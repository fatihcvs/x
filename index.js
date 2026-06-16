require("dotenv").config();

const REQUIRED = [
  "OPENAI_API_KEY",
  "TELEGRAM_BOT_TOKEN",
];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing env vars: " + missing.join(", "));
  console.error("Copy .env.example to .env and fill them in.");
  process.exit(1);
}

const scheduler = require("./src/scheduler");
const web = require("./src/web");

(async () => {
  try {
    scheduler.start();
    web.start();
    console.log("[startup] running.");
  } catch (e) {
    console.error("[startup] failed:", e.message);
    process.exit(1);
  }
})();
