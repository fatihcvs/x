const cron = require("node-cron");
const config = require("../config");
const x = require("./x");
const ai = require("./ai");
const db = require("./db");
const { getEnrichedTrends } = require("./trends");
const { notify, sendSuggestion } = require("./telegram");

// --- Post one original tweet (respecting the daily cap) ----------------
async function runTweetJob() {
  try {
    if (db.countToday("tweet") >= config.maxTweetsPerDay) {
      return notify("⏸️ Günlük tweet limiti dolu, atlandı.");
    }
    const recent = db.recentTweets();

    // Ride a safe, broad trend when one is available; otherwise post normally.
    let tweet = null;
    let viaTrend = false;
    if (config.trendsEnabled) {
      try {
        const trends = await getEnrichedTrends();
        if (trends.length) {
          const t = await ai.generateTrendTweet(trends, recent);
          if (t) {
            tweet = t;
            viaTrend = true;
          }
        }
      } catch {
        /* trend path is best-effort; fall back to a normal tweet */
      }
    }
    if (!tweet) tweet = await ai.generateTweet(recent);

    await x.postTweet(tweet);
    db.logPost("tweet", tweet);
    notify(`${viaTrend ? "🔥 Trend tweet" : "📤 Tweet"} atıldı:\n"${tweet}"`);
  } catch (e) {
    notify("⚠️ Tweet atılamadı: " + e.message);
  }
}

// --- Check mentions, draft replies, push suggestions to Telegram --------
async function runMentionJob() {
  try {
    const sinceId = db.getMeta("last_mention_id");
    const mentions = await x.getNewMentions(sinceId);
    if (!mentions.length) return;

    for (const m of mentions) {
      db.setMeta("last_mention_id", m.id); // advance even if we skip
      if (db.mentionSeen(m.id)) continue;

      const draft = await ai.draftReply(m);
      if (draft === "SKIP") continue;

      db.addPending({
        mention_id: m.id,
        mention_text: m.text,
        author: m.author,
        draft,
        tg_message_id: null,
      });
      const pending = db.getPendingByMentionId(m.id);
      await sendSuggestion(pending);
    }
  } catch (e) {
    notify("⚠️ Mention kontrolü hata: " + e.message);
  }
}

function start() {
  config.tweetSchedule.forEach((expr) => cron.schedule(expr, runTweetJob));
  cron.schedule(config.mentionPollCron, runMentionJob);
  console.log(
    `[scheduler] ${config.tweetSchedule.length} tweet slot(s), ` +
      `mentions every: ${config.mentionPollCron}`
  );
}

module.exports = { start, runTweetJob, runMentionJob };
