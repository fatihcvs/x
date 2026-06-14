// Türkiye trend awareness.
//
// Single, swappable source: to use a different provider, change TRENDS_URL and
// parseTrends() below — nothing else in the app needs to know where trends come
// from. Any network/parse failure returns [] so the bot quietly falls back to
// normal (non-trend) tweets. We never throw from here.
const https = require("https");

// getdaytrends.com publishes the live X/Twitter trend list per country as plain
// server-rendered HTML (no JS needed). No API key required. If it ever breaks,
// swap TRENDS_URL + parseTrends() — the rest of the app is source-agnostic.
const TRENDS_URL = "https://getdaytrends.com/turkey/";
const TIMEOUT_MS = 8000;
const MAX_TRENDS = 20;

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          // A browser-like UA avoids trivial blocks. Ask for plain text so we
          // don't have to deal with gzip in this tiny helper.
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/html",
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          return reject(new Error("HTTP " + res.statusCode));
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(body));
      }
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("timeout")));
  });
}

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'");

// Pull trend titles out of the current-trends table. Defensive: if the markup
// shifts, we just return whatever we can (possibly nothing).
function parseTrends(html) {
  // The first `...trends...` table holds the live list; each row's main cell
  // is <td class="main"><a href="/turkey/trend/...">#trend</a>.
  const table = html.match(
    /<table[^>]*class="[^"]*\btrends\b[^"]*"[^>]*>([\s\S]*?)<\/table>/i
  );
  const block = table ? table[1] : html;

  const out = [];
  const re = /<td[^>]*class="[^"]*\bmain\b[^"]*"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/gi;
  let m;
  while ((m = re.exec(block))) {
    const t = decode(m[1]).trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, MAX_TRENDS);
}

// Current Türkiye trend titles, newest first. Always resolves to string[].
async function getTrends() {
  try {
    const html = await fetchText(TRENDS_URL);
    return parseTrends(html);
  } catch {
    return [];
  }
}

module.exports = { getTrends };
