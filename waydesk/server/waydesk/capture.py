"""GStreamer yakalama hattı: PipeWire düğümü → (ölçekle) → JPEG → asyncio.

    pipewiresrc path=<düğüm> ! video/x-raw,max-framerate=<fps>/1
      ! queue (sızdıran, 1 kare) ! videoscale ! videoconvert ! jpegenc ! appsink

- Kare hızını Mutter sınırlar (max-framerate). Mutter, sınır yüzünden atladığı son
  değişikliği "follow-up" karesiyle sonradan yine gönderir; ekran donuk kalmaz.
- Pipewiresrc çıkışındaki prob, Mutter sınırı uygulamazsa diye bir emniyet sınırıdır
  (jeton kovası: ortalamayı fps'te tutar, kısa titremelerde kare atmaz).
- Sızdıran kuyruk, kodlama yavaşlarsa PipeWire tarafını bekletmeden eski kareyi atar.
- Hat yalnız izleyen istemci varken PLAYING'dir. NULL'da PipeWire tüketicisi kopar ve
  Mutter o monitör için kare üretmeyi bırakır.
- Durum geçişleri (PipeWire'a bağlanma/kopma) bloklayabildiği için ayrı thread'de yapılır;
  asyncio döngüsü donmaz.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Callable

import gi

gi.require_version("Gst", "1.0")
from gi.repository import Gst  # noqa: E402

log = logging.getLogger(__name__)

SOURCE_PIPEWIRE = "pipewire"
SOURCE_TEST = "test"

PROBE_BURST = 2.0  # jeton kovası kapasitesi (kare)
PROBE_HEADROOM = 1.15  # kova fps'in biraz üstünde dolar; titreme birikip kare attırmasın


@dataclass(frozen=True)
class EncodedFrame:
    data: bytes
    width: int
    height: int
    encode_ms: float | None  # yakalama zaman damgasından appsink'e kadar geçen süre


def scaled_size(width: int, height: int, max_width: int) -> tuple[int, int]:
    """max_width'i aşan kaynağı en-boy oranını koruyarak küçültür (çift boyutlar)."""
    if max_width <= 0 or width <= max_width:
        return width, height
    new_h = round(height * max_width / width)
    return max_width - max_width % 2, new_h - new_h % 2


