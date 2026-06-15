// Durable store on SQLite via Node's built-in `node:sqlite` (Node 22+, no native
// build, synchronous API). This is the bot's memory: posts, mentions and meta
// survive restarts and are queryable. Same function interface as before, so the
// rest of the app is unchanged. On Railway/Hetzner keep data.db on a persistent
// disk so history survives redeploys.
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DB_FILE = path.join(__dirname, "..", "data.db");
const db = new DatabaseSync(DB_FILE);

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS posts (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    date TEXT NOT NULL,
    at   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pending (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    mention_id    TEXT UNIQUE,
    mention_text  TEXT,
    author        TEXT,
    draft         TEXT,
    tg_message_id INTEGER,
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_platforms (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    platform_id   TEXT NOT NULL,
    access_token  TEXT,
    refresh_token TEXT,
    username      TEXT,
    UNIQUE(user_id, platform_id)
  );
  CREATE TABLE IF NOT EXISTS user_meta (
    user_id INTEGER NOT NULL,
    key     TEXT NOT NULL,
    value   TEXT,
    PRIMARY KEY(user_id, key)
  );
  CREATE INDEX IF NOT EXISTS idx_posts_kind_date ON posts(kind, date);
  CREATE INDEX IF NOT EXISTS idx_pending_tg ON pending(tg_message_id);
`);

// Multi-platform migration: ensure 'platform' columns exist
try { db.exec("ALTER TABLE posts ADD COLUMN platform TEXT NOT NULL DEFAULT 'x'"); } catch (e) {}
try { db.exec("ALTER TABLE pending ADD COLUMN platform TEXT NOT NULL DEFAULT 'x'"); } catch (e) {}

// Multi-user migration: ensure 'user_id' columns exist
try { db.exec("ALTER TABLE posts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1"); } catch (e) {}
try { db.exec("ALTER TABLE pending ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1"); } catch (e) {}

// Seed the first user if empty and migrate meta
const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
if (userCount === 0) {
  const hash = require("crypto").createHash("sha256").update(process.env.DASHBOARD_PASSWORD || "admin").digest("hex");
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (1, ?, ?, ?)").run(
    process.env.DASHBOARD_EMAIL || "admin", 
    hash, 
    new Date().toISOString()
  );
  // Migrate legacy meta to user_meta for user 1
  try {
    const metaRows = db.prepare("SELECT * FROM meta").all();
    for (const r of metaRows) {
      db.prepare("INSERT OR REPLACE INTO user_meta (user_id, key, value) VALUES (1, ?, ?)").run(r.key, r.value);
    }
  } catch(e) {}
}

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

// One-time migration from the legacy data.json (if a previous JSON run exists).
(function migrateFromJson() {
  try {
    const JSON_FILE = path.join(__dirname, "..", "data.json");
    if (!fs.existsSync(JSON_FILE)) return;
    const have =
      db.prepare("SELECT COUNT(*) AS n FROM posts").get().n +
      db.prepare("SELECT COUNT(*) AS n FROM pending").get().n +
      db.prepare("SELECT COUNT(*) AS n FROM meta").get().n;
    if (have > 0) return; // DB already populated; don't double-import

    const data = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
    const insMeta = db.prepare(
      "INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)"
    );
    for (const [k, v] of Object.entries(data.meta || {})) insMeta.run(k, String(v));
    const insPost = db.prepare(
      "INSERT INTO posts(kind, text, date, at, platform) VALUES(?, ?, ?, ?, 'x')"
    );
    for (const p of data.posts || []) insPost.run(p.kind, p.text, p.date, p.at);
    const insPend = db.prepare(
      "INSERT OR IGNORE INTO pending(mention_id, mention_text, author, draft, tg_message_id, status, created_at, platform) VALUES(?, ?, ?, ?, ?, ?, ?, 'x')"
    );
    for (const p of data.pending || [])
      insPend.run(
        p.mention_id,
        p.mention_text,
        p.author,
        p.draft,
        p.tg_message_id ?? null,
        p.status || "pending",
        p.created_at || new Date().toISOString()
      );
    fs.renameSync(JSON_FILE, JSON_FILE + ".migrated"); // keep a backup
    console.log("[db] data.json -> data.db migrasyonu tamam (yedek: data.json.migrated)");
  } catch (e) {
    console.error("[db] migrasyon atlandi:", e.message);
  }
})();

// --- API (same signatures as the old JSON store) ------------------------
const getMeta = (userId, key) => {
  const row = db.prepare("SELECT value FROM user_meta WHERE user_id = ? AND key = ?").get(userId, key);
  return row ? row.value : null;
};

const setMeta = (userId, key, value) => {
  db.prepare(
    "INSERT INTO user_meta(user_id, key, value) VALUES(?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value"
  ).run(userId, key, String(value));
};

const countToday = (userId, kind) =>
  db
    .prepare("SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND kind = ? AND date = ?")
    .get(userId, kind, localDate()).n;

const countTodayByPlatform = (userId, kind) => {
  const rows = db
    .prepare("SELECT platform, COUNT(*) AS n FROM posts WHERE user_id = ? AND kind = ? AND date = ? GROUP BY platform")
    .all(userId, kind, localDate());
  return rows.reduce((acc, r) => ({ ...acc, [r.platform]: r.n }), {});
};

const logPost = (userId, kind, text, platformId = "x") => {
  db.prepare("INSERT INTO posts(user_id, kind, text, date, at, platform) VALUES(?, ?, ?, ?, ?, ?)").run(
    userId,
    kind,
    text,
    localDate(),
    new Date().toISOString(),
    platformId
  );
};

const recentTweets = (userId, limit = 15) =>
  db
    .prepare("SELECT text FROM posts WHERE user_id = ? AND kind = 'tweet' ORDER BY id DESC LIMIT ?")
    .all(userId, limit)
    .map((r) => r.text);

const recentPosts = (userId, limit = 20) =>
  db
    .prepare("SELECT kind, text, at, platform FROM posts WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, limit);

const listPending = (userId, status = "pending") =>
  db
    .prepare(
      "SELECT id, mention_id, mention_text, author, draft, status, created_at, platform FROM pending WHERE user_id = ? AND status = ? ORDER BY id DESC"
    )
    .all(userId, status);

const mentionSeen = (userId, mentionId) =>
  !!db.prepare("SELECT 1 FROM pending WHERE user_id = ? AND mention_id = ?").get(userId, mentionId);

const addPending = (userId, m, platformId = "x") => {
  if (mentionSeen(userId, m.mention_id)) return;
  db.prepare(
    "INSERT INTO pending(user_id, mention_id, mention_text, author, draft, tg_message_id, status, created_at, platform) VALUES(?, ?, ?, ?, ?, ?, 'pending', ?, ?)"
  ).run(
    userId,
    m.mention_id,
    m.mention_text,
    m.author,
    m.draft,
    m.tg_message_id ?? null,
    new Date().toISOString(),
    platformId
  );
};

const setTgMessageId = (userId, mentionId, tgMessageId) => {
  db.prepare("UPDATE pending SET tg_message_id = ? WHERE user_id = ? AND mention_id = ?").run(
    tgMessageId,
    userId,
    mentionId
  );
};

const getPendingByTgMessage = (tgMessageId) =>
  db.prepare("SELECT * FROM pending WHERE tg_message_id = ?").get(tgMessageId);

const getPendingById = (userId, id) =>
  db.prepare("SELECT * FROM pending WHERE user_id = ? AND id = ?").get(userId, id);

const getPendingByMentionId = (userId, mentionId) =>
  db.prepare("SELECT * FROM pending WHERE user_id = ? AND mention_id = ?").get(userId, mentionId);

const setPendingStatus = (userId, id, status) => {
  db.prepare("UPDATE pending SET status = ? WHERE user_id = ? AND id = ?").run(status, userId, id);
};

// --- User Management API ----------------------------------------------
const getUser = (email) => db.prepare("SELECT * FROM users WHERE email = ?").get(email);
const getUserById = (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id);
const getUserByTgChat = (chatId) => {
  const row = db.prepare("SELECT user_id FROM user_meta WHERE key = 'telegramChatId' AND value = ?").get(String(chatId));
  // Fallback for user 1 if not set in DB but exists in env
  if (!row && String(chatId) === String(process.env.TELEGRAM_CHAT_ID)) return 1;
  return row ? row.user_id : null;
};
const createUser = (email, passwordHash) => {
  const res = db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)").run(email, passwordHash, new Date().toISOString());
  return res.lastInsertRowid;
};
const getAllUsers = () => db.prepare("SELECT id FROM users").all();
const getUserPlatforms = (userId) => db.prepare("SELECT * FROM user_platforms WHERE user_id = ?").all(userId);
const setUserPlatform = (userId, platformId, accessToken, refreshToken, username) => {
  db.prepare(
    "INSERT INTO user_platforms (user_id, platform_id, access_token, refresh_token, username) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, platform_id) DO UPDATE SET access_token=excluded.access_token, refresh_token=excluded.refresh_token, username=excluded.username"
  ).run(userId, platformId, accessToken, refreshToken, username);
};

module.exports = {
  getMeta,
  setMeta,
  countToday,
  countTodayByPlatform,
  logPost,
  recentTweets,
  recentPosts,
  listPending,
  mentionSeen,
  addPending,
  setTgMessageId,
  getPendingByTgMessage,
  getPendingById,
  getPendingByMentionId,
  setPendingStatus,
  getUser,
  getUserById,
  getUserByTgChat,
  createUser,
  getAllUsers,
  getUserPlatforms,
  setUserPlatform,
};
