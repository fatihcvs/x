const { TwitterApi } = require("twitter-api-v2");

module.exports = function createXClient(tokens) {
  const client = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: tokens.access_token,
    accessSecret: tokens.refresh_token, // OAuth1a secrets are often mapped here, or we use tokens.refresh_token to store accessSecret
  });

  const rw = client.readWrite;

  let cachedUserId = null;

  async function getUserId() {
    if (cachedUserId) return cachedUserId;
    const me = await rw.v2.me();
    cachedUserId = me.data.id;
    return cachedUserId;
  }

  async function post(text) {
    const res = await rw.v2.tweet(text);
    return res.data; // { id, text }
  }

  async function replyTo(tweetId, text) {
    const res = await rw.v2.tweet(text, {
      reply: { in_reply_to_tweet_id: tweetId },
    });
    return res.data;
  }

  async function postThread(texts) {
    const ids = [];
    let lastId = null;
    for (const text of texts) {
      const res = lastId
        ? await rw.v2.tweet(text, { reply: { in_reply_to_tweet_id: lastId } })
        : await rw.v2.tweet(text);
      lastId = res.data.id;
      ids.push(lastId);
    }
    return ids;
  }

  async function getMentions(sinceId) {
    const userId = await getUserId();
    const params = {
      max_results: 20,
      "tweet.fields": ["author_id", "created_at"],
      expansions: ["author_id"],
      "user.fields": ["username"],
    };
    if (sinceId) params.since_id = sinceId;

    const timeline = await rw.v2.userMentionTimeline(userId, params);
    const tweets = timeline.data?.data ?? [];
    const users = timeline.data?.includes?.users ?? [];
    const usernameById = Object.fromEntries(
      users.map((u) => [u.id, u.username])
    );

    return tweets
      .map((t) => ({
        id: t.id,
        text: t.text,
        author: usernameById[t.author_id] || "someone",
      }))
      .reverse();
  }

  async function getMyRecentPosts(max = 20) {
    const userId = await getUserId();
    const timeline = await rw.v2.userTimeline(userId, {
      max_results: Math.min(Math.max(max, 5), 100),
      "tweet.fields": ["public_metrics", "created_at"],
      exclude: ["retweets", "replies"],
    });
    const tweets = timeline.data?.data ?? [];
    return tweets.map((t) => ({
      id: t.id,
      text: t.text,
      metrics: t.public_metrics || {},
    }));
  }

  return {
    id: "x",
    name: "X (Twitter)",
    limits: { maxLen: 280, hasThreads: true, hasMentions: true },
    post,
    replyTo,
    postThread,
    getMentions,
    getMyRecentPosts,
  };
};
