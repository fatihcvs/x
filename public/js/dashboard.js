const $=s=>document.querySelector(s);
const api=(p,o)=>fetch(p,Object.assign({headers:{'Content-Type':'application/json'}},o));
const esc=s=>(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const show=id=>{
  $('#auth').classList.toggle('hidden',id!=='auth');
  $('#dash').classList.toggle('hidden',id!=='dash');
  $('#settingsView').classList.toggle('hidden',id!=='settings');
  $('#adminView').classList.toggle('hidden',id!=='admin');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  if (id === 'dash') document.querySelector('.nav-item[onclick="show(\\\'dash\\\')"]')?.classList.add('active');
  if (id === 'settings') document.getElementById('settingsBtn')?.classList.add('active');
  if (id === 'admin') document.getElementById('adminLink')?.classList.add('active');
};
let draft=null;
function renderContent(c){
  let html = c.parts?c.parts.map((p,i)=>(i+1)+'. '+esc(p)).join('\\n\\n'):esc(c.text);
  if (c.mediaUrl) html += '<br><br><img src="'+esc(c.mediaUrl)+'" style="max-width:100%; border-radius:8px;" />';
  return html;
}

async function load(){
  if(!$('#dash').classList.contains('hidden') || !$('#settingsView').classList.contains('hidden')) {} else return;
  const r=await api('/api/stats');
  if(r.status===401){show('auth');return;}
  const s=await r.json();
  if(!$('#dash').classList.contains('hidden')) {
    $('#model').textContent=s.model + ' (' + s.plan.toUpperCase() + ')';
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
    
    // UI limits based on subscription
    const imgBtn = document.getElementById('btnImg');
    if (imgBtn) {
      if (!s.canUseMedia) {
        imgBtn.disabled = true;
        imgBtn.title = "Görsel üretimi Premium pakete özeldir.";
      } else {
        imgBtn.disabled = false;
        imgBtn.title = "";
      }
    }

    if (s.role === 'admin' && !document.getElementById('adminPanelBtn')) {
      const btn = document.createElement('button');
      btn.id = 'adminPanelBtn';
      btn.className = 'ghost';
      btn.textContent = '👑 Admin Paneli';
      btn.onclick = () => { loadAdmin(); show('admin'); };
      $('#resumeBtn').parentNode.insertBefore(btn, $('#settingsBtn'));
    }

    const [pa,ac]=await Promise.all([api('/api/pending').then(x=>x.json()),api('/api/activity').then(x=>x.json())]);
    $('#pending').innerHTML=pa.pending.length?pa.pending.map(p=>'<div class="item"><div class="meta">['+(p.platform||'X')+'] @'+esc(p.author)+'</div>'+esc(p.mention_text)+'<div class="muted pre" style="margin-top:6px">🤖 '+esc(p.draft)+'</div><div class="row" style="margin-top:8px"><button data-id="'+p.id+'" data-act="approve">✅ Gönder</button><button class="ghost" data-id="'+p.id+'" data-act="reject">❌ Geç</button></div></div>').join(''):'<div class="muted">Bekleyen yok.</div>';
    document.querySelectorAll('#pending button[data-id]').forEach(b=>{b.onclick=()=>act(Number(b.dataset.id),b.dataset.act);});
    $('#activity').innerHTML=ac.posts.length?ac.posts.map(p=>'<div class="item"><div class="meta">['+(p.platform||'X')+'] '+(p.kind==='tweet'?'📤 gönderi':'💬 cevap')+' · '+new Date(p.at).toLocaleString('tr-TR')+'</div>'+esc(p.text)+'</div>').join(''):'<div class="muted">Henüz yok.</div>';
  }
}
window.act=async(id,action)=>{const r=await api('/api/pending/'+id,{method:'POST',body:JSON.stringify({action})});const j=await r.json();if(!j.ok)alert(j.error||'Hata');load();};

async function generate(withMedia=false){
  $('#genErr').textContent='';$('#preview').classList.add('hidden');draft=null;
  $('#genBtn').disabled=true;$('#genBtn').textContent='Üretiliyor...';
  try{
    const r=await api('/api/generate',{method:'POST',body:JSON.stringify({mode:$('#mode').value,topic:$('#topic').value,withMedia})});
    const j=await r.json();
    if(!j.ok){$('#genErr').textContent=j.error||'Üretilemedi.';return;}
    draft=j.content;$('#previewBody').innerHTML=renderContent(draft);$('#preview').classList.remove('hidden');
  }catch(e){$('#genErr').textContent='Hata: '+e.message;}
  finally{$('#genBtn').disabled=false;$('#genBtn').textContent='Üret';}
}
$('#genBtn').onclick=()=>generate(false);
const btnImg = document.createElement('button');
btnImg.id = 'btnImg';
btnImg.textContent = '🖼️ Görselli Üret';
btnImg.style.marginLeft = '8px';
btnImg.onclick = () => generate(true);
$('#genBtn').parentNode.appendChild(btnImg);
$('#regenBtn').onclick=()=>generate(!!(draft && draft.mediaUrl));
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
  $('#set_platform_instagram').checked = active.includes('instagram');
  
  $('#set_model').value = get('model') || '';
  $('#set_maxTweetsPerDay').value = get('maxTweetsPerDay') || '';
  $('#set_maxRepliesPerDay').value = get('maxRepliesPerDay') || '';
  $('#set_accountGoal').value = get('accountGoal') || '';
  $('#set_persona').value = get('persona') || '';
  $('#set_tg_chat').value = get('telegramChatId') || '';
  $('#set_openai_key').value = get('openAiApiKey') || '';
  
  $('#set_autoGenerateMedia').checked = !!get('autoGenerateMedia');
  $('#set_refineTweets').checked = !!get('refineTweets');
  $('#set_trendsEnabled').checked = !!get('trendsEnabled');
  $('#set_autoReplySafeMentions').checked = !!get('autoReplySafeMentions');
  
  const x = j.platforms.x || {};
  const t = j.platforms.threads || {};
  const ig = j.platforms.instagram || {};
  $('#set_x_token').value = x.access_token || '';
  $('#set_x_secret').value = x.refresh_token || '';
  $('#set_threads_user').value = t.username || '';
  $('#set_threads_token').value = t.access_token || '';
  $('#set_instagram_user').value = ig.username || '';
  $('#set_instagram_token').value = ig.access_token || '';
}

