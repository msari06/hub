#!/usr/bin/env python3
"""hub/generate.py — ``events/*.ndjson`` → ``index.html`` + ``data.json``.

Tüm projelerin aktivite olaylarını okur, çok-proje bir feed panosu üretir.
Veri HTML'e gömülür (fetch/CORS yok, ``file://`` ile çevrimdışı açılır) — myz
roadmap panosuyla aynı desen.

Bağımlılık yok (yalnız stdlib).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVENTS_DIR = HERE / "events"
TEMPLATE = HERE / "template.html"
INDEX = HERE / "index.html"
DATA = HERE / "data.json"
_INJECT_TOKEN = "/*__HUB_JSON__*/ null"


def _load_events() -> list[dict]:
    events: list[dict] = []
    if not EVENTS_DIR.is_dir():
        return events
    for path in sorted(EVENTS_DIR.glob("*.ndjson")):
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                print(f"  ! atlandı (bozuk JSON): {path.name}:{line_no}")
                continue
            obj.setdefault("project", path.stem)
            obj.setdefault("actor", "?")
            obj.setdefault("actor_kind", "human")
            obj.setdefault("kind", "note")
            obj.setdefault("summary", "")
            obj.setdefault("details", "")
            obj.setdefault("links", [])
            obj.setdefault("ts", "")
            events.append(obj)
    return events


def _aggregate(events: list[dict]) -> dict:
    events_sorted = sorted(events, key=lambda e: e.get("ts", ""), reverse=True)
    projects: dict[str, dict] = {}
    actors: dict[str, dict] = {}
    for event in events_sorted:
        proj = event["project"]
        pinfo = projects.setdefault(proj, {"name": proj, "count": 0, "last_ts": "", "agent": 0, "human": 0})
        pinfo["count"] += 1
        if event["ts"] > pinfo["last_ts"]:
            pinfo["last_ts"] = event["ts"]
        pinfo["agent" if event["actor_kind"] == "agent" else "human"] += 1

        akey = event["actor"]
        ainfo = actors.setdefault(akey, {"name": akey, "kind": event["actor_kind"], "count": 0})
        ainfo["count"] += 1

    return {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "totals": {
            "projects": len(projects),
            "events": len(events_sorted),
            "agentEvents": sum(1 for e in events_sorted if e["actor_kind"] == "agent"),
        },
        "projects": projects,
        "actors": actors,
        "events": events_sorted,
    }


def build_index(data: dict) -> None:
    if not TEMPLATE.is_file():
        raise SystemExit(f"template bulunamadı: {TEMPLATE}")
    template = TEMPLATE.read_text(encoding="utf-8")
    if _INJECT_TOKEN not in template:
        raise SystemExit(f"template içinde enjeksiyon noktası yok: {_INJECT_TOKEN!r}")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    INDEX.write_text(template.replace(_INJECT_TOKEN, payload), encoding="utf-8")


def main() -> int:
    events = _load_events()
    data = _aggregate(events)
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ {data['totals']['events']} olay · {data['totals']['projects']} proje → data.json")
    print(f"  ({data['totals']['agentEvents']} agent olayı)")
    build_index(data)
    print(f"✓ index.html üretildi (veri gömülü, çevrimdışı açılır) → {INDEX}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
