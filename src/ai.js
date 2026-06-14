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

// Generate a tweet tied to a *safe, broad* Türkiye trend.
// Returns null when there are no trends or none are suitable (so callers
// can fall back to a normal tweet).
async function generateTrendTweet(trends, recent = []) {
  const list = (trends || []).filter(Boolean);
  if (!list.length) return null;

  const style = pickStyle();
  const styleLine = style
    ? `\n\nUygun trendi seçtikten sonra şu formatta yaz: ${style}`
    : "";

  const user =
    "Şu an Türkiye'de X (Twitter) gündemindeki başlıklar:\n" +
    list.map((t) => `- ${t}`).join("\n") +
    "\n\nGÖREV: Bu başlıklardan SADECE hafif, geniş kitleye hitap eden ve " +
    "GÜVENLİ olan bir tanesini seç, ona doğal şekilde bağlanan tek bir tweet yaz.\n" +
    "ŞUNLARI KESİNLİKLE ATLA: ölüm/vefat/taziye, felaket/kaza, siyaset/seçim/" +
    "politik figürler, tartışmalı/ajite/provokatif konular, dini ya da etnik " +
    "hassasiyetler, markalı reklam/kampanya, bir kişiyi hedef alan içerik.\n" +
    'Uygun (hafif ve güvenli) bir başlık YOKSA sadece "SKIP" yaz.\n' +
    "Kurallar: link/URL yok, 280 karakteri geçme, doğal ol ve persona'na sadık kal." +
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
