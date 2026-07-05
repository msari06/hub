#!/usr/bin/env bash
# sync.sh — panoyu üret + değişiklikleri commit'le + GitHub'a push et.
# Cloudflare production branch (main) push'ta otomatik yayınlar.
#
#   ./sync.sh                 # varsayılan commit mesajı
#   ./sync.sh "özel mesaj"    # kendi mesajın
set -euo pipefail
cd "$(dirname "$0")"

python3 generate.py

if git diff --quiet --exit-code events/ index.html 2>/dev/null; then
  echo "• değişiklik yok, push atlanıyor"
  exit 0
fi

msg="${1:-chore: aktivite akışı güncellendi ($(date -u +%Y-%m-%dT%H:%MZ))}"
git add events/ index.html
git commit -q -m "$msg"
git push -q origin main
echo "✓ yayınlandı → https://github.com/msari06/hub"
