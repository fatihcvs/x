const TelegramBot = require("node-telegram-bot-api");
const config = require("../config");
const x = require("./x");
const ai = require("./ai");
const db = require("./db");
const { getEnrichedTrends } = require("./trends");

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const isOwner = (msg) => String(msg.chat.id) === String(CHAT_ID);

function notify(text) {
  return bot.sendMessage(CHAT_ID, text).catch(() => {});
}

// ===================================================================
//  Mention reply suggestions (human-approved) — existing flow
// ===================================================================

// Send a reply suggestion with Approve / Skip buttons.
async function sendSuggestion(pending) {
  const body =
    `💬 @${pending.author} sana yazdı:\n"${pending.mention_text}"\n\n` +
    `🤖 Önerilen cevap:\n"${pending.draft}"\n\n` +
    `(Düzenlemek için bu mesajı yanıtla — gönderdiğin metin cevap olur.)`;

  const sent = await bot.sendMessage(CHAT_ID, body, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Gönder", callback_data: `send:${pending.id}` },
          { text: "❌ Geç", callback_data: `skip:${pending.id}` },
        ],
      ],
    },
  });
  db.setTgMessageId(pending.mention_id, sent.message_id);
}

async function postReply(pending, text, tgMessageId) {
  if (db.countToday("reply") >= config.maxRepliesPerDay) {
    await bot.editMessageText("⏸️ Günlük cevap limitine ulaşıldı, atlanıyor.", {
      chat_id: CHAT_ID,
      message_id: tgMessageId,
    });
    db.setPendingStatus(pending.id, "skipped");
    return;
  }
  await x.replyTo(pending.mention_id, text);
  db.logPost("reply", text);
  db.setPendingStatus(pending.id, "sent");
}

// ===================================================================
//  Manual content — /tweet, /tweet <konu>, /trend, /thread
//  Kept separate from the mention flow: drafts live in memory keyed by
//  the Telegram message_id, and buttons use the `mt_` callback prefix.
// ===================================================================

const manualDrafts = new Map(); // message_id -> { mode, topic, content }

function manualKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "✅ Gönder", callback_data: "mt_post" },
        { text: "🔄 Yeniden üret", callback_data: "mt_regen" },
        { text: "❌ İptal", callback_data: "mt_cancel" },
      ],
    ],
  };
}

// content is { text } for a single tweet or { parts: [...] } for a thread.
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

// Build one draft. Returns { text } | { parts } | null (null = nothing usable,
// e.g. trend mode found no safe/suitable trend).
async function buildDraft(mode, topic) {
  const recent = db.recentTweets();

  if (mode === "trend") {
    const trends = await getEnrichedTrends();
    if (!trends.length) return null;
    const t = await ai.generateTrendTweet(trends, recent);
    return t ? { text: t } : null;
  }

  // Both /thread and topic-less /tweet pull the current agenda as background.
  let context = [];
  if (config.trendsEnabled && (mode === "thread" || !topic)) {
    try {
      context = await getEnrichedTrends();
    } catch {
      /* best-effort background */
    }
  }

  if (mode === "thread") {
    const parts = await ai.generateThread(topic, recent, context);
    return parts && parts.length ? { parts } : null;
  }

  const text = await ai.generateTweet(recent, topic, context);
  return text ? { text } : null;
}

// editMessageText wrapper that swallows Telegram's "not modified" noise.
async function editMsg(messageId, text, withButtons) {
  const opts = { chat_id: CHAT_ID, message_id: messageId };
  if (withButtons) opts.reply_markup = manualKeyboard();
  try {
    await bot.editMessageText(text, opts);
  } catch (e) {
    if (!/not modified/i.test(e.message || "")) throw e;
  }
}

