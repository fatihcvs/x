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

    // Read the room first: current Türkiye trends + news context. Used to ride
    // a safe trend when there's a good one, and as background awareness so even
    // normal tweets feel timely (not forced onto a trend).
    let trends = [];
    if (config.trendsEnabled) {
      try {
        trends = await getEnrichedTrends();
      } catch {
        /* best-effort; trends stay empty */
      }
    }

    let tweet = null;
    let viaTrend = false;
    if (trends.length) {
      try {
        const t = await ai.generateTrendTweet(trends, recent);
        if (t) {
          tweet = t;
          viaTrend = true;
        }
      } catch {
        /* trend writing failed; fall back to a normal tweet below */
      }
    }
    if (!tweet) tweet = await ai.generateTweet(recent, null, trends);

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

      const draft = await ai.draftReply(m, db.recentTweets());
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
  const opts = config.timezone ? { timezone: config.timezone } : {};
  config.tweetSchedule.forEach((expr) => cron.schedule(expr, runTweetJob, opts));
  cron.schedule(config.mentionPollCron, runMentionJob, opts);
  console.log(
    `[scheduler] ${config.tweetSchedule.length} tweet slot(s) ` +
      `(${config.timezone || "server time"}), mentions every: ${config.mentionPollCron}`
  );
}

module.exports = { start, runTweetJob, runMentionJob };
