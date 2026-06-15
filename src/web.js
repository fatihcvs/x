const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { getSettings } = require("./settings");
const db = require("./db");
const compose = require("./compose");

const SECRET = process.env.SESSION_SECRET || "dev_secret_key_123";
const COOKIE = "sid";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

const sign = (userId, exp) =>
  `${userId}.${exp}.${crypto.createHmac("sha256", SECRET).update(`${userId}.${exp}`).digest("hex")}`;

function validToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const userId = Number(parts[0]);
  const expStr = parts[1];
  const mac = parts[2];
  const exp = Number(expStr);
  if (!userId || !exp || Date.now() > exp || !mac) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(`${userId}.${expStr}`).digest("hex");
  try {
    if (crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
      return userId;
    }
  } catch {}
  return null;
}

function cookieToken(req) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

const MODES = new Set(["manual", "trend", "thread"]);

function buildApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "../public")));

  app.post("/api/login", (req, res) => {
    const { email, password } = req.body || {};
    const u = db.getUser(email);
    if (!u) return res.status(401).json({ ok: false, error: "Kullanıcı bulunamadı" });
    const hash = crypto.createHash("sha256").update(password || "").digest("hex");
    if (u.password_hash !== hash) return res.status(401).json({ ok: false, error: "Hatalı şifre" });
    
    const exp = Date.now() + SESSION_MS;
    const secure = req.headers["x-forwarded-proto"] === "https";
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${sign(u.id, exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
        SESSION_MS / 1000
      )}${secure ? "; Secure" : ""}`
    );
    res.json({ ok: true });
  });

  app.post("/api/register", (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password || password.length < 5) {
      return res.status(400).json({ok: false, error: "Geçersiz e-posta veya kısa şifre"});
    }
    if (db.getUser(email)) return res.status(400).json({ok: false, error: "Bu e-posta zaten kullanımda"});
    
    const hash = crypto.createHash("sha256").update(password).digest("hex");
    const newId = db.createUser(email, hash);
    const exp = Date.now() + SESSION_MS;
    const secure = req.headers["x-forwarded-proto"] === "https";
    
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${sign(newId, exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
        SESSION_MS / 1000
      )}${secure ? "; Secure" : ""}`
    );
    
    const scheduler = require("./scheduler");
    scheduler.startUser(newId);
    
    res.json({ ok: true });
  });

  app.post("/api/logout", (req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
    res.json({ ok: true });
  });

  app.use("/api", (req, res, next) => {
    const userId = validToken(cookieToken(req));
    if (userId) {
      req.userId = userId;
      return next();
    }
    res.status(401).json({ ok: false, error: "Giriş gerekli" });
  });

  app.get("/api/stats", (req, res) => {
    const config = getSettings(req.userId);
    const subscription = require("./subscription");
    const sub = subscription.checkLimits(req.userId, config);
    res.json({
      model: config.model,
      paused: db.getMeta(req.userId, "paused") === "1",
      activePlatforms: sub.activePlatforms,
      role: db.getUserById(req.userId).role,
      plan: sub.planId,
      canUseMedia: sub.canUseMedia,
      tweets: { 
        today: db.countToday(req.userId, "tweet"), 
        max: sub.maxTweetsPerDay,
        byPlatform: db.countTodayByPlatform(req.userId, "tweet")
      },
      replies: { 
        today: db.countToday(req.userId, "reply"), 
        max: config.maxRepliesPerDay,
        byPlatform: db.countTodayByPlatform(req.userId, "reply")
      },
    });
  });

  app.get("/api/activity", (req, res) => res.json({ posts: db.recentPosts(req.userId, 20) }));
  app.get("/api/pending", (req, res) => res.json({ pending: db.listPending(req.userId) }));

  app.post("/api/pause", (req, res) => {
    db.setMeta(req.userId, "paused", "1");
    res.json({ ok: true, paused: true });
  });
  app.post("/api/resume", (req, res) => {
    db.setMeta(req.userId, "paused", "0");
    res.json({ ok: true, paused: false });
  });

  app.get("/api/settings", (req, res) => {
    const config = getSettings(req.userId);
    const platformsDb = db.getUserPlatforms(req.userId);
    const pm = Object.fromEntries(platformsDb.map(p => [p.platform_id, p]));
    res.json({ ok: true, data: config._getRaw(), platforms: { x: pm.x || {}, threads: pm.threads || {}, instagram: pm.instagram || {} } });
  });

  app.post("/api/settings", (req, res) => {
    try {
      const config = getSettings(req.userId);
      config._update((req.body && req.body.config) || {});
      const p = (req.body && req.body.platforms) || {};
      
      if (p.x && (p.x.access_token || p.x.refresh_token)) {
        db.setUserPlatform(req.userId, "x", p.x.access_token || "", p.x.refresh_token || "", p.x.username || "");
      }
      if (p.threads && (p.threads.access_token || p.threads.username)) {
        db.setUserPlatform(req.userId, "threads", p.threads.access_token || "", p.threads.refresh_token || "", p.threads.username || "");
      }
      if (p.instagram && (p.instagram.access_token || p.instagram.username)) {
        db.setUserPlatform(req.userId, "instagram", p.instagram.access_token || "", p.instagram.refresh_token || "", p.instagram.username || "");
      }
      
      const scheduler = require("./scheduler");
      scheduler.startUser(req.userId);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/generate", async (req, res) => {
    const mode = (req.body && req.body.mode) || "";
    const topic = req.body && req.body.topic ? String(req.body.topic).trim() : null;
    const withMedia = req.body && req.body.withMedia;
    
    if (withMedia) {
      const sub = require("./subscription").checkLimits(req.userId, getSettings(req.userId));
      if (!sub.canUseMedia) {
        return res.status(403).json({ ok: false, error: "Görsel üretimi Premium pakete özeldir." });
      }
    }
    
    if (!MODES.has(mode)) return res.status(400).json({ ok: false, error: "Geçersiz mod" });
    try {
      const content = withMedia 
        ? await compose.generateContentWithMedia(req.userId, mode, topic || null)
        : await compose.generateContent(req.userId, mode, topic || null);
      if (!content) {
        return res.json({
          ok: false,
          error: mode === "trend" ? "Uygun/güvenli trend bulunamadı." : "Üretilemedi.",
        });
      }
      res.json({ ok: true, content });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/post", async (req, res) => {
    const content = req.body && req.body.content;
    if (!content || (!content.text && !Array.isArray(content.parts))) {
      return res.status(400).json({ ok: false, error: "İçerik yok" });
    }
    try {
      const count = await compose.postContent(req.userId, content);
      res.json({ ok: true, count });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/pending/:id", async (req, res) => {
    const id = Number(req.params.id);
    const action = (req.body && req.body.action) || "";
    const pending = db.getPendingById(req.userId, id);
    if (!pending || pending.status !== "pending") {
      return res.status(404).json({ ok: false, error: "Bulunamadı veya zaten işlenmiş" });
    }
    try {
      if (action === "reject") {
        db.setPendingStatus(req.userId, id, "skipped");
        return res.json({ ok: true, status: "skipped" });
      }
      if (action === "approve" || action === "edit") {
        const text =
          action === "edit"
            ? String((req.body && req.body.text) || "").slice(0, 280)
            : pending.draft;
        if (!text) return res.status(400).json({ ok: false, error: "Boş cevap" });
        const r = await compose.sendReply(req.userId, pending, text);
        if (!r.ok) return res.status(400).json({ ok: false, error: r.reason });
        return res.json({ ok: true, status: "sent" });
      }
      res.status(400).json({ ok: false, error: "Geçersiz aksiyon" });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // ADMIN ROUTES
  app.get("/api/admin/users", (req, res) => {
    const u = db.getUserById(req.userId);
    if (!u || u.role !== "admin") return res.status(403).json({ ok: false, error: "Yetkisiz erişim" });
    const users = db.getAllUsersDetails().map(user => {
      const sub = require("./subscription").getUserLimits(user.id);
      return {
        id: user.id, email: user.email, role: user.role, plan: user.plan_id,
        createdAt: user.created_at,
        tweetsToday: db.countToday(user.id, "tweet")
      };
    });
    res.json({ ok: true, users });
  });

  app.post("/api/admin/users/:id/plan", (req, res) => {
    const u = db.getUserById(req.userId);
    if (!u || u.role !== "admin") return res.status(403).json({ ok: false, error: "Yetkisiz erişim" });
    const targetId = Number(req.params.id);
    const newPlan = req.body && req.body.plan;
    if (!["free", "pro", "premium"].includes(newPlan)) return res.status(400).json({ ok: false, error: "Geçersiz paket" });
    
    db.updateUserPlan(targetId, newPlan);
    res.json({ ok: true });
  });

  app.get("/dashboard", (req, res) => {
    const userId = validToken(cookieToken(req));
    if (!userId) return res.redirect("/");
    res.sendFile(path.join(__dirname, "../public/dashboard.html"));
  });

  app.get("/", (req, res) => {
    const userId = validToken(cookieToken(req));
    if (userId) return res.redirect("/dashboard");
    res.sendFile(path.join(__dirname, "../public/index.html"));
  });

  return app;
}

function start() {
  const port = Number(process.env.PORT) || 3000;
  return buildApp().listen(port, () =>
    console.log(`[web] kontrol paneli :${port} (Çoklu-Kullanıcı SaaS)`)
  );
}

module.exports = { start };