// Produce a draft and show it with ✅/🔄/❌ buttons. Reuses a single status
// message so the chat stays tidy.
async function startDraft(mode, topic) {
  let statusId = null;
  try {
    const placeholder =
      mode === "thread"
        ? "🧵 Thread üretiliyor..."
        : mode === "trend"
        ? "🔎 Uygun trend aranıyor..."
        : "✍️ Taslak üretiliyor...";
    const sent = await bot.sendMessage(CHAT_ID, placeholder);
    statusId = sent.message_id;
  } catch {
    /* couldn't send placeholder; we'll send a fresh message below */
  }

  try {
    const remaining = config.maxTweetsPerDay - db.countToday("tweet");
    if (remaining <= 0) {
      const txt = "⏸️ Günlük tweet limiti dolu. Bugün yeni tweet atılamaz.";
      return statusId ? editMsg(statusId, txt, false) : notify(txt);
    }

    const content = await buildDraft(mode, topic);
    if (!content) {
      const txt =
        mode === "thread"
          ? "Thread üretilemedi, tekrar dene."
          : "Şu an uygun (hafif/güvenli) bir trend bulunamadı. Normal /tweet deneyebilirsin.";
      return statusId ? editMsg(statusId, txt, false) : notify(txt);
    }

    const needed = content.parts ? content.parts.length : 1;
    if (needed > remaining) {
      const txt = `⏸️ Bu thread ${needed} tweet ama bugün kalan hakkın ${remaining}. Yarın dene ya da maxTweetsPerDay'i artır.`;
      return statusId ? editMsg(statusId, txt, false) : notify(txt);
    }

    const body = draftBody(mode, content);
    if (statusId) {
      await editMsg(statusId, body, true);
      manualDrafts.set(statusId, { mode, topic, content });
    } else {
      const sent = await bot.sendMessage(CHAT_ID, body, {
        reply_markup: manualKeyboard(),
      });
      manualDrafts.set(sent.message_id, { mode, topic, content });
    }
  } catch (e) {
    const txt = "⚠️ Taslak üretilemedi: " + e.message;
    if (statusId) editMsg(statusId, txt, false).catch(() => {});
    else notify(txt);
  }
}

async function handleManualCallback(q) {
  const messageId = q.message.message_id;
  const entry = manualDrafts.get(messageId);
  if (!entry) {
    return bot.answerCallbackQuery(q.id, {
      text: "Taslak bulunamadı veya süresi geçti.",
    });
  }

  if (q.data === "mt_cancel") {
    manualDrafts.delete(messageId);
    await editMsg(messageId, "❌ İptal edildi.", false);
    return bot.answerCallbackQuery(q.id);
  }

  if (q.data === "mt_regen") {
    await bot.answerCallbackQuery(q.id, { text: "Yeniden üretiliyor..." });
    let content;
    try {
      content = await buildDraft(entry.mode, entry.topic);
    } catch (e) {
      return editMsg(messageId, "⚠️ Üretilemedi: " + e.message, true);
    }
    if (!content) {
      return editMsg(
        messageId,
        "Üretilemedi (uygun içerik yok). Tekrar dene ya da iptal et.",
        true
      );
    }
    entry.content = content;
    manualDrafts.set(messageId, entry);
    return editMsg(messageId, draftBody(entry.mode, content), true);
  }

  if (q.data === "mt_post") {
    const content = entry.content;
    const needed = content.parts ? content.parts.length : 1;
    const remaining = config.maxTweetsPerDay - db.countToday("tweet");
    if (needed > remaining) {
      manualDrafts.delete(messageId);
      await bot.answerCallbackQuery(q.id, { text: "Günlük limit yetersiz." });
      return editMsg(
        messageId,
        `⏸️ Günlük limit yetersiz (gereken ${needed}, kalan ${remaining}), gönderilmedi.`,
        false
      );
    }
    try {
      if (content.parts) {
        await x.postThread(content.parts);
        content.parts.forEach((p) => db.logPost("tweet", p));
      } else {
        await x.postTweet(content.text);
        db.logPost("tweet", content.text);
      }
    } catch (e) {
      return editMsg(messageId, "⚠️ Gönderilemedi: " + e.message, false);
    }
    manualDrafts.delete(messageId);
    await bot.answerCallbackQuery(q.id, { text: "Gönderildi ✅" });
    const summary = content.parts
      ? `✅ Thread gönderildi (${content.parts.length} tweet).`
      : `✅ Gönderildi:\n"${content.text}"`;
    return editMsg(messageId, summary, false);
  }

  return bot.answerCallbackQuery(q.id);
}

