const db = require("./db");

const DEFAULT_CONFIG = {
  model: "claude-3-5-sonnet-20241022",
  maxTweetsPerDay: 5,
  maxRepliesPerDay: 10,
  
  accountGoal: "Bu hesap teknoloji, yazılım ve yapay zeka alanında güncel bilgiler paylaşır.",
  persona: "Samimi, öğretici, net.",
  
  referenceInfluencers: [],
  tweetStyles: [],
  
  tweetSchedule: ["0 10 * * *", "0 14 * * *", "0 19 * * *"],
  mentionPollCron: "*/15 * * * *",
  digestCron: "0 22 * * *",
  timezone: "Europe/Istanbul",
  
  activePlatforms: ["x"],
  
  refineTweets: true,
  trendsEnabled: false,
  autoReplySafeMentions: true,
  learnFromMetrics: false,
  
  openAiApiKey: "",
  falApiKey: "",
  autoGenerateMedia: false,
};

function getSettings(userId) {
  if (!userId) throw new Error("userId is required for getSettings");
  
  const rawMeta = db.getAllMeta(userId);
  
  const overrides = {};
  for (const [k, v] of Object.entries(rawMeta)) {
    try {
      overrides[k] = JSON.parse(v);
    } catch {
      overrides[k] = v;
    }
  }

  const settings = { ...DEFAULT_CONFIG, ...overrides };

  if (settings.model === "claude-3-5-sonnet-latest") {
    settings.model = "claude-3-5-sonnet-20241022";
  }

  settings._getRaw = () => ({ defaults: DEFAULT_CONFIG, overrides });
  settings._update = (newObj) => {
    for (const [k, v] of Object.entries(newObj)) {
      if (v === null || v === undefined) {
        db.deleteMeta(userId, k);
      } else {
        const val = typeof v === "object" ? JSON.stringify(v) : String(v);
        db.setMeta(userId, k, val);
      }
    }
  };

  return settings;
}

module.exports = { getSettings };
