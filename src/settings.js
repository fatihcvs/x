const db = require("./db");
const defaults = require("../config");

function loadOverrides(userId) {
  let overrides = {};
  try {
    const raw = db.getMeta(userId, "config_overrides");
    if (raw) overrides = JSON.parse(raw);
  } catch (e) {
    console.error(`[settings] User ${userId} overrides ayrıştırılamadı:`, e.message);
  }
  return overrides;
}

function getSettings(userId) {
  const overrides = loadOverrides(userId);
  const settings = {
    _getRaw() {
      return { defaults, overrides };
    },
    _update(newOverrides) {
      for (const [k, v] of Object.entries(newOverrides)) {
        if (v === null) delete overrides[k];
        else overrides[k] = v;
      }
      db.setMeta(userId, "config_overrides", JSON.stringify(overrides));
    }
  };

  for (const key of Object.keys(defaults)) {
    Object.defineProperty(settings, key, {
      get: () => (overrides[key] !== undefined ? overrides[key] : defaults[key]),
      enumerable: true
    });
  }
  return settings;
}

module.exports = { getSettings };
