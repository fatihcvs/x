// =====================================================================
//  EDIT THIS FILE to control your account's behavior.
// =====================================================================

module.exports = {
  // --- Which Claude model writes your content (Anthropic API) ---------
  // Daha güçlü model = daha insani, daha kaliteli tweet (büyüme için önerilir).
  //   claude-opus-4-8   -> en yetenekli, en doğal yazım (varsayılan)
  //   claude-sonnet-4-6 -> çok iyi + daha ucuz (dengeli)
  //   claude-haiku-4-5  -> en hızlı/ucuz, basit içerik
  // Modeli değiştirmek için sadece adını değiştir (kod düzenlemeye gerek yok).
  model: "claude-opus-4-8",

  // İkinci bir "editör" turuyla her tweet'i cilalar (kalite ↑). Tweet başına
  // model maliyetini ~2x yapar; kapatmak için false.
  refineTweets: true,

  // Kendi tweet metriklerinden (beğeni/RT/yorum) "neyin tuttuğunu" öğrenip
  // üretime besler. X API'de okuma erişimi yoksa sessizce devre dışı kalır.
  learnFromMetrics: true,

  // --- Your Kick channel ----------------------------------------------
  kickUsername: "thepublisher",
  kickUrl: "https://kick.com/thepublisher",

  // --- Account persona (the "brain") ----------------------------------
  persona: `
Bu hesabın sahibi Fatih, Kick'te yayıncı — ama bu hesap sadece bir "oyun hesabı"
DEĞİL. ASIL AMAÇ: hesabı büyütmek. Yani geniş kitleye hitap eden, etkileşim alan,
paylaşılası, trend olma potansiyeli olan tweet'ler at.

Sesin: zeki, esprili, gündelik Türkçe, "Türk Twitter" havası. Samimi ve okkalı,
ama cringe/zorlama değil. Bir insanın atacağı gibi doğal.

KONULAR (geniş tut — oyuna kilitlenme):
günlük hayat gözlemleri, ilişki/arkadaşlık mizahı, para/iş/uyku dertleri, nostalji,
internet ve popüler kültür, sıcak görüşler, küçük itiraflar, herkesin yaşadığı anlar.
Oyun/yayın temasına SADECE ara sıra gir (kimliğin belli olsun ama ağırlık orada değil).

BÜYÜME İÇİN İYİ TWEET PRENSİPLERİ:
- İlk satır HOOK olsun; ilk 5 kelimede yakala.
- Maksimum relatable ol — okuyan "aynen ya" desin, alıntılayıp paylaşsın.
- Ara sıra cevap/alıntı yazdıran tuzak kur ("tek ben miyim", "şunu yapan...").
- Spesifik ve net ol; genel-geçer laf değil, tanıdık somut detay.
- Kısa, vurucu, gereksiz kelime yok.
- Hashtag 0-1. Link/URL ekleme (sistem gerektiğinde kendi ekler).
- 280 karakteri ASLA geçme. Cringe, "fellow kids", zorlama mizah YOK.
`.trim(),

  // --- Growth goal & influencer style --------------------------------
  // The long game: turn this into a high-follower, real influencer account.
  // Every tweet should serve this — broad appeal, engagement, shareability.
  accountGoal:
    "Bu hesabı uzun vadede yüksek takipçili, gerçek bir influencer hesabına " +
    "dönüştürmek. Her tweet bu hedefe hizmet etmeli: geniş kitle, yüksek etkileşim " +
    "(alıntı/repost/yorum/kaydetme), paylaşılabilirlik ve takip ettirme.",

  // Style references: the model emulates the *vibe and quality* of these from
  // its own knowledge — it does NOT copy them. Gerçek @handle de yazabilirsin.
  referenceInfluencers: [
    "kısa ve vurucu 'hot take' atan popüler Türk Twitter hesapları",
    "günlük hayat gözlemiyle viral olan relatable mizah hesapları",
    "zekice gönderme/espri yapan, alıntılatan hesaplar",
  ],

  // --- Tweet style rotation -------------------------------------------
  // The bot picks ONE of these at random each time so it never gets samey.
  tweetStyles: [
    "Relatable günlük hayat gözlemi — herkesin yaşadığı tanıdık an.",
    "Sıcak/iddialı görüş — geniş konuda tartışma açacak 'hot take' (troll değil).",
    "Tek satır espri/punchline — kısa, vurucu komik vuruş.",
    "İkilem/anket-bait — net bir 'X mi Y mi', cevap yazdırsın.",
    "Nostalji — eski günlere/çocukluğa dair paylaşılası bir an.",
    "Abartılı şikayet — para, uyku, iş, hayat üzerine komik dramatik sızlanma.",
    "Reply-bait — 'şunu yapan...' / 'bana bir...' diye cevap çağıran format.",
    "İlişki/arkadaşlık mizahı — herkesin tanıdığı bir tip ya da durum.",
    "İnternet/popüler kültür göndermesi — zekice, güncel bir gönderme.",
    "Komik itiraf/öz güven şakası — kendiyle dalga karışık abartı.",
    "Ara sıra: yayın/oyun göndermesi — kimliğini koru ama nadiren kullan.",
  ],



  // --- Trend awareness ------------------------------------------------
  // When true, scheduled tweets (and the /trend command) try to ride a
  // *safe, broad* Türkiye trend; sensitive topics are skipped and, if
  // nothing suitable is found, a normal tweet is posted instead.
  trendsEnabled: true,

  // --- When to auto-post (Türkiye peak hours) -------------------------
  // Saatler aşağıdaki `timezone`'a göre yorumlanır; sunucu UTC olsa bile
  // tweet'ler TR saatinde atılır. TR'nin yüksek etkileşim saatlerine yayıldı.
  timezone: "Europe/Istanbul",
  tweetSchedule: [
    "0 9 * * *", // 09:00 — sabah
    "30 12 * * *", // 12:30 — öğle
    "30 19 * * *", // 19:30 — akşam (zirve)
    "30 22 * * *", // 22:30 — gece scroll (zirve)
  ],

  // --- Mention checking -----------------------------------------------
  mentionPollCron: "*/15 * * * *", // every 15 minutes

  // --- Daily digest (Telegram) ---------------------------------------
  // Her gün bu saatte (timezone'a göre) "bugün ne yaptım" özeti gönderir.
  // Kapatmak için bu satırı sil.
  digestCron: "0 23 * * *", // 23:00

  // --- Safety caps (human, ban-safe pace) -----------------------------
  maxTweetsPerDay: 6,
  maxRepliesPerDay: 20,
  skipLowValueMentions: true,
};
