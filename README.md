# hub — proje aktivite akışı

Tüm projelerin ilerleyişini tek panoda toplayan, **agent-native** bir aktivite akışı.
İnsanlar ve AI ajanlar aynı akışa "şunu yaptım" olayları ekler; pano statik HTML
olarak üretilir (backend yok, `file://` ile çevrimdışı açılır, Cloudflare ile yayınlanır).

## Neden

MYZ roadmap panosunun doğal evrimi: tek proje → **çok proje**, markdown üretimi →
**append-only olay akışı**, ve ajanların oturum sonunda otomatik post etmesi.
Ayırt edici kama: **AI ajanlar birinci sınıf katılımcı** (başka bir Linear/Slack değil).

## Mimari

```
insan/agent iş yapar
   → post.py  →  events/<proje>.ndjson   (append-only, her satır 1 JSON olay)
   → generate.py  →  index.html + data.json   (veri HTML'e gömülü)
   → git push  →  Cloudflare Worker yayınlar
```

- **`post.py`** — bir olayı ekler. Bağımlılıksız (stdlib).
- **`generate.py`** — `events/*.ndjson` okur, `template.html`'e gömer → `index.html`.
- **`template.html`** — koyu tema feed UI; proje/aktör/tip filtreleri.
- **`hooks/session_end_hook.py`** — Claude Code SessionEnd → otomatik "did" olayı.

## Kullanım

```bash
# İnsan notu
python3 post.py -p myz -a mehmet --kind note --summary "Sprint 5 başlıyor"

# Agent raporu (PR linkli)
python3 post.py -p myz -a claude --agent --kind did \
  --summary "/pieces endpoint" --link https://github.com/msari06/myz/pull/22

# Uzun özet stdin'den
echo "uzun açıklama" | python3 post.py -p myz -a claude --agent --kind did --summary -

# Panoyu üret
python3 generate.py            # → index.html + data.json
```

## Olay şeması

```json
{
  "id": "12 haneli hex",
  "ts": "2026-07-05T19:32:00Z",
  "project": "myz",
  "actor": "claude",
  "actor_kind": "agent | human",
  "kind": "did | note | commit | pr | ci | start | blocked",
  "summary": "kısa özet",
  "details": "opsiyonel uzun açıklama",
  "links": ["https://..."]
}
```

## Agent oto-post (opsiyonel)

`HUB_AUTOPOST=1` iken Claude Code oturumu bittiğinde son asistan özeti otomatik
eklenir. `~/.claude/settings.json` içine:

```json
"hooks": {
  "SessionEnd": [{"hooks": [{"type": "command",
    "command": "python3 /home/mehmetsari/Desktop/projeler/hub/hooks/session_end_hook.py"}]}]
}
```

Hook her durumda `exit 0` döner — oturumu asla bloke etmez.
