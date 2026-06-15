const config = require("../settings");
const x = require("./x");
const threads = require("./threads");

const all = { x, threads };

// Returns the array of platform adapter objects that are currently active
function getActive() {
  const activeIds = config.activePlatforms || ["x"];
  return activeIds.map((id) => all[id]).filter(Boolean);
}

// Calculates the most restrictive limits across all active platforms
// so that a single generated content can be safely posted to all.
function getMinLimits() {
  const active = getActive();
  if (!active.length) {
    return { maxLen: 280, hasThreads: false, hasMentions: false };
  }
  return {
    maxLen: Math.min(...active.map((p) => p.limits.maxLen)),
    hasThreads: active.every((p) => p.limits.hasThreads),
    hasMentions: active.some((p) => p.limits.hasMentions),
  };
}

module.exports = {
  all,
  getActive,
  getMinLimits,
};