// /tweet  or  /tweet <konu>
bot.onText(/^\/tweet(?:@\w+)?(?:\s+([\s\S]+))?$/, (msg, match) => {
  if (!isOwner(msg)) return;
  const topic = match && match[1] ? match[1].trim() : null;
  startDraft("manual", topic);
});

// /trend
bot.onText(/^\/trend(?:@\w+)?\s*$/, (msg) => {
  if (!isOwner(msg)) return;
  startDraft("trend", null);
});

// /thread  or  /thread <konu>
bot.onText(/^\/thread(?:@\w+)?(?:\s+([\s\S]+))?$/, (msg, match) => {
  if (!isOwner(msg)) return;
  const topic = match && match[1] ? match[1].trim() : null;
  startDraft("thread", topic);
});

// /help or /start — list the available commands
const HELP =
  "🤖 Co-pilot komutları:\n\n" +
  "/tweet — rastgele formatla bir tweet taslağı üret\n" +
  "/tweet <konu> — verdiğin konu/ipucu etrafında taslak üret\n" +
  "/trend — uygun (hafif/güvenli) bir Türkiye trendine göre taslak üret\n" +
  "/thread <konu> — konu üzerine 3-5 tweet'lik thread taslağı üret\n" +
  "/help — bu mesajı göster\n\n" +
  "Her taslakta ✅ Gönder / 🔄 Yeniden üret / ❌ İptal butonları gelir.\n" +
  "Mention'lar ayrıca otomatik olarak onayına düşer (komut gerekmez).";

bot.onText(/^\/(help|start)(?:@\w+)?\s*$/, (msg) => {
  if (!isOwner(msg)) return;
  notify(HELP);
});

// Register the commands so they show up in Telegram's "/" menu for discovery.
bot
  .setMyCommands([
    { command: "tweet", description: "Tweet taslağı üret (konu opsiyonel)" },
    { command: "trend", description: "Uygun Türkiye trendine göre taslak üret" },
    { command: "thread", description: "3-5 tweet'lik thread taslağı üret" },
    { command: "help", description: "Komutları göster" },
  ])
  .catch(() => {});

// ===================================================================
//  Telegram event handlers
// ===================================================================

// Button presses
bot.on("callback_query", async (q) => {
  // Manual/trend tweet flow uses a separate callback prefix.
  if (q.data && q.data.startsWith("mt_")) {
    return handleManualCallback(q).catch(async (e) => {
      try {
        await bot.answerCallbackQuery(q.id, { text: "Hata: " + e.message });
      } catch {
        /* ignore */
      }
    });
  }

  try {
    const [action, idStr] = q.data.split(":");
    const pending = db.getPendingById(Number(idStr));
    if (!pending || pending.status !== "pending") {
      return bot.answerCallbackQuery(q.id, { text: "Zaten işlenmiş." });
    }

    if (action === "send") {
      await postReply(pending, pending.draft, q.message.message_id);
      await bot.editMessageText(`✅ Gönderildi:\n"${pending.draft}"`, {
        chat_id: CHAT_ID,
        message_id: q.message.message_id,
      });
    } else if (action === "skip") {
      db.setPendingStatus(pending.id, "skipped");
      await bot.editMessageText(`❌ Geçildi:\n"${pending.mention_text}"`, {
        chat_id: CHAT_ID,
        message_id: q.message.message_id,
      });
    }
    await bot.answerCallbackQuery(q.id);
  } catch (e) {
    await bot.answerCallbackQuery(q.id, { text: "Hata: " + e.message });
  }
});

// Edited reply: user replies to a suggestion message with custom text
bot.on("message", async (msg) => {
  try {
    if (!msg.reply_to_message || !msg.text) return;
    const pending = db.getPendingByTgMessage(msg.reply_to_message.message_id);
    if (!pending || pending.status !== "pending") return;

    await postReply(pending, msg.text.slice(0, 280), msg.reply_to_message.message_id);
    await bot.sendMessage(CHAT_ID, `✅ Senin metninle gönderildi:\n"${msg.text}"`);
  } catch (e) {
    await bot.sendMessage(CHAT_ID, "Hata: " + e.message);
  }
});

module.exports = { bot, notify, sendSuggestion };
