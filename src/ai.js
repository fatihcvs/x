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

// Generate one original tweet, rotating styles and avoiding duplicates.
async function generateTweet(recent = []) {
  const avoid = recent.length
    ? `\n\nSon attığın tweet'ler (bunları TEKRARLAMA, format ve konu olarak farklı yaz):\n` +
      recent.map((t) => `- ${t}`).join("\n")
    : "";

  const styles = config.tweetStyles || [];
  const style = styles.length
    ? styles[Math.floor(Math.random() * styles.length)]
    : null;
  const styleLine = style ? `\n\nBu sefer şu formatta yaz: ${style}` : "";

  const user =
    "Şu an atılacak tek bir tweet yaz. Sadece tweet metnini ver, " +
    "tırnak veya açıklama ekleme." +
    styleLine +
    avoid;

  let tweet = (await chat(config.persona, user)).replace(/^["']|["']$/g, "").trim();
  if (tweet.length > 280) tweet = tweet.slice(0, 277) + "...";
  return tweet;
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

  let reply = (await chat(config.persona, user)).replace(/^["']|["']$/g, "").trim();
  if (reply.toUpperCase() === "SKIP") return "SKIP";
  if (reply.length > 280) reply = reply.slice(0, 277) + "...";
  return reply;
}

module.exports = { generateTweet, draftReply };
