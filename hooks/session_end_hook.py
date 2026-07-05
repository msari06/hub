#!/usr/bin/env python3
"""session_end_hook.py — Claude Code SessionEnd → hub'a otomatik "did" olayı.

Agent-native kama: bir ajan oturumu bittiğinde son asistan özetini alıp
``hub/post.py`` ile ``events/<proje>.ndjson`` dosyasına ekler. Proje adı cwd'nin
klasör adından türetilir.

Güvenlik/nezaket kuralları:
- Yalnız ``HUB_AUTOPOST=1`` ortam değişkeni varken çalışır (varsayılan: sessiz).
- **Her durumda exit 0** — hook asla Claude Code oturumunu bloke etmez.
- Ağ/dosya yok; yalnız yerel ``post.py`` çağrısı (bağımlılıksız).

Kurulum (~/.claude/settings.json):
    "hooks": {
      "SessionEnd": [{"hooks": [{"type": "command",
        "command": "python3 /home/mehmetsari/Desktop/projeler/hub/hooks/session_end_hook.py"}]}]
    }
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
POST = HERE.parent / "post.py"


def _read_last_assistant_summary(transcript_path: str) -> str:
    """Transcript (JSONL) içindeki son asistan metin mesajını döndürür."""
    try:
        lines = Path(transcript_path).read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("type") != "assistant":
            continue
        content = obj.get("message", {}).get("content", [])
        parts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
        text = " ".join(p.strip() for p in parts if p.strip())
        if text:
            return text
    return ""


def main() -> int:
    if os.environ.get("HUB_AUTOPOST") != "1":
        return 0

    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0

    cwd = payload.get("cwd") or os.getcwd()
    project = Path(cwd).name or "genel"
    transcript = payload.get("transcript_path", "")

    summary = _read_last_assistant_summary(transcript)
    if not summary:
        return 0
    summary = summary.replace("\n", " ").strip()[:200]

    try:
        subprocess.run(
            [sys.executable, str(POST), "-p", project, "-a", "claude", "--agent",
             "--kind", "did", "--summary", summary, "--quiet"],
            check=False, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
