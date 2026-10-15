"""Mutter'ın doğrudan D-Bus API'si: RemoteDesktop oturumu + ona bağlı ScreenCast oturumu.

gnome-remote-desktop'ın kullandığı API. Portal'dan farkı: izin diyaloğu yok, monitör
connector adıyla (ör. "eDP-1") seçilir. Sıra (Mutter 46 kaynağına göre):

  RemoteDesktop.CreateSession → Session.SessionId
  ScreenCast.CreateSession({"remote-desktop-session-id": id})
  ScreenCast.Session.RecordMonitor(connector, {"cursor-mode": 1})  → Stream
  RemoteDesktop.Session.Start   (bağlı ScreenCast oturumu buradan başlar)
  Stream.PipeWireStreamAdded(node_id)

Oturum, D-Bus bağlantısı kapanınca (süreç bitince) Mutter tarafından kendiliğinden kapatılır.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Callable

from dbus_next import Variant
from dbus_next.aio import MessageBus

log = logging.getLogger(__name__)

RD_NAME = "org.gnome.Mutter.RemoteDesktop"
RD_PATH = "/org/gnome/Mutter/RemoteDesktop"
RD_IFACE = "org.gnome.Mutter.RemoteDesktop"
RD_SESSION_IFACE = "org.gnome.Mutter.RemoteDesktop.Session"

SC_NAME = "org.gnome.Mutter.ScreenCast"
SC_PATH = "/org/gnome/Mutter/ScreenCast"
SC_IFACE = "org.gnome.Mutter.ScreenCast"
SC_SESSION_IFACE = "org.gnome.Mutter.ScreenCast.Session"
SC_STREAM_IFACE = "org.gnome.Mutter.ScreenCast.Stream"

CURSOR_HIDDEN = 0
CURSOR_EMBEDDED = 1
CURSOR_METADATA = 2

NODE_TIMEOUT = 10.0


class MutterError(RuntimeError):
    pass


@dataclass(frozen=True)
class Stream:
    connector: str
    object_path: str  # NotifyPointerMotionAbsolute'un "stream" argümanı
    node_id: int  # PipeWire düğümü (pipewiresrc path=)


class MutterSession:
    def __init__(self, bus: MessageBus, on_closed: Callable[[], None] | None = None):
        self._bus = bus
        self._on_closed = on_closed
        self._rd = None
        self._sc = None
        self._closed = True
        self.streams: dict[str, Stream] = {}

    @property
    def active(self) -> bool:
        return not self._closed

    async def _iface(self, name: str, path: str, iface: str):
        introspection = await self._bus.introspect(name, path)
        return self._bus.get_proxy_object(name, path, introspection).get_interface(iface)

    async def start(self, connectors: list[str], cursor_mode: int = CURSOR_EMBEDDED) -> dict[str, Stream]:
        try:
            rd = await self._iface(RD_NAME, RD_PATH, RD_IFACE)
            sc = await self._iface(SC_NAME, SC_PATH, SC_IFACE)
        except Exception as exc:  # noqa: BLE001 — dbus-next birçok hata türü fırlatır
            raise MutterError(
                "Mutter RemoteDesktop/ScreenCast D-Bus API'sine ulaşılamadı. "
                "GNOME Wayland oturumundaki bir terminalden mi çalıştırıyorsun?"
            ) from exc

        rd_path = await rd.call_create_session()
        self._rd = await self._iface(RD_NAME, rd_path, RD_SESSION_IFACE)
        self._rd.on_closed(self._handle_closed)
        self._closed = False
        session_id = await self._rd.get_session_id()

        sc_path = await sc.call_create_session(
            {"remote-desktop-session-id": Variant("s", session_id)})
        self._sc = await self._iface(SC_NAME, sc_path, SC_SESSION_IFACE)

        loop = asyncio.get_running_loop()
        pending = []
        for connector in connectors:
            stream_path = await self._sc.call_record_monitor(
                connector, {"cursor-mode": Variant("u", cursor_mode)})
            stream_iface = await self._iface(SC_NAME, stream_path, SC_STREAM_IFACE)
            node_future = loop.create_future()
            stream_iface.on_pipe_wire_stream_added(_resolver(node_future))
            pending.append((connector, stream_path, node_future))

        await self._rd.call_start()

        streams = {}
        for connector, stream_path, node_future in pending:
            try:
                node_id = await asyncio.wait_for(node_future, NODE_TIMEOUT)
            except asyncio.TimeoutError as exc:
                raise MutterError(f"{connector} için PipeWire düğümü {NODE_TIMEOUT:.0f} sn içinde gelmedi") from exc
            streams[connector] = Stream(connector, stream_path, int(node_id))
            log.info("ekran yayını hazır: %s → PipeWire düğümü %s", connector, node_id)
        self.streams = streams
        return streams

    async def stop(self) -> None:
        was_open = self._rd is not None and not self._closed
        # Mutter, Stop yanıtından önce Closed sinyali yollar; kendi kapatmamızı
        # "dışarıdan kapandı" sanmamak için bayrağı önce kaldır.
        self._closed = True
        self.streams = {}
        if was_open:
            try:
                await self._rd.call_stop()
            except Exception as exc:  # noqa: BLE001 — oturum zaten kapanmış olabilir
                log.debug("Session.Stop: %s", exc)

    def _handle_closed(self) -> None:
        if self._closed:
            return
        self._closed = True
        self.streams = {}
        log.warning("Mutter uzak masaüstü oturumu kapandı")
        if self._on_closed is not None:
            self._on_closed()


def _resolver(future: asyncio.Future):
    # dbus-next sinyal işleyicisinin parametre sayısını denetler; tek argümanlı kalmalı.
    def on_added(node_id):
        if not future.done():
            future.set_result(node_id)
    return on_added
