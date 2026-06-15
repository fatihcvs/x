const { getSettings } = require("../settings");
const db = require("../db");
const createX = require("./x");
const createThreads = require("./threads");

const PLATFORM_FACTORIES = { x: createX, threads: createThreads };

function createRouter(userId) {
  const config = getSettings(userId);
  const activeIds = config.activePlatforms || ["x"];
  
  const platformsDb = db.getUserPlatforms(userId);
  const platformsMap = Object.fromEntries(platformsDb.map(p => [p.platform_id, p]));
  
  const active = [];
  const allMap = {};
  
  for (const id of Object.keys(PLATFORM_FACTORIES)) {
    const tokens = platformsMap[id];
    // Global fallback for user 1 to avoid breaking single-tenant setups immediately
    const fallbackTokens = userId === 1 && id === "x" ? {
      access_token: process.env.X_ACCESS_TOKEN,
      refresh_token: process.env.X_ACCESS_SECRET
    } : (userId === 1 && id === "threads" ? {
      username: process.env.THREADS_USER_ID,
      access_token: process.env.THREADS_ACCESS_TOKEN
    } : null);

    const activeTokens = tokens || fallbackTokens;
    if (activeTokens && activeTokens.access_token) {
       allMap[id] = PLATFORM_FACTORIES[id](activeTokens);
    }
  }
  
  for (const id of activeIds) {
    if (allMap[id]) active.push(allMap[id]);
  }
  
  return {
    all: allMap,
    getActive: () => active,
    getMinLimits: () => {
      if (!active.length) return { maxLen: 280, hasThreads: false, hasMentions: false };
      return {
        maxLen: Math.min(...active.map((p) => p.limits.maxLen)),
        hasThreads: active.every((p) => p.limits.hasThreads),
        hasMentions: active.some((p) => p.limits.hasMentions),
      };
    }
  };
}

module.exports = { createRouter };