$('#settingsBtn').onclick = () => { loadSettings(); show('settings'); };
$('#closeSettingsBtn').onclick = () => { load(); show('dash'); };
$('#closeAdminBtn').onclick = () => { load(); show('dash'); };

async function loadAdmin() {
  const r = await api('/api/admin/users');
  const j = await r.json();
  if (!j.ok) return alert(j.error);
  const tb = $('#adminUsersTable tbody');
  tb.innerHTML = j.users.map(u => 
    '<tr style="border-bottom:1px solid var(--bd);"><td style="padding:8px">'+u.id+'</td>'+
    '<td style="padding:8px">'+esc(u.email)+'</td>'+
    '<td style="padding:8px"><span class="badge '+(u.role==='admin'?'warn':'ok')+'">'+u.role+'</span></td>'+
    '<td style="padding:8px">'+u.tweetsToday+'</td>'+
    '<td style="padding:8px">'+
      '<select id="plan_'+u.id+'">'+
        '<option value="free" '+(u.plan==='free'?'selected':'')+'>Free</option>'+
        '<option value="pro" '+(u.plan==='pro'?'selected':'')+'>Pro</option>'+
        '<option value="premium" '+(u.plan==='premium'?'selected':'')+'>Premium</option>'+
      '</select>'+
    '</td>'+
    '<td style="padding:8px"><button onclick="updatePlan('+u.id+')">Ayarla</button></td></tr>'
  ).join('');
}

