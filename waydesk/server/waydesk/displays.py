"""Monitör yerleşimi: org.gnome.Mutter.DisplayConfig.GetCurrentState.

Monitörler mantıksal konumlarına göre soldan sağa (eşitse yukarıdan aşağı)
sıralanır ve 1'den başlayarak numaralanır; telefondaki 1/2/3 bu numaralardır.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from dbus_next.aio import MessageBus

DEST = "org.gnome.Mutter.DisplayConfig"
PATH = "/org/gnome/Mutter/DisplayConfig"
IFACE = "org.gnome.Mutter.DisplayConfig"

# 90° / 270° döndürmelerde (ve flip'li karşılıklarında) genişlik-yükseklik yer değiştirir.
_ROTATED_TRANSFORMS = {1, 3, 5, 7}


@dataclass(frozen=True)
class Monitor:
    index: int
    connector: str
    name: str
    x: int
    y: int
    width: int  # aktif modun fiziksel piksel boyutu (döndürme uygulanmış)
    height: int
    refresh: float
    scale: float
    primary: bool

    def as_dict(self) -> dict:
        return asdict(self)


def _value(variant_or_value):
    return getattr(variant_or_value, "value", variant_or_value)


def parse_current_state(state: list) -> list[Monitor]:
    """GetCurrentState dönüşünü (serial, monitors, logical_monitors, props) çözer."""
    _serial, monitors, logical_monitors, _props = state

    physical: dict[str, tuple[str, list | None]] = {}
    for spec, modes, props in monitors:
        connector, vendor, product, _serial_no = spec
        current = next((m for m in modes if _value(m[6].get("is-current", False))), None)
        name = _value(props.get("display-name", "")) or f"{vendor} {product}".strip()
        physical[connector] = (name, current)

    rows = []
    for x, y, scale, transform, primary, specs, _lprops in logical_monitors:
        for spec in specs:
            connector = spec[0]
            name, mode = physical.get(connector, (connector, None))
            if mode is None:
                continue
            width, height, refresh = mode[1], mode[2], mode[3]
            if transform in _ROTATED_TRANSFORMS:
                width, height = height, width
            rows.append((x, y, connector, name, width, height, refresh, scale, bool(primary)))

    rows.sort()
    return [
        Monitor(index=i, connector=c, name=n, x=x, y=y, width=w, height=h,
                refresh=round(r, 2), scale=round(s, 5), primary=p)
        for i, (x, y, c, n, w, h, r, s, p) in enumerate(rows, 1)
    ]


async def read_monitors(bus: MessageBus) -> list[Monitor]:
    introspection = await bus.introspect(DEST, PATH)
    iface = bus.get_proxy_object(DEST, PATH, introspection).get_interface(IFACE)
    state = await iface.call_get_current_state()
    return parse_current_state(state)
