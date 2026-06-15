const db = require("./db");

const PLANS = {
  free: {
    maxTweetsPerDay: 1,
    maxPlatforms: 1, // Sadece X
    canUseMedia: false,
    canUseTelegram: false
  },
  pro: {
    maxTweetsPerDay: 10,
    maxPlatforms: 2, // X ve Threads
    canUseMedia: false,
    canUseTelegram: true
  },
  premium: {
    maxTweetsPerDay: 50,
    maxPlatforms: 999, // Tüm platformlar
    canUseMedia: true,
    canUseTelegram: true
  }
};

function getUserLimits(userId) {
  const user = db.getUserById(userId);
  if (!user) throw new Error("Kullanıcı bulunamadı");
  
  const planId = user.plan_id || "free";
  return PLANS[planId] || PLANS.free;
}

function checkLimits(userId, config) {
  const limits = getUserLimits(userId);
  
  // Kullanıcının config dosyasındaki sınırları paket limitini aşamaz
  const maxTweets = Math.min(config.maxTweetsPerDay || 1, limits.maxTweetsPerDay);
  
  // Platform kısıtlaması (örneğin free hesapta sadece ilk 1 platform aktif kalır)
  let activePlatforms = config.activePlatforms || ["x"];
  if (activePlatforms.length > limits.maxPlatforms) {
    activePlatforms = activePlatforms.slice(0, limits.maxPlatforms);
  }
  
  return {
    maxTweetsPerDay: maxTweets,
    activePlatforms: activePlatforms,
    canUseMedia: limits.canUseMedia,
    canUseTelegram: limits.canUseTelegram,
    planId: db.getUserById(userId).plan_id
  };
}

module.exports = {
  PLANS,
  getUserLimits,
  checkLimits
};
