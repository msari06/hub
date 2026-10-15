# waydesk — Mimari Plan (taslak, onay bekliyor)

Telefondaki bir PWA'dan, GNOME Wayland üzerinde çalışan PC'yi görüntüleyip kontrol etmek
için kişisel bir uzak masaüstü. Ses kapsam dışı.

## 1. Genel bakış

```
 Telefon (PWA, tarayıcı)                          PC — GNOME / Wayland / RTX 4060
┌────────────────────────────┐                  ┌──────────────────────────────────────────────┐
│ canvas ← çözümleme         │◄── video ────────│ GStreamer (monitör başına 1 hat, yalnız aktif │
│  (JPEG → sonra H.264)      │   (binary WS)    │   olan PLAYING):                              │
│ jest motoru (abs/trackpad) │── input (JSON) ─►│   pipewiresrc → [ölçek] → kodlayıcı → appsink │
│ klavye + ek tuş satırı     │── kontrol ──────►│ Python asyncio sunucu (aiohttp: HTTP + WS)    │
│ 1/2/3, zoom/pan (yerel)    │   (1/2/3, ack)   │   ├─ SessionBackend  ← portal | mutter        │
│ service worker, manifest   │                  │   │   ScreenCast: 3 monitör stream'i          │
└────────────────────────────┘                  │   │   RemoteDesktop: Notify* input            │
            ▲                                   │   └─ StreamManager: aktif monitör seçimi      │
            └──── Tailscale (LAN'da doğrudan, dışarıda WireGuard) ────┘
```

Tek bağlantı: aynı WebSocket hem video karelerini hem input/kontrol mesajlarını taşır.

## 2. Bileşenler

### 2.1 SessionBackend — capture ve input aynı oturumda

Hepsi aynı küçük arayüzü uygular, config ile seçilir:

```
start() / close()
monitors() -> [Monitor(index, connector, w, h, x, y, node_id)]
pointer_abs(monitor, x, y)      # stream koordinatında
pointer_rel(dx, dy)
button(code, pressed)           # evdev: 272 sol, 273 sağ, 274 orta
scroll(dx, dy, finish)          # pürüzsüz scroll
keysym(sym, pressed)
```

| Backend | Nasıl | İzin diyaloğu | Not |
|---|---|---|---|
| **PortalBackend** (senin tercihin) | `org.freedesktop.portal.RemoteDesktop` + `ScreenCast`: CreateSession → SelectDevices(klavye+işaretçi, `persist_mode=2`, `restore_token`) → SelectSources(MONITOR, `multiple=true`, cursor EMBEDDED) → Start → OpenPipeWireRemote (fd) | İlk sefer bir kez, **ancak** RemoteDesktop restore desteği varsa | Birleşik oturumda kalıcılık yalnız `RemoteDesktop.SelectDevices` üzerinden; `ScreenCast` persist seçenekleri bu oturumda kullanılamaz (spec). Token tek kullanımlık; her Start'ta yenisi `~/.config/waydesk/state.json`'a yazılır. |
| **MutterBackend** (önerdiğim fallback) | `org.gnome.Mutter.RemoteDesktop` + `org.gnome.Mutter.ScreenCast`: aynı Notify* metodları, `RecordMonitor(connector)` ile monitör başına stream | **Hiç yok** | gnome-remote-desktop'ın kullandığı, portal-gnome'un da arkada çağırdığı API. Mutter kaynağında çağıranı kısıtlayan bir allow-list yok (oturum veri yoluna erişen her kullanıcı süreci kullanabiliyor). GNOME'a özel, "private" API. |
| UinputBackend (son çare) | python-evdev ile sanal mutlak işaretçi + klavye; video için yalnız ScreenCast portalı | ScreenCast için bir kez | `/dev/uinput` izni (udev kuralı) gerekir; çok monitörde mutlak konum için yerleşim hesabı; keycode tabanlı → Türkçe karakterler için düzen eşlemesi. ydotool'dan iyidir ama yine de en zayıf seçenek. |

**Pop!_OS uyarısı:** Pop!_OS 22.04, GNOME 42 ve xdg-desktop-portal-gnome 42 ile geliyor.
RemoteDesktop oturumunu geri yükleme (restore) desteği xdg-desktop-portal-gnome **45**'te geldi.
22.04'teysen portal yolu **her oturum kuruluşunda izin diyaloğu gösterir**. Aşama 0 bunu kesinleştirir.
Bu durumda önerim MutterBackend.

### 2.2 Medya hattı (GStreamer, monitör başına)

