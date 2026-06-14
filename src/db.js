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
  CREATE INDEX IF NOT EXISTS idx_posts_kind_date ON posts(kind, date);
  CREATE INDEX IF NOT EXISTS idx_pending_tg ON pending(tg_message_id);
`);

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
      "INSERT INTO posts(kind, text, date, at) VALUES(?, ?, ?, ?)"
    );
    for (const p of data.posts || []) insPost.run(p.kind, p.text, p.date, p.at);
    const insPend = db.prepare(
      "INSERT OR IGNORE INTO pending(mention_id, mention_text, author, draft, tg_message_id, status, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)"
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
const getMeta = (key) => {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : null;
};

const setMeta = (key, value) => {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
};

const countToday = (kind) =>
  db
    .prepare("SELECT COUNT(*) AS n FROM posts WHERE kind = ? AND date = ?")
    .get(kind, localDate()).n;

const logPost = (kind, text) => {
  db.prepare("INSERT INTO posts(kind, text, date, at) VALUES(?, ?, ?, ?)").run(
    kind,
    text,
    localDate(),
    new Date().toISOString()
  );
};

const recentTweets = (limit = 15) =>
  db
    .prepare("SELECT text FROM posts WHERE kind = 'tweet' ORDER BY id DESC LIMIT ?")
    .all(limit)
    .map((r) => r.text);

const mentionSeen = (mentionId) =>
  !!db.prepare("SELECT 1 FROM pending WHERE mention_id = ?").get(mentionId);

const addPending = (m) => {
  if (mentionSeen(m.mention_id)) return;
  db.prepare(
    "INSERT INTO pending(mention_id, mention_text, author, draft, tg_message_id, status, created_at) VALUES(?, ?, ?, ?, ?, 'pending', ?)"
  ).run(
    m.mention_id,
    m.mention_text,
    m.author,
    m.draft,
    m.tg_message_id ?? null,
    new Date().toISOString()
  );
};

const setTgMessageId = (mentionId, tgMessageId) => {
  db.prepare("UPDATE pending SET tg_message_id = ? WHERE mention_id = ?").run(
    tgMessageId,
    mentionId
  );
};

const getPendingByTgMessage = (tgMessageId) =>
  db.prepare("SELECT * FROM pending WHERE tg_message_id = ?").get(tgMessageId);

const getPendingById = (id) =>
  db.prepare("SELECT * FROM pending WHERE id = ?").get(id);

const getPendingByMentionId = (mentionId) =>
  db.prepare("SELECT * FROM pending WHERE mention_id = ?").get(mentionId);

const setPendingStatus = (id, status) => {
  db.prepare("UPDATE pending SET status = ? WHERE id = ?").run(status, id);
};

module.exports = {
  getMeta,
  setMeta,
  countToday,
  logPost,
  recentTweets,
  mentionSeen,
  addPending,
  setTgMessageId,
  getPendingByTgMessage,
  getPendingById,
  getPendingByMentionId,
  setPendingStatus,
};
