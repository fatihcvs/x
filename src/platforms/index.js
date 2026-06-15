const { getSettings } = require("../settings");
const db = require("../db");
const createXClient = require("./x");
const createThreadsClient = require("./threads");
const createInstagramClient = require("./instagram");

function createRouter(userId) {
  if (!userId) throw new Error("userId is required for createRouter");
  
  const userPlatforms = db.getUserPlatforms(userId);
  const tokenMap = {};
  for (const p of userPlatforms) {
    tokenMap[p.platform_id] = p;
  }

  // Fallbacks for User 1 if DB tokens are empty but global .env exists
  if (userId === 1 && !tokenMap.x) {
    tokenMap.x = { access_token: process.env.X_ACCESS_TOKEN, refresh_token: process.env.X_ACCESS_SECRET };
  }
  if (userId === 1 && !tokenMap.threads) {
    tokenMap.threads = { username: process.env.THREADS_USER_ID, access_token: process.env.THREADS_ACCESS_TOKEN };
  }

  const all = {};
  if (tokenMap.x && (tokenMap.x.access_token || tokenMap.x.refresh_token)) {
    all.x = createXClient(tokenMap.x);
  }
  if (tokenMap.threads && (tokenMap.threads.access_token || tokenMap.threads.username)) {
    all.threads = createThreadsClient(tokenMap.threads);
  }
  if (tokenMap.instagram && (tokenMap.instagram.access_token || tokenMap.instagram.username)) {
    all.instagram = createInstagramClient(tokenMap.instagram);
  }

  const config = getSettings(userId);
  const activeIds = config.activePlatforms || ["x"];
  
  const active = [];
  for (const id of activeIds) {
    if (all[id]) active.push(all[id]);
  }

  if (active.length === 0 && all.x) active.push(all.x);

  return {
    all,
    getActive: () => active,
    getMinLimits: () => {
      let maxLen = 99999;
      let hasThreads = true;
      for (const p of active) {
        if (p.limits.maxLen < maxLen) maxLen = p.limits.maxLen;
        if (!p.limits.hasThreads) hasThreads = false;
      }
      if (maxLen === 99999) maxLen = 280;
      return { maxLen, hasThreads };
    },
  };
}

module.exports = { createRouter };
