# Yol Haritası — AI Sosyal Medya Otomasyonu

> Bu döküman projenin **baştan sona** planıdır: nereden başladık, amacımız ne,
> nereye gidiyoruz ve hangi adımları uygulayacağız. Tek başına okunduğunda
> projenin tüm resmini verir. Her faz tamamlandıkça bu döküman güncellenir.

Son güncelleme: 2026-06-14

---

## 1. Amaç (nereye gidiyoruz?)

**Kısa vadede:** Tek bir X (Twitter) hesabını, gerçek bir insan gibi yazan,
gündemi takip eden, büyüme odaklı bir yapay zeka co-pilot'u ile yönetmek ve
hesabı **yüksek takipçili bir influencer hesabına** dönüştürmek.

**Uzun vadede:** Bu sistemi tek hesaba/tek platforma bağlı olmaktan çıkarıp,
**çok platformlu (X, Instagram, TikTok, LinkedIn…) ve çok kullanıcılı bir
sosyal medya otomasyon ve yönetim ürününe (SaaS)** dönüştürmek. Yani sadece bizim
için değil, kayıt olan başka kullanıcılar için de çalışan bir platform.

**Pusula ilkesi:** Her zaman çalışan, kanıtlanmış küçük bir şeyi büyütürüz.
Kullanılmayan büyük altyapıyı önceden kurmayız (erken optimizasyon = israf).

---

## 2. Şu ana kadar ne yaptık? (tamamlandı)

Proje, tek hesaplı çalışan tam fonksiyonel bir X co-pilot'u hâline geldi. Hepsi
GitHub'da (`fatihcvs/x`, `main`):

| # | Yapılan | Durum |
|---|---------|-------|
| 1 | **Temel bot:** zamanlanmış otomatik tweet, mention'lara cevap taslağı, Telegram onayı. Beğeni/takip YOK, link YOK, ≤280, insan onaylı cevaplar. | ✅ |
| 2 | **Manuel komutlar + trend farkındalığı:** `/tweet`, `/tweet <konu>`, `/trend`. | ✅ |
| 3 | **`/help` + Telegram komut menüsü.** | ✅ |
| 4 | **Gerçek gündem analizi:** trendleri getdaytrends.com'dan, "neden trend?" bağlamını Google News (TR) RSS'inden çeker; hassas/çözülemeyen trendleri atlar. | ✅ |
| 5 | **İnsani içerik katmanı:** model yazmadan önce "gerçek biri ne atardı" diye düşünür; yapay zeka klişelerinden kaçınır; tüm gündem (trend+haber) normal tweet'lere de arka plan olur. | ✅ |
| 6 | **Büyüme/influencer stratejisi + zirve saat zamanlaması:** TR zirve saatleri + doğru saat dilimi (Europe/Istanbul). | ✅ |
| 7 | **Model: OpenAI → Claude (Anthropic) geçişi:** `claude-opus-4-8` + ikinci "editör" cilası (`refineTweets`). | ✅ |
| 8 | **Thread'ler:** `/thread <konu>` → 3-5 tweet'lik AI zinciri, onaylı gönderim. | ✅ |
| 9 | **Kontrol paneli (Telegram) + günlük özet:** `/pause`, `/resume`, `/stats` ve her akşam özet. | ✅ |
| 10 | **Performans öğrenme döngüsü:** kendi en çok tutan tweet'lerini okuyup üretime besler (`learnFromMetrics`). | ✅ |
| 11 | **Akıllı oto-cevap:** mention'ları auto/review/skip diye sınıflar; sadece açıkça güvenli olanlara otomatik cevap verir, gerisi onaya düşer. | ✅ |
| 12 | **Kalıcı hafıza (veritabanı):** `data.json` → yerleşik **SQLite** (`node:sqlite`, `data.db`); aynı arayüz, otomatik göç. Geçmiş artık sorgulanabilir bir DB'de. | ✅ |

**Bugünkü teknoloji:** Node.js (CommonJS) tek süreç · `@anthropic-ai/sdk` ·
`twitter-api-v2` · `node-telegram-bot-api` · `node-cron` · `dotenv`. Durum yerleşik
**SQLite** (`data.db`, `node:sqlite`) veritabanında. Kontrol arayüzü = Telegram.

---

## 3. Mimari: bugün vs. hedef

