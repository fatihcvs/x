// OAuth 2.0 hesap bağlama akışları (X, Threads, Instagram)
const crypto = require("crypto");
const db = require("./db");

const BASE_URL = () => {
  let url = process.env.BASE_URL || "http://localhost:3000";
  return url.endsWith("/") ? url.slice(0, -1) : url;
};

// --- Yardımcı: state parametresini şifreleyerek userId taşıma ---
const STATE_SECRET = () => process.env.SESSION_SECRET || "dev_secret_key_123";

function encodeState(userId, platform) {
  const payload = `${userId}.${platform}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", STATE_SECRET()).update(payload).digest("hex").slice(0, 16);
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

function decodeState(state) {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const parts = decoded.split(".");
    if (parts.length !== 4) return null;
    const [userId, platform, ts, sig] = parts;
    const payload = `${userId}.${platform}.${ts}`;
    const expected = crypto.createHmac("sha256", STATE_SECRET()).update(payload).digest("hex").slice(0, 16);
    if (sig !== expected) return null;
    // 10 dakika zaman aşımı
    if (Date.now() - Number(ts) > 10 * 60 * 1000) return null;
    return { userId: Number(userId), platform };
  } catch {
    return null;
  }
}

// --- PKCE helpers (X OAuth 2.0) ---
const pendingPKCE = new Map(); // state -> code_verifier (geçici, bellekte)

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// =====================================================================
// X (Twitter) OAuth 2.0 PKCE
// =====================================================================
function xAuthUrl(userId) {
  const clientId = process.env.X_CLIENT_ID;
  if (!clientId) return null;

  const { verifier, challenge } = generatePKCE();
  const state = encodeState(userId, "x");
  pendingPKCE.set(state, verifier);

  // 10dk sonra temizle
  setTimeout(() => pendingPKCE.delete(state), 10 * 60 * 1000);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: `${BASE_URL()}/auth/x/callback`,
    scope: "tweet.read tweet.write users.read offline.access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  // X (Twitter) API'si boşlukların "+" yerine "%20" olmasını zorunlu kılar, 
  // "+" olursa sonsuz yönlendirme (ERR_TOO_MANY_REDIRECTS) hatası verir.
  const queryString = params.toString().replace(/\+/g, "%20");

  return `https://twitter.com/i/oauth2/authorize?${queryString}`;
}

async function xCallback(code, state) {
  const decoded = decodeState(state);
  if (!decoded || decoded.platform !== "x") throw new Error("Geçersiz state parametresi");

  const verifier = pendingPKCE.get(state);
  if (!verifier) throw new Error("PKCE doğrulayıcı bulunamadı veya süresi doldu");
  pendingPKCE.delete(state);

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;

  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: `${BASE_URL()}/auth/x/callback`,
    code_verifier: verifier,
  });

  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${authHeader}`,
    },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`X token hatası: ${data.error_description || data.error || "Bilinmeyen hata"}`);
  }

  // Kullanıcı adını al
  let username = "";
  try {
    const meRes = await fetch("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const meData = await meRes.json();
    username = meData.data?.username || "";
  } catch {}

  db.setUserPlatform(
    decoded.userId,
    "x",
    data.access_token,
    data.refresh_token || "",
    username
  );

  return { userId: decoded.userId, username, platform: "x" };
}

// =====================================================================
// Meta OAuth 2.0 (Threads & Instagram)
// =====================================================================
function metaAuthUrl(userId, platform) {
  const appId = process.env.META_APP_ID;
  if (!appId) return null;

  const state = encodeState(userId, platform);

  let scope = "";
  if (platform === "threads") {
    scope = "threads_basic,threads_content_publish,threads_manage_insights";
  } else if (platform === "instagram") {
    scope = "instagram_basic,instagram_content_publish,pages_read_engagement";
  }

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: `${BASE_URL()}/auth/${platform}/callback`,
    scope,
    response_type: "code",
    state,
  });

  const authBase = platform === "threads"
    ? "https://threads.net/oauth/authorize"
    : "https://www.facebook.com/v19.0/dialog/oauth";

  return `${authBase}?${params.toString()}`;
}

async function metaCallback(code, state, platform) {
  const decoded = decodeState(state);
  if (!decoded || decoded.platform !== platform) throw new Error("Geçersiz state parametresi");

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  const tokenUrl = platform === "threads"
    ? "https://graph.threads.net/oauth/access_token"
    : "https://graph.facebook.com/v19.0/oauth/access_token";

  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: `${BASE_URL()}/auth/${platform}/callback`,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`${platform} token hatası: ${data.error?.message || JSON.stringify(data)}`);
  }

  // Kullanıcı bilgisini al
  let userId_platform = "";
  let username = "";
  try {
    if (platform === "threads") {
      const meRes = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${data.access_token}`);
      const meData = await meRes.json();
      userId_platform = meData.id || "";
      username = meData.username || meData.id || "";
    } else {
      // Instagram: Facebook token ile Instagram Business hesabını bul
      const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${data.access_token}`);
      const pagesData = await pagesRes.json();
      const page = (pagesData.data || [])[0];
      if (page) {
        const igRes = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${data.access_token}`);
        const igData = await igRes.json();
        userId_platform = igData.instagram_business_account?.id || "";
        username = userId_platform;
      }
    }
  } catch {}

  db.setUserPlatform(
    decoded.userId,
    platform,
    data.access_token,
    data.refresh_token || "",
    username || userId_platform
  );

  return { userId: decoded.userId, username: username || userId_platform, platform };
}

