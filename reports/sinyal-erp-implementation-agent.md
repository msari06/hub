# SİNYAL Analiz Raporu — ERP İmplementasyon/Kurulum Ajanı

- **Seed:** ERP implementasyon/kurulum sürecini AI ajanı ile otomatikleştirmek
  (kaynak: `ai-is-arkadasi-agent` fikrinin somut wedge'i)
- **Analiz tipi:** Masa başı PRE-SCREEN / triyaj (SİNYAL v2)
- **Tarih:** 2026-09-05
- **Analist:** SİNYAL (agent) · **Operatör:** mehmet

> **Metodoloji notu:** SİNYAL v2 rubriğinin tam tanım dosyası bu repoda (`hub`)
> bulunmuyor; skorlama, seed brief'te açıkça belirtilen kurallardan
> operasyonelleştirildi: Feasibility /15 ve ≤3 hard-fail; toplam /100; bantlar
> 85+ / 70–85 / <70; "rakip var diye elenmez" (27 Ağ. revizyonu); ve **GO'ya masa
> başı skorla ulaşılamaz** — PROMOTE için insan-konuşması kanıtı şart. Rubriğin
> resmî dosyası farklıysa boyut ağırlıkları ona göre güncellenmelidir.

---

## 0. Yönetici Özeti (Verdict)

| | |
|---|---|
| **Skor (masa başı)** | **66 / 100** |
| **Bant** | **SIDELINE** (üst sınır — watchlist eşiğinin hemen altı) |
| **Feasibility** | 8 / 15 — hard-fail **değil** (eşik 3) |
| **Seçilen mutasyon** | Mutasyon 4 çekirdek + Mutasyon 1 konumlanması: **"TR-yerel ERP ekosisteminde veri migrasyonu + süreç keşfi" dar wedge'i** |
| **Öneri** | Sideline'da raporla; **ama** tek ucuz doğrulama adımı (3–5 hedefli görüşme) skoru watchlist'e taşıyabilir. Görüşme planı §7'de. |

**Tek cümlelik tez:** Acı gerçek ve "why-now" güçlü, fakat (a) fizibilitenin can
alıcı noktası olan *derin ERP veri/API erişimi* masa başında çözülemiyor ve
(b) küresel devlerin bıraktığı "implementasyon" boşluğu hızla dolmaya başladı
(SAP Project Setup Agent, NL-config %85–90 doğruluk, 18 ayda 500M$+ VC) — bu iki
belirsizlik giderilmeden GO'ya çıkılamaz.

---

## 1. Rakip Analizi (zorunlu adım)

Kural: *rakip var diye elenmez.* Sorulan soru: **kim ne yapıyor, ne YAPMIYOR,
implementasyon tarafını neden atlıyor, ve bu boşluk hâlâ açık mı?**

### 1.1 "Kurulu sistemi çalıştıran" ajanlar (operasyon odaklı) — boşluğu doğruluyor

| Oyuncu | Ne yapıyor | İmplementasyonu neden atlıyor | Boşluk? |
|---|---|---|---|
| **SAP Joule** | 40+ ajan, 2400+ skill; günlük operasyon (tender analizi, satınalma, fatura) uçtan uca otonom | Kurulu müşteri tabanını rahatsız etmeme; danışmanlık/partner gelirini kanibalize etmeme; implementasyonun proje-bazlı değişkenliği | Kısmen açık — aşağıya bak |
| **MS Dynamics 365 Copilot** | Agentic AI ERP'nin merkezinde; operasyon + **NL agent builder** | Partner ekosistemi implementasyonu satıyor | Daralıyor |
| **Oracle Fusion AI Agents / NetSuite AI** | Finans, tedarik, kapanış otomasyonu | Aynı örüntü | Açık |
| **Odoo AI / Priority aiERP Companion** | Gömülü operasyon asistanı | Aynı örüntü | Açık |
| **Nebim (TR)** | AI ortaklıklar (Masraff-masraf yönetimi, Cloud4Feed-sadakat); **Nebim ERA** = "AI + Agentic Computing" PaaS | İmplementasyon hâlâ insan danışman/proje ekibi; kendi kurulum-otomasyon ajanı görünmüyor | **Açık (TR-yerel)** |

**Örüntü teyidi:** Küresel devler "implementasyonu hızlandıran AI" değil,
"kurulu sistemi çalıştıran AI" inşa ediyor. Seed brief'in temel gözlemi doğru.

### 1.2 Ama boşluk hızla daralıyor (tezin en büyük riski)

Araştırma, "implementasyon dokunulmamış" varsayımını zayıflatan üç sinyal
gösteriyor:

1. **Vendörler sınıra giriyor:** SAP S/4HANA Cloud Public Edition'da **Project
   Setup Agent** çıktı; Business Central **doğal dil agent builder** ile
   fonksiyonel kullanıcıların süreç otomasyonu kurmasını sağlıyor — bu, "partner
   implementasyon yetkinliği" üzerinde baskı yaratıyor.
2. **Teknik olgunluk:** AI, ERP modüllerini doğal dilden **%85–90 doğrulukla**
   konfigüre edebiliyor (karmaşık kurulumlar hâlâ insan onayı istiyor).
3. **Sermaye akını:** Son 18 ayda AI-native ERP startup'larına **500M$+ VC**;
   bir kısmı açıkça "danışman-yoğun implementasyonu AI ile değiştirmeyi"
   pazarlıyor.

**Sonuç:** Boşluk bugün gerçek, ama 12–24 aylık bir pencere. Geniş "tam
implementasyon otomasyonu" oynanışları (Mutasyon 1/2'nin geniş hâli) hem büyük
incumbent'lerle hem de fonlanmış startup'larla kafa kafaya gelir.

### 1.3 En doğrulanmış alt-alan: veri migrasyonu + süreç keşfi

Migrasyon, ERP geçişlerinin **en yüksek riskli darboğazı** (dağınık spreadsheet/
PDF/legacy tarama uzlaştırması). Kanıt: bir perakende grubu SAP ECC→S/4HANA
geçişini (**115.000 tablo, 1,5M kolon**) GenAI ile ~2 yıldan **~1 haftaya**
indirdi. Ama burada da nokta-çözüm rakipleri var: **Energent.ai, Ispirer,
digna.ai, CraftedERP, Konexxia**. Yani bu wedge en kanıtlı ROI'ye sahip *ama*
en kalabalık olan.

---

## 2. Mutasyon/Segment Değerlendirmesi

| # | Mutasyon | Acı | Pazar | Fizibilite | Rekabet | Not |
|---|---|---|---|---|---|---|
| 1 | TR-yerel ERP tam kurulum otomasyonu (Nebim/KOBİ) | Yüksek | Dar (TR) | **Düşük** (tam config + change-mgmt + "her proje farklı") | Düşük (TR) | Fizibilite hard-fail'e yakın |
| 2 | Dikey-özel mikro-ERP kurulum ajanı (şablonlu) | Orta-Yüksek | Orta | Orta (şablon öğrenimi zor) | Orta | Şablon = hem moat hem yük |
| 3 | Büyük ölçek SAP/Oracle migration/upgrade asistanı (danışmanlığa satılan) | Yüksek | Büyük | Orta | **Çok yüksek** (devler + 500M$ VC buraya akıyor) | Alıcı = kanibalize ettiğin danışmanlık |
| 4 | **Veri migrasyonu + süreç keşfi dar wedge** | **En yüksek/kanıtlı** | Orta (genişleyebilir) | **Orta** (şema çıkarımı çalışıyor) | Yüksek (nokta-çözümler) | En net ROI; en iyi *wedge* |

### Seçim ve gerekçe

**Seçilen: Mutasyon 4'ü çekirdek wedge yap, Mutasyon 1'in konumuna (TR-yerel /
Nebim ekosistemi) yerleştir.**

Neden:
- **En kanıtlı acı + ROI** (2 yıl → 1 hafta) migrasyonda; "tam implementasyon"
  belirsizliğine girmeden ölçülebilir değer.
- **Fizibilite tam config'ten yüksek:** şema çıkarımı/eşleme/validasyon GenAI ile
  bugün çalışan bir şey; tüm iş kurallarını otonom kurmaktan daha dar/güvenli.
- **Savunulabilirlik TR-yerel'de artıyor:** küresel nokta-çözümler TR ERP veri
  modellerini (Nebim V3, Logo, Mikro) ve TR mevzuat/lokalizasyonunu bilmiyor;
  moat = TR-ERP şablonları + biriken eşleme verisi + Nebim/SI ilişkileri.
- **`ai-is-arkadasi-agent` vizyonuna köprü:** migrasyon sırasında çıkarılan iş
  kuralları/süreç haritası, uzun soluklu "self-onboarding iş arkadaşı"nın
  ilk öğrenme katmanı olur.

Elenen: Mutasyon 3 (rekabet çok yüksek + alıcı çatışması), Mutasyon 1 geniş hâli
(fizibilite riski), Mutasyon 2 (şablon yükü, dağınık talep).

---

## 3. Rubrik Skorlaması (SİNYAL v2 — seçilen wedge)

| Boyut | Ağırlık | Skor | Gerekçe |
|---|---|---|---|
| Acı / problem şiddeti | /15 | **13** | Migrasyon ERP geçişinin en pahalı, en riskli, en somut acısı; kanıtlı |
| Pazar büyüklüğü | /15 | **9** | Wedge (TR-yerel migrasyon) dar; genişleme yolu (TR→bölge, migrasyon→tam onboarding) var |
| **Fizibilite** | **/15** | **8** | Şema çıkarımı/eşleme çalışıyor; ama derin kaynak-sistem erişimi, doğruluk/sorumluluk (yanlış veri = mali risk) ve "insan onayı şart" gerçek — **hard-fail değil** |
| Kama / farklılaşma | /15 | **8** | TR-lokal + süreç-keşfi kombinasyonu yerelde ayrışıyor; küreselde nokta-çözümler mevcut |
| Rekabet / savunulabilirlik | /10 | **5** | Kalabalık (Energent, Ispirer, digna…) + vendör sınıra giriyor; moat yerel veri/ilişkide |
| GTM / dağıtım | /10 | **6** | Kanal var (Nebim partner/SI ağı, doğrudan KOBİ) ama B2B2B satış döngüsü yavaş |
| Timing / why-now | /10 | **9** | GenAI şema çıkarımı yeni çalışır oldu; 500M$ VC; TR-yerel boşluk hâlâ açık |
| Para kazanma / ödeme isteği | /10 | **8** | İmplementasyon bütçeleri büyük (ERP maliyetinin %15–40'ı); ödeme isteği kanıtlı |
| **TOPLAM** | **/100** | **66** | |

**Feasibility hard-fail kontrolü:** 8 > 3 → **geçer.** İdea elenmez.

**Bant:** 66 < 70 → **SIDELINE**. Ancak 70 eşiğine 4 puan; en oynak iki boyut
(fizibilite ve pazar) sadece **insan görüşmesiyle** yukarı ya da aşağı gider.

---

## 4. Açık Soruların Cevapları

**S1 — Hedef müşteri kim?**
Wedge için **iki katmanlı öneri:** (a) İlk giriş = **doğrudan KOBİ + onların SI/
implementasyon partneri** (partner aracı olarak; danışmanı ikame etmek yerine
hızlandır → kanibalizasyon direncini kır). (b) Ölçek = **ERP vendörüne B2B2B**
(Nebim ERA gibi bir PaaS'a migrasyon-katmanı olarak). Son müşteriye (KOBİ'ye
doğrudan tek başına) satış, derin veri erişimi + güven eşiği yüzünden en zor
başlangıç. → **Görüşmelerde test edilecek birincil hipotez.**

**S2 — Derin ERP veri modeli/API erişimi nasıl?**
İki yol: **(i) Bağımsız entegrasyon katmanı** — DB read-only export, dosya/
tablo dökümleri, süreç madenciliği (event log) üzerinden; vendör iş birliği
gerektirmez, hızlı başlar, ama her ERP için konnektör yükü. **(ii) Vendör iş
birliği** (Nebim ERA/BTP tarzı) — derin API + resmî destek, ama satış döngüsü
ve bağımlılık. **Wedge stratejisi:** (i) ile başla (migrasyon zaten kaynak
sistemden *dışarı* veri çeker, canlı API şart değil), traction sonrası (ii)'ye
geç. Bu, fizibilite skorunu masa başında 8 tutan ana sebep.

**S3 — "Her proje farklı" ne kadar engel?**
Tam implementasyon için **yüksek** engel (Mutasyon 1/2'yi zorlaştıran şey bu).
Ama **migrasyon + süreç keşfi** için engel **daha düşük**: kaynak→hedef şema
eşleme ve veri temizleme, projeler arası **genelleştirilebilir** bir problem
(kanıt: 115k-tablo vakası). Değişkenlik iş kuralı katmanında; onu da "çıkar +
insana onaylat" (copilot) modeliyle yönet, "otonom kur" değil. → Wedge seçiminin
temel gerekçesi.

---

## 5. Riskler / Kill-Criteria

- **Fizibilite kill:** İlk 3 KOBİ'de kaynak-sistem verisine read-only erişim
  bile sözleşme/güven nedeniyle alınamıyorsa → fizibilite ≤3, hard-fail.
- **Pencere kill:** Nebim/Logo 12 ay içinde kendi migrasyon-ajanını çıkarırsa,
  TR-yerel moat buharlaşır.
- **Sorumluluk kill:** Yanlış migrasyon = mali/hukuki sorumluluk; sigorta/SLA
  modeli kurulamıyorsa KOBİ satın almaz.
- **Kanibalizasyon kill:** SI partnerleri aracı "işimizi bitiriyor" diye
  benimsemezse B2B2B kanal tıkanır.

---

## 6. Verdict

**SIDELINE — 66/100 (masa başı triyaj).** Feasibility hard-fail değil; idea
elenmiyor, ama masa başı bandı watchlist'in altında. Bu, SİNYAL v2 kuralına
uygun: **GO'ya masa başı skorla ulaşılamaz.**

Yasal/teknik engelle bloke bir "85+" durumu **yok** (skor zaten 85 altı), o yüzden
ayrı bloke-raporu gerekmez.

**Kritik nüans:** Skor 70 eşiğine sadece 4 puan uzaklıkta ve iki oynak boyut
(fizibilite, pazar) yalnızca insan görüşmesiyle netleşir. Bu yüzden öneri
"unut" değil, **"ucuz doğrula, sonra karar ver."**

---

## 7. PROMOTE için Görüşme Planı (watchlist'e taşıma koşulu)

Hedef: 3–5 görüşme ile fizibilite ve pazar hipotezlerini test et. Bunlar
tamamlanmadan skor değişmez (masa başı tavan = 66).

1. **2× KOBİ (Nebim/Logo kullanan, yakın zamanda geçiş yapmış/yapacak):** Geçiş
   sürecinde en çok acıyı nerede çektiler? Migrasyon mı, config mi, eğitim mi?
   Read-only veri erişimi vermeye açık mılar? Ne kadar öderler?
2. **1–2× SI / implementasyon danışmanı:** Migrasyonu hızlandıran bir aracı
   *benimserler mi* yoksa tehdit mi görürler? Marj modelleri buna dayanır mı?
3. **1× ERP vendör tarafı (Nebim/Logo ekosistem/partner yöneticisi):** ERA gibi
   PaaS'a üçüncü-parti migrasyon katmanı entegrasyonu mümkün mü? Yol haritalarında
   kendi migrasyon-ajanı var mı? (pencere riski testi)

**Watchlist'e terfi eşiği:** ≥3 görüşmede (a) migrasyonun #1 acı olduğu, (b)
read-only erişimin alınabildiği, (c) partner/vendör düşmanlığının olmadığı
doğrulanırsa → fizibilite 8→11, pazar/GTM +2–3 → toplam ~74 → **WATCHLIST**,
aramaya devam.

---

## Kaynaklar

- [SAP Business AI Q1 2026 / Joule agents](https://news.sap.com/2026/04/sap-business-ai-release-highlights-q1-2026/)
- [SAP Joule Agentic AI 2026 — 40+ ajan, 2400 skill (SAVIC)](https://www.savictech.com/insights/sap-joule-agentic-platform-40-agents-2026/)
- [Dynamics 365 Wave 1 — agentic AI ERP (erp.today)](https://erp.today/dynamics-365-wave-1-puts-agentic-ai-at-the-heart-of-erp/)
- [AI Agents in ERP: Use Cases, Costs & ROI 2026 (Commerce Pundit)](https://www.commercepundit.com/blog/ai-agents-in-erp-2026/)
- [7 AI-Native ERPs Rated (RoboCFO)](https://robocfo.ai/frameworks/ai-native-erp-landscape)
- [AI-Powered ERP Migration Tools 2026 (Energent.ai)](https://www.energent.ai/energent/compare/en/ai-powered-erp-migration)
- [AI Data Migration 2026 (Ispirer)](https://www.ispirer.com/blog/ai-data-migration)
- [Removing the Legacy Data Barrier: AI Migration for ERP (CraftedERP)](https://craftederp.com/the-buzz/how-ai-acceleration-drives-faster-time-to-value)
- [AI in ERP Data Migration (Konexxia)](https://www.konexxia.com/post/artificial-intelligence-in-erp-data-migration-transforming-implementation-quality-and-speed)
- [Nebim ERA Platform (PaaS) — AI + Agentic Computing](https://nebimera.nebim.com.tr/platform-paas)
- [Nebim V3 & Masraff — AI masraf yönetimi](https://www.nebim.com.tr/tr/nebim-v3/masraff-entegrasyonu)
- [Nebim Planet 2026 — Nebim AI stratejisi (YouTube)](https://www.youtube.com/watch?v=DHMz6od6gZQ)

_Bu bir masa başı PRE-SCREEN çıktısıdır; PROMOTE/GO için §7'deki görüşme kanıtı şarttır._
