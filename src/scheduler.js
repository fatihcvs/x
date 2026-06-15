const cron = require("node-cron");
const { getSettings } = require("./settings");
const { createRouter } = require("./platforms/index");
const ai = require("./ai");
const db = require("./db");
const { getEnrichedTrends } = require("./trends");
const { getLearnings } = require("./insights");
const { notify, sendSuggestion } = require("./telegram");

async function runTweetJob(userId) {
  const config = getSettings(userId);
  const router = createRouter(userId);
  try {
    if (db.getMeta(userId, "paused") === "1") return;
    if (db.countToday(userId, "tweet") >= config.maxTweetsPerDay) {
      return notify(userId, "⏸️ Günlük tweet limiti dolu, atlandı.");
    }
    const recent = db.recentTweets(userId);

    let trends = [];
    if (config.trendsEnabled) {
      try { trends = await getEnrichedTrends(); } catch {}
    }

    let learnings = "";
    if (config.learnFromMetrics) {
      try { learnings = await getLearnings(userId); } catch {}
    }

    let tweet = null;
    let viaTrend = false;
    if (trends.length) {
      try {
        const t = await ai.generateTrendTweet(userId, trends, recent, learnings, router.getMinLimits());
        if (t) {
          tweet = t;
          viaTrend = true;
        }
      } catch {}
    }
    if (!tweet) tweet = await ai.generateTweet(userId, recent, null, trends, learnings, router.getMinLimits());

    for (const p of router.getActive()) {
      try {
        await p.post(tweet);
        db.logPost(userId, "tweet", tweet, p.id);
      } catch (e) {
        notify(userId, `⚠️ [${p.name}] Gönderim hatası: ${e.message}`);
      }
    }
    
    notify(userId, `${viaTrend ? "🔥 Trend içerik" : "📤 İçerik"} atıldı:\n"${tweet}"`);
  } catch (e) {
    notify(userId, "⚠️ Tweet atılamadı: " + e.message);
  }
}

async function runMentionJob(userId) {
  const config = getSettings(userId);
  const router = createRouter(userId);
  try {
    for (const p of router.getActive()) {
      if (!p.limits.hasMentions) continue;

      const metaKey = p.id === "x" ? "last_mention_id" : `last_mention_id_${p.id}`;
      const sinceId = db.getMeta(userId, metaKey);
      const mentions = await p.getMentions(sinceId);
      if (!mentions.length) continue;

      for (const m of mentions) {
        db.setMeta(userId, metaKey, m.id);
        if (db.mentionSeen(userId, m.id)) continue;

        const triage = await ai.triageMention(userId, m, db.recentTweets(userId), p.limits);
        if (triage.action === "skip") continue;

        const hasLink = /https?:\/\//i.test(m.text || "");
        if (
          config.autoReplySafeMentions &&
          triage.action === "auto" &&
          !hasLink &&
          db.countToday(userId, "reply") < config.maxRepliesPerDay
        ) {
          await p.replyTo(m.id, triage.reply);
          db.logPost(userId, "reply", triage.reply, p.id);
          notify(userId, `🤖 Otomatik cevap [${p.name}] (@${m.author}):\n"${triage.reply}"`);
          continue;
        }

        db.addPending(userId, {
          mention_id: m.id,
          mention_text: m.text,
          author: m.author,
          draft: triage.reply,
          tg_message_id: null,
        }, p.id);
        const pending = db.getPendingByMentionId(userId, m.id);
        await sendSuggestion(userId, pending);
      }
    }
  } catch (e) {
    notify(userId, "⚠️ Mention kontrolü hata: " + e.message);
  }
}

async function runDigest(userId) {
  const config = getSettings(userId);
  try {
    const tweets = db.countToday(userId, "tweet");
    const replies = db.countToday(userId, "reply");
    const paused = db.getMeta(userId, "paused") === "1";
    notify(
      userId,
      "🌙 Günlük özet\n" +
        `• Tweet: ${tweets}/${config.maxTweetsPerDay}\n` +
        `• Cevap: ${replies}/${config.maxRepliesPerDay}\n` +
        `• Durum: ${paused ? "⏸️ duraklatılmış" : "▶️ aktif"}`
    );
  } catch (e) {
    notify(userId, "⚠️ Özet hatası: " + e.message);
  }
}

const userTasks = {};

function startUser(userId) {
  stopUser(userId);
  const config = getSettings(userId);
  const opts = config.timezone ? { timezone: config.timezone } : {};
  const tasks = { tweets: [] };
  
  config.tweetSchedule.forEach((expr) => {
    tasks.tweets.push(cron.schedule(expr, () => runTweetJob(userId), opts));
  });
  tasks.mentions = cron.schedule(config.mentionPollCron, () => runMentionJob(userId), opts);
  if (config.digestCron) {
    tasks.digest = cron.schedule(config.digestCron, () => runDigest(userId), opts);
  }
  userTasks[userId] = tasks;
}

function stopUser(userId) {
  const tasks = userTasks[userId];
  if (tasks) {
    tasks.tweets.forEach(t => t.stop());
    if (tasks.mentions) tasks.mentions.stop();
    if (tasks.digest) tasks.digest.stop();
    delete userTasks[userId];
  }
}

function start() {
  const users = db.getAllUsers();
  users.forEach(u => startUser(u.id));
  console.log(`[scheduler] Started for ${users.length} users.`);
}

module.exports = { start, startUser, stopUser, runTweetJob, runMentionJob, runDigest };
