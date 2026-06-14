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

// --- News context (why is something trending?) -----------------------
// We enrich the top trends with recent Türkiye news headlines from Google
// News RSS (free, no key) so the model can actually understand a trend
// instead of guessing from the bare title.
const CONTEXT_COUNT = 8; // how many top trends to enrich
const HEADLINES_PER_TREND = 4;

const newsRssUrl = (term) =>
  "https://news.google.com/rss/search?q=" +
  encodeURIComponent(term.replace(/^#/, "")) +
  "&hl=tr&gl=TR&ceid=TR:tr";

// Recent headline strings for a query, or [] on any failure.
function parseHeadlines(xml) {
  const out = [];
  const items = xml.split(/<item>/i).slice(1); // drop the channel header
  for (const it of items) {
    const m = it.match(/<title>([\s\S]*?)<\/title>/i);
    if (!m) continue;
    let t = decode(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")).trim();
    t = t.replace(/\s+-\s+[^-]+$/, "").trim(); // strip trailing " - Source"
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= HEADLINES_PER_TREND) break;
  }
  return out;
}

async function getTrendContext(term) {
  try {
    return parseHeadlines(await fetchText(newsRssUrl(term)));
  } catch {
    return [];
  }
}

// Top trends paired with their news context: [{ title, context: string[] }].
// Always resolves (empty array if the trend source is down).
async function getEnrichedTrends() {
  const titles = await getTrends();
  if (!titles.length) return [];
  const top = titles.slice(0, CONTEXT_COUNT);
  const contexts = await Promise.all(top.map(getTrendContext));
  return top.map((title, i) => ({ title, context: contexts[i] }));
}

module.exports = { getTrends, getTrendContext, getEnrichedTrends };
