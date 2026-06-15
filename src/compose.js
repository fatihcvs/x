// Shared content service: generate a draft, post a tweet/thread, send a reply.
// Used by the web panel. (The Telegram flow has equivalent logic inline; the two
// will be unified into this service layer in the multi-user phase — ROADMAP Faz 3.)
const config = require("./settings");
const db = require("./db");
const ai = require("./ai");
const router = require("./platforms/index");
const { getEnrichedTrends } = require("./trends");
const { getLearnings } = require("./insights");

// mode: "manual" (tweet, optional topic) | "trend" | "thread".
// Returns { text } | { parts } | null (null = nothing usable).
async function generateContent(mode, topic) {
  const recent = db.recentTweets();

  let learnings = "";
  if (config.learnFromMetrics) {
    try {
      learnings = await getLearnings();
    } catch {
      /* best-effort */
    }
  }

  if (mode === "trend") {
    const trends = await getEnrichedTrends();
    if (!trends.length) return null;
    const t = await ai.generateTrendTweet(trends, recent, learnings, router.getMinLimits());
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
    const parts = await ai.generateThread(topic, recent, context, learnings, router.getMinLimits());
    return parts && parts.length ? { parts } : null;
  }

  const text = await ai.generateTweet(recent, topic, context, learnings, router.getMinLimits());
  return text ? { text } : null;
}

// Post a tweet or thread (cap-aware). Returns number of tweets posted.
// Throws if the daily cap can't fit the content.
async function postContent(content) {
  const need = content.parts ? content.parts.length : 1;
  const remaining = config.maxTweetsPerDay - db.countToday("tweet");
  if (need > remaining) {
    throw new Error(`Günlük tweet limiti yetersiz (gereken ${need}, kalan ${remaining}).`);
  }
  const activePlatforms = router.getActive();
  
  if (content.parts) {
    for (const p of activePlatforms) {
      if (!p.limits.hasThreads && activePlatforms.length > 1) continue; // Skip if it doesn't support threads
      await p.postThread(content.parts);
      content.parts.forEach((part) => db.logPost("tweet", part, p.id));
    }
  } else {
    for (const p of activePlatforms) {
      await p.post(content.text);
      db.logPost("tweet", content.text, p.id);
    }
  }
  return need;
}

// Send a reply to a pending mention (cap-aware). Returns { ok, reason? }.
async function sendReply(pending, text) {
  if (db.countToday("reply") >= config.maxRepliesPerDay) {
    db.setPendingStatus(pending.id, "skipped");
    return { ok: false, reason: "Günlük cevap limiti dolu." };
  }
  
  const targetPlatform = router.all[pending.platform || "x"];
  if (!targetPlatform) return { ok: false, reason: "Bilinmeyen platform." };

  await targetPlatform.replyTo(pending.mention_id, text);
  db.logPost("reply", text, targetPlatform.id);
  db.setPendingStatus(pending.id, "sent");
  return { ok: true };
}

module.exports = { generateContent, postContent, sendReply };
