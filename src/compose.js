// Shared content service: generate a draft, post a tweet/thread, send a reply.
// Used by the web panel. (The Telegram flow has equivalent logic inline; the two
// will be unified into this service layer in the multi-user phase — ROADMAP Faz 3.)
const config = require("../config");
const db = require("./db");
const ai = require("./ai");
const x = require("./x");
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
    const t = await ai.generateTrendTweet(trends, recent, learnings);
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
    const parts = await ai.generateThread(topic, recent, context, learnings);
    return parts && parts.length ? { parts } : null;
  }

  const text = await ai.generateTweet(recent, topic, context, learnings);
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
  if (content.parts) {
    await x.postThread(content.parts);
    content.parts.forEach((p) => db.logPost("tweet", p));
  } else {
    await x.postTweet(content.text);
    db.logPost("tweet", content.text);
  }
  return need;
}

// Send a reply to a pending mention (cap-aware). Returns { ok, reason? }.
async function sendReply(pending, text) {
  if (db.countToday("reply") >= config.maxRepliesPerDay) {
    db.setPendingStatus(pending.id, "skipped");
    return { ok: false, reason: "Günlük cevap limiti dolu." };
  }
  await x.replyTo(pending.mention_id, text);
  db.logPost("reply", text);
  db.setPendingStatus(pending.id, "sent");
  return { ok: true };
}

module.exports = { generateContent, postContent, sendReply };
