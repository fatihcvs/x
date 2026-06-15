// Meta Threads API implementation via fetch (requires Node 18+)
const BASE_URL = "https://graph.threads.net/v1.0";

module.exports = function createThreadsClient(tokens) {
  const USER_ID = tokens.username;
  const TOKEN = tokens.access_token;

  async function _request(method, endpoint, body) {
    if (!USER_ID || !TOKEN) {
      throw new Error("Threads yetkilendirmesi eksik (username, access_token).");
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

  async function _postContainer(text, replyToId = null, mediaUrl = null, mediaType = "TEXT") {
    const payload = { media_type: mediaType, text };
    if (replyToId) payload.reply_to_id = replyToId;
    if (mediaUrl) {
      if (mediaType === "IMAGE") payload.image_url = mediaUrl;
      if (mediaType === "VIDEO") payload.video_url = mediaUrl;
    }
    
    // 1. Create container
    const container = await _request("POST", `/${USER_ID}/threads`, payload);
    if (!container.id) throw new Error("Threads container oluşturulamadı.");

    // Wait until it's ready (if video)
    // Here we assume it finishes quickly, but for videos Meta says to poll container status.
    // We will just publish directly, if it fails, it might need polling in the future.

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
  
  async function postWithMedia(text, mediaBuffer, mimeType, mediaUrl) {
    // Threads API needs public URL for media!
    if (!mediaUrl) throw new Error("Threads requires a public media URL for images/videos.");
    const type = mimeType.startsWith("video") ? "VIDEO" : "IMAGE";
    const res = await _postContainer(text, null, mediaUrl, type);
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

  return {
    id: "threads",
    name: "Threads",
    limits: { maxLen: 500, hasThreads: true, hasMentions: false },
    post,
    postWithMedia,
    replyTo,
    postThread,
    getMentions,
    getMyRecentPosts,
  };
};