| Konu | Bugün (tek kullanıcı) | Hedef (SaaS) |
|------|------------------------|--------------|
| Kullanıcı | 1 (sahip) | Çok kullanıcı, kayıt/giriş |
| Platform | Sadece X | X + Instagram + TikTok + … (adaptörler) |
| Arayüz | Telegram | Web kontrol paneli (+ Telegram opsiyonel) |
| Veri | **SQLite** (`data.db`, tek dosya) | Postgres + kullanıcı başına izolasyon |
| Anahtarlar | Tek `.env` | Kullanıcı başına **şifreli** saklanan anahtarlar |
| Süreç | Tek Node süreci | Web app + worker(lar) + DB (+ kuyruk) |
| Faturalandırma | Yok | Planlar/abonelik (Stripe) |

> Bugünkü yapı bilerek tek-kullanıcılık. SaaS'a geçiş kademeli bir
> **yeniden mimari**dir; aşağıdaki fazlar bu geçişi adım adım yapar.

---

## 4. Yol haritası (fazlar ve adımlar)

### Faz 0 — Canlı doğrulama (ÖN KOŞUL) ▢
Her şey bunun üstüne kurulacak; önce gerçekten çalıştığını görelim.
1. `.env`'i doldur: `ANTHROPIC_API_KEY`, X anahtarları, Telegram token + chat id.
2. `npm install && npm start`.
3. Telegram'dan `/tweet`, `/trend`, `/thread`, `/stats` dene; gerçek Claude
   çıktısını ve mention akışını gör.
4. Persona/model/`refineTweets`/saatleri gerçek çıktıya göre ince ayarla.
- **Kabul:** Bot 7/24 sorunsuz çalışıyor, tweet/cevap kalitesi tatmin edici.

