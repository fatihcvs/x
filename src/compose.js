const { getSettings } = require("./settings");
const db = require("./db");
const ai = require("./ai");
const { createRouter } = require("./platforms/index");
const { getEnrichedTrends } = require("./trends");
const { getLearnings } = require("./insights");

async function generateContent(userId, mode, topic) {
  const config = getSettings(userId);
  const router = createRouter(userId);
  const recent = db.recentTweets(userId);

  let learnings = "";
  if (config.learnFromMetrics) {
    try {
      learnings = await getLearnings(userId);
    } catch {
      /* best-effort */
    }
  }

  if (mode === "trend") {
    const trends = await getEnrichedTrends();
    if (!trends.length) return null;
    const t = await ai.generateTrendTweet(userId, trends, recent, learnings, router.getMinLimits());
    return t ? { text: t } : null;
  }

  let context = [];
  if (config.trendsEnabled && (mode === "thread" || !topic)) {
    try {
      context = await getEnrichedTrends();
    } catch {
      /* best-effort background */
    }
  }

  if (mode === "thread") {
    const parts = await ai.generateThread(userId, topic, recent, context, learnings, router.getMinLimits());
    return parts && parts.length ? { parts } : null;
  }

  const text = await ai.generateTweet(userId, recent, topic, context, learnings, router.getMinLimits());
  return text ? { text } : null;
}

async function postContent(userId, content) {
  const config = getSettings(userId);
  const router = createRouter(userId);
  const need = content.parts ? content.parts.length : 1;
  const remaining = config.maxTweetsPerDay - db.countToday(userId, "tweet");
  if (need > remaining) {
    throw new Error(`Günlük tweet limiti yetersiz (gereken ${need}, kalan ${remaining}).`);
  }
  const activePlatforms = router.getActive();
  
  if (content.parts) {
    for (const p of activePlatforms) {
      if (!p.limits.hasThreads && activePlatforms.length > 1) continue;
      await p.postThread(content.parts);
      content.parts.forEach((part) => db.logPost(userId, "tweet", part, p.id));
    }
  } else {
    for (const p of activePlatforms) {
      await p.post(content.text);
      db.logPost(userId, "tweet", content.text, p.id);
    }
  }
  return need;
}

async function sendReply(userId, pending, text) {
  const config = getSettings(userId);
  const router = createRouter(userId);
  if (db.countToday(userId, "reply") >= config.maxRepliesPerDay) {
    db.setPendingStatus(userId, pending.id, "skipped");
    return { ok: false, reason: "Günlük cevap limiti dolu." };
  }
  
  const targetPlatform = router.all[pending.platform || "x"];
  if (!targetPlatform) return { ok: false, reason: "Bilinmeyen platform." };

  await targetPlatform.replyTo(pending.mention_id, text);
  db.logPost(userId, "reply", text, targetPlatform.id);
  db.setPendingStatus(userId, pending.id, "sent");
  return { ok: true };
}

module.exports = { generateContent, postContent, sendReply };
