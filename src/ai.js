const OpenAI = require("openai");
const config = require("../config");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// One chat call. NOTE: gpt-4o / gpt-4.x models use `max_tokens`.
// If you switch to a GPT-5.x model, change it to `max_completion_tokens`.
async function chat(system, user) {
  const res = await client.chat.completions.create({
    model: config.model,
    max_tokens: 300,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return (res.choices?.[0]?.message?.content || "").trim();
}

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

const clean = (s) => (s || "").replace(/^["']|["']$/g, "").trim();
const clip = (s) => (s.length > 280 ? s.slice(0, 277) + "..." : s);

// Generate one original tweet, rotating styles and avoiding duplicates.
// `topic` is optional: when given, the tweet is built around that hint
// (still persona + style rotation + ≤280 + no link).
async function generateTweet(recent = [], topic = null) {
  const style = pickStyle();
  const styleLine = style ? `\n\nBu sefer şu formatta yaz: ${style}` : "";
  const topicLine = topic
    ? `\n\nBu tweet şu konu/ipucu etrafında olsun: ${topic}`
    : "";

  const user =
    "Şu an atılacak tek bir tweet yaz. Sadece tweet metnini ver, " +
    "tırnak veya açıklama ekleme. Link/URL ekleme." +
    topicLine +
    styleLine +
    avoidBlock(recent);

  return clip(clean(await chat(config.persona, user)));
}

// Generate a tweet tied to a *safe, broad* Türkiye trend, grounded in real
// news context so the model understands *why* something is trending.
// `trends` is [{ title, context: string[] }] (plain strings also accepted).
// Returns null when nothing is suitable (so callers fall back to a normal tweet).
async function generateTrendTweet(trends, recent = []) {
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
    avoidBlock(recent) +
    '\n\nSadece tweet metnini ver (ya da "SKIP"). Başka açıklama ekleme.';

  const out = clean(await chat(config.persona, user));
  if (!out || out.toUpperCase() === "SKIP") return null;
  return clip(out);
}

// Draft a reply to a mention. May return "SKIP" for low-value mentions.
async function draftReply(mention) {
  const skipNote = config.skipLowValueMentions
    ? `\nEğer bu mention cevap vermeye değmez (spam, tek emoji, anlamsız) ise ` +
      `sadece "SKIP" yaz.`
    : "";

  const user =
    `@${mention.author} sana şöyle bir mention attı:\n\n"${mention.text}"\n\n` +
    `Buna senin ağzından kısa, doğal bir cevap yaz (280 karakteri geçme, ` +
    `link ekleme). Sadece cevap metnini ver.` +
    skipNote;

  const reply = clean(await chat(config.persona, user));
  if (reply.toUpperCase() === "SKIP") return "SKIP";
  return clip(reply);
}

module.exports = { chat, generateTweet, generateTrendTweet, draftReply };