**Aşama 1 (JPEG):**
```
pipewiresrc fd=<fd> path=<node> always-copy=true
  ! videorate drop-only=true max-rate=30
  ! videoscale ! video/x-raw,width=<≤1600>
  ! videoconvert ! jpegenc quality=60
  ! appsink drop=true max-buffers=1 sync=false
```

**Aşama 4 (NVENC H.264):**
```
pipewiresrc … ! [cudaupload ! cudaconvert | videoconvert]
  ! nvh264enc preset=low-latency-hq rc-mode=cbr bitrate=<…> zerolatency=true bframes=0 gop-size=-1
  ! h264parse config-interval=-1 ! video/x-h264,stream-format=byte-stream,alignment=au
  ! appsink drop=true max-buffers=1 sync=false
```
Bağlanınca ve monitör değişince `force-key-unit` ile anında IDR.

- **Kare hızı:** 60 fps ile sınırlı. 165/210 Hz telefonda fark yaratmaz, bant genişliğini harcar.
- **Akış kontrolü:** Telefon her kareyi çizince `ack` gönderir. Havada en fazla 2 kare olur, fazlası sunucuda düşürülür. Böylece yavaş ağda gecikme birikmez, kare atlanır.
- **Pasif monitörler:** Hattı `NULL` durumuna alınır ve PipeWire tüketicisi kopar. Mutter tüketicisi olmayan stream için kare kopyalamaz, kodlayıcı da çalışmaz. Geçişte aktif hat `PLAYING` olur ve IDR üretilir. Oturum ve stream'ler bir kez kurulduğu için yeniden izin istenmez.
- **İmleç:** Videoya gömülü (EMBEDDED). Trackpad modunda yerel imleç çizimi (METADATA) ileride bir iyileştirme olabilir.
- **Gecikme ölçümü yerleşik:** Her karede yakalama zaman damgası taşınır, `ack` ile geri döner. İstemcide gecikme/fps göstergesi bulunur. <100 ms hedefi ölçülebilir olur.

### 2.3 Protokol (tek WebSocket, `/ws`)

Sunucu → istemci, binary:
`u8 tür (1=JPEG, 2=H264) | u8 monitör | u16 bayrak (keyframe) | u32 seq | u32 ts_ms | yük`

İstemci → sunucu, JSON (küçük, okunaklı):
```
{"t":"hello","token":"…"}          {"t":"mon","i":2}
{"t":"ma","x":0.512,"y":0.233}     # mutlak, aktif monitörde normalize 0..1
{"t":"mr","dx":3.5,"dy":-1}        # göreli (trackpad)
{"t":"btn","b":1,"d":1}            # 1 sol, 2 orta, 3 sağ; d: bas/bırak
{"t":"sc","dx":0,"dy":-12.5,"end":false}
{"t":"txt","s":"merhaba ğüş"}      {"t":"key","k":"Control_L","d":1}
{"t":"ack","seq":123,"ts":…}
```
Normalize koordinat kullanmak ölçek, kesirli ölçekleme ve pivot farklarını sunucu tarafına bırakır:
`x * stream_genişliği`.

### 2.4 İstemci (PWA)

Vanilla JS, ES modülleri, build adımı yok. Modüller: `net.js` (WS ve yeniden bağlanma),
`view.js` (canvas, zoom/pan dönüşümü), `gestures.js`, `keyboard.js`, `ui.js`, `sw.js`.

| Hareket | Mutlak mod (varsayılan) | Trackpad modu |
|---|---|---|
| 1 parmak dokun | imleç oraya + sol tık | sol tık (imleç yerinde) |
| 1 parmak sürükle | sol tuş basılı sürükle (dokunmatik ekran gibi) | imleci göreli kaydır (ivmeli) |
| çift dokun + sürükle | — | sol tuş basılı sürükle |
| 2 parmak dokun | sağ tık | sağ tık |
| 2 parmak sürükle | pürüzsüz scroll | pürüzsüz scroll |
| pinch | **yalnız istemcide** zoom (merkez hareketi pan yapar) | aynı |
| 3 parmak sürükle | zoom'luyken görüntüyü kaydır | aynı |

İki parmaklı bir jest, mesafe değişimi eşiği aşılırsa pinch, aşılmazsa scroll olarak
sınıflandırılır. Sınıflandırma parmaklar kalkana kadar değişmez.

**Klavye:**
- Gizli bir `<textarea>` üzerinde `beforeinput`/`input` olayları dinlenir. Android Gboard `keydown`'da `keyCode 229` gönderdiği için olay tabanlı fark alınır. `autocorrect`, `autocapitalize` ve `spellcheck` kapalı tutulur.
- Karakterler sunucuda keysym'e çevrilir. Bunun için libxkbcommon `xkb_utf32_to_keysym` (ctypes) kullanılır. Türkçe karakterler için bu önemli: `ğ` → `0x2bb` (eski keysym). Mutter keysym'i düzende ararken `0x100011f` biçimindeki Unicode keysym'i bulamaz.
- Ek tuş satırı: Ctrl, Alt, Super, Esc, Tab ve oklar. Değiştirici tuşlar "yapışkan"dır: tek dokunuş bir sonraki tuş için geçerli olur, çift dokunuş kilitler.

