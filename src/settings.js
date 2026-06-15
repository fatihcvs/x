const db = require("./db");
const defaults = require("../config");

let overrides = {};
try {
  const raw = db.getMeta("config_overrides");
  if (raw) overrides = JSON.parse(raw);
} catch (e) {
  console.error("[settings] Overrides ayrıştırılamadı:", e.message);
}

const settings = {
  // UI için mevcut durumu ve varsayılanları döndürür
  _getRaw() {
    return { defaults, overrides };
  },

  // Panelden gelen yeni ayarları kaydeder
  _update(newOverrides) {
    for (const [k, v] of Object.entries(newOverrides)) {
      if (v === null) {
        // null gelirse override iptal edilir (varsayılana döner)
        delete overrides[k];
      } else {
        overrides[k] = v;
      }
    }
    db.setMeta("config_overrides", JSON.stringify(overrides));
  }
};

// config.js içindeki her bir anahtarı getter ile sarmalıyoruz.
// İstendiğinde önce override'a, yoksa varsayılana bakar.
for (const key of Object.keys(defaults)) {
  Object.defineProperty(settings, key, {
    get: () => (overrides[key] !== undefined ? overrides[key] : defaults[key]),
    enumerable: true
  });
}

module.exports = settings;
