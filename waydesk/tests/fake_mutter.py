"""Testler için sahte Mutter: DisplayConfig + RemoteDesktop + ScreenCast D-Bus servisleri.

Arayüz adları, imzalar ve davranış Mutter 46.2 kaynağındaki XML'e ve
meta-screen-cast-session.c'ye göre taklit edilir (ör. bağlı ScreenCast oturumu
kendi Start'ıyla başlatılamaz). Gerçek PipeWire düğümü yoktur; sahte düğüm
numaraları üretilir.
"""

from __future__ import annotations

import asyncio
import itertools
import os
import signal as signals
import sys

from dbus_next import DBusError, Variant
from dbus_next.aio import MessageBus
from dbus_next.service import PropertyAccess, ServiceInterface, dbus_property, method, signal

MONITORS = [
    # connector, vendor, product, w, h, hz, scale, x, y, primary, display-name
    ("DP-1", "GWD", "ARZOPA", 1920, 1080, 144.0, 1.0, 0, 941, False, 'GWD 16"'),
    ("eDP-1", "BOE", "0x0b9f", 2560, 1600, 165.0, 1.50235, 1920, 764, True, "Built-in display"),
    ("HDMI-1", "JDR", "27Q", 2560, 1440, 143.98, 1.0, 3624, 0, False, 'JDR 27"'),
]

_ids = itertools.count(1)


class DisplayConfig(ServiceInterface):
    def __init__(self):
        super().__init__("org.gnome.Mutter.DisplayConfig")

    @method()
    def GetCurrentState(self) -> "ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv}":
        monitors, logical = [], []
        for conn, vendor, product, w, h, hz, scale, x, y, primary, name in MONITORS:
            spec = [conn, vendor, product, "0"]
            modes = [
                [f"{w}x{h}@{hz}", w, h, hz, 1.0, [1.0, scale],
                 {"is-current": Variant("b", True), "is-preferred": Variant("b", True)}],
                ["1280x720@60", 1280, 720, 60.0, 1.0, [1.0], {}],
            ]
            monitors.append([spec, modes, {"display-name": Variant("s", name)}])
            logical.append([x, y, scale, 0, primary, [spec], {}])
        return [1, monitors, logical, {"layout-mode": Variant("u", 1)}]


class RemoteDesktopSession(ServiceInterface):
    def __init__(self, service: "FakeMutter", session_id: str):
        super().__init__("org.gnome.Mutter.RemoteDesktop.Session")
        self.service = service
        self.session_id = session_id
        self.started = False
        self.calls: list[tuple] = []

    @dbus_property(access=PropertyAccess.READ)
    def SessionId(self) -> "s":
        return self.session_id

    @method()
    def Start(self):
        if self.started:
            raise DBusError("org.freedesktop.DBus.Error.Failed", "Already started")
        self.started = True
        for sc in self.service.screencasts:
            if sc.remote_desktop_session_id == self.session_id:
                sc.start_streams()

    @method()
    def Stop(self):
        self.Closed()
        self.service.close_rd(self)

    @signal()
    def Closed(self):
        pass

    @method()
    def NotifyPointerMotionAbsolute(self, stream: "s", x: "d", y: "d"):
        self.calls.append(("motion_abs", stream, x, y))

    @method()
    def NotifyPointerButton(self, button: "i", state: "b"):
        self.calls.append(("button", button, state))

    @method()
    def NotifyKeyboardKeysym(self, keysym: "u", state: "b"):
        self.calls.append(("keysym", keysym, state))


class ScreenCastStream(ServiceInterface):
    def __init__(self, connector: str, node_id: int):
        super().__init__("org.gnome.Mutter.ScreenCast.Stream")
        self.connector = connector
        self.node_id = node_id

    @signal()
    def PipeWireStreamAdded(self) -> "u":
        return self.node_id

    @dbus_property(access=PropertyAccess.READ)
    def Parameters(self) -> "a{sv}":
        return {"output-name": Variant("s", self.connector)}


