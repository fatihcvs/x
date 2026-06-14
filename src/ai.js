const Anthropic = require("@anthropic-ai/sdk");
const config = require("../config");

// Reads ANTHROPIC_API_KEY from the environment.
const client = new Anthropic();

// One chat call via the Anthropic Messages API. `system` is a top-level param
// (not a message), and the reply text is in the first text content block.
const MAX_OUT = 1000;
async function chat(system, user) {
  const res = await client.messages.create({
    model: config.model,
    max_tokens: MAX_OUT,
    system,
    messages: [{ role: "user", content: user }],
  });
  const block = (res.content || []).find((b) => b.type === "text");
  return (block?.text || "").trim();
}

// Shared "write like a real person" guide, layered on top of the user's
// persona for EVERY tweet and reply. This is the main lever against the
// "AI smell": think first, then write specific, natural Turkish with a voice.
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

const systemPrompt = () => config.persona + HUMAN_GUIDE;

// Extra strategy layer for ORIGINAL tweets (not replies): write with the
// instincts of a successful Türk Twitter influencer, aimed at follower growth.
function growthBlock() {
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

const tweetSystem = () => systemPrompt() + growthBlock();

// --- Shared helpers ---------------------------------------------------
function pickStyle() {
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

// Compact "what's happening on X in Türkiye right now" background. Optional
// awareness for normal tweets — the model may use it to feel timely, but is
// explicitly told NOT to force it. Accepts enriched trends or plain strings.
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
const clip = (s) => (s.length > 280 ? s.slice(0, 277) + "..." : s);

// Second pass: a strict editor rewrites the draft to be punchier and more
// human. Returns the original if anything goes wrong. Gated by config.refineTweets.
async function refine(draft, recent = []) {
  const user =
    "Şu tweet taslağını sert bir editör gözüyle değerlendir ve DAHA İYİSİNİ yaz:\n\n" +
    `"${draft}"\n\n` +
    "Sor: Hook ilk kelimelerde tutuyor mu? Spesifik mi yoksa klişe/yapay mı? Daha " +
    "vurucu, daha insani, daha paylaşılası olur mu? Gerekiyorsa baştan yaz; zaten " +
    "güçlüyse olduğu gibi bırak. Kurallar: link yok, 280'i geçme, en fazla 1 doğal " +
    "hashtag. Sadece final tweet metnini ver, açıklama yazma." +
    avoidBlock(recent);
  const out = clip(clean(await chat(tweetSystem(), user)));
  return out || draft;
}

// Generate one original tweet. `topic` is an optional hint; `context` is the
// optional current agenda (enriched trends) for timeliness. Backward compatible.
async function generateTweet(recent = [], topic = null, context = [], learnings = "") {
  const style = pickStyle();
  const styleLine = style ? `\n\nBu sefer şu format ruhunda yaz: ${style}` : "";
  const topicLine = topic
    ? `\n\nBu tweet şu konu/ipucu etrafında olsun: ${topic}`
    : "";

  const user =
    "Şu an atılacak tek bir tweet yaz. Önce kafanda 2-3 farklı açı düşün, en çok " +
    "etkileşim alacak ve en doğal olanı seç; sonra SADECE onu yaz. Gerçek bir " +
    "insanın atacağı gibi doğal, spesifik ve güncel hissettirsin. Tırnak, açıklama " +
    "veya düşünceni yazma. Link/URL ekleme." +
    topicLine +
    styleLine +
    agendaBlock(context) +
    (learnings || "") +
    avoidBlock(recent);

  let out = clip(clean(await chat(tweetSystem(), user)));
  if (config.refineTweets && out) out = await refine(out, recent);
  return out;
}

// Generate a tweet tied to a *safe, broad* Türkiye trend, grounded in real
// news context so the model understands *why* something is trending.
// `trends` is [{ title, context: string[] }] (plain strings also accepted).
// Returns null when nothing is suitable (so callers fall back to a normal tweet).
async function generateTrendTweet(trends, recent = [], learnings = "") {
  const items = (trends || [])
    .map((t) => (typeof t === "string" ? { title: t, context: [] } : t))
    .filter((t) => t && t.title);
  if (!items.length) return null;

  const style = pickStyle();
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
    "Şu an Türkiye'de X (Twitter) gündemindeki trendler ve (varsa) ilgili güncel " +
    "haber başlıkları aşağıda. Haberler, trendin NEDEN gündemde olduğunu anlaman için.\n\n" +
    trendBlock +
    "\n\nADIM ADIM DÜŞÜN:\n" +
    "1) Hangi trendi gerçekten ANLADIĞINI ve hakkında iyi, güvenli, geniş kitleye " +
    "hitap eden bir tweet yazabileceğini seç.\n" +
    "2) ŞUNLARI ATLA: ölüm/vefat/taziye, felaket/kaza, siyaset/seçim/politik figürler, " +
    "tartışmalı/ajite/provokatif konular, dini ya da etnik hassasiyetler, markalı " +
    "reklam/kampanya, bir kişiyi hedef alan içerik VE ne olduğunu çözemediğin belirsiz " +
    "trendler.\n" +
    '3) Uygun hiçbir trend yoksa SADECE "SKIP" yaz.\n' +
    "4) Uygun trend varsa, o konuya GERÇEKTEN değinen tek bir tweet yaz. Trendi doğal " +
    "işle; kelimeyi/etiketi cümleye zorla sıkıştırma. Hook ile başla, vurucu ve " +
    "paylaşılası olsun.\n\n" +
    "KURALLAR: link/URL yok; 280 karakteri geçme; en fazla 1 hashtag, o da ancak doğal " +
    "duruyorsa; persona'na sadık kal." +
    styleLine +
    (learnings || "") +
    avoidBlock(recent) +
    '\n\nSadece tweet metnini ver (ya da "SKIP"). Başka açıklama ekleme.';

  let out = clean(await chat(tweetSystem(), user));
  if (!out || out.toUpperCase() === "SKIP") return null;
  out = clip(out);
  if (config.refineTweets) out = await refine(out, recent);
  return out;
}

// Generate a 3-5 tweet thread (array of strings) on a topic. Growth-oriented,
// human, no links, each part <=280. Returns [] when nothing usable.
async function generateThread(topic = null, recent = [], context = [], learnings = "") {
  const topicLine = topic
    ? `\n\nKonu/ipucu: ${topic}`
    : "\n\nKonuyu sen seç: gündeme ve persona'na uygun, geniş kitleye hitap eden bir şey.";

  const user =
    "Tek tweet değil, 3-5 tweet'lik bir THREAD (zincir) yaz. Büyüme ve etkileşim odaklı.\n" +
    "- İlk tweet en güçlü HOOK olsun; tek başına merak uyandırsın, 'devamı aşağıda' gibi klişe yok.\n" +
    "- Her tweet kendi içinde anlamlı ve akıcı; birlikte bir fikri derinleştirsin.\n" +
    "- Son tweet vurucu bir kapanış ya da cevap çağıran bir soru olsun.\n" +
    "- Her tweet en fazla 280 karakter, link/URL yok, en fazla 1 doğal hashtag." +
    topicLine +
    agendaBlock(context) +
    (learnings || "") +
    avoidBlock(recent) +
    "\n\nÇIKTI BİÇİMİ: yalnızca tweet metinleri; her tweet'in arasına AYRI bir satırda `---` koy. Numara, etiket veya açıklama ekleme.";

  const raw = await chat(tweetSystem(), user);
  return raw
    .split(/\n\s*-{3,}\s*\n/)
    .map((s) => clip(clean(s)))
    .filter(Boolean)
    .slice(0, 6);
}

// Draft a reply to a mention AND triage it. Returns { action, reply }:
//   "skip"   -> not worth replying (spam/noise)
//   "auto"   -> clearly friendly/benign; safe to send without human review
//   "review" -> anything sensitive/uncertain; needs human approval
// `recent` (your last tweets) keeps the reply in your voice.
async function triageMention(mention, recent = []) {
  const voice = recent.length
    ? `\n\nSenin son tweet'lerin (aynı sese/ağıza sadık kal, kopyalama):\n` +
      recent.slice(0, 5).map((t) => `- ${t}`).join("\n")
    : "";

  const user =
    `@${mention.author} sana şöyle yazdı:\n\n"${mention.text}"\n\n` +
    "1) Gerçek bir insan gibi, doğal ve kısa bir cevap yaz. Mention'ın tonuna uy " +
    "(şakaysa şakayla, samimiyse samimi). Robot/fazla kibar olma. ≤280, link yok.\n" +
    "2) Sonra şu kararı ver:\n" +
    "   AUTO = mention açıkça dostça/zararsız (övgü, teşekkür, basit pozitif, emoji) " +
    "ve cevabın tamamen güvenli/genel; insan onayı olmadan gönderilebilir.\n" +
    "   REVIEW = en ufak tartışma, soru, eleştiri, hassasiyet, belirsizlik ya da " +
    "riskli olma ihtimali varsa.\n" +
    "   SKIP = cevaba değmez (spam, tek emoji, anlamsız).\n" +
    "ÇIKTI BİÇİMİ: İLK satır yalnızca AUTO, REVIEW ya da SKIP. Sonraki satır(lar) cevap metni." +
    voice;

  const raw = (await chat(systemPrompt(), user)).trim();
  const nl = raw.indexOf("\n");
  const tag = (nl === -1 ? raw : raw.slice(0, nl)).trim().toUpperCase();
  const body = nl === -1 ? "" : raw.slice(nl + 1);

  if (tag.startsWith("SKIP")) return { action: "skip", reply: "" };

  // If the model didn't follow the format, treat the whole output as a reply
  // that needs review — never auto-send an unparsed response.
  const known = tag.startsWith("AUTO") || tag.startsWith("REVIEW");
  const reply = clip(clean(known ? body.trim() : raw));
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
