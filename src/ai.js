const Anthropic = require("@anthropic-ai/sdk");
const { getSettings } = require("./settings");

// Reads ANTHROPIC_API_KEY from the environment.
const client = new Anthropic();

const MAX_OUT = 1000;
async function chat(userId, system, user) {
  const config = getSettings(userId);
  const res = await client.messages.create({
    model: config.model,
    max_tokens: MAX_OUT,
    system,
    messages: [{ role: "user", content: user }],
  });
  const block = (res.content || []).find((b) => b.type === "text");
  return (block?.text || "").trim();
}

const HUMAN_GUIDE = `

--- GERÇEK İNSAN GİBİ YAZ (her tweet/cevap için) ---
Sen zeki, esprili, gerçek bir Türk kullanıcısısın; yapay zeka değil.
ÖNCE kafanda düşün (YAZMA): bugün millet neyi konuşuyor, hangi açı taze,
gerçek biri şu an ne atardı? SONRA sadece final metni ver.

YAP:
- Spesifik ol: somut, tanıdık bir an/detay. Herkesin diyebileceği genel laf değil.
- Doğal günlük Türkçe; yeri gelince küçük harf, eksiltili cümle olabilir.
- Tek net fikir, kısa ve vurucu, ilk kelimelerde yakala. Kendi tavrın/görüşün olsun.

YAPMA (yapay zeka kokusu):
- Klişe/motivasyon ("hayat işte", "bazen", "unutma ki"), zorlama kelime oyunu.
- Aşırı parlak/simetrik kurgu, "X değil Y" kalıbı, ders verme/açıklama tonu.
- Gereksiz emoji (en fazla 1, gerçekten gerekiyorsa), zorlama hashtag, süslü tire (—).`;

const systemPrompt = (userId) => {
  const config = getSettings(userId);
  return (config.persona || "") + HUMAN_GUIDE;
};

function growthBlock(userId) {
  const config = getSettings(userId);
  const refs = (config.referenceInfluencers || []).filter(Boolean);
  const refLine = refs.length
    ? "\nTarz referansı (TAKLİT etme; kaliteyi/enerjiyi yakala): " +
      refs.join("; ") +
      "."
    : "";
  return (
    "\n\n--- BÜYÜME HEDEFİ ---\n" +
    (config.accountGoal ? config.accountGoal + "\n" : "") +
    "Başarılı Türk Twitter influencer'larının mantığıyla düşün: güçlü hook, " +
    "netlik, doğru zamanlama, alıntılatan/yorumlatan açı, yüksek paylaşılabilirlik. " +
    "Takipçi kazandıracak, 'bunu ben de yaşadım, paylaşayım' dedirtecek tweet üret." +
    refLine
  );
}

const tweetSystem = (userId) => systemPrompt(userId) + growthBlock(userId);

function pickStyle(userId) {
  const config = getSettings(userId);
  const styles = config.tweetStyles || [];
  return styles.length
    ? styles[Math.floor(Math.random() * styles.length)]
    : null;
}

function avoidBlock(recent = []) {
  return recent.length
    ? `\n\nSon attığın tweet'ler (bunları TEKRARLAMA, format ve konu olarak farklı yaz):\n` +
        recent.map((t) => `- ${t}`).join("\n")
    : "";
}

function agendaBlock(trends) {
  const items = (trends || [])
    .map((t) => (typeof t === "string" ? { title: t, context: [] } : t))
    .filter((t) => t && t.title);
  if (!items.length) return "";
  const lines = items.slice(0, 6).map((t) => {
    const h = (t.context || [])[0];
    return `- ${t.title}${h ? ` (${h})` : ""}`;
  });
  return (
    "\n\nBUGÜN TÜRKİYE'DE X GÜNDEMİ (arka plan — sadece tweet'i daha güncel/insani " +
    "yapacaksa kullan; zorlama, illa değinme):\n" +
    lines.join("\n")
  );
}

