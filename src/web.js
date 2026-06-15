// Web control panel (Faz 1): stats, recent activity, pending mentions,
// pause/resume, a composer (generate/post tweet·trend·thread) and mention
// approval — all behind a single-password login. Runs inside the bot process,
// enabled only when DASHBOARD_PASSWORD is set.
//
// SECURITY: the panel can post and reply on your behalf, so always run it behind
// HTTPS in production (Railway gives HTTPS; on a bare VPS use a TLS reverse proxy).
const crypto = require("crypto");
const express = require("express");
const config = require("./settings");
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
      activePlatforms: config.activePlatforms || ["x"],
      tweets: { 
        today: db.countToday("tweet"), 
        max: config.maxTweetsPerDay,
        byPlatform: db.countTodayByPlatform("tweet")
      },
      replies: { 
        today: db.countToday("reply"), 
        max: config.maxRepliesPerDay,
        byPlatform: db.countTodayByPlatform("reply")
      },
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

  app.get("/api/settings", (_req, res) => res.json({ ok: true, data: config._getRaw() }));
  app.post("/api/settings", (req, res) => {
    try {
      config._update(req.body || {});
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
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
input,select,textarea{background:#0b0d12;border:1px solid var(--bd);color:var(--fg);border-radius:8px;padding:10px 12px;font-size:15px;font-family:inherit;}
input[type="checkbox"]{width:auto;}
input,textarea{width:100%}select{flex:0 0 auto}
.list{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.item{border:1px solid var(--bd);border-radius:8px;padding:10px 12px}
.item .meta{color:var(--mut);font-size:12px;margin-bottom:4px}.muted{color:var(--mut)}
h2{font-size:13px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em;margin:20px 0 8px}
.hidden{display:none !important}.err{color:var(--danger);font-size:14px;min-height:18px}
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
<button id="settingsBtn" class="ghost">⚙️ Ayarlar</button>
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
</div>

<div id="settingsView" class="hidden">
<div class="row"><h1>⚙️ Ayarlar</h1><span class="sp"></span><button id="closeSettingsBtn" class="ghost">← Geri</button></div>
<p class="muted">Boş bırakılan veya değiştirilmeyen ayarlar <code>config.js</code> içindeki varsayılan değerleri kullanır.</p>
<div class="card list">
  <div style="margin-top:8px;margin-bottom:8px;"><label class="muted">Aktif Platformlar (Eşzamanlı Gönderim)</label>
    <div><label><input id="set_platform_x" type="checkbox" /> X (Twitter)</label></div>
    <div><label><input id="set_platform_threads" type="checkbox" /> Threads</label></div>
  </div>
  <div><label class="muted">Model (örn: claude-sonnet-4-6)</label><br><input id="set_model" /></div>
  <div><label class="muted">Günlük Maksimum Tweet</label><br><input id="set_maxTweetsPerDay" type="number" /></div>
  <div><label class="muted">Günlük Maksimum Cevap</label><br><input id="set_maxRepliesPerDay" type="number" /></div>
  <div><label class="muted">Hesap Hedefi (accountGoal)</label><br><textarea id="set_accountGoal" rows="3"></textarea></div>
  <div><label class="muted">Persona</label><br><textarea id="set_persona" rows="6"></textarea></div>
  
  <div style="margin-top:8px"><label><input id="set_refineTweets" type="checkbox" /> Tweet'leri Cilala (refineTweets)</label></div>
  <div><label><input id="set_trendsEnabled" type="checkbox" /> Trendlere Katıl (trendsEnabled)</label></div>
  <div><label><input id="set_autoReplySafeMentions" type="checkbox" /> Güvenli Mention'lara Oto-Cevap (autoReplySafeMentions)</label></div>
  <div><label><input id="set_learnFromMetrics" type="checkbox" /> Metriklerden Öğren (learnFromMetrics)</label></div>
  
  <div class="row" style="margin-top:16px"><button id="saveSettingsBtn">Kaydet</button><span id="set_msg" class="muted" style="margin-left:10px;"></span></div>
</div>
</div>

</div>
<script>
const $=s=>document.querySelector(s);
const api=(p,o)=>fetch(p,Object.assign({headers:{'Content-Type':'application/json'}},o));
const esc=s=>(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const show=id=>{$('#login').classList.toggle('hidden',id!=='login');$('#dash').classList.toggle('hidden',id!=='dash');$('#settingsView').classList.toggle('hidden',id!=='settings');};
let draft=null;
function renderContent(c){return c.parts?c.parts.map((p,i)=>(i+1)+'. '+esc(p)).join('\\n\\n'):esc(c.text);}

async function load(){
  if(!$('#dash').classList.contains('hidden') || !$('#settingsView').classList.contains('hidden')) {} else return;
  const r=await api('/api/stats');
  if(r.status===401){show('login');return;}
  const s=await r.json();
  if(!$('#dash').classList.contains('hidden')) {
    $('#model').textContent=s.model;
    const formatStats = (d) => {
      let str = d.today + ' / ' + d.max;
      if (d.byPlatform && Object.keys(d.byPlatform).length) {
        str += ' <span style="font-size:12px;color:var(--mut);">(' + Object.entries(d.byPlatform).map(([k,v])=>k+':'+v).join(', ') + ')</span>';
      }
      return str;
    };
    $('#tw').innerHTML=formatStats(s.tweets);
    $('#rp').innerHTML=formatStats(s.replies);
    const st=$('#status');st.textContent=s.paused?'duraklatılmış':'aktif';st.className='badge '+(s.paused?'warn':'ok');
    $('#pauseBtn').disabled=s.paused;$('#resumeBtn').disabled=!s.paused;
    const [pa,ac]=await Promise.all([api('/api/pending').then(x=>x.json()),api('/api/activity').then(x=>x.json())]);
    $('#pending').innerHTML=pa.pending.length?pa.pending.map(p=>'<div class="item"><div class="meta">['+(p.platform==='threads'?'Threads':'X')+'] @'+esc(p.author)+'</div>'+esc(p.mention_text)+'<div class="muted pre" style="margin-top:6px">🤖 '+esc(p.draft)+'</div><div class="row" style="margin-top:8px"><button data-id="'+p.id+'" data-act="approve">✅ Gönder</button><button class="ghost" data-id="'+p.id+'" data-act="reject">❌ Geç</button></div></div>').join(''):'<div class="muted">Bekleyen yok.</div>';
    document.querySelectorAll('#pending button[data-id]').forEach(b=>{b.onclick=()=>act(Number(b.dataset.id),b.dataset.act);});
    $('#activity').innerHTML=ac.posts.length?ac.posts.map(p=>'<div class="item"><div class="meta">['+(p.platform==='threads'?'Threads':'X')+'] '+(p.kind==='tweet'?'📤 tweet':'💬 cevap')+' · '+new Date(p.at).toLocaleString('tr-TR')+'</div>'+esc(p.text)+'</div>').join(''):'<div class="muted">Henüz yok.</div>';
  }
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

let currentSettings = {};
async function loadSettings() {
  const r = await api('/api/settings');
  const j = await r.json();
  if(!j.ok) return;
  const d = j.data.defaults;
  const o = j.data.overrides;
  const get = k => o[k] !== undefined ? o[k] : d[k];
  currentSettings = { defaults: d, overrides: o };
  
  const active = get('activePlatforms') || [];
  $('#set_platform_x').checked = active.includes('x');
  $('#set_platform_threads').checked = active.includes('threads');
  
  $('#set_model').value = get('model') || '';
  $('#set_maxTweetsPerDay').value = get('maxTweetsPerDay') || '';
  $('#set_maxRepliesPerDay').value = get('maxRepliesPerDay') || '';
  $('#set_accountGoal').value = get('accountGoal') || '';
  $('#set_persona').value = get('persona') || '';
  
  $('#set_refineTweets').checked = !!get('refineTweets');
  $('#set_trendsEnabled').checked = !!get('trendsEnabled');
  $('#set_autoReplySafeMentions').checked = !!get('autoReplySafeMentions');
  $('#set_learnFromMetrics').checked = !!get('learnFromMetrics');
}

$('#settingsBtn').onclick = () => { loadSettings(); show('settings'); };
$('#closeSettingsBtn').onclick = () => { load(); show('dash'); };

$('#saveSettingsBtn').onclick = async () => {
  $('#saveSettingsBtn').disabled = true;
  $('#set_msg').textContent = 'Kaydediliyor...';
  const payload = {};
  
  const active = [];
  if ($('#set_platform_x').checked) active.push('x');
  if ($('#set_platform_threads').checked) active.push('threads');
  payload.activePlatforms = JSON.stringify(active) === JSON.stringify(currentSettings.defaults.activePlatforms) ? null : active;
  
  const vStr = (id, k) => { 
    const val = $('#'+id).value; 
    payload[k] = val === currentSettings.defaults[k] ? null : val; 
  };
  const vNum = (id, k) => { 
    const val = Number($('#'+id).value); 
    payload[k] = val === currentSettings.defaults[k] ? null : val; 
  };
  const vBool = (id, k) => { 
    const val = $('#'+id).checked; 
    payload[k] = val === currentSettings.defaults[k] ? null : val; 
  };

  vStr('set_model', 'model');
  vNum('set_maxTweetsPerDay', 'maxTweetsPerDay');
  vNum('set_maxRepliesPerDay', 'maxRepliesPerDay');
  vStr('set_accountGoal', 'accountGoal');
  vStr('set_persona', 'persona');
  
  vBool('set_refineTweets', 'refineTweets');
  vBool('set_trendsEnabled', 'trendsEnabled');
  vBool('set_autoReplySafeMentions', 'autoReplySafeMentions');
  vBool('set_learnFromMetrics', 'learnFromMetrics');
  
  const r = await api('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
  const j = await r.json();
  $('#saveSettingsBtn').disabled = false;
  if (j.ok) {
    $('#set_msg').textContent = 'Kaydedildi! (yeniden başlatma gerektirebilir)';
    setTimeout(() => $('#set_msg').textContent='', 3000);
    loadSettings();
  } else {
    $('#set_msg').textContent = 'Hata: ' + j.error;
  }
};

$('#loginBtn').onclick=async()=>{$('#loginErr').textContent='';const r=await api('/api/login',{method:'POST',body:JSON.stringify({password:$('#pw').value})});if(r.ok){$('#pw').value='';show('dash');load();}else{$('#loginErr').textContent='Hatalı şifre.';}};
$('#pw').addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click();});
$('#pauseBtn').onclick=async()=>{await api('/api/pause',{method:'POST'});load();};
$('#resumeBtn').onclick=async()=>{await api('/api/resume',{method:'POST'});load();};
$('#refreshBtn').onclick=load;
$('#logoutBtn').onclick=async()=>{await api('/api/logout',{method:'POST'});show('login');};

api('/api/stats').then(r=>{if(r.ok){show('dash');load();}else show('login');}).catch(()=>show('login'));
setInterval(()=>{load();},20000);
</script></body></html>`;

module.exports = { start, buildApp };
