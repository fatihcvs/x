const TelegramBot = require("node-telegram-bot-api");
const { getSettings } = require("./settings");
const { createRouter } = require("./platforms/index");
const ai = require("./ai");
const db = require("./db");
const { getEnrichedTrends } = require("./trends");
const { getLearnings } = require("./insights");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

function notify(userId, text) {
  const chatId = getSettings(userId).telegramChatId || (userId === 1 ? process.env.TELEGRAM_CHAT_ID : null);
  if (!chatId) return Promise.resolve();
  return bot.sendMessage(chatId, text).catch(() => {});
}

async function sendSuggestion(userId, pending) {
  const chatId = getSettings(userId).telegramChatId || (userId === 1 ? process.env.TELEGRAM_CHAT_ID : null);
  if (!chatId) return;

  const router = createRouter(userId);
  const pName = (router.all[pending.platform || "x"] || {}).name || "X";
  const body =
    `💬 [${pName}] @${pending.author} sana yazdı:\n"${pending.mention_text}"\n\n` +
    `🤖 Önerilen cevap:\n"${pending.draft}"\n\n` +
    `(Düzenlemek için bu mesajı yanıtla — gönderdiğin metin cevap olur.)`;

  const sent = await bot.sendMessage(chatId, body, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Gönder", callback_data: `send:${userId}:${pending.id}` },
          { text: "❌ Geç", callback_data: `skip:${userId}:${pending.id}` },
        ],
      ],
    },
  });
  db.setTgMessageId(userId, pending.mention_id, sent.message_id);
}

async function postReply(userId, pending, text, tgMessageId) {
  const config = getSettings(userId);
  const router = createRouter(userId);
  const chatId = config.telegramChatId || (userId === 1 ? process.env.TELEGRAM_CHAT_ID : null);

  if (db.countToday(userId, "reply") >= config.maxRepliesPerDay) {
    if (chatId) {
      await bot.editMessageText("⏸️ Günlük cevap limitine ulaşıldı, atlanıyor.", {
        chat_id: chatId,
        message_id: tgMessageId,
      }).catch(()=>{});
    }
    db.setPendingStatus(userId, pending.id, "skipped");
    return;
  }
  
  const targetPlatform = router.all[pending.platform || "x"];
  if (!targetPlatform) {
    db.setPendingStatus(userId, pending.id, "skipped");
    return;
  }

  await targetPlatform.replyTo(pending.mention_id, text);
  db.logPost(userId, "reply", text, targetPlatform.id);
  db.setPendingStatus(userId, pending.id, "sent");
}

const manualDrafts = new Map();

function manualKeyboard(userId) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Gönder", callback_data: `mt_post:${userId}` },
        { text: "🔄 Yeniden üret", callback_data: `mt_regen:${userId}` },
        { text: "❌ İptal", callback_data: `mt_cancel:${userId}` },
      ],
    ],
  };
}

function draftBody(mode, content) {
  if (content.parts) {
    return (
      `🧵 Thread taslağı (${content.parts.length} tweet):\n\n` +
      content.parts.map((p, i) => `${i + 1}. ${p}`).join("\n\n")
    );
  }
  const head = mode === "trend" ? "🔥 Trend taslağı" : "📝 Tweet taslağı";
  return `${head}:\n\n"${content.text}"`;
}

async function buildDraft(userId, mode, topic) {
  const config = getSettings(userId);
  const router = createRouter(userId);
  const recent = db.recentTweets(userId);

  let learnings = "";
  if (config.learnFromMetrics) {
    try { learnings = await getLearnings(userId); } catch {}
  }

  if (mode === "trend") {
    const trends = await getEnrichedTrends();
    if (!trends.length) return null;
    const t = await ai.generateTrendTweet(userId, trends, recent, learnings, router.getMinLimits());
    return t ? { text: t } : null;
  }

  let context = [];
  if (config.trendsEnabled && (mode === "thread" || !topic)) {
    try { context = await getEnrichedTrends(); } catch {}
  }

  if (mode === "thread") {
    const parts = await ai.generateThread(userId, topic, recent, context, learnings, router.getMinLimits());
    return parts && parts.length ? { parts } : null;
  }

  const text = await ai.generateTweet(userId, recent, topic, context, learnings, router.getMinLimits());
  return text ? { text } : null;
}

async function editMsg(chatId, messageId, text, withButtons, userId) {
  const opts = { chat_id: chatId, message_id: messageId };
  if (withButtons) opts.reply_markup = manualKeyboard(userId);
  try {
    await bot.editMessageText(text, opts);
  } catch (e) {
    if (!/not modified/i.test(e.message || "")) throw e;
  }
}

