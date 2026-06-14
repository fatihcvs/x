const TelegramBot = require("node-telegram-bot-api");
const config = require("../config");
const x = require("./x");
const db = require("./db");

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

function notify(text) {
  return bot.sendMessage(CHAT_ID, text).catch(() => {});
}

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

// Button presses
bot.on("callback_query", async (q) => {
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
