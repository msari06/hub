# waydesk

Telefondan (tarayıcı/PWA) GNOME Wayland PC'yi görüntüleme ve kontrol etme. Kişisel kullanım.
Hedef ortam: Pop!_OS + GNOME Wayland, NVIDIA RTX 4060, 3 monitör; uzaktan erişim Tailscale ile.

Mimari ve yön kararları: [docs/PLAN.md](docs/PLAN.md)

## Durum

| Aşama | Konu | Durum |
|---|---|---|
| 0 | Ortam keşfi | **script hazır, rapor bekleniyor** |
| 1 | Tek monitör, JPEG → WebSocket → canvas | plan onaylandı, Aşama 0 raporu bekleniyor |
| 2 | Input (mouse, tık, scroll, klavye) + token | — |
| 3 | 3 monitör, 1/2/3 geçişi | — |
| 4 | NVENC H.264 + düşük gecikmeli taşıma | — |
| 5 | Tailscale bind, HTTPS, systemd | — |
| 6 | PWA cilası | — |

## Aşama 0 — ortam keşfi

`scripts/stage0-discover.sh` **salt okunurdur**:

- Paket kurmaz, ayar değiştirmez, ekran paylaşım oturumu açmaz; izin diyaloğu çıkmaz.
- Portal ve Mutter D-Bus arayüzlerinin sürüm özelliklerini, monitör yerleşimini, GStreamer elementlerini, Python modüllerini ve Tailscale durumunu okur.
- Tek aktif işi, GPU'da birkaç saniyelik NVENC deneme kodlamasıdır (`videotestsrc → fakesink`). Diske bir şey yazmaz.

### Nasıl test edilir

1. Script'i PC'ye al:
   ```bash
   cd ~/Desktop/projeler/hub
   git fetch origin claude/wayland-remote-desktop-pwa-alq66z
   git checkout claude/wayland-remote-desktop-pwa-alq66z
   ```
2. **GNOME oturumundaki bir terminalden** çalıştır. SSH'tan veya `sudo` ile çalıştırma; oturumun D-Bus'ına erişmesi gerekiyor:
   ```bash
   bash waydesk/scripts/stage0-discover.sh
   ```
3. Çalışma 30–60 sn sürer (GStreamer ilk taramada CUDA'yı yükler). Sonunda `ÖZET` bölümü ve önerilen backend yazılır.
4. Rapor, script nereden çalıştırılırsa çalıştırılsın `~/waydesk-stage0.txt` dosyasına yazılır. `cat ~/waydesk-stage0.txt` çıktısını paylaş. IP ve tailnet adlarını istersen maskeleyebilirsin.

Rapordan sonra kurulacak paket listesini önereceğim; **onayın olmadan hiçbir şey kurulmayacak**.

## Kurulum / çalıştırma

Aşama 1 ile eklenecek.

## Bilinen sorunlar

Şimdilik öngörülen riskler [docs/PLAN.md §5](docs/PLAN.md#5-riskler--bilinen-sorunlar-ilk-tahmin-aşamalarda-güncellenecek)'te listeleniyor. Doğrulananlar her aşamada buraya taşınacak.
