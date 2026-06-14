const { TwitterApi } = require("twitter-api-v2");

const client = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

const rw = client.readWrite;

let cachedUserId = null;

async function getUserId() {
  if (cachedUserId) return cachedUserId;
  const me = await rw.v2.me();
  cachedUserId = me.data.id;
  return cachedUserId;
}

async function postTweet(text) {
  const res = await rw.v2.tweet(text);
  return res.data; // { id, text }
}

async function replyTo(tweetId, text) {
  const res = await rw.v2.tweet(text, {
    reply: { in_reply_to_tweet_id: tweetId },
  });
  return res.data;
}

// Post a thread: first tweet, then each next as a reply to the previous one.
// Returns the array of created tweet ids.
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

// Returns new mentions since the last seen id (oldest -> newest)
async function getNewMentions(sinceId) {
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
    .reverse(); // process oldest first
}

// Your own recent original tweets with engagement metrics (best-effort: needs
// API read access). Newest first.
async function getMyRecentTweets(max = 20) {
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

module.exports = {
  getUserId,
  postTweet,
  replyTo,
  postThread,
  getNewMentions,
  getMyRecentTweets,
};
