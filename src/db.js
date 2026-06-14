// Zero-dependency JSON store. Plenty for this bot's scale and deploys
// anywhere with no native compilation. On Railway/Hetzner, put the project
// on a persistent disk so data.json survives restarts.
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data.json");

let data = { meta: {}, posts: [], pending: [], seq: 0 };
try {
  data = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch {
  /* first run: start fresh */
}

function save() {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

const getMeta = (key) => (key in data.meta ? data.meta[key] : null);
const setMeta = (key, value) => {
  data.meta[key] = String(value);
  save();
};

const countToday = (kind) =>
  data.posts.filter((p) => p.kind === kind && p.date === localDate()).length;

const logPost = (kind, text) => {
  data.posts.push({ kind, text, date: localDate(), at: new Date().toISOString() });
  save();
};

const recentTweets = (limit = 15) =>
  data.posts
    .filter((p) => p.kind === "tweet")
    .slice(-limit)
    .reverse()
    .map((p) => p.text);

const mentionSeen = (mentionId) =>
  data.pending.some((p) => p.mention_id === mentionId);

const addPending = (m) => {
  if (mentionSeen(m.mention_id)) return;
  data.pending.push({
    id: ++data.seq,
    mention_id: m.mention_id,
    mention_text: m.mention_text,
    author: m.author,
    draft: m.draft,
    tg_message_id: m.tg_message_id ?? null,
    status: "pending",
    created_at: new Date().toISOString(),
  });
  save();
};

const setTgMessageId = (mentionId, tgMessageId) => {
  const p = data.pending.find((x) => x.mention_id === mentionId);
  if (p) {
    p.tg_message_id = tgMessageId;
    save();
  }
};

const getPendingByTgMessage = (tgMessageId) =>
  data.pending.find((p) => p.tg_message_id === tgMessageId);

const getPendingById = (id) => data.pending.find((p) => p.id === id);

const getPendingByMentionId = (mentionId) =>
  data.pending.find((p) => p.mention_id === mentionId);

const setPendingStatus = (id, status) => {
  const p = getPendingById(id);
  if (p) {
    p.status = status;
    save();
  }
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
