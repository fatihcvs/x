# AI Twitter Co-pilot

X (Twitter) hesabını büyütmek için AI asistanı. İçerik **OpenAI (ChatGPT) API** ile üretilir.

- **Tweet'ler:** tam otomatik. Geniş kitleye hitap eden, etkileşim/büyüme odaklı,
  her seferinde farklı formatta (rotasyon) özgün tweet'ler üretir ve belirlediğin
  saatlerde atar.
- **Mention'lar:** otomatik DEĞİL. Biri yazınca AI cevap taslağı hazırlar, Telegram'a
  düşer. **✅ Gönder** / **❌ Geç**. Mesajı yanıtlayıp kendi metnini de yollayabilirsin.
- **Beğeni / takip yok:** hesap ban'ını tetikleyen kısım bu, bilerek eklenmedi.

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

## Ayarlar — sadece `config.js`
- `model` — `gpt-4o-mini` (ucuz, varsayılan) / `gpt-5.4-mini` (daha kaliteli, pahalı).
  Not: GPT-5.x modeline geçersen `src/ai.js` içinde `max_tokens` yerine
  `max_completion_tokens` yazman gerekebilir.
- `persona` — hesabının sesi/tonu/konuları.
- `tweetStyles` — rastgele dönen tweet formatları.
- `tweetSchedule` — kaç tweet, hangi saatlerde (cron).
- `maxTweetsPerDay` / `maxRepliesPerDay` — güvenli sınırlar.

**Tahmini maliyet:** OpenAI tarafı tweet başına neredeyse yok denecek kadar az
(gpt-4o-mini ile aylık birkaç dolar); X tarafı günde 3 tweet ≈ ayda ~$1-3.
