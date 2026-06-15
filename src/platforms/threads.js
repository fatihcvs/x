// Meta Threads API implementation via fetch (requires Node 18+)
const USER_ID = process.env.THREADS_USER_ID;
const TOKEN = process.env.THREADS_ACCESS_TOKEN;
const BASE_URL = "https://graph.threads.net/v1.0";

async function _request(method, endpoint, body) {
  if (!USER_ID || !TOKEN) {
    throw new Error("Threads yetkilendirmesi eksik (THREADS_USER_ID, THREADS_ACCESS_TOKEN).");
  }
  const isGet = method.toUpperCase() === "GET";
  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.append("access_token", TOKEN);
  if (isGet && body) {
    for (const [k, v] of Object.entries(body)) url.searchParams.append(k, v);
  }

  const opts = { method };
  if (!isGet && body) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), opts);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Threads API Error: ${data.error?.message || res.statusText}`);
  }
  return data;
}

// Helper to create and immediately publish a thread/reply
async function _postContainer(text, replyToId = null) {
  const payload = { media_type: "TEXT", text };
  if (replyToId) payload.reply_to_id = replyToId;
  
  // 1. Create container
  const container = await _request("POST", `/${USER_ID}/threads`, payload);
  if (!container.id) throw new Error("Threads container oluşturulamadı.");

  // 2. Publish container
  const published = await _request("POST", `/${USER_ID}/threads_publish`, {
    creation_id: container.id,
  });
  return published;
}

async function post(text) {
  const res = await _postContainer(text);
  return { id: res.id, text };
}

async function replyTo(threadId, text) {
  const res = await _postContainer(text, threadId);
  return { id: res.id, text };
}

async function postThread(texts) {
  const ids = [];
  let lastId = null;
  for (const text of texts) {
    const res = await _postContainer(text, lastId);
    lastId = res.id;
    ids.push(lastId);
  }
  return ids;
}

async function getMentions(sinceId) {
  // Meta henüz Threads için standart mention okuma API'si sunmuyor veya çok kısıtlı.
  return [];
}

async function getMyRecentPosts(max = 20) {
  if (!USER_ID || !TOKEN) return [];
  try {
    const data = await _request("GET", `/${USER_ID}/threads`, { limit: max });
    const posts = data.data || [];
    return posts.map(p => ({
      id: p.id,
      text: p.text,
      metrics: {}, 
    }));
  } catch (e) {
    console.error("[threads] getMyRecentPosts hatası:", e.message);
    return [];
  }
}

module.exports = {
  id: "threads",
  name: "Threads",
  limits: { maxLen: 500, hasThreads: true, hasMentions: false },
  post,
  replyTo,
  postThread,
  getMentions,
  getMyRecentPosts,
};
