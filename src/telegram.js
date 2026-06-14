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
//  Manual & trend tweets — /tweet, /tweet <konu>, /trend
//  Kept separate from the mention flow: drafts live in memory keyed by
//  the Telegram message_id, and buttons use the `mt_` callback prefix.
// ===================================================================

const manualDrafts = new Map(); // message_id -> { mode, topic, text }

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

const draftBody = (mode, text) =>
  `${mode === "trend" ? "🔥 Trend taslağı" : "📝 Tweet taslağı"}:\n\n"${text}"`;

// Build one draft. Returns null when there's no usable text
// (e.g. trend mode found no safe/suitable trend).
async function buildDraft(mode, topic) {
  const recent = db.recentTweets();
  if (mode === "trend") {
    const trends = await getEnrichedTrends();
    if (!trends.length) return null;
    return ai.generateTrendTweet(trends, recent); // may be null
  }
  // Manual tweet: when no topic is given, pull the current agenda as background
  // awareness so the tweet feels timely (model uses it only if it helps).
  let context = [];
  if (!topic && config.trendsEnabled) {
    try {
      context = await getEnrichedTrends();
    } catch {
      /* best-effort background */
    }
  }
  return ai.generateTweet(recent, topic, context);
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
      mode === "trend" ? "🔎 Uygun trend aranıyor..." : "✍️ Taslak üretiliyor...";
    const sent = await bot.sendMessage(CHAT_ID, placeholder);
    statusId = sent.message_id;
  } catch {
    /* couldn't send placeholder; we'll send a fresh message below */
  }

  try {
    if (db.countToday("tweet") >= config.maxTweetsPerDay) {
      const txt = "⏸️ Günlük tweet limiti dolu. Bugün yeni tweet atılamaz.";
      return statusId ? editMsg(statusId, txt, false) : notify(txt);
    }

    const text = await buildDraft(mode, topic);
    if (!text) {
      const txt =
        "Şu an uygun (hafif/güvenli) bir trend bulunamadı. Normal /tweet deneyebilirsin.";
      return statusId ? editMsg(statusId, txt, false) : notify(txt);
    }

    if (statusId) {
      await editMsg(statusId, draftBody(mode, text), true);
      manualDrafts.set(statusId, { mode, topic, text });
    } else {
      const sent = await bot.sendMessage(CHAT_ID, draftBody(mode, text), {
        reply_markup: manualKeyboard(),
      });
      manualDrafts.set(sent.message_id, { mode, topic, text });
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
    let text;
    try {
      text = await buildDraft(entry.mode, entry.topic);
    } catch (e) {
      return editMsg(messageId, "⚠️ Üretilemedi: " + e.message, true);
    }
    if (!text) {
      return editMsg(
        messageId,
        "Şu an uygun (hafif/güvenli) bir trend yok. Tekrar dene ya da iptal et.",
        true
      );
    }
    entry.text = text;
    manualDrafts.set(messageId, entry);
    return editMsg(messageId, draftBody(entry.mode, text), true);
  }

  if (q.data === "mt_post") {
    if (db.countToday("tweet") >= config.maxTweetsPerDay) {
      manualDrafts.delete(messageId);
      await bot.answerCallbackQuery(q.id, { text: "Günlük limit dolu." });
      return editMsg(messageId, "⏸️ Günlük tweet limiti dolu, gönderilmedi.", false);
    }
    await x.postTweet(entry.text);
    db.logPost("tweet", entry.text);
    manualDrafts.delete(messageId);
    await bot.answerCallbackQuery(q.id, { text: "Gönderildi ✅" });
    return editMsg(messageId, `✅ Gönderildi:\n"${entry.text}"`, false);
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

// /help or /start — list the available commands
const HELP =
  "🤖 Co-pilot komutları:\n\n" +
  "/tweet — rastgele formatla bir tweet taslağı üret\n" +
  "/tweet <konu> — verdiğin konu/ipucu etrafında taslak üret\n" +
  "/trend — uygun (hafif/güvenli) bir Türkiye trendine göre taslak üret\n" +
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
