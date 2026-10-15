# waydesk

Telefondan (tarayıcı/PWA) GNOME Wayland PC'yi görüntüleme ve kontrol etme. Kişisel kullanım.
Hedef ortam: Pop!_OS 24.04 + GNOME 46 Wayland, laptop (i7-13700HX, RTX 4060 Laptop), 3 monitör; uzaktan erişim Tailscale ile.

Mimari ve yön kararları: [docs/PLAN.md](docs/PLAN.md)

## Durum

| Aşama | Konu | Durum |
|---|---|---|
| 0 | Ortam keşfi | **tamamlandı**; paket kurulumu onay bekliyor |
| 1 | Tek monitör, JPEG → WebSocket → canvas | kurulum onayından sonra başlayacak |
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

### Aşama 0 sonuçları

| Konu | Bulgu |
|---|---|
| Oturum | Pop!_OS 24.04, GNOME Shell 46.0 / Mutter 46.2, Wayland |
| Monitörler (soldan sağa = 1/2/3) | 1: DP-1 1920×1080@144 · 2: eDP-1 (dahili) 2560×1600@165, ölçek ×1.5 · 3: HDMI-1 2560×1440@144; hepsi yatay |
| Portal | xdg-desktop-portal 1.18.4 var, **xdg-desktop-portal-gnome yok**: ScreenCast/RemoteDesktop portalı hiç yok |
| Mutter doğrudan API | ✓ RemoteDesktop v1 (klavye, işaretçi, dokunmatik), ScreenCast v4 → **birincil backend olarak öneriliyor** |
| GStreamer 1.24.2 | pipewiresrc ✓, jpegenc ✓, nvh264enc / nvcudah264enc ✓ (NV12 ve BGRA girişi; BGRx yok), cudaconvert yok, webrtcbin ✓ ama libnice yok |
| NVIDIA | sürücü 580.82.09 (open), libnvidia-encode ✓, NVENC deneme kodlaması ✓ |
| Python 3.12 | python3-gi 3.48 + Gst ✓; GstApp/GstVideo typelib'leri, aiohttp, dbus-next eksik |
| Ağ | Wi-Fi (wlp0s20f3); Tailscale kurulu değil |

## Kurulum / çalıştırma

Aşama 1 ile eklenecek.

## Bilinen sorunlar

Şimdilik öngörülen riskler [docs/PLAN.md §5](docs/PLAN.md#5-riskler--bilinen-sorunlar-ilk-tahmin-aşamalarda-güncellenecek)'te listeleniyor. Doğrulananlar her aşamada buraya taşınacak.
