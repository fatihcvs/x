const cron = require("node-cron");
const config = require("./settings");
const router = require("./platforms/index");
const ai = require("./ai");
const db = require("./db");
const { getEnrichedTrends } = require("./trends");
const { getLearnings } = require("./insights");
const { notify, sendSuggestion } = require("./telegram");

// --- Post one original tweet (respecting the daily cap) ----------------
async function runTweetJob() {
  try {
    if (db.getMeta("paused") === "1") return; // /pause: skip auto-posting silently
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

    // Learn from what performed well (best-effort; needs API read access).
    let learnings = "";
    if (config.learnFromMetrics) {
      try {
        learnings = await getLearnings();
      } catch {
        /* best-effort */
      }
    }

    let tweet = null;
    let viaTrend = false;
    if (trends.length) {
      try {
        const t = await ai.generateTrendTweet(trends, recent, learnings, router.getMinLimits());
        if (t) {
          tweet = t;
          viaTrend = true;
        }
      } catch {
        /* trend writing failed; fall back to a normal tweet below */
      }
    }
    if (!tweet) tweet = await ai.generateTweet(recent, null, trends, learnings, router.getMinLimits());

    for (const p of router.getActive()) {
      try {
        await p.post(tweet);
        db.logPost("tweet", tweet, p.id);
      } catch (e) {
        notify(`⚠️ [${p.name}] Gönderim hatası: ${e.message}`);
      }
    }
    
    notify(`${viaTrend ? "🔥 Trend içerik" : "📤 İçerik"} atıldı:\n"${tweet}"`);
  } catch (e) {
    notify("⚠️ Tweet atılamadı: " + e.message);
  }
}

// --- Check mentions, draft replies, push suggestions to Telegram --------
async function runMentionJob() {
  try {
    for (const p of router.getActive()) {
      if (!p.limits.hasMentions) continue;

      const metaKey = p.id === "x" ? "last_mention_id" : `last_mention_id_${p.id}`;
      const sinceId = db.getMeta(metaKey);
      const mentions = await p.getMentions(sinceId);
      if (!mentions.length) continue;

      for (const m of mentions) {
        db.setMeta(metaKey, m.id); // advance even if we skip
        if (db.mentionSeen(m.id)) continue;

        const triage = await ai.triageMention(m, db.recentTweets(), p.limits);
        if (triage.action === "skip") continue;

        // Auto-reply only to clearly safe mentions (no links), within the cap.
        const hasLink = /https?:\/\//i.test(m.text || "");
        if (
          config.autoReplySafeMentions &&
          triage.action === "auto" &&
          !hasLink &&
          db.countToday("reply") < config.maxRepliesPerDay
        ) {
          await p.replyTo(m.id, triage.reply);
          db.logPost("reply", triage.reply, p.id);
          notify(`🤖 Otomatik cevap [${p.name}] (@${m.author}):\n"${triage.reply}"`);
          continue;
        }

        // Otherwise: human approval via Telegram.
        db.addPending({
          mention_id: m.id,
          mention_text: m.text,
          author: m.author,
          draft: triage.reply,
          tg_message_id: null,
        }, p.id);
        const pending = db.getPendingByMentionId(m.id);
        await sendSuggestion(pending);
      }
    }
  } catch (e) {
    notify("⚠️ Mention kontrolü hata: " + e.message);
  }
}

// --- Daily digest: report today's activity to Telegram ------------------
async function runDigest() {
  try {
    const tweets = db.countToday("tweet");
    const replies = db.countToday("reply");
    const paused = db.getMeta("paused") === "1";
    notify(
      "🌙 Günlük özet\n" +
        `• Tweet: ${tweets}/${config.maxTweetsPerDay}\n` +
        `• Cevap: ${replies}/${config.maxRepliesPerDay}\n` +
        `• Durum: ${paused ? "⏸️ duraklatılmış" : "▶️ aktif"}`
    );
  } catch (e) {
    notify("⚠️ Özet hatası: " + e.message);
  }
}

function start() {
  const opts = config.timezone ? { timezone: config.timezone } : {};
  config.tweetSchedule.forEach((expr) => cron.schedule(expr, runTweetJob, opts));
  cron.schedule(config.mentionPollCron, runMentionJob, opts);
  if (config.digestCron) cron.schedule(config.digestCron, runDigest, opts);
  console.log(
    `[scheduler] ${config.tweetSchedule.length} tweet slot(s) ` +
      `(${config.timezone || "server time"}), mentions every: ${config.mentionPollCron}`
  );
}

module.exports = { start, runTweetJob, runMentionJob, runDigest };