async function startDraft(userId, chatId, mode, topic) {
  const config = getSettings(userId);
  let statusId = null;
  try {
    const placeholder =
      mode === "thread"
        ? "🧵 Thread üretiliyor..."
        : mode === "trend"
        ? "🔎 Uygun trend aranıyor..."
        : "✍️ Taslak üretiliyor...";
    const sent = await bot.sendMessage(chatId, placeholder);
    statusId = sent.message_id;
  } catch {}

  try {
    const remaining = config.maxTweetsPerDay - db.countToday(userId, "tweet");
    if (remaining <= 0) {
      const txt = "⏸️ Günlük tweet limiti dolu. Bugün yeni tweet atılamaz.";
      return statusId ? editMsg(chatId, statusId, txt, false, userId) : notify(userId, txt);
    }

    const content = await buildDraft(userId, mode, topic);
    if (!content) {
      const txt = mode === "thread"
        ? "Thread üretilemedi, tekrar dene."
        : "Şu an uygun (hafif/güvenli) bir trend bulunamadı. Normal /tweet deneyebilirsin.";
      return statusId ? editMsg(chatId, statusId, txt, false, userId) : notify(userId, txt);
    }

    const needed = content.parts ? content.parts.length : 1;
    if (needed > remaining) {
      const txt = `⏸️ Bu thread ${needed} tweet ama bugün kalan hakkın ${remaining}. Yarın dene ya da maxTweetsPerDay'i artır.`;
      return statusId ? editMsg(chatId, statusId, txt, false, userId) : notify(userId, txt);
    }

    const body = draftBody(mode, content);
    if (statusId) {
      await editMsg(chatId, statusId, body, true, userId);
      manualDrafts.set(statusId, { mode, topic, content, userId });
    } else {
      const sent = await bot.sendMessage(chatId, body, {
        reply_markup: manualKeyboard(userId),
      });
      manualDrafts.set(sent.message_id, { mode, topic, content, userId });
    }
  } catch (e) {
    const txt = "⚠️ Taslak üretilemedi: " + e.message;
    if (statusId) editMsg(chatId, statusId, txt, false, userId).catch(() => {});
    else notify(userId, txt);
  }
}

async function handleManualCallback(q, action, userIdStr) {
  const messageId = q.message.message_id;
  const chatId = q.message.chat.id;
  const userId = Number(userIdStr);
  const entry = manualDrafts.get(messageId);
  
  if (!entry || entry.userId !== userId) {
    return bot.answerCallbackQuery(q.id, { text: "Taslak bulunamadı veya yetkisiz." });
  }

  if (action === "mt_cancel") {
    manualDrafts.delete(messageId);
    await editMsg(chatId, messageId, "❌ İptal edildi.", false, userId);
    return bot.answerCallbackQuery(q.id);
  }

  if (action === "mt_regen") {
    await bot.answerCallbackQuery(q.id, { text: "Yeniden üretiliyor..." });
    let content;
    try {
      content = await buildDraft(userId, entry.mode, entry.topic);
    } catch (e) {
      return editMsg(chatId, messageId, "⚠️ Üretilemedi: " + e.message, true, userId);
    }
    if (!content) {
      return editMsg(chatId, messageId, "Üretilemedi (uygun içerik yok).", true, userId);
    }
    entry.content = content;
    manualDrafts.set(messageId, entry);
    return editMsg(chatId, messageId, draftBody(entry.mode, content), true, userId);
  }

  if (action === "mt_post") {
    const config = getSettings(userId);
    const router = createRouter(userId);
    const content = entry.content;
    const needed = content.parts ? content.parts.length : 1;
    const remaining = config.maxTweetsPerDay - db.countToday(userId, "tweet");
    if (needed > remaining) {
      manualDrafts.delete(messageId);
      await bot.answerCallbackQuery(q.id, { text: "Günlük limit yetersiz." });
      return editMsg(chatId, messageId, `⏸️ Günlük limit yetersiz (gereken ${needed}, kalan ${remaining}), gönderilmedi.`, false, userId);
    }
    try {
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
    } catch (e) {
      return editMsg(chatId, messageId, "⚠️ Gönderilemedi: " + e.message, false, userId);
    }
    manualDrafts.delete(messageId);
    await bot.answerCallbackQuery(q.id, { text: "Gönderildi ✅" });
    const summary = content.parts
      ? `✅ Thread gönderildi (${content.parts.length} tweet).`
      : `✅ Gönderildi:\n"${content.text}"`;
    return editMsg(chatId, messageId, summary, false, userId);
  }
}

