"""WebSocket protokolü.

Sunucu → istemci, binary kare mesajı (ağ bayt sırası, 12 baytlık başlık + yük):

    u8  kind     KIND_JPEG (Aşama 4'te H.264 eklenecek)
    u8  monitor  1 tabanlı monitör numarası (soldan sağa)
    u16 flags    FLAG_KEYFRAME, ...
    u32 seq      kare sıra numarası (istemci ack'te geri yollar)
    u32 ts_ms    sunucu monotonik saati (ms, 32 bit sarar)

Diğer tüm mesajlar JSON metin mesajıdır; ``t`` alanı türü belirtir.
"""

from __future__ import annotations

import struct
import time

HEADER = struct.Struct("!BBHII")

KIND_JPEG = 1

FLAG_KEYFRAME = 1

PROTOCOL_VERSION = 1


def now_ms() -> int:
    return int(time.monotonic() * 1000) & 0xFFFFFFFF


def pack_frame(kind: int, monitor: int, flags: int, seq: int, payload: bytes) -> bytes:
    return HEADER.pack(kind, monitor, flags, seq & 0xFFFFFFFF, now_ms()) + payload


def unpack_header(packet: bytes) -> tuple[int, int, int, int, int]:
    return HEADER.unpack_from(packet)
