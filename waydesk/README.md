# waydesk

Telefondan (tarayıcı/PWA) GNOME Wayland PC'yi görüntüleme ve kontrol etme. Kişisel kullanım.
Hedef ortam: Pop!_OS 24.04 + GNOME 46 Wayland, laptop (i7-13700HX, RTX 4060 Laptop), 3 monitör; uzaktan erişim Tailscale ile.

Mimari ve yön kararları: [docs/PLAN.md](docs/PLAN.md)

## Durum

| Aşama | Konu | Durum |
|---|---|---|
| 0 | Ortam keşfi | tamamlandı; paketler kuruldu |
| 1 | Tek monitör, JPEG → WebSocket → canvas | **kod hazır, test bekleniyor** |
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
| Mutter doğrudan API | ✓ RemoteDesktop v1 (klavye, işaretçi, dokunmatik), ScreenCast v4 → **birincil backend (onaylandı)** |
| GStreamer 1.24.2 | pipewiresrc ✓, jpegenc ✓, nvh264enc / nvcudah264enc ✓ (NV12 ve BGRA girişi; BGRx yok), cudaconvert yok, webrtcbin ✓ ama libnice yok |
| NVIDIA | sürücü 580.82.09 (open), libnvidia-encode ✓, NVENC deneme kodlaması ✓ |
| Python 3.12 | python3-gi 3.48 + Gst ✓; GstApp/GstVideo typelib'leri, aiohttp, dbus-next eksik |
| Ağ | Wi-Fi (wlp0s20f3); Tailscale kurulu değil |

## Kurulum / çalıştırma

Gereken paketler (Ubuntu 24.04 deposundan; Aşama 0'dan sonra kuruldu):

```bash
sudo apt install gir1.2-gst-plugins-base-1.0 python3-aiohttp python3-dbus-next
```

Sunucu, GNOME oturumundaki bir terminalden çalıştırılır (SSH'tan değil; oturumun D-Bus'ı ve
PipeWire'ı gerekiyor):

```bash
cd ~/Desktop/projeler/hub/waydesk/server
python3 -m waydesk --list-monitors          # monitörler ve 1/2/3 numaraları
python3 -m waydesk --host 192.168.1.109     # telefondan: http://192.168.1.109:8765/
```

| Seçenek | Varsayılan | Açıklama |
|---|---|---|
| `--host` | `127.0.0.1` | Dinlenecek adres. Telefon için LAN IP'si. |
| `--port` | `8765` | |
| `--monitor N` | birincil | Soldan sağa 1/2/3. |
| `--fps` | `30` | Üst kare hızı; ekran değişmezse kare gönderilmez. |
| `--max-width` | `1600` | Daha geniş monitörler bu genişliğe küçültülür; `0` = küçültme yok. |
| `--quality` | `60` | JPEG kalitesi (1–100). |
| `--source test` | — | Ekran yerine test deseni; yalnız ağ ve telefon tarafını dener. |
| `-v` | — | Ayrıntılı log. |

Testler (repo kökünden): `python3 -m unittest discover -s waydesk/tests -v`

Telefondaki sol üst gösterge:

| Alan | Anlamı |
|---|---|
| `fps` | Telefona gönderilen kare/sn. Ekran duruyorsa düşer; bu normal. |
| `kodlama` | Kare yakalandıktan JPEG'i hazır olana kadar geçen süre (PC). |
| `çözme` | Telefonun JPEG'i çözüp çizme süresi. |
| `ağ+çizim` | Kare gönderildikten telefonun "çizdim" yanıtı gelene kadar (Wi-Fi gidiş-dönüş + çözme + çizim). |

Kabaca ekrandan ekrana gecikme ≈ `kodlama` + `ağ+çizim` + en fazla bir kare süresi (30 fps'te 33 ms).

## Aşama 1 — nasıl test edilir

1. Kodu al: `cd ~/Desktop/projeler/hub && git pull --ff-only origin claude/wayland-remote-desktop-pwa-alq66z`
2. **Monitör listesi:** `cd waydesk/server && python3 -m waydesk --list-monitors`.
   Beklenen: 1 = DP-1, 2 = eDP-1 (birincil), 3 = HDMI-1.
3. **Yalnız ağ + telefon (ekran yakalamadan):** `python3 -m waydesk --source test --host 192.168.1.109`.
   Telefonda Chrome ile `http://192.168.1.109:8765/` aç. Beklenen: renkli test çubukları, üzerinde
   akan bir saat, sol üstte ~30 fps. Bağlanamazsan `sudo ufw status` ile güvenlik duvarına bak.
   Ctrl+C ile kapat.
4. **Gerçek ekran:** `python3 -m waydesk --host 192.168.1.109`. Beklenenler:
   - GNOME üst çubuğunda ekran paylaşımı göstergesi çıkar (beklenen davranış); hiç izin diyaloğu çıkmaz.
   - Telefonda birincil ekran (laptop ekranı) görünür, fare imleci de görüntüde.
   - PC'de bir pencereyi sürükle; telefonda akıcı izlenmeli. Göstergedeki değerleri not et.
5. **Diğer monitörler:** Sunucuyu `--monitor 1` ve `--monitor 3` ile ayrı ayrı başlatıp aynı kontrolü yap.
6. **Toparlanma:**
   - GNOME göstergesinden paylaşımı durdur. Telefonda "Ekran oturumu kapandı…" yazmalı, ~3–5 sn sonra görüntü geri gelmeli.
   - Sunucuyu Ctrl+C ile kapatıp yeniden başlat. Telefon kendiliğinden yeniden bağlanmalı.
7. **Boşta kaynak kullanımı:** Telefonda sekmeyi kapat. 5 sn sonra terminalde `yakalama durdu` görünmeli;
   `top` ile `python3`'ün CPU kullanımının ~0'a indiğini kontrol et.

Bana iletmen gerekenler: her monitör için göstergedeki değerler (`fps`, `kodlama`, `çözme`, `ağ+çizim`),
görüntü doğru mu (renk, oran, imleç), terminalde `WARNING`/`ERROR` satırları varsa onlar.

Kabul: telefonda doğru görüntü, ekran hareketliyken ≥20 fps, toparlanma adımları çalışıyor.

## Bilinen sorunlar

- **Input yok:** Aşama 2'de gelecek.
- **Kimlik doğrulama yok:** Sunucu çalıştığı sürece LAN'daki herkes ekranı görebilir. Yalnız test sırasında, ön planda çalıştır. Token Aşama 2'de, input ile birlikte gelecek.
- **Ekran paylaşımı göstergesi:** Sunucu açık olduğu sürece GNOME'da görünür; Mutter oturumu sunucu başlarken kuruluyor. Yakalama ise yalnız izleyen varken çalışır. Oturumun bağlanınca açılıp kapanması Aşama 5'te.
- **Görüntü ölçeği:** Varsayılan 1600 piksel genişlik. Yazılar okunmazsa `--max-width 0 --quality 70` dene; bant genişliği artar.
- **Ekran durunca kare gelmez:** Bu tasarım gereği; telefonda son kare kalır.

Öngörülen diğer riskler: [docs/PLAN.md §5](docs/PLAN.md#5-riskler--bilinen-sorunlar-ilk-tahmin-aşamalarda-güncellenecek).