bot.on("callback_query", async (q) => {
  try {
    const parts = q.data.split(":");
    if (parts[0].startsWith("mt_")) {
      return handleManualCallback(q, parts[0], parts[1]).catch(()=>{});
    }

    const [action, userIdStr, idStr] = parts;
    const userId = Number(userIdStr);
    const pendingId = Number(idStr);
    const pending = db.getPendingById(userId, pendingId);
    if (!pending || pending.status !== "pending") {
      return bot.answerCallbackQuery(q.id, { text: "Zaten işlenmiş." });
    }

    if (action === "send") {
      await postReply(userId, pending, pending.draft, q.message.message_id);
      await bot.editMessageText(`✅ Gönderildi:\n"${pending.draft}"`, {
        chat_id: q.message.chat.id,
        message_id: q.message.message_id,
      });
    } else if (action === "skip") {
      db.setPendingStatus(userId, pending.id, "skipped");
      await bot.editMessageText(`❌ Geçildi:\n"${pending.mention_text}"`, {
        chat_id: q.message.chat.id,
        message_id: q.message.message_id,
      });
    }
    await bot.answerCallbackQuery(q.id);
  } catch (e) {
    await bot.answerCallbackQuery(q.id, { text: "Hata: " + e.message }).catch(()=>{});
  }
});

bot.on("message", async (msg) => {
  try {
    const userId = db.getUserByTgChat(msg.chat.id);
    if (!userId) {
      if (msg.text && msg.text.startsWith("/start")) {
        // Here we could implement an auth token flow to link a user account.
        bot.sendMessage(msg.chat.id, "Lütfen Web Paneli üzerinden Telegram entegrasyonunuzu yapın. Sizin Telegram ID'niz: " + msg.chat.id);
      }
      return;
    }

    const config = getSettings(userId);

    // Edited reply to mention
    if (msg.reply_to_message && msg.text) {
      const pending = db.getPendingByTgMessage(msg.reply_to_message.message_id);
      if (!pending || pending.status !== "pending" || pending.user_id !== userId) return;

      const router = createRouter(userId);
      const targetPlatform = router.all[pending.platform || "x"];
      const limit = targetPlatform ? targetPlatform.limits.maxLen : 280;

      await postReply(userId, pending, msg.text.slice(0, limit), msg.reply_to_message.message_id);
      await bot.sendMessage(msg.chat.id, `✅ Senin metninle gönderildi:\n"${msg.text}"`);
      return;
    }

    // Commands
    if (!msg.text) return;
    const txt = msg.text.trim();

    if (txt.startsWith("/tweet")) {
      const topic = txt.replace(/^\/tweet(?:@\w+)?/, "").trim() || null;
      return startDraft(userId, msg.chat.id, "manual", topic);
    }
    if (txt.startsWith("/trend")) {
      return startDraft(userId, msg.chat.id, "trend", null);
    }
    if (txt.startsWith("/thread")) {
      const topic = txt.replace(/^\/thread(?:@\w+)?/, "").trim() || null;
      return startDraft(userId, msg.chat.id, "thread", topic);
    }
    if (txt.startsWith("/pause")) {
      db.setMeta(userId, "paused", "1");
      return notify(userId, "⏸️ Otomatik tweet'ler duraklatıldı. /resume ile aç.\n(Manuel komutlar ve mention onayı çalışmaya devam eder.)");
    }
    if (txt.startsWith("/resume")) {
      db.setMeta(userId, "paused", "0");
      return notify(userId, "▶️ Otomatik tweet'ler tekrar aktif.");
    }
    if (txt.startsWith("/stats")) {
      const tweets = db.countToday(userId, "tweet");
      const replies = db.countToday(userId, "reply");
      const paused = db.getMeta(userId, "paused") === "1";
      return notify(userId, "📊 Bugün\n" + `• Tweet: ${tweets}/${config.maxTweetsPerDay}\n` + `• Cevap: ${replies}/${config.maxRepliesPerDay}\n` + `• Durum: ${paused ? "⏸️ duraklatılmış" : "▶️ aktif"}`);
    }
    if (txt.startsWith("/help") || txt.startsWith("/start")) {
      return notify(userId, "🤖 Co-pilot komutları:\n\n/tweet — rastgele formatla bir tweet taslağı üret\n/tweet <konu> — verdiğin konu etrafında taslak üret\n/trend — Türkiye trendine göre taslak üret\n/thread <konu> — 3-5 tweet'lik thread taslağı üret\n/pause — otomatik tweet'leri duraklat\n/resume — tekrar başlat\n/stats — bugünkü durum\n/help — bu mesaj\n\nHer taslakta ✅ Gönder / 🔄 Yeniden / ❌ İptal butonları gelir. Mention'lar da buraya düşer.");
    }
  } catch (e) {
    bot.sendMessage(msg.chat.id, "Hata: " + e.message).catch(()=>{});
  }
});

bot.setMyCommands([
  { command: "tweet", description: "Tweet taslağı üret (konu opsiyonel)" },
  { command: "trend", description: "Uygun Türkiye trendine göre taslak üret" },
  { command: "thread", description: "3-5 tweet'lik thread taslağı üret" },
  { command: "pause", description: "Otomatik tweet'leri duraklat" },
  { command: "resume", description: "Otomatik tweet'leri başlat" },
  { command: "stats", description: "Bugünkü sayıları göster" },
  { command: "help", description: "Komutları göster" },
]).catch(() => {});

module.exports = { bot, notify, sendSuggestion };