class ScreenCastSession(ServiceInterface):
    def __init__(self, service: "FakeMutter", remote_desktop_session_id: str | None):
        super().__init__("org.gnome.Mutter.ScreenCast.Session")
        self.service = service
        self.remote_desktop_session_id = remote_desktop_session_id
        self.streams: list[ScreenCastStream] = []

    @method()
    def Start(self):
        if self.remote_desktop_session_id:
            raise DBusError("org.freedesktop.DBus.Error.Failed",
                            "Must be started from remote desktop session")
        self.start_streams()

    @method()
    def RecordMonitor(self, connector: "s", properties: "a{sv}") -> "o":
        if connector not in {m[0] for m in MONITORS}:
            raise DBusError("org.freedesktop.DBus.Error.Failed", "Unknown monitor")
        mode = properties.get("cursor-mode")
        if mode is not None and mode.value not in (0, 1, 2):
            raise DBusError("org.freedesktop.DBus.Error.Failed", "Unknown cursor mode")
        # FAKE_MUTTER_NODE_ID: uçtan uca testte gerçek bir PipeWire düğümünü taklit et.
        node_id = int(os.environ.get("FAKE_MUTTER_NODE_ID", 0)) or 40 + next(_ids)
        stream = ScreenCastStream(connector, node_id)
        path = f"/org/gnome/Mutter/ScreenCast/Stream/u{next(_ids)}"
        self.service.bus.export(path, stream)
        self.streams.append(stream)
        return path

    def start_streams(self):
        for stream in self.streams:
            stream.PipeWireStreamAdded()


class RemoteDesktop(ServiceInterface):
    def __init__(self, service: "FakeMutter"):
        super().__init__("org.gnome.Mutter.RemoteDesktop")
        self.service = service

    @method()
    def CreateSession(self) -> "o":
        n = next(_ids)
        session = RemoteDesktopSession(self.service, f"rd-session-{n}")
        path = f"/org/gnome/Mutter/RemoteDesktop/Session/u{n}"
        self.service.bus.export(path, session)
        self.service.rd_sessions.append(session)
        return path

    @dbus_property(access=PropertyAccess.READ)
    def SupportedDeviceTypes(self) -> "u":
        return 7

    @dbus_property(access=PropertyAccess.READ)
    def Version(self) -> "i":
        return 1


class ScreenCast(ServiceInterface):
    def __init__(self, service: "FakeMutter"):
        super().__init__("org.gnome.Mutter.ScreenCast")
        self.service = service

    @method()
    def CreateSession(self, properties: "a{sv}") -> "o":
        rd_id = properties.get("remote-desktop-session-id")
        session = ScreenCastSession(self.service, rd_id.value if rd_id else None)
        path = f"/org/gnome/Mutter/ScreenCast/Session/u{next(_ids)}"
        self.service.bus.export(path, session)
        self.service.screencasts.append(session)
        return path

    @dbus_property(access=PropertyAccess.READ)
    def Version(self) -> "i":
        return 4


class FakeMutter:
    def __init__(self, bus: MessageBus):
        self.bus = bus
        self.rd_sessions: list[RemoteDesktopSession] = []
        self.screencasts: list[ScreenCastSession] = []

    async def start(self):
        self.bus.export("/org/gnome/Mutter/DisplayConfig", DisplayConfig())
        self.bus.export("/org/gnome/Mutter/RemoteDesktop", RemoteDesktop(self))
        self.bus.export("/org/gnome/Mutter/ScreenCast", ScreenCast(self))
        for name in ("org.gnome.Mutter.DisplayConfig", "org.gnome.Mutter.RemoteDesktop",
                     "org.gnome.Mutter.ScreenCast"):
            await self.bus.request_name(name)

    def close_rd(self, session: RemoteDesktopSession):
        if session in self.rd_sessions:
            self.rd_sessions.remove(session)

    def close_all(self):
        """Kullanıcı GNOME'daki "paylaşımı durdur"a basmış gibi."""
        for session in list(self.rd_sessions):
            session.Closed()
            self.close_rd(session)


async def main() -> None:
    bus = await MessageBus().connect()
    fake = FakeMutter(bus)
    await fake.start()
    # SIGUSR1: GNOME'da "paylaşımı durdur"a basılmış gibi tüm oturumları kapat.
    asyncio.get_running_loop().add_signal_handler(signals.SIGUSR1, fake.close_all)
    print("fake mutter hazır", flush=True)
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
