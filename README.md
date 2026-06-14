# AI Twitter Co-pilot

X (Twitter) hesabını büyütmek için AI asistanı. İçerik **Anthropic (Claude) API** ile üretilir.

- **Tweet'ler:** tam otomatik. Geniş kitleye hitap eden, etkileşim/büyüme odaklı,
  her seferinde farklı formatta (rotasyon) özgün tweet'ler üretir ve belirlediğin
  saatlerde atar.
- **Mention'lar:** AI cevap taslağı hazırlar; çoğu Telegram'da onayına düşer
  (**✅ Gönder** / **❌ Geç**, ya da yanıtlayıp kendi metnini yolla). Açıkça
  dostça/zararsız olanlara — ayar açıksa — insan onayı olmadan otomatik cevap verir.
- **Beğeni / takip yok:** hesap ban'ını tetikleyen kısım bu, bilerek eklenmedi.
- **Manuel içerik:** Telegram'dan `/tweet`, `/tweet <konu>`, `/trend` veya
  `/thread <konu>` ile istediğin an taslak üret → **✅ Gönder / 🔄 Yeniden üret / ❌ İptal**.
- **Trend farkındalığı:** otomatik tweet'ler, güncel **Türkiye haberleriyle bağlam
  kurarak** uygun (hafif/güvenli) bir trende bağlanır — trendin neden gündemde
  olduğunu analiz eder, hassas/çözülemeyen trendleri atlar, uygun yoksa normal atar.
- **İnsani içerik:** bot yazmadan önce "bugün ne konuşuluyor, gerçek biri ne atardı"
  diye düşünür; tüm içerik (tweet, trend, mention cevabı) spesifik ve doğal olur,
  yapay zeka kalıplarından kaçınır. Normal tweet'ler de gündeme göre güncel hisseder.

---

## Adım adım kurulum

### 0) Node.js kurulu olsun
Bilgisayarında/sunucunda **Node.js 22+** olmalı (yerleşik SQLite veritabanı için).
Kontrol: `node -v`. Yoksa https://nodejs.org adresinden güncel sürümü kur.

### 1) Anthropic (Claude) API anahtarı
1. https://console.anthropic.com → giriş yap.
2. **Settings → API keys → Create Key** → kopyala (`ANTHROPIC_API_KEY`).
3. **Billing**'den ödeme/kredi ekle (anahtar kredisiz çalışmaz). Varsayılan
   `claude-sonnet-4-6` az tüketir (maliyet notu aşağıda).

### 2) Telegram botu
1. Telegram'da **@BotFather**'a yaz → `/newbot` → isim ver → **token** al
   (`TELEGRAM_BOT_TOKEN`).
2. **@userinfobot**'a yaz → sana dönen **Id** senin `TELEGRAM_CHAT_ID`'in.
3. Az önce oluşturduğun bota git ve bir kez "selam" yaz (yoksa bot sana mesaj atamaz).

### 3) X / Twitter anahtarları
1. https://developer.x.com → developer hesabı + bir **App** oluştur.
2. App ayarlarında izni **Read and Write** yap.
3. **Keys and tokens** sekmesinden şunları üret ve sakla:
   `API Key`, `API Secret`, `Access Token`, `Access Token Secret`.
4. 2026'da X API kullandıkça-öde. Geliştirici konsolundan ödeme/kredi tanımla,
   yoksa istekler reddedilir. (Metin tweet ~$0.015, kendi okumaların ~$0.001.)

### 4) Projeyi aç
Zip'i indir, bir klasöre çıkar, terminalde o klasöre gir:
```bash
cd ai-twitter-copilot
```

### 5) .env dosyasını doldur
```bash
cp .env.example .env
```
`.env` dosyasını aç, 1-3. adımdaki tüm değerleri yapıştır.

### 6) Bağımlılıkları kur
```bash
npm install
```

### 7) Çalıştır (test)
```bash
npm start
```
Telegram'a **"🤖 Co-pilot çalışıyor"** mesajı geldiyse her şey tamam.
Terminalde `X auth OK` görmen X anahtarlarının doğru olduğunu gösterir.

### 8) Kişiselleştir (opsiyonel ama önerilir)
`config.js` içindeki `persona`, `tweetStyles`, `tweetSchedule`, `maxTweetsPerDay`
değerlerini kendine göre düzenle. Persona ne kadar iyiyse tweet'ler o kadar iyi.

### 9) 7/24 çalışsın (deploy)
Telegram onay akışı sürekli açık bir süreç ister; bilgisayarını kapatınca durur.
En ucuz iki yol:
- **Railway** — repo'yu bağla, env değişkenlerini gir, çalıştır. `data.db` için
  küçük bir Volume ekle (yeniden başlatınca geçmiş/hafıza kaybolmasın).
- **Hetzner (~€4/ay)** — küçük VPS'te `npm install -g pm2 && pm2 start index.js`
  ile sürekli çalıştır.

---

## Kullanım
- Tweet'ler `config.js`'teki saatlerde otomatik atılır, sana bildirim gelir.
- Mention gelince Telegram'a taslak + **✅ Gönder / ❌ Geç** düşer.
- Taslağı beğenmezsen o mesajı **yanıtla**, yazdığın metin cevap olarak gider.

### Manuel tweet & trend (Telegram komutları)
- **`/tweet`** — persona + rastgele formatla bir tweet taslağı üretir.
- **`/tweet <konu>`** — verdiğin konu/ipucu etrafında taslak üretir.
- **`/trend`** — o an uygun (hafif/güvenli) bir Türkiye trendine göre taslak üretir.
- **`/thread <konu>`** — konu üzerine 3-5 tweet'lik bir **thread** (zincir) taslağı üretir.
  Gönderilirse tweet'ler zincir olarak atılır ve her biri günlük limite sayılır.
