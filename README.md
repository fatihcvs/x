# AI Twitter Co-pilot

X (Twitter) hesabını büyütmek için AI asistanı. İçerik **OpenAI (ChatGPT) API** ile üretilir.

- **Tweet'ler:** tam otomatik. Geniş kitleye hitap eden, etkileşim/büyüme odaklı,
  her seferinde farklı formatta (rotasyon) özgün tweet'ler üretir ve belirlediğin
  saatlerde atar.
- **Mention'lar:** otomatik DEĞİL. Biri yazınca AI cevap taslağı hazırlar, Telegram'a
  düşer. **✅ Gönder** / **❌ Geç**. Mesajı yanıtlayıp kendi metnini de yollayabilirsin.
- **Beğeni / takip yok:** hesap ban'ını tetikleyen kısım bu, bilerek eklenmedi.
- **Manuel tweet:** Telegram'dan `/tweet`, `/tweet <konu>` veya `/trend` ile
  istediğin an taslak üret → **✅ Gönder / 🔄 Yeniden üret / ❌ İptal**.
- **Trend farkındalığı:** otomatik tweet'ler, güncel **Türkiye haberleriyle bağlam
  kurarak** uygun (hafif/güvenli) bir trende bağlanır — trendin neden gündemde
  olduğunu analiz eder, hassas/çözülemeyen trendleri atlar, uygun yoksa normal atar.
- **İnsani içerik:** bot yazmadan önce "bugün ne konuşuluyor, gerçek biri ne atardı"
  diye düşünür; tüm içerik (tweet, trend, mention cevabı) spesifik ve doğal olur,
  yapay zeka kalıplarından kaçınır. Normal tweet'ler de gündeme göre güncel hisseder.

---

## Adım adım kurulum

### 0) Node.js kurulu olsun
Bilgisayarında/sunucunda **Node.js 18+** olmalı. Kontrol: `node -v`
Yoksa https://nodejs.org adresinden LTS sürümü kur.

### 1) OpenAI API anahtarı
1. https://platform.openai.com → giriş yap.
2. Sağ üst → **API keys** → **Create new secret key** → kopyala (`OPENAI_API_KEY`).
3. **Billing → Add payment method** ile kredi ekle (anahtar kredisiz çalışmaz).
   Tweet botu çok az tüketir; birkaç dolar kredi uzun süre yeter.

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
- **Railway** — repo'yu bağla, env değişkenlerini gir, çalıştır. `data.json` için
  küçük bir Volume ekle (yeniden başlatınca durum kaybolmasın).
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
- **`/help`** — komut listesini gösterir (komutlar Telegram'ın `/` menüsünde de görünür).

Her taslakta **✅ Gönder / 🔄 Yeniden üret / ❌ İptal** butonları gelir. Gönderilen
manuel tweet'ler de günlük limite (`maxTweetsPerDay`) dahildir. Komutlar yalnızca
senin sohbetinden (`TELEGRAM_CHAT_ID`) çalışır.

## Ayarlar — sadece `config.js`
- `model` — içeriği yazan OpenAI modeli. Varsayılan `gpt-4o` (güçlü, doğal yazım);
  daha ucuz için `gpt-4o-mini`, daha güçlü için hesabındaki daha yeni bir model.
  Kod model-bağımsızdır: token parametresini (`max_tokens` / `max_completion_tokens`)
  otomatik ayarlar, kod düzenlemene gerek yok.
- `accountGoal` / `referenceInfluencers` — büyüme hedefi ve taklit edilecek
  (kopyalanmayacak) tarz referansları. Bot, başarılı influencer mantığıyla ve
  güncel gündeme göre büyüme/etkileşim odaklı tweet üretir.
- `persona` — hesabının sesi/tonu/konuları.
- `tweetStyles` — rastgele dönen tweet formatları.
- `tweetSchedule` / `timezone` — otomatik tweet saatleri (cron) ve saat dilimi.
  Varsayılan TR zirve saatleri (09:00, 12:30, 19:30, 22:30) ve `Europe/Istanbul`;
  sunucu UTC'de olsa bile tweet'ler TR saatine göre atılır.
- `maxTweetsPerDay` / `maxRepliesPerDay` — güvenli sınırlar.
- `trendsEnabled` — `true` ise zamanlanmış tweet'ler uygun bir **Türkiye trendine**
  bağlanır (hassas konular atlanır); uygun trend yoksa normal tweet atılır. `/trend`
  komutu da bu mantığı kullanır. Kapatmak için `false` yap.
  Trend listesi getdaytrends.com'dan, "neden trend?" bağlamı ise Google News (TR)
  başlıklarından gelir (ücretsiz, API key yok). Her iki kaynak da `src/trends.js`
  içinde tek yerde toplanmıştır; değiştirmek istersen orayı düzenle.

**Tahmini maliyet:** `gpt-4o` ile tweet başına birkaç sent (günde birkaç tweet =
aylık ~birkaç dolar); en ucuzu istersen `gpt-4o-mini`'ye düş. X tarafı günde
4 tweet ≈ ayda ~$2-4.

## Büyüme / influencer modu
Bot, başarılı Türk Twitter influencer'larının format ve mantığını (modelin kendi
bilgisinden) güncel trend + haber gündemiyle birleştirip büyüme/etkileşim odaklı,
insani tweet üretir. Yazmadan önce birkaç açı düşünüp en güçlüsünü seçer.

Not: belirli influencer hesaplarının tweet'lerini **canlı** okumak X API'de ücretli
read/search erişimi ister (mevcut ucuz tier'da yok) ve X scraping'i engeller. İleride
API erişimin olursa canlı influencer tweet'lerini aynı gündem mekanizmasına bağlarız.
