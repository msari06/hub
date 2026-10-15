"""Komut satırı: ``python3 -m waydesk --host 192.168.1.109``."""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from . import __version__


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="waydesk", description="Telefondan GNOME Wayland masaüstü.")
    p.add_argument("--host", default="127.0.0.1",
                   help="dinlenecek adres (varsayılan 127.0.0.1; telefon için LAN IP'si)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--monitor", type=int, default=0,
                   help="soldan sağa 1/2/3… (varsayılan: birincil monitör)")
    p.add_argument("--fps", type=int, default=30, help="üst kare hızı (varsayılan 30)")
    p.add_argument("--max-width", type=int, default=1600,
                   help="daha genişse bu genişliğe küçült; 0 = küçültme (varsayılan 1600)")
    p.add_argument("--quality", type=int, default=60, help="JPEG kalitesi 1-100 (varsayılan 60)")
    p.add_argument("--source", choices=["mutter", "test"], default="mutter",
                   help="test: ekran yerine test deseni (ağ/istemci denemesi için)")
    p.add_argument("--list-monitors", action="store_true", help="monitörleri listele ve çık")
    p.add_argument("-v", "--verbose", action="store_true")
    p.add_argument("--version", action="version", version=f"waydesk {__version__}")
    args = p.parse_args(argv)
    if not 1 <= args.quality <= 100:
        p.error("--quality 1-100 arasında olmalı")
    if not 1 <= args.fps <= 120:
        p.error("--fps 1-120 arasında olmalı")
    return args


async def list_monitors() -> None:
    from dbus_next.aio import MessageBus

    from .displays import read_monitors

    bus = await MessageBus().connect()
    for m in await read_monitors(bus):
        print(f"{m.index}: {m.connector:<8} {m.name:<30} {m.width}x{m.height}@{m.refresh:g}Hz "
              f"ölçek={m.scale:g} konum=({m.x},{m.y}){'  birincil' if m.primary else ''}")
    bus.disconnect()


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
                        datefmt="%H:%M:%S")
    if args.list_monitors:
        asyncio.run(list_monitors())
        return 0

    import gi

    gi.require_version("Gst", "1.0")
    from gi.repository import Gst

    Gst.init(None)

    from .app import Config, Server

    config = Config(host=args.host, port=args.port, source=args.source, monitor=args.monitor,
                    fps=args.fps, max_width=args.max_width, quality=args.quality)
    try:
        asyncio.run(Server(config).run())
    except KeyboardInterrupt:
        pass
    except OSError as exc:
        logging.getLogger("waydesk").error("%s", exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
