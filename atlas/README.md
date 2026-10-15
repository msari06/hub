# Atlas — bayrak ve harita oyunları

Siyasi haritalar ve bayraklar üzerine kurulu mini oyun koleksiyonu. Statik HTML;
backend yok, `index.html` dosyası `file://` ile de açılır (internet yalnızca yazı
tipleri için kullanılır, yoksa sistem yazı tipine düşer).

```bash
xdg-open atlas/index.html        # ya da tarayıcıya sürükle-bırak
python3 -m http.server -d atlas  # isteğe bağlı: http://localhost:8000
```

## Haritalar

Sekiz siyasi harita, her biri kendi projeksiyonuyla: **Dünya** (Natural Earth),
**Avrupa, Asya, Afrika, Kuzey Amerika, Güney Amerika, Okyanusya, Orta Doğu**
(Lambert azimutal eşit alan). 197 ülke: 193 BM üyesi + Vatikan, Filistin, Kosova,
Tayvan. Çok küçük ülkeler haritada daire işaretçiyle gösterilir. Haritalar iki
parmakla/tekerlekle yakınlaştırılır, sürüklenerek kaydırılır.

## Oyunlar (20)

| Kategori | Oyun | Ne yapıyorsun |
|---|---|---|
| Harita | Haritada Bul | Adı verilen ülkeye haritada dokun (3 hak) |
| | Bu Hangi Ülke? | Vurgulanan ülkeyi dört seçenekten bul |
| | Hepsini Yaz | Dilsiz haritadaki bütün ülkeleri ezberden yaz |
| | Komşular | Bir ülkenin bütün kara komşularını işaretle |
| | Keşfet | Puansız: bayrak, başkent, yüzölçümü, komşular |
| Bayrak | Bayrak Bil | Bayrak → ülke |
| | Bayrağı Seç | Ülke → dört bayraktan doğrusu |
| | Bayraktan Bul | Bayrağı gösterilen ülkeyi haritada bul |
| | Bayrak Renkleri | Bayraktaki renklerin hepsini seç (siyah-beyaz ipucu ya da sadece ad) |
| | Bayrağı Boya | Boş şablonu (şeritler, İskandinav haçı, daire…) doğru renklerle boya |
| Başkent | Başkentler | Ülke → başkent ya da başkent → ülke |
| | Başkentten Bul | Başkenti verilen ülkeyi haritada bul |
| Bulmaca | Yapboz | Ülke parçasını sürükleyip yerine oturt |
| | Rota | İki ülke arasındaki en kısa kara yolunu bul (Travle benzeri) |
| | Sınır Zinciri | Her halka bir öncekinin komşusu: zinciri uzat |
| | Haritayı Boya | Dört renk bulmacası: komşular aynı renk olmasın |
| | Silüet | Sadece dış hatlara bakarak ülkeyi tanı |
| Challenge | Günlük Challenge | Herkese aynı 10 karışık soru, paylaşılabilir sonuç |
| | 60 Saniye | Bir dakikada en çok doğru; yanlış 3 sn yakar |
| | Hayatta Kal | 3 can, giderek zorlaşan karışık sorular |

Rekorlar, istatistikler ve 17 rozet tarayıcının `localStorage`'ında tutulur.

## Dosyalar

```
atlas/
  index.html            giriş noktası
  css/atlas.css         tasarım (açık/koyu tema)
  js/core.js            veri dizini, bölgeler, Türkçe ad eşleme, rastgelelik, ses
  js/map.js             MapView: projeksiyon, çizim, yakınlaştırma, tıklama
  js/ui.js              oyun ekranı, kurulum/sonuç pencereleri, rekor ve rozetler
  js/app.js             ana sayfa (bölge seçici harita, oyun kartları)
  js/games/*.js         oyunlar (quiz, harita, bayrak, bulmaca, challenge)
  js/vendor/            d3-array, d3-geo, topojson-client (ISC)
  data/                 üretilmiş veri (elle düzenlemeyin)
  tools/                veri üretim betiği
```

## Veriyi yeniden üretmek

```bash
cd atlas/tools
npm install
npm run data    # → ../data/*.js ve ../js/vendor/*.min.js
```

Türkçe adlar, başkentler, ek adlar (ABD, BAE, KDC…) ve bayrak renkleri elle
derlenmiş `tools/meta_tr.mjs` dosyasındadır. Bayrak renkleri, bayrak SVG'lerinin
Chromium'da piksel bazında renk dağılımıyla karşılaştırılarak doğrulandı.

## Kaynaklar ve lisanslar

- Sınırlar: [Natural Earth](https://www.naturalearthdata.com/) 1:50m (kamu malı), `world-atlas@2.0.2` paketiyle (ISC)
- Ülke bilgisi (bölge, komşuluk, alan): [mledoze/countries](https://github.com/mledoze/countries), `world-countries@5.1.0` (ODbL)
- Bayraklar: `flag-icons@7.5.0` (MIT)
- Harita kodu: `d3-geo`, `d3-array`, `topojson-client` (ISC)

Tartışmalı sınır ve statüler (Kuzey Kıbrıs, Batı Sahra, Somaliland vb.) haritada
oyuna girmeyen gri bölge olarak gösterilir; bu bir siyasi görüş bildirmez.
