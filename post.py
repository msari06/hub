#!/usr/bin/env python3
"""hub/post.py — bir aktivite olayını ``events/<proje>.ndjson`` dosyasına ekler.

Append-only: her satır tek bir JSON olay. İnsan da agent da buraya post eder.
Bağımlılık yok (yalnız stdlib). Türkçe/UTF-8 güvenli.

Örnekler:
    python3 post.py --project myz --actor mehmet --kind note --summary "Sprint 6 başlıyor"
    python3 post.py -p myz -a claude --agent --kind did \\
        --summary "/pieces endpoint (PR #22)" --link https://github.com/msari06/myz/pull/22
    echo "uzun özet" | python3 post.py -p myz -a claude --agent --kind did --summary -
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVENTS_DIR = HERE / "events"

VALID_KINDS = {"did", "note", "commit", "pr", "ci", "start", "blocked"}
VALID_ACTOR_KINDS = {"agent", "human"}


def _slug(value: str) -> str:
    """Proje adını dosya-güvenli slug'a çevirir (Türkçe karakterler sadeleşir)."""
    tr = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    value = value.translate(tr).lower().strip()
    value = re.sub(r"[^a-z0-9._-]+", "-", value).strip("-")
    return value or "genel"


def add_event(
    project: str,
    actor: str,
    actor_kind: str,
    kind: str,
    summary: str,
    details: str = "",
    links: list[str] | None = None,
) -> tuple[dict, Path]:
    if actor_kind not in VALID_ACTOR_KINDS:
        raise ValueError(f"actor_kind '{actor_kind}' geçersiz; {sorted(VALID_ACTOR_KINDS)}")
    if kind not in VALID_KINDS:
        raise ValueError(f"kind '{kind}' geçersiz; {sorted(VALID_KINDS)}")
    summary = summary.strip()
    if not summary:
        raise ValueError("summary boş olamaz")

    EVENTS_DIR.mkdir(exist_ok=True)
    event = {
        "id": uuid.uuid4().hex[:12],
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "project": project.strip(),
        "actor": actor.strip(),
        "actor_kind": actor_kind,
        "kind": kind,
        "summary": summary,
        "details": (details or "").strip(),
        "links": [link for link in (links or []) if link.strip()],
    }
    path = EVENTS_DIR / f"{_slug(project)}.ndjson"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")
    return event, path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="hub aktivite olayı ekle")
    parser.add_argument("-p", "--project", required=True, help="proje adı/slug")
    parser.add_argument("-a", "--actor", required=True, help="kim (ör. mehmet, claude)")
    parser.add_argument("--agent", action="store_true", help="aktör bir AI agent (varsayılan: insan)")
    parser.add_argument("--kind", default="did", choices=sorted(VALID_KINDS))
    parser.add_argument("--summary", required=True, help="kısa özet ('-' → stdin'den oku)")
    parser.add_argument("--details", default="", help="opsiyonel uzun açıklama")
    parser.add_argument("--link", action="append", default=[], help="ilgili URL (tekrarlanabilir)")
    parser.add_argument("--quiet", action="store_true", help="çıktı basma")
    args = parser.parse_args(argv)

    summary = sys.stdin.read() if args.summary == "-" else args.summary
    try:
        event, path = add_event(
            project=args.project,
            actor=args.actor,
            actor_kind="agent" if args.agent else "human",
            kind=args.kind,
            summary=summary,
            details=args.details,
            links=args.link,
        )
    except ValueError as exc:
        print(f"hata: {exc}", file=sys.stderr)
        return 2

    if not args.quiet:
        print(f"✓ olay eklendi → {path.name}: [{event['kind']}] {event['summary'][:60]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