### Faz 1 — Kişisel tam kontrol paneli (web) ▢  ← *bir sonraki büyük adım*
Amaç: botu tarayıcıdan, görsel bir panelden yönetmek (Telegram'ı tamamlar).
1. **Web sunucusu:** Express ekle, bota entegre başlat (`PORT` env). Tek
   sayfalık arayüz + JSON API.
2. **Güvenlik:** tek şifreli giriş (`DASHBOARD_PASSWORD`), imzalı oturum çerezi;
   tüm panel ve `/api` korumalı. Deploy'da **HTTPS şart** (panel tweet attırabilir).
3. **Servis katmanı:** mevcut `ai/x/db/trends/insights/scheduler` fonksiyonlarını
   route'ların çağırdığı temiz bir katmana bağla (ileride çok-kullanıcı için zemin).
4. **API uçları:**
   - `GET /api/stats` (bugünkü sayılar, durum) · `GET /api/activity` (son gönderimler)
   - `GET /api/pending` (bekleyen mention'lar) · `POST /api/pending/:id` (onayla/geç/düzenle)
   - `POST /api/generate` `{mode, topic}` → taslak (göndermeden önizleme)
   - `POST /api/post` `{content}` → gönder (tek tweet veya thread)
   - `POST /api/pause` · `POST /api/resume`
   - `GET/PUT /api/settings` (persona, model, saatler, flag'ler)
5. **Ayar düzenleme altyapısı:** `config.js` kod olduğu için runtime'da
   düzenlemek risklidir → ayarları `data.json` içinde bir **override** katmanına
   taşı; "varsayılan (config.js) + kullanıcı override" birleşsin. Böylece panelden
   güvenle ayar değiştirilir.
6. **Arayüz (build gerektirmeyen tek sayfa, sade):**
   - Dashboard: bugünkü istatistik + küçük büyüme grafiği + durum.
   - Composer: tweet/trend/thread üret → önizle → onayla/yeniden üret → gönder.
   - Mentions: bekleyenler; onayla / geç / düzenleyip gönder.
   - Settings: persona, model, `refineTweets`, saatler, flag'ler.
   - Activity: son atılan tweet/cevaplar.
- **Kabul:** Tarayıcıdan giriş → istatistik gör, tweet/thread üret-gönder, mention
  onayla, pause/resume, ayar değiştir. Telegram akışı bozulmadan çalışmaya devam eder.

### Faz 2 — Çok platform ▢
Amaç: X'e kilitli olmaktan çıkmak.
1. **`platforms/` soyutlaması:** ortak arayüz — `post(text)`, `postThread(parts)`,
   `getMentions(since)`, `replyTo(id, text)`, `getMyRecentTweets()`, `limits`
   (maks karakter vb.). Mevcut `x.js` → `platforms/x.js` olarak bu arayüze sarılır.
2. **İçerik katmanını platform-agnostik yap:** üretim metni ortak; platforma özel
   kısıtlar (karakter limiti, hashtag kültürü, format) parametreyle gelir.
3. **Zamanlayıcı:** her aktif platform için ayrı job; panelde platform seçici.
4. **Yeni adaptörler — en erişilebilirden başla.** Gerçeklik: her platformun API'si
   ayrı bir savaş (aşağıdaki "Riskler"e bak). Sırayla ekle, hepsini birden değil.
- **Kabul:** En az bir ikinci platform uçtan uca (üret→onayla→gönder) çalışır;
  yeni platform eklemek = yeni bir adaptör dosyası yazmak.

### Faz 3 — Çok kullanıcı (SaaS) ▢
Amaç: başka kullanıcıların da kayıt olup kendi hesaplarını yönetmesi.
1. **Veritabanı:** SQLite temeli **kuruldu** (`data.db`, `node:sqlite`; eski
   `data.json` otomatik göç ediyor). Burada yapılacak: çok-kullanıcı şeması
   (`users`, `accounts` = platform + **şifreli** creds; her sorgu `user_id` ile
   izole), ölçek için Postgres'e geçiş.
2. **Kimlik:** kullanıcı kayıt/giriş (email+şifre veya OAuth), oturum/JWT.
3. **Creds güvenliği:** kullanıcı API anahtarları **at-rest şifreli** saklanır
   (uygulama anahtarı/secret manager). Sandbox/loglara asla sızmaz.
4. **İzolasyon:** her sorgu `user_id` ile filtrelenir; bir kullanıcı diğerinin
   verisine erişemez. (Güvenliğin en kritik kısmı.)
5. **Süreç ayrışması:** web app (API + panel) + worker (zamanlama/gönderim) + DB
   (+ gerekirse kuyruk). Tek süreçten çok süreçe.
6. **Onboarding:** kullanıcı platform bağlama (OAuth akışı), persona kurulumu.
7. **Faturalandırma (en son):** Stripe + plan limitleri (hesap sayısı, günlük post).
8. **Operasyon:** loglama, izleme, hata bildirimi, yedekleme.
- **Kabul:** İki ayrı kullanıcı kayıt olup kendi hesaplarını birbirinden tamamen
  izole şekilde yönetebilir.

---

## 5. Çalışma şeklimiz
Her adımda aynı ritim: **uygula → doğrula (syntax + test) → "evet" → commit & push.**
Büyük fazlar küçük, gözden geçirilebilir parçalara bölünür. Her parça kendi
başına çalışır halde bırakılır (yarım bırakmayız).

**Bu yol haritası her değişiklikte güncellenir** — ne yaptığımız, nerede olduğumuz
ve nereye gittiğimiz dökümana bakınca daima güncel görünür.

---

## 6. Yatay konular (her fazda geçerli)

- **Güvenlik:** panel şifresi + HTTPS; SaaS'ta şifreli creds + kullanıcı izolasyonu.
- **Maliyet:** Claude (Opus) + X API + hosting; SaaS'ta DB/altyapı. Model ve
  `refineTweets` ile maliyet ayarlanabilir.
- **Yasal/ToS:** her platformun otomasyon kuralları (ban riski); başkalarının
  verisini tutunca KVKK/GDPR sorumluluğu doğar.
- **Bakım:** çok platform = çok sayıda dış API'yi takip etmek.

---

## 7. Riskler ve gerçekçi notlar

- **X API katmanı:** okuma (mention + kendi metrik) ve yazma gerekir; ücretli
  tier maliyeti var. Başka hesapları **canlı** okumak daha pahalı tier ister.
- **Instagram / TikTok / LinkedIn API'si zor:** Instagram Graph API yalnızca
  Business/Creator + uygulama incelemesi ister; TikTok içerik gönderme API'si
  başvuru/onay gerektirir; LinkedIn kısıtlıdır. Bu yüzden Faz 2 platform-by-platform
  ilerler, hepsi birden değil.
- **SaaS sorumluluğu:** başka kullanıcıların anahtarlarını tutmak ciddi güvenlik
  ve yasal yük getirir; bu yüzden en sona bırakıldı.

---

## 8. Sıradaki somut adım

1. **Faz 0:** `.env`'i doldur, botu canlı çalıştır, kaliteyi doğrula.
2. **Faz 1'e başla:** Express + şifreli giriş iskeleti → `/api/stats` ve basit
   dashboard → sonra composer ve mention onayı → sonra ayar düzenleme.

> Onay verdiğinde Faz 1'i bu sıralamayla, parça parça kurmaya başlarım.