- **`/pause`** / **`/resume`** — otomatik (zamanlı) tweet'leri duraklat/başlat.
  Manuel komutlar ve mention onayı çalışmaya devam eder.
- **`/stats`** — bugünkü tweet/cevap sayıları ve aktif/duraklatılmış durumu gösterir.
- **`/help`** — komut listesini gösterir (komutlar Telegram'ın `/` menüsünde de görünür).

Her taslakta **✅ Gönder / 🔄 Yeniden üret / ❌ İptal** butonları gelir. Gönderilen
manuel tweet'ler de günlük limite (`maxTweetsPerDay`) dahildir. Komutlar yalnızca
senin sohbetinden (`TELEGRAM_CHAT_ID`) çalışır.

## Web kontrol paneli (opsiyonel)
`.env`'de `DASHBOARD_PASSWORD` tanımlarsan bot açılırken bir web paneli de başlar
(varsayılan port 3000, `PORT` ile değiştirilir). Tarayıcıdan `http://SUNUCU:PORT`:
- Şifreyle giriş; bugünkü tweet/cevap sayıları, **son aktivite**, **bekleyen
  mention'lar** ve **⏸️ Duraklat / ▶️ Devam**.
- `DASHBOARD_PASSWORD` boşsa panel kapalıdır. Panel botu kontrol ettiği için
  **mutlaka HTTPS arkasında** çalıştır (Railway HTTPS verir; düz VPS'te TLS reverse proxy).

> Composer (panelden tweet/thread üret-gönder), mention onay aksiyonları ve ayar
> düzenleme bir sonraki dilimde gelecek.

## Ayarlar — sadece `config.js`
- `model` — içeriği yazan Claude modeli. Varsayılan `claude-sonnet-4-6` (çok iyi
  kalite, Opus'tan kat kat ucuz); en yüksek kalite için `claude-opus-4-8`, en ucuz
  için `claude-haiku-4-5`. Değiştirmek için sadece adını yaz.
- `refineTweets` — `true` ise her tweet ikinci bir "editör" turuyla cilalanır
  (kalite ↑, tweet başına model maliyeti ~2x). Kapatmak için `false`.
- `learnFromMetrics` — `true` ise bot kendi en çok tutan tweet'lerini (beğeni/RT/
  yorum) okuyup üretime "şu işe yaradı" sinyali olarak besler. X API'de okuma
  erişimi yoksa sessizce devre dışı kalır.
- `accountGoal` / `referenceInfluencers` — büyüme hedefi ve taklit edilecek
  (kopyalanmayacak) tarz referansları. Bot, başarılı influencer mantığıyla ve
  güncel gündeme göre büyüme/etkileşim odaklı tweet üretir.
- `persona` — hesabının sesi/tonu/konuları.
- `tweetStyles` — rastgele dönen tweet formatları.
- `tweetSchedule` / `timezone` — otomatik tweet saatleri (cron) ve saat dilimi.
  Varsayılan TR zirve saatleri (09:00, 12:30, 19:30, 22:30) ve `Europe/Istanbul`;
  sunucu UTC'de olsa bile tweet'ler TR saatine göre atılır.
- `digestCron` — her gün bu saatte (timezone'a göre) Telegram'a günlük özet
  (bugün kaç tweet/cevap, aktif mi) gönderir. Varsayılan 23:00; kapatmak için sil.
- `maxTweetsPerDay` / `maxRepliesPerDay` — güvenli sınırlar.
- `autoReplySafeMentions` — `true` ise açıkça dostça/zararsız mention'lara insan
  onayı olmadan otomatik cevap verilir (linkli mention'lar ve günlük cevap limiti
  hariç). Diğer tüm mention'lar yine onaya düşer. `false` = her cevap onaylı.
- `trendsEnabled` — `true` ise zamanlanmış tweet'ler uygun bir **Türkiye trendine**
  bağlanır (hassas konular atlanır); uygun trend yoksa normal tweet atılır. `/trend`
  komutu da bu mantığı kullanır. Kapatmak için `false` yap.
  Trend listesi getdaytrends.com'dan, "neden trend?" bağlamı ise Google News (TR)
  başlıklarından gelir (ücretsiz, API key yok). Her iki kaynak da `src/trends.js`
  içinde tek yerde toplanmıştır; değiştirmek istersen orayı düzenle.

**Tahmini maliyet:** `claude-sonnet-4-6` ile tweet başına maliyet çok düşüktür
(günde birkaç tweet + cilalama ≈ aylık birkaç dolar). Daha da düşürmek için
`refineTweets: false` (tweet başına 2 yerine 1 çağrı) ya da `claude-haiku-4-5`.
En yüksek kalite gerekiyorsa `claude-opus-4-8` (belirgin pahalı). X tarafı günde
4 tweet ≈ ayda ~$2-4.

## Büyüme / influencer modu
Bot, başarılı Türk Twitter influencer'larının format ve mantığını (modelin kendi
bilgisinden) güncel trend + haber gündemiyle birleştirip büyüme/etkileşim odaklı,
insani tweet üretir. Yazmadan önce birkaç açı düşünüp en güçlüsünü seçer.

Not: belirli influencer hesaplarının tweet'lerini **canlı** okumak X API'de ücretli
read/search erişimi ister (mevcut ucuz tier'da yok) ve X scraping'i engeller. İleride
API erişimin olursa canlı influencer tweet'lerini aynı gündem mekanizmasına bağlarız.
