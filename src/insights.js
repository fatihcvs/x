// "What's working" signal derived from your own tweet metrics, fed back into
// generation so the bot learns what performs. Best-effort: if the X API tier
// doesn't allow reading tweet metrics, this quietly returns "" and the bot
// generates without it. Cached to avoid hammering the API.
const x = require("./x");

const TTL_MS = 3 * 60 * 60 * 1000; // 3h
let cache = { at: 0, value: "" };

// Rank recent tweets by a simple engagement score and describe the top few.
function buildBlock(tweets) {
  const scored = (tweets || [])
    .filter((t) => t.text && t.metrics)
    .map((t) => ({
      text: t.text,
      score:
        (t.metrics.like_count || 0) +
        2 * (t.metrics.retweet_count || 0) +
        2 * (t.metrics.reply_count || 0) +
        3 * (t.metrics.quote_count || 0),
    }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) return "";
  return (
    "\n\nEN İYİ TUTAN KENDİ TWEET'LERİN (bunlardan ÖĞREN — neden tuttuklarını " +
    "düşün; tonu ve format mantığını yakala, KOPYALAMA):\n" +
    scored.map((t) => `- (${t.score} etkileşim) ${t.text}`).join("\n")
  );
}

// Returns a prompt block string (or "") describing your top performers.
async function getLearnings() {
  if (cache.at && Date.now() - cache.at < TTL_MS) return cache.value;
  let value = "";
  try {
    value = buildBlock(await x.getMyRecentTweets(20));
  } catch {
    value = ""; // no read access / error -> generate without learnings
  }
  cache = { at: Date.now(), value };
  return value;
}

module.exports = { getLearnings };
