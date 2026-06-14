// Web control panel (Faz 1): stats, recent activity, pending mentions,
// pause/resume, a composer (generate/post tweet·trend·thread) and mention
// approval — all behind a single-password login. Runs inside the bot process,
// enabled only when DASHBOARD_PASSWORD is set.
//
// SECURITY: the panel can post and reply on your behalf, so always run it behind
// HTTPS in production (Railway gives HTTPS; on a bare VPS use a TLS reverse proxy).
const crypto = require("crypto");
const express = require("express");
const config = require("../config");
const db = require("./db");
const compose = require("./compose");

const PASSWORD = process.env.DASHBOARD_PASSWORD || "";
const SECRET = crypto.createHash("sha256").update(PASSWORD || "disabled").digest();
const COOKIE = "sid";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün

// --- signed session token (HMAC + expiry) -------------------------------
const sign = (exp) =>
  `${exp}.${crypto.createHmac("sha256", SECRET).update(String(exp)).digest("hex")}`;

function validToken(token) {
  if (!token) return false;
  const [expStr, mac] = token.split(".");
  const exp = Number(expStr);
  if (!exp || Date.now() > exp || !mac) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(expStr).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  } catch {
    return false;
  }
}

function cookieToken(req) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

function passwordOk(input) {
  const a = Buffer.from(input || "");
  const b = Buffer.from(PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const MODES = new Set(["manual", "trend", "thread"]);

function buildApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  app.post("/api/login", (req, res) => {
    if (!PASSWORD || !passwordOk(req.body && req.body.password)) {
      return res.status(401).json({ ok: false, error: "Hatalı şifre" });
    }
    const exp = Date.now() + SESSION_MS;
    const secure = req.headers["x-forwarded-proto"] === "https";
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
        SESSION_MS / 1000
      )}${secure ? "; Secure" : ""}`
    );
    res.json({ ok: true });
  });

  app.post("/api/logout", (req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
    res.json({ ok: true });
  });

  // Auth gate for everything else under /api.
  app.use("/api", (req, res, next) => {
    if (validToken(cookieToken(req))) return next();
    res.status(401).json({ ok: false, error: "Giriş gerekli" });
  });

  app.get("/api/stats", (_req, res) => {
    res.json({
      model: config.model,
      paused: db.getMeta("paused") === "1",
      tweets: { today: db.countToday("tweet"), max: config.maxTweetsPerDay },
      replies: { today: db.countToday("reply"), max: config.maxRepliesPerDay },
    });
  });

  app.get("/api/activity", (_req, res) => res.json({ posts: db.recentPosts(20) }));
  app.get("/api/pending", (_req, res) => res.json({ pending: db.listPending() }));

  app.post("/api/pause", (_req, res) => {
    db.setMeta("paused", "1");
    res.json({ ok: true, paused: true });
  });
  app.post("/api/resume", (_req, res) => {
    db.setMeta("paused", "0");
    res.json({ ok: true, paused: false });
  });

  // Composer: generate a draft (no posting), then post it.
  app.post("/api/generate", async (req, res) => {
    const mode = (req.body && req.body.mode) || "";
    const topic =
      req.body && req.body.topic ? String(req.body.topic).trim() : null;
    if (!MODES.has(mode)) return res.status(400).json({ ok: false, error: "Geçersiz mod" });
    try {
      const content = await compose.generateContent(mode, topic || null);
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
      const count = await compose.postContent(content);
      res.json({ ok: true, count });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // Mention approval: approve | edit | reject.
  app.post("/api/pending/:id", async (req, res) => {
    const id = Number(req.params.id);
    const action = (req.body && req.body.action) || "";
    const pending = db.getPendingById(id);
    if (!pending || pending.status !== "pending") {
      return res.status(404).json({ ok: false, error: "Bulunamadı veya zaten işlenmiş" });
    }
    try {
      if (action === "reject") {
        db.setPendingStatus(id, "skipped");
        return res.json({ ok: true, status: "skipped" });
      }
      if (action === "approve" || action === "edit") {
        const text =
          action === "edit"
            ? String((req.body && req.body.text) || "").slice(0, 280)
            : pending.draft;
        if (!text) return res.status(400).json({ ok: false, error: "Boş cevap" });
        const r = await compose.sendReply(pending, text);
        if (!r.ok) return res.status(400).json({ ok: false, error: r.reason });
        return res.json({ ok: true, status: "sent" });
      }
      res.status(400).json({ ok: false, error: "Geçersiz aksiyon" });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/", (_req, res) => res.type("html").send(PAGE));
  return app;
}

function start() {
  if (!PASSWORD) {
    console.log("[web] panel kapalı (DASHBOARD_PASSWORD tanımlı değil).");
    return null;
  }
  const port = Number(process.env.PORT) || 3000;
  return buildApp().listen(port, () =>
    console.log(`[web] kontrol paneli :${port} (şifre korumalı)`)
  );
}

const PAGE = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Co-pilot Panel</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--bd:#272b36;--fg:#e6e8ee;--mut:#9aa3b2;--acc:#3b82f6;--ok:#22c55e;--warn:#f59e0b;--danger:#ef4444}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
.wrap{max-width:760px;margin:0 auto;padding:20px}h1{font-size:18px;margin:0}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.sp{flex:1}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px 16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}
.stat .n{font-size:26px;font-weight:700}.stat .l{color:var(--mut);font-size:13px}
.badge{padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
.badge.ok{background:rgba(34,197,94,.15);color:var(--ok)}.badge.warn{background:rgba(245,158,11,.15);color:var(--warn)}
button{background:var(--acc);color:#fff;border:0;border-radius:8px;padding:8px 14px;font-size:14px;cursor:pointer}
button.ghost{background:transparent;border:1px solid var(--bd);color:var(--fg)}button:disabled{opacity:.5;cursor:default}
input,select,textarea{background:#0b0d12;border:1px solid var(--bd);color:var(--fg);border-radius:8px;padding:10px 12px;font-size:15px}
input,textarea{width:100%}select{flex:0 0 auto}
.list{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.item{border:1px solid var(--bd);border-radius:8px;padding:10px 12px}
.item .meta{color:var(--mut);font-size:12px;margin-bottom:4px}.muted{color:var(--mut)}
h2{font-size:13px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em;margin:20px 0 8px}
.hidden{display:none}.err{color:var(--danger);font-size:14px;min-height:18px}
.pre{white-space:pre-wrap}
</style></head><body><div class="wrap">
<div id="login" class="card hidden">
<h1>🤖 Co-pilot Panel</h1><p class="muted">Devam etmek için şifre gir.</p>
<div class="row"><input id="pw" type="password" placeholder="Panel şifresi" /></div>
<div class="err" id="loginErr"></div><div class="row"><button id="loginBtn">Giriş</button></div>
</div>
<div id="dash" class="hidden">
<div class="row"><h1>🤖 Co-pilot</h1><span id="status" class="badge ok">aktif</span>
<span class="sp"></span><span class="muted" id="model"></span></div>
<div class="grid">
<div class="card stat"><div class="n" id="tw">–</div><div class="l">Bugün tweet</div></div>
<div class="card stat"><div class="n" id="rp">–</div><div class="l">Bugün cevap</div></div></div>
<div class="row"><button id="pauseBtn" class="ghost">⏸️ Duraklat</button>
<button id="resumeBtn" class="ghost">▶️ Devam</button><span class="sp"></span>
<button id="refreshBtn" class="ghost">↻ Yenile</button><button id="logoutBtn" class="ghost">Çıkış</button></div>

<h2>Yeni içerik</h2>
<div class="card">
<div class="row"><select id="mode">
<option value="manual">Tweet</option><option value="trend">Trend tweet</option><option value="thread">Thread</option>
</select><input id="topic" placeholder="Konu (opsiyonel)" /><button id="genBtn">Üret</button></div>
<div class="err" id="genErr"></div>
<div id="preview" class="hidden">
<div id="previewBody" class="item pre" style="margin-top:10px"></div>
<div class="row" style="margin-top:8px"><button id="sendBtn">✅ Gönder</button>
<button id="regenBtn" class="ghost">🔄 Yeniden</button><button id="cancelBtn" class="ghost">❌ İptal</button></div>
</div></div>

<h2>Bekleyen mention'lar</h2><div id="pending" class="list"></div>
<h2>Son aktivite</h2><div id="activity" class="list"></div>
</div></div>
<script>
const $=s=>document.querySelector(s);
const api=(p,o)=>fetch(p,Object.assign({headers:{'Content-Type':'application/json'}},o));
const esc=s=>(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const show=id=>{$('#login').classList.toggle('hidden',id!=='login');$('#dash').classList.toggle('hidden',id!=='dash');};
let draft=null;
function renderContent(c){return c.parts?c.parts.map((p,i)=>(i+1)+'. '+esc(p)).join('\\n\\n'):esc(c.text);}

async function load(){
  const r=await api('/api/stats');
  if(r.status===401){show('login');return;}
  const s=await r.json();show('dash');
  $('#model').textContent=s.model;
  $('#tw').textContent=s.tweets.today+' / '+s.tweets.max;
  $('#rp').textContent=s.replies.today+' / '+s.replies.max;
  const st=$('#status');st.textContent=s.paused?'duraklatılmış':'aktif';st.className='badge '+(s.paused?'warn':'ok');
  $('#pauseBtn').disabled=s.paused;$('#resumeBtn').disabled=!s.paused;
  const [pa,ac]=await Promise.all([api('/api/pending').then(x=>x.json()),api('/api/activity').then(x=>x.json())]);
  $('#pending').innerHTML=pa.pending.length?pa.pending.map(p=>'<div class="item"><div class="meta">@'+esc(p.author)+'</div>'+esc(p.mention_text)+'<div class="muted pre" style="margin-top:6px">🤖 '+esc(p.draft)+'</div><div class="row" style="margin-top:8px"><button data-id="'+p.id+'" data-act="approve">✅ Gönder</button><button class="ghost" data-id="'+p.id+'" data-act="reject">❌ Geç</button></div></div>').join(''):'<div class="muted">Bekleyen yok.</div>';
  document.querySelectorAll('#pending button[data-id]').forEach(b=>{b.onclick=()=>act(Number(b.dataset.id),b.dataset.act);});
  $('#activity').innerHTML=ac.posts.length?ac.posts.map(p=>'<div class="item"><div class="meta">'+(p.kind==='tweet'?'📤 tweet':'💬 cevap')+' · '+new Date(p.at).toLocaleString('tr-TR')+'</div>'+esc(p.text)+'</div>').join(''):'<div class="muted">Henüz yok.</div>';
}
window.act=async(id,action)=>{const r=await api('/api/pending/'+id,{method:'POST',body:JSON.stringify({action})});const j=await r.json();if(!j.ok)alert(j.error||'Hata');load();};

async function generate(){
  $('#genErr').textContent='';$('#preview').classList.add('hidden');draft=null;
  $('#genBtn').disabled=true;$('#genBtn').textContent='Üretiliyor...';
  try{
    const r=await api('/api/generate',{method:'POST',body:JSON.stringify({mode:$('#mode').value,topic:$('#topic').value})});
    const j=await r.json();
    if(!j.ok){$('#genErr').textContent=j.error||'Üretilemedi.';return;}
    draft=j.content;$('#previewBody').innerHTML=renderContent(draft);$('#preview').classList.remove('hidden');
  }catch(e){$('#genErr').textContent='Hata: '+e.message;}
  finally{$('#genBtn').disabled=false;$('#genBtn').textContent='Üret';}
}
$('#genBtn').onclick=generate;$('#regenBtn').onclick=generate;
$('#cancelBtn').onclick=()=>{$('#preview').classList.add('hidden');draft=null;};
$('#sendBtn').onclick=async()=>{
  if(!draft)return;$('#sendBtn').disabled=true;
  const r=await api('/api/post',{method:'POST',body:JSON.stringify({content:draft})});const j=await r.json();
  $('#sendBtn').disabled=false;
  if(!j.ok){$('#genErr').textContent=j.error||'Gönderilemedi.';return;}
  draft=null;$('#preview').classList.add('hidden');$('#topic').value='';load();
};
$('#loginBtn').onclick=async()=>{$('#loginErr').textContent='';const r=await api('/api/login',{method:'POST',body:JSON.stringify({password:$('#pw').value})});if(r.ok){$('#pw').value='';load();}else{$('#loginErr').textContent='Hatalı şifre.';}};
$('#pw').addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click();});
$('#pauseBtn').onclick=async()=>{await api('/api/pause',{method:'POST'});load();};
$('#resumeBtn').onclick=async()=>{await api('/api/resume',{method:'POST'});load();};
$('#refreshBtn').onclick=load;
$('#logoutBtn').onclick=async()=>{await api('/api/logout',{method:'POST'});show('login');};
load();setInterval(()=>{if(!$('#dash').classList.contains('hidden'))load();},20000);
</script></body></html>`;

module.exports = { start, buildApp };
