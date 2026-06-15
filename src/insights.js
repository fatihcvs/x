const { createRouter } = require("./platforms/index");

const TTL_MS = 3 * 60 * 60 * 1000; // 3h
const caches = new Map(); // userId -> { at, value }

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

async function getLearnings(userId) {
  const c = caches.get(userId);
  if (c && Date.now() - c.at < TTL_MS) return c.value;
  
  let value = "";
  try {
    const router = createRouter(userId);
    const x = router.all["x"];
    if (x) {
      const posts = await x.getMyRecentPosts(20);
      value = buildBlock(posts);
    }
  } catch {
    value = ""; 
  }
  caches.set(userId, { at: Date.now(), value });
  return value;
}

module.exports = { getLearnings };