### 2.5 Erişim ve güvenlik

- **Bind:** `127.0.0.1` + Tailscale IP'si (`tailscale ip -4`). tailscaled geç kalkarsa sunucu periyodik olarak tekrar dener.
- **HTTPS:** Service worker, PWA kurulumu ve WebCodecs güvenli bağlam (HTTPS) ister. Önerim `tailscale serve --bg https:443 http://127.0.0.1:<port>`. Geçerli `*.ts.net` sertifikası sağlar ve otomatik yenilenir. Bu kurulumda sunucu yalnız localhost'u dinler, bu da istenenden daha da sıkı.
- **Token:** İlk çalıştırmada üretilir ve `~/.config/waydesk/config.toml` dosyasına (0600) yazılır. Eşleştirme için terminalde `…/#token=…` URL'si ve QR kodu basılır. İstemci token'ı localStorage'da saklar ve WS `hello` mesajında gönderir; sunucu sabit zamanlı karşılaştırır.
- **Oturum yaşam döngüsü:** Mümkünse ilk istemci bağlanınca oturum kurulur, son istemci ayrıldıktan ~30 sn sonra kapatılır. Böylece boştayken GPU/CPU harcanmaz ve GNOME'un "ekran paylaşılıyor" göstergesi sürekli yanmaz. Bunun ön koşulu sessiz geri yüklemedir (Mutter ya da restore'lu portal). Diyaloglu portalda oturum açık tutulur.
- **systemd user service:** `graphical-session.target`'a bağlıdır, oturum kapanınca durur. PC'de **kullanıcı oturumu açık olmalı**; ekran kilitli olması sorun değil. Yeniden başlatma sonrası uzaktan erişim için GDM otomatik giriş + ekran kilidi önerilir.

## 3. Yön kararları — açık karşılaştırma

### 3.1 Sunshine + Moonlight yerine özel çözüm
- **Sunshine'ın artısı:** Gecikme mükemmel (yıllarca ayarlanmış NVENC + FEC). Ses ve gamepad desteği var.
- **Bu senaryodaki sorunları:**
  1. GNOME Wayland'da yakalama KMS üzerinden yapılıyor. Bu `cap_sys_admin` ister (pratikte root'a yakın). NVIDIA + Wayland'da siyah ekran raporları yaygın; NvFBC ise yalnız X11'de çalışıyor.
  2. İstemci native Moonlight. Tarayıcı için ek bir köprü gerekir (ör. moonlight-web: C++/Qt arka uç + WebRTC). Sonuç: Sunshine + köprü + 1/2/3 ve jestler için çatallanmış bir web arayüzü, yani 3 hareketli parça.
  3. Monitör seçimi akış oturumu başına yapılıyor. Geçiş anlık değil, yeniden bağlanma gerektirir.
  4. Dokunmatik semantiği oyun odaklı.
- **Karar:** Ana kullanım oyun olsaydı Sunshine + native Moonlight'ı önerirdim. PWA, anlık 1/2/3 geçişi ve dokunmatik masaüstü kontrolü için özel çözüm daha uygun. **Senin yönünde kalıyoruz.**

### 3.2 Fallback: ydotool/uinput yerine Mutter API
- **Senin yönün:** Portal, olmazsa ydotool/uinput.
- **Önerim:** Portal, olmazsa **Mutter doğrudan API**, en son uinput.
  - Mutter API, portal ile aynı semantiği sunar: stream bazlı mutlak koordinat ve keysym ile metin.
  - Root/udev gerektirmez, hiç diyalog göstermez.
  - Connector adıyla monitör seçer; 1/2/3 eşlemesi doğrudan yapılır.
  - ydotool ise mutlak konumu "sol üste git, sonra göreli kaydır" yöntemiyle simüle ediyor (işaretçi ivmesinden etkilenir) ve keycode tabanlı.
- Backend bir config satırıyla seçilir, ikisi de aynı arayüzü uygular.

### 3.3 Aşama 4 taşıması: WebRTC yerine WebCodecs + WebSocket (Aşama 4'te birlikte karar verelim)

