"""Aşama 1 testleri: protokol, monitör sıralaması, Mutter oturumu (sahte), akış kontrolü, JPEG hattı.

Çalıştırma (repo kökünden):
    python3 -m unittest discover -s waydesk/tests -v

D-Bus testleri özel bir dbus-daemon açar; sistemde dbus-daemon yoksa atlanır.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from waydesk.protocol import HEADER, KIND_JPEG, pack_frame, unpack_header  # noqa: E402


class ProtocolTest(unittest.TestCase):
    def test_roundtrip(self):
        packet = pack_frame(KIND_JPEG, 3, 1, 2**32 + 7, b"\xff\xd8abc")
        kind, monitor, flags, seq, _ts = unpack_header(packet)
        self.assertEqual((kind, monitor, flags, seq), (KIND_JPEG, 3, 1, 7))
        self.assertEqual(HEADER.size, 12)
        self.assertEqual(packet[12:], b"\xff\xd8abc")


class ScaledSizeTest(unittest.TestCase):
    def test_scaling(self):
        from waydesk.capture import scaled_size

        self.assertEqual(scaled_size(2560, 1600, 1600), (1600, 1000))
        self.assertEqual(scaled_size(2560, 1440, 1600), (1600, 900))
        self.assertEqual(scaled_size(1920, 1080, 1600), (1600, 900))
        self.assertEqual(scaled_size(1280, 720, 1600), (1280, 720))
        self.assertEqual(scaled_size(2560, 1440, 0), (2560, 1440))


@unittest.skipUnless(shutil.which("dbus-daemon"), "dbus-daemon yok")
class MutterDBusTest(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.daemon = subprocess.Popen(
            ["dbus-daemon", "--session", "--nofork", "--print-address=1"],
            stdout=subprocess.PIPE, text=True)
        cls.address = cls.daemon.stdout.readline().strip()
        cls._old_address = os.environ.get("DBUS_SESSION_BUS_ADDRESS")
        os.environ["DBUS_SESSION_BUS_ADDRESS"] = cls.address

    @classmethod
    def tearDownClass(cls):
        cls.daemon.terminate()
        cls.daemon.wait()
        cls.daemon.stdout.close()
        if cls._old_address is None:
            os.environ.pop("DBUS_SESSION_BUS_ADDRESS", None)
        else:
            os.environ["DBUS_SESSION_BUS_ADDRESS"] = cls._old_address

    async def asyncSetUp(self):
        from dbus_next.aio import MessageBus

        from fake_mutter import FakeMutter

        self.service_bus = await MessageBus().connect()
        self.fake = FakeMutter(self.service_bus)
        await self.fake.start()
        self.bus = await MessageBus().connect()

    async def asyncTearDown(self):
        self.bus.disconnect()
        self.service_bus.disconnect()

    async def test_monitors_left_to_right(self):
        from waydesk.app import pick_monitor
        from waydesk.displays import read_monitors

        monitors = await read_monitors(self.bus)
        self.assertEqual([m.connector for m in monitors], ["DP-1", "eDP-1", "HDMI-1"])
        self.assertEqual([m.index for m in monitors], [1, 2, 3])
        edp = monitors[1]
        self.assertEqual((edp.width, edp.height, edp.primary), (2560, 1600, True))
        self.assertAlmostEqual(edp.scale, 1.50235)
        self.assertEqual(pick_monitor(monitors, 0).connector, "eDP-1")
        self.assertEqual(pick_monitor(monitors, 3).connector, "HDMI-1")

    async def test_session_start_and_external_close(self):
        from waydesk.mutter import MutterSession

        closed = asyncio.Event()
        session = MutterSession(self.bus, on_closed=closed.set)
        streams = await session.start(["eDP-1"])
        self.assertIn("eDP-1", streams)
        stream = streams["eDP-1"]
        self.assertTrue(stream.object_path.startswith("/org/gnome/Mutter/ScreenCast/Stream/"))
        self.assertGreater(stream.node_id, 40)
        self.assertTrue(session.active)
        self.assertTrue(self.fake.rd_sessions[0].started)

        self.fake.close_all()
        await asyncio.wait_for(closed.wait(), 2)
        self.assertFalse(session.active)

    async def test_session_stop_does_not_report_closed(self):
        from waydesk.mutter import MutterSession

        closed = asyncio.Event()
        session = MutterSession(self.bus, on_closed=closed.set)
        await session.start(["HDMI-1"])
        await session.stop()
        await asyncio.sleep(0.2)
        self.assertFalse(closed.is_set())
        self.assertEqual(self.fake.rd_sessions, [])

    async def test_unknown_monitor_fails(self):
        from dbus_next import DBusError

        from waydesk.mutter import MutterSession

        session = MutterSession(self.bus)
        with self.assertRaises(DBusError):
            await session.start(["VGA-9"])
        await session.stop()


class _FakeWS:
    def __init__(self):
        self.closed = False
        self.sent: list[bytes] = []

    async def send_bytes(self, data):
        self.sent.append(data)


class FlowControlTest(unittest.IsolatedAsyncioTestCase):
    async def test_inflight_limit_and_latest_wins(self):
        from waydesk.app import MAX_INFLIGHT, Client, Frame

        ws = _FakeWS()
        client = Client(ws, "test")
        sender = asyncio.create_task(client.run_sender())
        for seq in range(1, 6):
            client.offer(Frame(seq, bytes([seq]), 1, 1))
            await asyncio.sleep(0)
        await asyncio.sleep(0.05)
        self.assertEqual(len(ws.sent), MAX_INFLIGHT)
        self.assertEqual(client.pending.seq, 5)  # aradaki kareler atlandı

        client.ack(ws.sent[0][0], drawn=True)
        await asyncio.sleep(0.05)
        self.assertEqual([d[0] for d in ws.sent], [1, 2, 5])
        self.assertIsNone(client.pending)
        self.assertEqual(len(client.latencies), 1)
        ws.closed = True
        sender.cancel()


class RateProbeTest(unittest.TestCase):
    """Emniyet probu: Mutter sınıra uyuyorsa (titremeli 30 fps) kare atmamalı,
    uymuyorsa (165 fps) ortalamayı ~30'da tutmalı."""

    def _run(self, timestamps):
        from unittest import mock

        import gi

        gi.require_version("Gst", "1.0")
        from gi.repository import Gst

        from waydesk import capture as capture_mod

        cap = capture_mod.JpegCapture(source="pipewire", node_id=1, width=1920, height=1080,
                                      fps=30, max_width=0, quality=50,
                                      on_frame=lambda f: None, on_error=lambda r: None)
        cap._last_probe = timestamps[0]
        passed = 0
        for t in timestamps:
            with mock.patch.object(capture_mod.time, "monotonic", return_value=t):
                if cap._rate_probe(None, None) == Gst.PadProbeReturn.OK:
                    passed += 1
        return passed, cap.dropped_by_probe

    def test_jittery_30fps_is_not_dropped(self):
        import random

        rng = random.Random(1)
        timestamps, t = [], 100.0
        for _ in range(300):  # 10 sn, 33.3 ms ± 8 ms
            t += 1 / 30 + rng.uniform(-0.008, 0.008)
            timestamps.append(t)
        passed, dropped = self._run(timestamps)
        self.assertEqual(dropped, 0)
        self.assertEqual(passed, 300)

    def test_165fps_is_capped_near_30(self):
        timestamps = [100.0 + i / 165 for i in range(165 * 4)]  # 4 sn
        passed, _dropped = self._run(timestamps)
        self.assertLessEqual(passed, 30 * 1.15 * 4 + 3)
        self.assertGreaterEqual(passed, 30 * 4)


class JpegCaptureTest(unittest.IsolatedAsyncioTestCase):
    async def test_test_source_produces_scaled_jpeg(self):
        import gi

        gi.require_version("Gst", "1.0")
        from gi.repository import Gst

        Gst.init(None)
        from waydesk.capture import SOURCE_TEST, JpegCapture

        frames = []
        got = asyncio.Event()

        def on_frame(frame):
            frames.append(frame)
            if len(frames) >= 3:
                got.set()

        capture = JpegCapture(source=SOURCE_TEST, node_id=None, width=1920, height=1080, fps=30,
                              max_width=1280, quality=50, on_frame=on_frame,
                              on_error=lambda reason: self.fail(reason))
        self.assertTrue(await capture.start())
        try:
            await asyncio.wait_for(got.wait(), 5)
        finally:
            await capture.stop()
        frame = frames[-1]
        self.assertEqual((frame.width, frame.height), (1280, 720))
        self.assertTrue(frame.data.startswith(b"\xff\xd8"))
        self.assertFalse(capture.running)


if __name__ == "__main__":
    unittest.main()
