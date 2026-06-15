const { getSettings } = require("./settings");
const db = require("./db");
const ai = require("./ai");
const { createRouter } = require("./platforms/index");
const { getEnrichedTrends } = require("./trends");
const { getLearnings } = require("./insights");
const media = require("./media");

async function generateContent(userId, mode, topic) {
  const config = getSettings(userId);
  const sub = require("./subscription").checkLimits(userId, config);
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
  
  if (config.autoGenerateMedia && text && sub.canUseMedia) {
    try {
      const prompt = await media.generateImagePrompt(userId, text);
      const url = await media.generateImage(userId, prompt);
      return { text, mediaUrl: url };
    } catch (e) {
      console.error("[media] Görsel üretilemedi:", e.message);
    }
  }

  return text ? { text } : null;
}

async function generateContentWithMedia(userId, mode, topic) {
  const content = await generateContent(userId, mode, topic);
  if (!content) return null;
  
  if (!content.mediaUrl && !content.parts) {
    try {
      const prompt = await media.generateImagePrompt(userId, content.text);
      const url = await media.generateImage(userId, prompt);
      content.mediaUrl = url;
    } catch (e) {
      console.error("[media] Görsel üretilemedi:", e.message);
      // throw e; // Let it proceed without image or fail? We'll just continue.
    }
  }
  return content;
}

async function postContent(userId, content) {
  const config = getSettings(userId);
  const sub = require("./subscription").checkLimits(userId, config);
  const router = createRouter(userId);
  const need = content.parts ? content.parts.length : 1;
  const remaining = sub.maxTweetsPerDay - db.countToday(userId, "tweet");
  if (need > remaining) {
    throw new Error(`Günlük tweet limiti yetersiz (gereken ${need}, kalan ${remaining}). Paket limiti: ${sub.maxTweetsPerDay}`);
  }
  const activePlatforms = router.getActive().filter(p => sub.activePlatforms.includes(p.id));
  if (activePlatforms.length === 0) {
    throw new Error(`Paketinizin desteklediği aktif bir platform bulunamadı.`);
  }
  
  if (content.parts) {
    for (const p of activePlatforms) {
      if (!p.limits.hasThreads && activePlatforms.length > 1) continue;
      await p.postThread(content.parts);
      content.parts.forEach((part) => db.logPost(userId, "tweet", part, p.id));
    }
  } else {
    let mediaData = null;
    if (content.mediaUrl) {
      mediaData = await media.downloadMediaBuffer(content.mediaUrl);
    }

    for (const p of activePlatforms) {
      if (mediaData && p.postWithMedia && sub.canUseMedia) {
        await p.postWithMedia(content.text, mediaData.buffer, mediaData.mimeType, content.mediaUrl);
      } else {
        await p.post(content.text);
      }
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

module.exports = { generateContent, generateContentWithMedia, postContent, sendReply };