class JpegCapture:
    def __init__(self, *, source: str, node_id: int | None, width: int, height: int,
                 fps: int, max_width: int, quality: int,
                 on_frame: Callable[[EncodedFrame], None],
                 on_error: Callable[[str], None]):
        self._source = source
        self._node_id = node_id
        self._width, self._height = width, height
        self._fps = fps
        self._max_width = max_width
        self._quality = quality
        self._on_frame = on_frame
        self._on_error = on_error
        self._use_max_framerate = True
        self._pipeline: Gst.Pipeline | None = None
        self._bus_task: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._tokens = PROBE_BURST
        self._last_probe = time.monotonic()
        self.frames = 0  # toplam teslim edilen (ilk kare gözcüsü için)
        # Saniyelik teşhis sayaçları; take_counters() okur ve sıfırlar.
        self.source_count = 0
        self.dropped_by_probe = 0
        self.encoded_count = 0
        self.encoded_bytes = 0

    @property
    def running(self) -> bool:
        return self._pipeline is not None

    def describe(self) -> str:
        if self._source == SOURCE_TEST:
            src = (f"videotestsrc name=src is-live=true pattern=smpte "
                   f"! video/x-raw,format=BGRx,width={self._width},height={self._height},"
                   f"framerate={self._fps}/1 ! timeoverlay font-desc=\"Sans 40\" ")
        else:
            src = (f"pipewiresrc name=src path={self._node_id} always-copy=true do-timestamp=true ")
            if self._use_max_framerate:
                src += f"! video/x-raw,max-framerate={self._fps}/1 "
        out_w, out_h = scaled_size(self._width, self._height, self._max_width)
        scale = ""
        if (out_w, out_h) != (self._width, self._height):
            scale = f"! video/x-raw,width={out_w},height={out_h},pixel-aspect-ratio=1/1 "
        return (src
                + "! queue max-size-buffers=1 max-size-bytes=0 max-size-time=0 leaky=downstream "
                + "! videoscale " + scale
                + f"! videoconvert ! jpegenc quality={self._quality} "
                + "! appsink name=sink emit-signals=true max-buffers=1 drop=true sync=false")

    async def start(self) -> bool:
        """Hattı PLAYING'e alır. Başarısızsa on_error çağrılır ve False döner."""
        if self._pipeline is not None:
            return True
        self._loop = asyncio.get_running_loop()
        description = self.describe()
        log.debug("hat: %s", description)
        pipeline = Gst.parse_launch(description)
        pipeline.get_by_name("sink").connect("new-sample", self._on_new_sample)
        src_pad = pipeline.get_by_name("src").get_static_pad("src")
        src_pad.add_probe(Gst.PadProbeType.BUFFER, self._rate_probe)
        self._pipeline = pipeline
        result = await self._loop.run_in_executor(None, pipeline.set_state, Gst.State.PLAYING)
        if result == Gst.StateChangeReturn.FAILURE:
            reason = "hat PLAYING durumuna geçemedi"
            msg = pipeline.get_bus().pop_filtered(Gst.MessageType.ERROR)
            if msg is not None:
                err, debug = msg.parse_error()
                reason += f": {err.message}" + (f" ({debug})" if debug else "")
            await self.stop()
            self._on_error(reason)
            return False
        self._bus_task = asyncio.create_task(self._watch_bus())
        log.info("yakalama başladı (%s)", "test deseni" if self._source == SOURCE_TEST
                 else f"PipeWire düğümü {self._node_id}")
        return True

    async def stop(self) -> None:
        if self._bus_task is not None:
            if self._bus_task is not asyncio.current_task():
                self._bus_task.cancel()
            self._bus_task = None
        pipeline, self._pipeline = self._pipeline, None
        if pipeline is not None:
            await asyncio.get_running_loop().run_in_executor(
                None, pipeline.set_state, Gst.State.NULL)
            log.info("yakalama durdu")

    # ---- akış thread'i --------------------------------------------------------

    def _rate_probe(self, _pad, _info):
        now = time.monotonic()
        self.source_count += 1
        self._tokens = min(PROBE_BURST, self._tokens + (now - self._last_probe) * self._fps * PROBE_HEADROOM)
        self._last_probe = now
        if self._tokens < 1.0:
            self.dropped_by_probe += 1
            return Gst.PadProbeReturn.DROP
        self._tokens -= 1.0
        return Gst.PadProbeReturn.OK

    def _on_new_sample(self, sink):
        sample = sink.emit("pull-sample")
        if sample is None:
            return Gst.FlowReturn.OK
        buf = sample.get_buffer()
        ok, info = buf.map(Gst.MapFlags.READ)
        if not ok:
            return Gst.FlowReturn.OK
        try:
            data = bytes(info.data)
        finally:
            buf.unmap(info)
        structure = sample.get_caps().get_structure(0)
        frame = EncodedFrame(data, structure.get_value("width"), structure.get_value("height"),
                             self._encode_latency_ms(buf))
        loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self._deliver, frame)
        return Gst.FlowReturn.OK

    def _encode_latency_ms(self, buf) -> float | None:
        pipeline = self._pipeline
        if pipeline is None or buf.pts == Gst.CLOCK_TIME_NONE:
            return None
        clock = pipeline.get_clock()
        if clock is None:
            return None
        running = clock.get_time() - pipeline.get_base_time()
        value = (running - buf.pts) / Gst.MSECOND
        return value if 0 <= value < 10_000 else None

    # ---- asyncio --------------------------------------------------------------

    def _deliver(self, frame: EncodedFrame) -> None:
        if self._pipeline is None:
            return  # durdurulduktan sonra gelen geç kare
        self.frames += 1
        self.encoded_count += 1
        self.encoded_bytes += len(frame.data)
        self._on_frame(frame)

    def take_counters(self) -> tuple[int, int, int, int]:
        """(kaynak, probun attığı, kodlanan, kodlanan bayt) — son çağrıdan beri."""
        counters = (self.source_count, self.dropped_by_probe, self.encoded_count, self.encoded_bytes)
        self.source_count = self.dropped_by_probe = self.encoded_count = self.encoded_bytes = 0
        return counters

    async def _watch_bus(self) -> None:
        mask = Gst.MessageType.ERROR | Gst.MessageType.WARNING | Gst.MessageType.EOS
        while self._pipeline is not None:
            bus = self._pipeline.get_bus()
            while (msg := bus.pop_filtered(mask)) is not None:
                if msg.type == Gst.MessageType.WARNING:
                    err, _debug = msg.parse_warning()
                    log.warning("GStreamer uyarısı: %s", err.message)
                    continue
                if msg.type == Gst.MessageType.EOS:
                    reason = "akış bitti (EOS)"
                else:
                    err, debug = msg.parse_error()
                    reason = f"{err.message} ({debug})" if debug else err.message
                    if (self._use_max_framerate and self._source == SOURCE_PIPEWIRE
                            and "not-negotiated" in reason):
                        log.warning("max-framerate ile pazarlık başarısız; sınır yalnız probla uygulanacak")
                        self._use_max_framerate = False
                        await self.stop()
                        await self.start()
                        return
                await self.stop()
                self._on_error(reason)
                return
            await asyncio.sleep(0.2)