// =====================================================================
// Express route'larını mount et
// =====================================================================
function mountOAuthRoutes(app, validToken, cookieToken) {
  // Middleware: OAuth başlatmak için giriş yapmış kullanıcı gerekli
  function requireAuth(req, res, next) {
    const userId = validToken(cookieToken(req));
    if (!userId) return res.redirect("/?error=login_required");
    req.userId = userId;
    next();
  }

  // --- X ---
  app.get("/auth/x", requireAuth, (req, res) => {
    const url = xAuthUrl(req.userId);
    if (!url) return res.redirect("/dashboard?error=x_not_configured");
    res.redirect(url);
  });

  app.get("/auth/x/callback", async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) return res.redirect(`/dashboard?error=${encodeURIComponent(error)}`);
      if (!code || !state) return res.redirect("/dashboard?error=missing_params");
      const result = await xCallback(code, state);
      res.redirect(`/dashboard?connected=x&username=${encodeURIComponent(result.username)}`);
    } catch (e) {
      console.error("[oauth/x] Callback hatası:", e.message);
      res.redirect(`/dashboard?error=${encodeURIComponent(e.message)}`);
    }
  });

  // --- DEBUG ENDPOINT ---
  app.get("/auth/debug", requireAuth, (req, res) => {
    const clientId = process.env.X_CLIENT_ID;
    const rawBaseUrl = process.env.BASE_URL;
    const safeBaseUrl = BASE_URL();
    const generatedUrl = xAuthUrl(req.userId);
    
    res.json({
      "1_X_CLIENT_ID_Length": clientId ? clientId.length : 0,
      "2_Raw_ENV_BASE_URL": rawBaseUrl,
      "3_Safe_Parsed_BASE_URL": safeBaseUrl,
      "4_Expected_Callback_In_Twitter_Portal": `${safeBaseUrl}/auth/x/callback`,
      "5_Generated_Twitter_OAuth_URL": generatedUrl
    });
  });

  // --- Threads ---
  app.get("/auth/threads", requireAuth, (req, res) => {
    const url = metaAuthUrl(req.userId, "threads");
    if (!url) return res.redirect("/dashboard?error=meta_not_configured");
    res.redirect(url);
  });

  app.get("/auth/threads/callback", async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) return res.redirect(`/dashboard?error=${encodeURIComponent(error)}`);
      if (!code || !state) return res.redirect("/dashboard?error=missing_params");
      const result = await metaCallback(code, state, "threads");
      res.redirect(`/dashboard?connected=threads&username=${encodeURIComponent(result.username)}`);
    } catch (e) {
      console.error("[oauth/threads] Callback hatası:", e.message);
      res.redirect(`/dashboard?error=${encodeURIComponent(e.message)}`);
    }
  });

  // --- Instagram ---
  app.get("/auth/instagram", requireAuth, (req, res) => {
    const url = metaAuthUrl(req.userId, "instagram");
    if (!url) return res.redirect("/dashboard?error=meta_not_configured");
    res.redirect(url);
  });

  app.get("/auth/instagram/callback", async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) return res.redirect(`/dashboard?error=${encodeURIComponent(error)}`);
      if (!code || !state) return res.redirect("/dashboard?error=missing_params");
      const result = await metaCallback(code, state, "instagram");
      res.redirect(`/dashboard?connected=instagram&username=${encodeURIComponent(result.username)}`);
    } catch (e) {
      console.error("[oauth/instagram] Callback hatası:", e.message);
      res.redirect(`/dashboard?error=${encodeURIComponent(e.message)}`);
    }
  });

  // Bağlantı kaldırma API'si
  app.post("/api/disconnect/:platform", (req, res) => {
    const userId = validToken(cookieToken(req));
    if (!userId) return res.status(401).json({ ok: false });
    const platform = req.params.platform;
    if (!["x", "threads", "instagram"].includes(platform)) {
      return res.status(400).json({ ok: false, error: "Geçersiz platform" });
    }
    db.setUserPlatform(userId, platform, "", "", "");
    res.json({ ok: true });
  });
}

module.exports = { mountOAuthRoutes };
