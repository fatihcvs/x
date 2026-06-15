// Meta Instagram Graph API implementation via fetch (requires Node 18+)
const BASE_URL = "https://graph.facebook.com/v19.0";

module.exports = function createInstagramClient(tokens) {
  const USER_ID = tokens.username; // For Instagram, this is the IG User ID
  const TOKEN = tokens.access_token;

  async function _request(method, endpoint, body) {
    if (!USER_ID || !TOKEN) {
      throw new Error("Instagram yetkilendirmesi eksik (account_id, access_token).");
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
      throw new Error(`Instagram API Error: ${data.error?.message || res.statusText}`);
    }
    return data;
  }

  async function post(text) {
    throw new Error("Instagram sadece görsel veya video içeren gönderileri destekler. Lütfen medyalı taslak üretin.");
  }

  async function postWithMedia(text, mediaBuffer, mimeType, mediaUrl) {
    if (!mediaUrl) throw new Error("Instagram API public media URL gerektirir.");
    const isVideo = mimeType.startsWith("video");
    
    const payload = { caption: text };
    if (isVideo) {
      payload.media_type = "REELS";
      payload.video_url = mediaUrl;
    } else {
      payload.image_url = mediaUrl;
    }
    
    // 1. Create container
    const container = await _request("POST", `/${USER_ID}/media`, payload);
    if (!container.id) throw new Error("Instagram container oluşturulamadı.");

    // Note: Video processing might take a while, so media_publish could fail immediately.
    // For a robust system, we would poll /<container_id>?fields=status_code 
    // Wait a brief moment just in case for images
    await new Promise(r => setTimeout(r, 2000));

    // 2. Publish container
    const published = await _request("POST", `/${USER_ID}/media_publish`, {
      creation_id: container.id,
    });
    return { id: published.id, text };
  }

  async function replyTo(threadId, text) {
    throw new Error("Instagram için yorum yanıtlama özelliği henüz desteklenmiyor.");
  }

  async function postThread(texts) {
    throw new Error("Instagram thread formatını desteklemiyor.");
  }

  async function getMentions(sinceId) {
    return [];
  }

  async function getMyRecentPosts(max = 20) {
    if (!USER_ID || !TOKEN) return [];
    try {
      const data = await _request("GET", `/${USER_ID}/media`, { fields: "id,caption,media_type,media_url", limit: max });
      const posts = data.data || [];
      return posts.map(p => ({
        id: p.id,
        text: p.caption,
        metrics: {}, 
      }));
    } catch (e) {
      console.error("[instagram] getMyRecentPosts hatası:", e.message);
      return [];
    }
  }

  return {
    id: "instagram",
    name: "Instagram",
    limits: { maxLen: 2200, hasThreads: false, hasMentions: false },
    post,
    postWithMedia,
    replyTo,
    postThread,
    getMentions,
    getMyRecentPosts,
  };
};