const clean = (s) => (s || "").replace(/^["']|["']$/g, "").trim();
const clip = (s, maxLen = 280) => (s.length > maxLen ? s.slice(0, maxLen - 3) + "..." : s);

async function refine(userId, draft, recent = [], limits = { maxLen: 280 }) {
  const user =
    "Şu metin taslağını sert bir editör gözüyle değerlendir ve DAHA İYİSİNİ yaz:\n\n" +
    `"${draft}"\n\n` +
    "Sor: Hook ilk kelimelerde tutuyor mu? Spesifik mi yoksa klişe/yapay mı? Daha " +
    "vurucu, daha insani, daha paylaşılası olur mu? Gerekiyorsa baştan yaz; zaten " +
    `güçlüyse olduğu gibi bırak. Kurallar: link yok, ${limits.maxLen} karakteri geçme, en fazla 1 doğal ` +
    "hashtag. Sadece final metnini ver, açıklama yazma." +
    avoidBlock(recent);
  const out = clip(clean(await chat(userId, tweetSystem(userId), user)), limits.maxLen);
  return out || draft;
}

async function generateTweet(userId, recent = [], topic = null, context = [], learnings = "", limits = { maxLen: 280 }) {
  const config = getSettings(userId);
  const style = pickStyle(userId);
  const styleLine = style ? `\n\nBu sefer şu format ruhunda yaz: ${style}` : "";
  const topicLine = topic
    ? `\n\nBu içerik şu konu/ipucu etrafında olsun: ${topic}`
    : "";

  const user =
    "Şu an atılacak tek bir içerik yaz. Önce kafanda 2-3 farklı açı düşün, en çok " +
    "etkileşim alacak ve en doğal olanı seç; sonra SADECE onu yaz. Gerçek bir " +
    "insanın atacağı gibi doğal, spesifik ve güncel hissettirsin. Tırnak, açıklama " +
    `veya düşünceni yazma. Link/URL ekleme. Maksimum ${limits.maxLen} karakter.` +
    topicLine +
    styleLine +
    agendaBlock(context) +
    (learnings || "") +
    avoidBlock(recent);

  let out = clip(clean(await chat(userId, tweetSystem(userId), user)), limits.maxLen);
  if (config.refineTweets && out) out = await refine(userId, out, recent, limits);
  return out;
}

async function generateTrendTweet(userId, trends, recent = [], learnings = "", limits = { maxLen: 280 }) {
  const config = getSettings(userId);
  const items = (trends || [])
    .map((t) => (typeof t === "string" ? { title: t, context: [] } : t))
    .filter((t) => t && t.title);
  if (!items.length) return null;

  const style = pickStyle(userId);
  const styleLine = style
    ? `\n\nSeçtiğin trende uygunsa şu format ruhunda yaz: ${style}`
    : "";

  const trendBlock = items
    .map((t, i) => {
      const ctx =
        t.context && t.context.length
          ? "\n   İlgili haberler: " +
            t.context.map((h) => `"${h}"`).join(" | ")
          : "\n   (güncel haber bulunamadı)";
      return `${i + 1}. ${t.title}${ctx}`;
    })
    .join("\n");

  const user =
    "Şu an Türkiye'de gündemindeki trendler ve (varsa) ilgili güncel " +
    "haber başlıkları aşağıda. Haberler, trendin NEDEN gündemde olduğunu anlaman için.\n\n" +
    trendBlock +
    "\n\nADIM ADIM DÜŞÜN:\n" +
    "1) Hangi trendi gerçekten ANLADIĞINI ve hakkında iyi, güvenli, geniş kitleye " +
    "hitap eden bir içerik yazabileceğini seç.\n" +
    "2) ŞUNLARI ATLA: ölüm/vefat/taziye, felaket/kaza, siyaset/seçim/politik figürler, " +
    "tartışmalı/ajite/provokatif konular, dini ya da etnik hassasiyetler, markalı " +
    "reklam/kampanya, bir kişiyi hedef alan içerik VE ne olduğunu çözemediğin belirsiz " +
    "trendler.\n" +
    '3) Uygun hiçbir trend yoksa SADECE "SKIP" yaz.\n' +
    "4) Uygun trend varsa, o konuya GERÇEKTEN değinen tek bir içerik yaz. Trendi doğal " +
    "işle; kelimeyi/etiketi cümleye zorla sıkıştırma. Hook ile başla, vurucu ve " +
    "paylaşılası olsun.\n\n" +
    `KURALLAR: link/URL yok; ${limits.maxLen} karakteri geçme; en fazla 1 hashtag, o da ancak doğal ` +
    "duruyorsa; persona'na sadık kal." +
    styleLine +
    (learnings || "") +
    avoidBlock(recent) +
    '\n\nSadece metni ver (ya da "SKIP"). Başka açıklama ekleme.';

  let out = clean(await chat(userId, tweetSystem(userId), user));
  if (!out || out.toUpperCase() === "SKIP") return null;
  out = clip(out, limits.maxLen);
  if (config.refineTweets) out = await refine(userId, out, recent, limits);
  return out;
}

async function generateThread(userId, topic = null, recent = [], context = [], learnings = "", limits = { maxLen: 280 }) {
  const topicLine = topic
    ? `\n\nKonu/ipucu: ${topic}`
    : "\n\nKonuyu sen seç: gündeme ve persona'na uygun, geniş kitleye hitap eden bir şey.";

  const user =
    "Tek bir parça değil, 3-5 parçalık bir THREAD (zincir) yaz. Büyüme ve etkileşim odaklı.\n" +
    "- İlk parça en güçlü HOOK olsun; tek başına merak uyandırsın, 'devamı aşağıda' gibi klişe yok.\n" +
    "- Her parça kendi içinde anlamlı ve akıcı; birlikte bir fikri derinleştirsin.\n" +
    "- Son parça vurucu bir kapanış ya da cevap çağıran bir soru olsun.\n" +
    `- Her parça en fazla ${limits.maxLen} karakter, link/URL yok, en fazla 1 doğal hashtag.` +
    topicLine +
    agendaBlock(context) +
    (learnings || "") +
    avoidBlock(recent) +
    "\n\nÇIKTI BİÇİMİ: yalnızca metinler; her parçanın arasına AYRI bir satırda `---` koy. Numara, etiket veya açıklama ekleme.";

  const raw = await chat(userId, tweetSystem(userId), user);
  return raw
    .split(/\n\s*-{3,}\s*\n/)
    .map((s) => clip(clean(s), limits.maxLen))
    .filter(Boolean)
    .slice(0, 6);
}

async function triageMention(userId, mention, recent = [], limits = { maxLen: 280 }) {
  const voice = recent.length
    ? `\n\nSenin son paylaşımların (aynı sese/ağıza sadık kal, kopyalama):\n` +
      recent.slice(0, 5).map((t) => `- ${t}`).join("\n")
    : "";

  const user =
    `@${mention.author} sana şöyle yazdı:\n\n"${mention.text}"\n\n` +
    "1) Gerçek bir insan gibi, doğal ve kısa bir cevap yaz. Mention'ın tonuna uy " +
    `(şakaysa şakayla, samimiyse samimi). Robot/fazla kibar olma. ≤${limits.maxLen} karakter, link yok.\n` +
    "2) Sonra şu kararı ver:\n" +
    "   AUTO = mention açıkça dostça/zararsız (övgü, teşekkür, basit pozitif, emoji) " +
    "ve cevabın tamamen güvenli/genel; insan onayı olmadan gönderilebilir.\n" +
    "   REVIEW = en ufak tartışma, soru, eleştiri, hassasiyet, belirsizlik ya da " +
    "riskli olma ihtimali varsa.\n" +
    "   SKIP = cevaba değmez (spam, tek emoji, anlamsız).\n" +
    "ÇIKTI BİÇİMİ: İLK satır yalnızca AUTO, REVIEW ya da SKIP. Sonraki satır(lar) cevap metni." +
    voice;

  const raw = (await chat(userId, systemPrompt(userId), user)).trim();
  const nl = raw.indexOf("\n");
  const tag = (nl === -1 ? raw : raw.slice(0, nl)).trim().toUpperCase();
  const body = nl === -1 ? "" : raw.slice(nl + 1);

  if (tag.startsWith("SKIP")) return { action: "skip", reply: "" };

  const known = tag.startsWith("AUTO") || tag.startsWith("REVIEW");
  const reply = clip(clean(known ? body.trim() : raw), limits.maxLen);
  if (!reply) return { action: "skip", reply: "" };
  return { action: tag.startsWith("AUTO") ? "auto" : "review", reply };
}

module.exports = {
  chat,
  generateTweet,
  generateTrendTweet,
  generateThread,
  triageMention,
};