window.updatePlan = async (id) => {
  const plan = $('#plan_'+id).value;
  const r = await api('/api/admin/users/'+id+'/plan', { method: 'POST', body: JSON.stringify({ plan }) });
  const j = await r.json();
  if (j.ok) alert('Kullanıcı planı güncellendi: ' + plan.toUpperCase());
  else alert('Hata: ' + j.error);
};

$('#saveSettingsBtn').onclick = async () => {
  $('#saveSettingsBtn').disabled = true;
  $('#set_msg').textContent = 'Kaydediliyor...';
  const cPayload = {};
  
  const active = [];
  if ($('#set_platform_x').checked) active.push('x');
  if ($('#set_platform_threads').checked) active.push('threads');
  if ($('#set_platform_instagram').checked) active.push('instagram');
  cPayload.activePlatforms = JSON.stringify(active) === JSON.stringify(currentSettings.defaults.activePlatforms) ? null : active;
  
  const vStr = (id, k) => { 
    const val = $('#'+id).value; 
    cPayload[k] = val === currentSettings.defaults[k] ? null : val; 
  };
  const vNum = (id, k) => { 
    const val = Number($('#'+id).value); 
    cPayload[k] = val === currentSettings.defaults[k] ? null : val; 
  };
  const vBool = (id, k) => { 
    const val = $('#'+id).checked; 
    cPayload[k] = val === currentSettings.defaults[k] ? null : val; 
  };

  vStr('set_model', 'model');
  vNum('set_maxTweetsPerDay', 'maxTweetsPerDay');
  vNum('set_maxRepliesPerDay', 'maxRepliesPerDay');
  vStr('set_accountGoal', 'accountGoal');
  vStr('set_persona', 'persona');
  vStr('set_tg_chat', 'telegramChatId');
  vStr('set_openai_key', 'openAiApiKey');
  vBool('set_autoGenerateMedia', 'autoGenerateMedia');
  vBool('set_refineTweets', 'refineTweets');
  vBool('set_trendsEnabled', 'trendsEnabled');
  vBool('set_autoReplySafeMentions', 'autoReplySafeMentions');
  
  const payload = {
    config: cPayload,
    platforms: {
      x: {
        access_token: $('#set_x_token').value,
        refresh_token: $('#set_x_secret').value
      },
      threads: {
        username: $('#set_threads_user').value,
        access_token: $('#set_threads_token').value
      },
      instagram: {
        username: $('#set_instagram_user').value,
        access_token: $('#set_instagram_token').value
      }
    }
  };
  
  const r = await api('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
  const j = await r.json();
  $('#saveSettingsBtn').disabled = false;
  if (j.ok) {
    $('#set_msg').textContent = 'Kaydedildi!';
    setTimeout(() => $('#set_msg').textContent='', 3000);
    loadSettings();
  } else {
    $('#set_msg').textContent = 'Hata: ' + j.error;
  }
};

const handleAuth=async(endpoint)=>{
  $('#authErr').textContent='';
  const email=$('#auth_email').value;
  const pw=$('#auth_pw').value;
  if(!email || !pw) return $('#authErr').textContent='Lütfen bilgileri doldurun.';
  const r=await api(endpoint,{method:'POST',body:JSON.stringify({email,password:pw})});
  if(r.ok){$('#auth_pw').value='';show('dash');load();}
  else{const j=await r.json();$('#authErr').textContent=j.error||'Bir hata oluştu.';}
};
$('#loginBtn').onclick=()=>handleAuth('/api/login');
$('#registerBtn').onclick=()=>handleAuth('/api/register');
$('#auth_pw').addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click();});

$('#pauseBtn').onclick=async()=>{await api('/api/pause',{method:'POST'});load();};
$('#resumeBtn').onclick=async()=>{await api('/api/resume',{method:'POST'});load();};
$('#refreshBtn').onclick=load;
$('#logoutBtn').onclick=async()=>{await api('/api/logout',{method:'POST'});show('auth');};

api('/api/stats').then(r=>{if(r.ok){show('dash');load();}else show('auth');}).catch(()=>show('auth'));
setInterval(()=>{load();},20000);