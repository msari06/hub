"""waydesk sunucusu: istemci dosyalarını HTTP'den sunar, kareleri WebSocket'ten yollar.

Akış kontrolü: istemci her kareyi çizince ``ack`` yollar. İstemci başına havada en
fazla MAX_INFLIGHT kare olur; fazlası beklemez, yalnız en yeni kare "sırada" tutulur.
Böylece yavaş ağda gecikme birikmez, kare atlanır.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import signal
import socket
import statistics
import time
from dataclasses import dataclass
from pathlib import Path

from aiohttp import WSMsgType, web

from . import __version__
from .capture import SOURCE_TEST, EncodedFrame, JpegCapture
from .displays import Monitor
from .protocol import FLAG_KEYFRAME, KIND_JPEG, PROTOCOL_VERSION, pack_frame

log = logging.getLogger(__name__)

CLIENT_DIR = Path(__file__).resolve().parents[2] / "client"

MAX_INFLIGHT = 2
INFLIGHT_TIMEOUT = 2.0  # sn; kaybolan ack'ler akışı kilitlemesin
CAPTURE_IDLE_STOP = 5.0  # sn; son istemci gidince yakalamayı durdurmadan önce bekle
FIRST_FRAME_TIMEOUT = 3.0  # sn; Mutter tüketici bağlanınca hemen bir kare çizer
RETRY_DELAY = 3.0


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    source: str
    monitor: int  # 0 = birincil
    fps: int
    max_width: int
    quality: int


@dataclass(frozen=True)
class Frame:
    seq: int
    packet: bytes
    width: int
    height: int


class Client:
    def __init__(self, ws: web.WebSocketResponse, peer: str):
        self.ws = ws
        self.peer = peer
        self.pending: Frame | None = None
        self.inflight: dict[int, float] = {}
        self.wake = asyncio.Event()
        self.latencies: list[float] = []
        self.sent_frames = 0
        self.sent_bytes = 0
        self.skipped = 0  # gönderilemeden yenisiyle değiştirilen kareler (ağ/telefon yetişemedi)

    def offer(self, frame: Frame) -> None:
        if self.pending is not None:
            self.skipped += 1
        self.pending = frame
        self.wake.set()

    def ack(self, seq: int) -> None:
        """İstemci kareyi aldı (henüz çizmedi); gecikme = gönderim → alım onayı."""
        sent_at = self.inflight.pop(seq, None)
        if sent_at is not None:
            self.latencies.append((time.monotonic() - sent_at) * 1000)
        self.wake.set()

    async def run_sender(self) -> None:
        while not self.ws.closed:
            try:
                await asyncio.wait_for(self.wake.wait(), 0.5)
            except asyncio.TimeoutError:
                pass
            self.wake.clear()
            now = time.monotonic()
            for seq in [s for s, t in self.inflight.items() if now - t > INFLIGHT_TIMEOUT]:
                del self.inflight[seq]
            while self.pending is not None and len(self.inflight) < MAX_INFLIGHT:
                frame, self.pending = self.pending, None
                self.inflight[frame.seq] = time.monotonic()
                try:
                    await self.ws.send_bytes(frame.packet)
                except (ConnectionError, RuntimeError):
                    return
                self.sent_frames += 1
                self.sent_bytes += len(frame.packet)

    def take_stats(self, elapsed: float) -> dict:
        stats = {
            "t": "stats",
            "fps": round(self.sent_frames / elapsed, 1),
            "kbps": round(self.sent_bytes * 8 / 1000 / elapsed),
            "lat": round(statistics.median(self.latencies)) if self.latencies else None,
            "skip": round(self.skipped / elapsed, 1),
            "kb": round(self.sent_bytes / self.sent_frames / 1024) if self.sent_frames else None,
        }
        self.sent_frames = 0
        self.sent_bytes = 0
        self.skipped = 0
        self.latencies.clear()
        return stats


class Server:
    def __init__(self, config: Config):
        self.config = config
        self.clients: set[Client] = set()
        self.monitors: list[Monitor] = []
        self.active: Monitor | None = None
        self.session = None  # MutterSession
        self.node_id: int | None = None
        self.capture: JpegCapture | None = None
        self.latest: Frame | None = None
        self.seq = 0
        self.encode_ms: list[float] = []
        self._stop_event = asyncio.Event()
        self._idle_handle: asyncio.TimerHandle | None = None
        self._capture_lock = asyncio.Lock()
        self._tasks: set[asyncio.Task] = set()
        self.client_build = _client_build()

    # ---- yaşam döngüsü ----------------------------------------------------------

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, self._stop_event.set)

        await self._setup_source()

        app = web.Application(middlewares=[_no_cache])
        app.router.add_get("/ws", self._ws_handler)
        app.router.add_get("/", self._index)
        app.router.add_static("/", CLIENT_DIR)
        runner = web.AppRunner(app, access_log=None)
        await runner.setup()
        site = web.TCPSite(runner, self.config.host, self.config.port)
        await site.start()
        self._log_urls()
        self._spawn(self._stats_loop())

        await self._stop_event.wait()
        log.info("kapatılıyor…")
        for ws in [c.ws for c in self.clients]:
            await ws.close()
        async with self._capture_lock:
            if self.capture is not None:
                await self.capture.stop()
                self.capture = None
        if self.session is not None:
            await self.session.stop()
        for task in list(self._tasks):
            task.cancel()
        await runner.cleanup()

    async def _setup_source(self) -> None:
        if self.config.source == SOURCE_TEST:
            self.monitors = [Monitor(1, "TEST", "Test deseni", 0, 0, 1920, 1080, 60.0, 1.0, True)]
            self.active = self.monitors[0]
            return

        from dbus_next.aio import MessageBus

        from .displays import read_monitors
        from .mutter import MutterSession

        bus = await MessageBus().connect()
        self.monitors = await read_monitors(bus)
        for m in self.monitors:
            log.info("monitör %d: %s %s %dx%d@%g ölçek=%g%s", m.index, m.connector, m.name,
                     m.width, m.height, m.refresh, m.scale, " (birincil)" if m.primary else "")
        self.active = pick_monitor(self.monitors, self.config.monitor)
        log.info("aktif monitör: %d (%s)", self.active.index, self.active.connector)
        self.session = MutterSession(bus, on_closed=self._on_session_closed)
        # Oturum arka planda kurulur; başarısız olsa da web sunucusu ayağa kalkar ve
        # istemci durumu görür.
        self._spawn(self._start_session())

    async def _start_session(self) -> None:
        while not self._stop_event.is_set():
            try:
                streams = await self.session.start([self.active.connector])
                self.node_id = streams[self.active.connector].node_id
                self._broadcast({"t": "status", "state": "ok"})
                self._update_capture()
                return
            except Exception as exc:  # noqa: BLE001
                log.error("uzak masaüstü oturumu başlatılamadı: %s", exc)
                await self.session.stop()
                await asyncio.sleep(RETRY_DELAY)

    def _on_session_closed(self) -> None:
        self.node_id = None
        self._update_capture()
        self._broadcast({"t": "status", "state": "session-closed"})
        if not self._stop_event.is_set():
            self._spawn(self._restart_session())

    async def _restart_session(self) -> None:
        await asyncio.sleep(RETRY_DELAY)
        await self._start_session()

    # ---- yakalama -----------------------------------------------------------------
    #
    # Yakalama "istenen durum"a göre uzlaştırılır: kaynak hazırsa ve izleyen istemci
    # varsa (ya da son istemci gideli CAPTURE_IDLE_STOP olmadıysa) çalışır, yoksa durur.
    # Başlatma/durdurma tek kilit altında sırayla yapılır.

    def _update_capture(self) -> None:
        if self.clients and self._idle_handle is not None:
            self._idle_handle.cancel()
            self._idle_handle = None
        elif not self.clients and self.capture is not None and self._idle_handle is None:
            loop = asyncio.get_running_loop()
            self._idle_handle = loop.call_later(CAPTURE_IDLE_STOP, self._idle_expired)
        self._spawn(self._reconcile_capture())

    def _idle_expired(self) -> None:
        self._idle_handle = None
        self._spawn(self._reconcile_capture())

    def _source_ready(self) -> bool:
        return self.config.source == SOURCE_TEST or self.node_id is not None

    async def _reconcile_capture(self) -> None:
        async with self._capture_lock:
            want = (self._source_ready() and not self._stop_event.is_set()
                    and (bool(self.clients) or self._idle_handle is not None))
            if want and self.capture is None:
                m = self.active
                capture = JpegCapture(
                    source=self.config.source, node_id=self.node_id, width=m.width,
                    height=m.height, fps=self.config.fps, max_width=self.config.max_width,
                    quality=self.config.quality,
                    on_frame=lambda f: self._on_frame(capture, f),
                    on_error=lambda reason: self._on_capture_error(capture, reason))
                self.capture = capture
                if await capture.start():
                    asyncio.get_running_loop().call_later(
                        FIRST_FRAME_TIMEOUT, self._check_first_frame, capture)
            elif not want and self.capture is not None:
                capture, self.capture = self.capture, None
                self.latest = None
                await capture.stop()

    def _check_first_frame(self, capture: JpegCapture) -> None:
        if capture is self.capture and capture.running and capture.frames == 0:
            log.warning("ilk kare %.0f sn içinde gelmedi; yakalama yeniden başlatılıyor",
                        FIRST_FRAME_TIMEOUT)
            self._spawn(self._restart_capture(capture))

    async def _restart_capture(self, capture: JpegCapture) -> None:
        async with self._capture_lock:
            if capture is not self.capture:
                return
            self.capture = None
            self.latest = None
            await capture.stop()
        await self._reconcile_capture()

    def _on_capture_error(self, capture: JpegCapture, reason: str) -> None:
        log.error("yakalama hatası: %s", reason)
        if capture is not self.capture:
            return
        self.capture = None
        self.latest = None
        self._broadcast({"t": "status", "state": "capture-error", "detail": reason})
        self._spawn(self._retry_capture())

    async def _retry_capture(self) -> None:
        await asyncio.sleep(RETRY_DELAY)
        await self._reconcile_capture()

    def _on_frame(self, capture: JpegCapture, encoded: EncodedFrame) -> None:
        if capture is not self.capture:
            return
        self.seq += 1
        packet = pack_frame(KIND_JPEG, self.active.index, FLAG_KEYFRAME, self.seq, encoded.data)
        frame = Frame(self.seq, packet, encoded.width, encoded.height)
        self.latest = frame
        if encoded.encode_ms is not None:
            self.encode_ms.append(encoded.encode_ms)
        for client in self.clients:
            client.offer(frame)

    # ---- istemciler -----------------------------------------------------------

    async def _index(self, _request: web.Request) -> web.FileResponse:
        return web.FileResponse(CLIENT_DIR / "index.html")

    async def _ws_handler(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=10.0, compress=False, max_msg_size=1 << 20)
        await ws.prepare(request)
        client = Client(ws, request.remote or "?")
        self.clients.add(client)
        log.info("istemci bağlandı: %s (toplam %d)", client.peer, len(self.clients))
        await ws.send_json(self._hello())
        sender = asyncio.create_task(client.run_sender())
        self._update_capture()
        if self.latest is not None:
            client.offer(self.latest)
        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    self._handle_message(client, msg.data)
                elif msg.type == WSMsgType.ERROR:
                    break
        finally:
            self.clients.discard(client)
            sender.cancel()
            self._update_capture()
            log.info("istemci ayrıldı: %s (kalan %d)", client.peer, len(self.clients))
        return ws

    def _handle_message(self, client: Client, text: str) -> None:
        try:
            msg = json.loads(text)
            kind = msg.get("t")
        except (ValueError, AttributeError):
            log.debug("geçersiz mesaj: %.80s", text)
            return
        if kind == "ack":
            seq = msg.get("seq")
            if isinstance(seq, int):
                client.ack(seq)
        elif kind == "hello":
            pass
        else:
            log.debug("bilinmeyen mesaj türü: %s", kind)

    def _hello(self) -> dict:
        return {
            "t": "hello",
            "v": PROTOCOL_VERSION,
            "server": __version__,
            "monitors": [m.as_dict() for m in self.monitors],
            "active": self.active.index if self.active else None,
            "state": "ok" if self._source_ready() else "starting",
            "build": self.client_build,
        }

    def _broadcast(self, message: dict) -> None:
        data = json.dumps(message)
        for client in self.clients:
            self._spawn(_safe_send(client.ws, data))

    async def _stats_loop(self) -> None:
        last = time.monotonic()
        while True:
            await asyncio.sleep(1.0)
            now = time.monotonic()
            elapsed, last = now - last, now
            enc = round(statistics.median(self.encode_ms), 1) if self.encode_ms else None
            self.encode_ms.clear()
            source = dropped = encoded = 0
            if self.capture is not None:
                source, dropped, encoded, _ = self.capture.take_counters()
            pipeline_stats = {
                "enc": enc,
                "src": round(source / elapsed, 1),  # Mutter'dan gelen kare/sn
                "drop": round(dropped / elapsed, 1),  # emniyet probunun attığı
                "encfps": round(encoded / elapsed, 1),  # JPEG'e çevrilen
            }
            frame = self.latest
            for client in list(self.clients):
                stats = client.take_stats(elapsed)
                stats.update(pipeline_stats)
                if frame is not None:
                    stats["size"] = [frame.width, frame.height]
                await _safe_send(client.ws, json.dumps(stats))
            if self.clients and source:
                log.debug("kaynak %.0f/sn, prob attı %.0f/sn, kodlanan %.0f/sn",
                          source / elapsed, dropped / elapsed, encoded / elapsed)

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _log_urls(self) -> None:
        host, port = self.config.host, self.config.port
        hosts = [host]
        if host in ("0.0.0.0", "::", ""):
            hosts = [ip for ip in [_primary_ip(), "127.0.0.1"] if ip]
        for h in hosts:
            log.info("hazır → http://%s:%d/", h, port)
        if host in ("127.0.0.1", "localhost"):
            log.info("yalnız bu bilgisayardan erişilebilir; telefon için --host <LAN IP> ver")


def pick_monitor(monitors: list[Monitor], index: int) -> Monitor:
    if not monitors:
        raise RuntimeError("hiç monitör bulunamadı")
    if index:
        for m in monitors:
            if m.index == index:
                return m
        raise SystemExit(f"--monitor {index} yok; mevcut: {[m.index for m in monitors]}")
    return next((m for m in monitors if m.primary), monitors[0])


async def _safe_send(ws: web.WebSocketResponse, data: str) -> None:
    if ws.closed:
        return
    try:
        await ws.send_str(data)
    except (ConnectionError, RuntimeError):
        pass


@web.middleware
async def _no_cache(request: web.Request, handler):
    response = await handler(request)
    # Geliştirme aşamasında telefon eski JS'i önbellekten kullanmasın.
    if request.path != "/ws":
        response.headers["Cache-Control"] = "no-store"
    return response


def _client_build() -> str:
    """İstemci dosyalarının özeti. Değişirse açık sayfalar kendini yeniler."""
    digest = hashlib.sha1()
    for path in sorted(CLIENT_DIR.rglob("*")):
        if path.is_file():
            digest.update(path.name.encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


def _primary_ip() -> str | None:
    """Varsayılan rotanın yerel IP'si (paket gönderilmez)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))
            return s.getsockname()[0]
    except OSError:
        return None