| | WebRTC (GStreamer webrtcbin) — senin yönün | WebCodecs + mevcut WebSocket — alternatif |
|---|---|---|
| Taşıma | UDP/SRTP, ICE, ayrı sinyalleşme | Aynı WSS bağlantısı; H.264 erişim birimleri binary mesaj olarak gider |
| Gecikme (LAN) | İyi; jitter buffer ~20–50 ms ekleyebilir | En düşük: `VideoDecoder` ile `optimizeForLatency`, buffer yok |
| Kayıplı ağ (hücresel) | Daha dayanıklı (UDP, NACK). Bant uyarlaması webrtcbin'de hazır gelmez, elle yazılır | TCP yüzünden takılma riski var; ack akış kontrolü ve bitrate düşürme ile hafifletilir |
| Karmaşıklık | Yüksek (SDP/ICE, Tailscale arayüzüne ICE bağlama) | Düşük; Aşama 1–3'ün protokolü aynen kalır |
| Ön koşul | — | Güvenli bağlam (HTTPS). `tailscale serve` HTTPS'i Aşama 4'e çekmeyi gerektirir |

- **aiortc'yi önermiyorum:** Kendi (CPU) kodlamasını yapıyor. NVENC çıktısını içinden geçirmek yama gerektirir.
- **Önerim:** Önce WebCodecs + WS (4a). Gecikmeyi ölçeriz. Hücresel/Tailscale DERP'te sorun görürsek webrtcbin'e (4b) geçeriz. Aşama 1–3 iki seçenekte de aynı, yani şu an bir şey kaybetmiyoruz.

### 3.4 Python mı, Rust mı
Python'da kalıyoruz. Medya yolu tamamen GStreamer'da (C, kendi thread'leri). Python yalnız
kontrol düzleminde çalışır ve kodlanmış kareleri taşır (JPEG ~3–6 MB/s, H.264 ~1–2 MB/s), bu ihmal
edilebilir bir yük. Rust'ın asıl artısı `ashpd` (olgun portal kütüphanesi) ve tek binary olurdu;
geçişi haklı çıkaracak bir engel görmüyorum.

Not: `dbus-next` 2021'den beri yeni sürüm almıyor ama fd aktarımı dahil gerekeni yapıyor. Sorun
çıkarsa API uyumlu, bakımı süren `dbus-fast`'e geçilir.

## 4. Aşamalar ve kabul kriterleri

| # | Çıktı | Kabul |
|---|---|---|
| 0 | `scripts/stage0-discover.sh` raporu | Raporu inceleyip backend, kurulacak paketler ve Pop!_OS sürümüne göre plan kesinleşir |
| 1 | Tek monitör, JPEG/WS, canvas | LAN'da telefondan ekran görünür, ≥20 fps, gecikme göstergesi çalışır |
| 2 | Mutlak işaretçi, tık, sağ tık, scroll, klavye (+ token) | Tablodaki jestler ve Türkçe karakterler çalışır |
| 3 | 3 monitör, 1/2/3 | Geçiş <300 ms, diyalog yok; pasif monitörlerde `nvidia-smi`/`top`'ta yük görünmez |
| 4 | NVENC H.264 + seçilen taşıma | LAN'da ölçülen gecikme <100 ms |
| 5 | Tailscale bind, HTTPS, token, systemd user service | Yeniden başlatıp giriş yapınca kendiliğinden ayağa kalkar; LAN IP'sinden erişilemez |
| 6 | PWA cilası | Ana ekrana eklenir, tam ekran açılır, bağlantı koparsa kendisi bağlanır |

Her aşamanın adım adım test talimatı o aşamanın teslimiyle birlikte README'ye eklenir.

## 5. Riskler / bilinen sorunlar (ilk tahmin, aşamalarda güncellenecek)

- **NVIDIA + Mutter screencast:** DMA-BUF yolunda siyah/bozuk kare raporları var. Başlangıçta SHM yolu (`always-copy=true`) kullanılacak. 1440p@60'ta CPU kopyası birkaç ms ekler, hedef için kabul edilebilir.
- **Portal diyaloğunda çoklu monitör seçimi:** GNOME diyaloğunun `multiple=true` ile 3 monitörü birden seçtirdiği Aşama 3'te doğrulanacak. Olmazsa MutterBackend.
- **iPhone ise:** iOS Safari'de Fullscreen API ve `screen.orientation.lock` yok. PWA'nın "standalone" modu kullanılır, landscape kilidi uygulanamaz.
- **Pivot monitör (dikey 1440×2560) ve landscape kilidi çakışıyor.** Öneri: kilit aktif monitörün yönüne göre değişsin.
- **Ekranlar kapalıysa (DPMS):** İlk dokunuş ekranları uyandırır, bir an siyah kare görülebilir.
- **Giriş ekranı (GDM) uzaktan kullanılamaz.** Kullanıcı oturumu açık olmalı.
