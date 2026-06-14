require("dotenv").config();

const REQUIRED = [
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_SECRET",
  "OPENAI_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing env vars: " + missing.join(", "));
  console.error("Copy .env.example to .env and fill them in.");
  process.exit(1);
}

const x = require("./src/x");
const scheduler = require("./src/scheduler");
const { notify } = require("./src/telegram");

(async () => {
  try {
    const userId = await x.getUserId(); // verifies X credentials early
    console.log("[startup] X auth OK, user id:", userId);
    scheduler.start();
    notify(
      "🤖 Co-pilot çalışıyor.\n" +
        "• Tweet'ler otomatik (uygun trend varsa ona göre)\n" +
        "• Mention'lar onayına gelir\n" +
        "• Komutlar: /tweet, /tweet <konu>, /trend"
    );
    console.log("[startup] running.");
  } catch (e) {
    console.error("[startup] failed:", e.message);
    process.exit(1);
  }
})();
