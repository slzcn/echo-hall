const SB_URL  = 'https://cddkniwbhvcbfgkgomtl.supabase.co';
// 私密房可召唤灵魂白名单(前端骨架直接显示用, 与后端 eh-admin-api SUMMONABLE 保持同步)
const EH_SUMMONABLES_FALLBACK = [
  { key:'wolf', emoji:'🐺', name:'狼姐', blurb:'私密房里会放开撩' },
  { key:'comedian', emoji:'🎭', name:'老K', blurb:'私密房的毒舌段子手' },
];
const WOLF_UID = 'ca72217f-7157-47f6-b540-049074bf06dd';   // 狼姐原始 uid(官方房)
// 狼姐视觉特判: 原始 uid 或 名字为'狼姐'(私密房召唤来的是新独立 uid, 按名字认)
function isWolfSoul(o){ return o && (o.user_id===WOLF_UID || o.name==='狼姐'); }
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkZGtuaXdiaHZjYmZna2dvbXRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NDc2MTMsImV4cCI6MjA5ODAyMzYxM30.1DaEJe4n91CZ0NcXKvyvPVUobPfc8QCePP3EG1aGpnY';
// supabase 库改 <script defer>(111KB,不阻塞首帧渲染)→ 主脚本解析期它还没执行,
// 故 sb 延迟创建: 先占位 null, 库就绪后 bootSupabase() 里 createClient + 挂 auth 引导。
// 全站函数体内用 sb 都是"调用时"(那时早已就绪), 只有 createClient/onAuthStateChange/
// getSession 这 3 处是解析期立即执行, 全收进 bootSupabase。
let sb = null;
const EH_AUTH_FN = SB_URL + '/functions/v1/eh-auth';
async function authApi(path, body){
  const r = await fetch(EH_AUTH_FN+path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  return { ok:r.ok, status:r.status, body: await r.json().catch(()=>({})) };
}

const $ = s => document.querySelector(s);

  // TOP10 #3: 生产日志静默,仅 ?debug=1 时输出
  // OPTD 批D: 加轻量 ring buffer(上限200条), 无论 ?debug=1 都静默记录, 供出问题现场 dump
  const _EH_DBG = /[?&]debug=1(&|$)/.test(location.search);
  window.__EH_LOG = window.__EH_LOG || [];
  const _EH_LOG_MAX = 200;
  function _ehDbg(){
    try{
      const args = Array.prototype.slice.call(arguments);
      // ring buffer: 无论 debug 与否都记录, 供出问题现场 dump
      try{
        window.__EH_LOG.push({ t: Date.now(), args: args.map(a=>{
          try{ if(a===null||a===undefined) return String(a);
               if(typeof a==='string') return a.slice(0,300);
               if(typeof a==='number'||typeof a==='boolean') return a;
               return JSON.stringify(a).slice(0,300);
          }catch(_){ return String(a).slice(0,300); }
        })});
        if(window.__EH_LOG.length > _EH_LOG_MAX) window.__EH_LOG.splice(0, window.__EH_LOG.length - _EH_LOG_MAX);
      }catch(_){}
      if(_EH_DBG){ try{ console.log.apply(console, args); }catch(_){} }
    }catch(_){}
  }
  window._ehDbg = _ehDbg;
  // ?debug=1 或出问题现场都可 window.ehDumpLog() 拿到全部日志
  window.ehDumpLog = function(){
    try{
      const rows = (window.__EH_LOG||[]).map(r=>({
        time: new Date(r.t).toISOString(),
        args: r.args
      }));
      if(_EH_DBG){ try{ console.table(rows.slice(-50)); }catch(_){ console.log(rows); } }
      return rows;
    }catch(e){ return []; }
  };
  // TOP10 日志合表: 前端 5 类行为埋点（scope=user）
  // 后端 admin 侧的 scope=admin 由 Edge Function 用 service_role 写入
  window.ehLog = function(tag, payload){
    try{
      if(!sb) return; // 未 boot 前静默
      const body = {
        scope: 'user',
        tag: tag,
        actor_id: (typeof myUid!=='undefined' && myUid) ? myUid : null,
        actor_name: (typeof me!=='undefined' && me && me.name) ? me.name : null,
        room_id: (payload && payload.room_id) ? payload.room_id : ((typeof curRoom!=='undefined' && curRoom) ? curRoom.id : null),
        room_name: (payload && (payload.room_name || payload.name)) ? (payload.room_name || payload.name) : ((typeof curRoom!=='undefined' && curRoom) ? curRoom.name : null),
        payload: payload || {},
        ua: navigator.userAgent.slice(0,200)
      };
      // fire-and-forget, RLS 拒绝也不阻塞主流程
      sb.from('eh_logs').insert(body).then(({error})=>{
        if(error) _ehDbg('[ehLog fail]', tag, error.message);
      });
    }catch(e){ _ehDbg('[ehLog error]', tag, e); }
  };
const esc = s => (s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    // 安全过滤：颜色只允许 #hex，非法则回退默认色；emoji 截断+转义防注入
    const safeColor = (c,def='#B57EDC') => (typeof c==='string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) ? c : def;
    const safeEmoji = (e) => esc((e||'').slice(0,8));
    // 头像内 emoji 渲染: 🕳️ 黑洞字形自带偏下(主体压下半、上方留白多),头像里看着往下沉,
    // 给它单独上移 2px 校正; 其他 emoji 字形居中, 原样输出。
    // 部分 emoji 字形锚点偏下(🕳️黑洞/🌙月亮), 在头像框里看着下沉 → 各自上移校正; 其它 emoji 原样
    const avEmoji = (e) => {
      if(!e) return e;
      if(e.indexOf('🕳')>-1) return `<span style="display:inline-block;transform:translateY(-4px)">${e}</span>`;
      if(e.indexOf('🌙')>-1) return `<span style="display:inline-block;transform:translateY(-2px)">${e}</span>`;
      return e;
    };
const rand = arr => arr[Math.floor(Math.random()*arr.length)];
// 触屏设备(移动端): 用于跳过一些桌面向的高频特效(打字流光/光标拖尾等), 省低端机主线程
const _coarsePointer = !!(window.matchMedia && matchMedia('(hover:none)').matches);

// ---- 身份 ----
const ADJ = EH_CONFIG.identityPool.adjectives;
const ANI = EH_CONFIG.identityPool.animals;
const EMO = ['🦦','🦊','🐦‍⬛','🪼','🐺','🐋','🦉','🦇','🐙','🦌','🐧','🐈‍⬛','🐬','🐯','🦔','🦋'];
// 手动选头像用全量(正式账号自由表达, 与名字无关); 随机生成只用上面 16 个对齐词表
const EMO_ALL = ['🦊','🐺','🐋','🦉','🪼','🐙','🦌','🐝','🐆','🦔','🐬','🦇','🦋','🦭','🐈‍⬛','🦅','👑','🐼','🐱','🦁','🐯','🐰','🐸','🐵','🦄','🐲','🦖','🦦','🦩','🦚'];
// 真人随机身份色: 与新十主题 accent 对齐(cyber/vapor/aurora/mono/klein/coral/lagoon/dusk/rose/sunset)
const COLORS = ["#00E5D4","#C77DFF","#22FF95","#F5D06A","#6486FF","#FF6F52","#12B0E0","#8FA6E8","#E29AAE","#FF3D92"]; // 十主题色
const LS_ID = 'eh_identity_v2';

let me = null;      // {id(uid), name, emoji, color}
let myUid = null;

function loadOrRollIdentity(){
  try{ const s=localStorage.getItem(LS_ID); if(s){ me=JSON.parse(s); if(reconcileEmoji()){ saveIdentity(); } return; } }catch(e){}
  rollIdentity();
}
function rollIdentity(){
  const ai = Math.floor(Math.random()*ANI.length); // 同一下标决定动物名+emoji, 防错位
  me = { id: me?.id||null, name: rand(ADJ)+ANI[ai], emoji: EMO[ai], color: rand(COLORS) };
  saveIdentity(); paintIdentity();
}
// 已存身份的 emoji 与名字末尾动物不匹配时, 用名字推导正确 emoji(修老用户脏数据)
function reconcileEmoji(){
  if(!me || !me.name || !me.emoji) return false;
  if(me.registered) return false; // 正式账号形象为自主选择, 不自动纠正
  for(let i=0;i<ANI.length;i++){
    if(me.name.endsWith(ANI[i])){
      if(me.emoji !== EMO[i]){ me.emoji = EMO[i]; return true; }
      return false;
    }
  }
  return false;
}
function saveIdentity(){ try{ localStorage.setItem(LS_ID, JSON.stringify(me)); }catch(e){} }
function paintIdentity(){
  const av=$('#idAv'); if(!av) return;
  av.textContent=me.emoji; av.style.background=me.color+'22';
  av.style.boxShadow=`0 0 24px ${safeColor(me.color)}55, inset 0 0 0 1.5px ${safeColor(me.color)}`; av.style.color=me.color;
  av.style.transform='scale(1.12) rotate(-6deg)'; setTimeout(()=>av.style.transform='scale(1) rotate(0)',60);
  $('#idName').textContent=me.name; $('#idName').style.color=me.color;
  const mb=$('#meBtn'); if(mb){ mb.textContent=me.emoji; mb.style.color=me.color; }
  const mbh=$('#meBtnHall'); if(mbh){ mbh.textContent=me.emoji; mbh.style.color=me.color; }
  // 正式账号 vs 临时身份: 更新标签 + 主按钮文案 + 换一个按钮(临时才可换)
  // ★ 多重判据: registered 字段可能因旧版本或异常保存而缺失,
  //   同时看 username/email(正式账号特有字段)作为兼容判据, 避免“已登录却显示临时身份”。
  const isRegistered = !!(me && (me.registered || me.username || me.email));
  const tag=$('#idTag'), rr=$('#rerollBtn'), eb=$('#enterBtn');
  if(isRegistered){
    if(!me.registered){ me.registered=true; try{saveIdentity();}catch(e){} }   // 兼容修复: 回写标志到 localStorage,避免下次再错
    if(tag) tag.textContent='正式用户 · 已登录'; if(rr) rr.style.display='none'; if(eb) eb.textContent='进 入';
  }
  else { if(tag) tag.textContent='临时用户 · 无需注册'; if(rr) rr.style.display=''; if(eb) eb.textContent='匿 名 进 入'; }
}

// supabase 库 defer 加载 → 用户可能在库就绪前就点"进入"。ensureAuth 等 sb 就位再跑。
// 库就绪即 bootSupabase() 建好 sb; 这里轮询等待(库通常已在下载或到位, 最多几百 ms)。
function awaitSb(timeout=8000){
  if(sb) return Promise.resolve(sb);
  return new Promise((resolve,reject)=>{
    const t0=Date.now();
    (function poll(){
      if(sb) return resolve(sb);
      // 库已下好但 boot 还没被 DOMContentLoaded 触发 → 主动引导
      if(window.supabase && window.supabase.createClient){ bootSupabase(); if(sb) return resolve(sb); }
      if(Date.now()-t0>timeout) return reject(new Error('supabase 库加载超时'));
      setTimeout(poll,50);
    })();
  });
}

// Promise 超时包装: 网络抖动时 supabase auth 请求会 hang 住(无内置超时), 套上超时兜底,
// 超时 reject/resolve fallback → 进房流程不再卡死在 await ensureAuth()(偶发"连接中+空白"根因)。
function withTimeout(promise, ms, fallback){
  return Promise.race([
    promise,
    new Promise((res,rej)=>setTimeout(()=>{ if(fallback!==undefined) res(fallback); else rej(new Error('timeout')); }, ms))
  ]);
}
// 匿名登录(路线C：默认匿名，可 magic link 升级，uid 不变)
// ★统一的 session 解析(ensureAuth / bootSupabase 共用, 避免两套恢复逻辑各修各的漂移)。
// getSession 本质是【本地读】(读 localStorage 里的 token), 正常几毫秒返回; 它偶发 hang 是内部
// 顺带 autoRefresh 的网络卡了。故: 给一个较紧的超时(3.5s)只做安全网; 超时/拿到 null 时对"曾登录过"
// 的情形再做一次不带超时的兜底重读——真 session 往往就在, 别因网络抖动误判成"没登录"。
// ★2026-07: 原 12s 太宽——它卡在整个大厅渲染之前(进入按钮/webview 兜底路径都 await 它), autoRefresh
//   网络一 hang 用户就干等最多12s空骨架。降到 3.5s: 本地读几毫秒即返回, 真慢也快速放行走兜底重读/匿名。
async function resolveSession(){
  if(!sb) return null;
  let session=null;
  try{ ({ data:{ session } } = await withTimeout(sb.auth.getSession(), 3500, { data:{ session:null } })); }
  catch(e){ console.warn('[auth] getSession 超时', e); session=null; }
  // 曾登录过(本地 me.registered 或有 username/email) 但这次没读到 → 不带超时再读一次兜底
  const everReg = !!(me && (me.registered || me.username || me.email));
  if(!session?.user && everReg){
    try{ const rr=await sb.auth.getSession(); if(rr?.data?.session?.user) session=rr.data.session; }catch(_){}
  }
  return session;
}
async function ensureAuth(){
  try{ await withTimeout(awaitSb(), 8000); }catch(e){ console.warn(e); toast(EH_CONFIG.text.err_initId); return null; }
  let session = await resolveSession();
  let uid = session?.user?.id;
  if(!uid){
    // 二次确认后仍无 session:
    //  · 正式账号 → 判定登录确已失效: 只清本地登录态(不重掷名字、不匿名冒充), 提示重登, 直接返回。
    //    不再 signInAnonymously 顶替(那会造出随机匿名 uid + 冲掉身份, 且用户以为还是自己)。
    //  · 匿名身份 → 正常匿名登录拿 uid。
    if(me && me.registered){
      console.warn('[auth] 正式账号 session 确已失效, 清本地登录态, 提示重登(不降级冒充)');
      me.registered=false; me.role='user'; me.username='';
      try{ saveIdentity(); }catch(e){}
      try{ toast('登录已过期，请重新登录'); }catch(e){}
      return null;
    }
    let data=null, error=null;
    try{ ({ data, error } = await withTimeout(sb.auth.signInAnonymously(), 10000)); }
    catch(e){ console.warn('anon signin 超时', e); toast(EH_CONFIG.text.err_initId); return null; }
    if(error || !data?.user){ console.warn('anon signin', error); toast(EH_CONFIG.text.err_initId); return null; }
    uid = data.user.id;
    // ★ 防冒充: 匿名登录后强制重掋随机名字, 避免旧缓存的正式账号名字(如 yiran)被新匿名 uid 带入 DB 产生“匿名 yiran”重复临时身份
    // 触发场景: admin 退出时未清 localStorage → me.name/emoji 残留 → 匿名登录后 → upsert 写入一条“临时 yiran”。
    try{ if(me){ me.registered=false; me.role='user'; me.username=''; } rollIdentity(); }catch(e){}
  }
  myUid = uid; me.id = uid; saveIdentity(); resyncMsgOwnership();
  // 真实 session 是匿名的, 但缓存 me 还标着正式账号 → 同样纠正+重掷昵称(防旧缓存残留冒充+同名)
  if(session?.user && !session.user.email && me && me.registered){
    me.registered=false; me.role='user'; me.username='';
    try{ rollIdentity(); }catch(e){}
    try{ saveIdentity(); paintIdentity&&paintIdentity(); }catch(e){}
  }
  // ★正式账号(session 带 email)的档案以【库为准】: 弱网抖动曾把缓存 me 误降级成随机匿名名,
  //   若此时照缓存 upsert 会把正式账号(如超管 yiran)的 name/emoji/color 冲成随机名(踩过)。
  //   故: 正式 session → 先从 eh_users 读回权威档案回填 me(修正被污染的缓存), 且 upsert 只更 last_seen,
  //   绝不用缓存覆盖正式账号的 name/emoji/color。只有匿名身份才整档 upsert。
  const isRegSession = !!(session?.user && session.user.email);
  if(isRegSession){
    // 只更在线时间, 不碰身份字段(名字/头像/色由本人显式改名时才写)
    sb.from('eh_users').update({ last_seen:new Date().toISOString() }).eq('id',uid)
      .then(({error})=>{ if(error) console.warn('eh_users last_seen', error.message); });
    // 读回权威档案, 修正可能被弱网降级污染的本地缓存
    sb.from('eh_users').select('name,emoji,color').eq('id',uid).maybeSingle().then(({data:prof})=>{
      if(prof && prof.name){
        let changed=false;
        if(me.name!==prof.name){ me.name=prof.name; changed=true; }
        if(prof.emoji && me.emoji!==prof.emoji){ me.emoji=prof.emoji; changed=true; }
        if(prof.color && me.color!==prof.color){ me.color=prof.color; changed=true; }
        if(!me.registered){ me.registered=true; changed=true; }   // 正式 session 必是正式账号
        if(changed){ try{ saveIdentity(); paintIdentity&&paintIdentity(); }catch(e){} }
      }
    });
  }else{
    // 匿名身份: 整档 upsert(名字随机、可随时重掷, 不怕覆盖)
    sb.from('eh_users').upsert({ id:uid, name:me.name, emoji:me.emoji, color:me.color, is_anonymous:true, last_seen:new Date().toISOString() })
      .then(({error})=>{ if(error) console.warn('eh_users upsert', error.message); });
  }
  return uid;
}

// ---- 打字机副标题 ----
// SUBTEXT 动态取配置(loadRemoteConfig 后能用到新值)
function getSubtext(){ return EH_CONFIG.text.officialDesc; }
let subI=0;
function typeSub(){
  const el=$('#subLine'); if(!el) return;
  if(subI<=getSubtext().length){ el.innerHTML=esc(getSubtext().slice(0,subI))+'<span class="cursor">&nbsp;</span>'; subI++; setTimeout(typeSub,55); }
  else el.innerHTML=esc(getSubtext())+'<span class="cursor">&nbsp;</span>';
}

// ============ 场景切换 ============
// ============ 皮肤/主题引擎 ============
// 主题元数据/官方房皮肤绑定 → 引用集中配置 EH_CONFIG(见文件顶部)
const THEMES=EH_CONFIG.themes;
const ROOM_THEME=EH_CONFIG.roomTheme;
// ============ BGM 氛围引擎(Web Audio 程序化生成, 零文件零跨域) ============
const LS_BGM='eh_bgm';
// 每官方房一套氛围: 根音(Hz)/和弦音程/音色波形/律动(ms,0=纯pad无脉冲)/滤波截止
// 官方房 BGM 氛围 → 引用集中配置 EH_CONFIG(见文件顶部)
const ROOM_BGM=EH_CONFIG.roomBgm;
// EH 操作音效：轻量 Web Audio 合成，不依赖外部音频文件；音色偏聊天/空间感，避免 VC 答题那种强游戏化。
const EhSfx=(function(){
  let ctx=null, master=null, enabled=true, lastClickAt=0;
  const VOL=.38;
  function ensure(){
    if(!ctx){
      try{
        try{ if(navigator.audioSession) navigator.audioSession.type='playback'; }catch(e){}
        ctx=new (window.AudioContext||window.webkitAudioContext)();
        master=ctx.createGain(); master.gain.value=VOL;
        const comp=ctx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-8,ctx.currentTime); comp.knee.setValueAtTime(10,ctx.currentTime);
        comp.ratio.setValueAtTime(4,ctx.currentTime); comp.attack.setValueAtTime(.004,ctx.currentTime); comp.release.setValueAtTime(.12,ctx.currentTime);
        master.connect(comp); comp.connect(ctx.destination);
      }catch(e){ ctx=null; }
    }
    if(ctx && ctx.state!=='running'){ try{ctx.resume();}catch(e){} }
    return ctx;
  }
  function tone(freq,start,dur,type,peak,glideTo){
    if(!ctx||!master) return;
    const t0=ctx.currentTime+start, o=ctx.createOscillator(), g=ctx.createGain();
    o.type=type||'sine'; o.frequency.setValueAtTime(freq,t0);
    if(glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(24,glideTo),t0+dur);
    g.gain.setValueAtTime(.0001,t0);
    g.gain.exponentialRampToValueAtTime(peak||.18,t0+.012);
    g.gain.exponentialRampToValueAtTime(.0001,t0+dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0+dur+.03);
    o.onended=function(){ try{o.disconnect();g.disconnect();}catch(e){} };
  }
  // 噪声爆(打击/爆炸的"实体感"): 一段白噪 → 低通扫频 + 快速衰减
  function noise(start,dur,peak,lpFrom,lpTo){
    if(!ctx||!master) return;
    const t0=ctx.currentTime+start, n=Math.floor(ctx.sampleRate*dur);
    const buf=ctx.createBuffer(1,n,ctx.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);   // 白噪, 尾部渐弱
    const src=ctx.createBufferSource(); src.buffer=buf;
    const lp=ctx.createBiquadFilter(); lp.type='lowpass';
    lp.frequency.setValueAtTime(lpFrom||2400,t0);
    if(lpTo) lp.frequency.exponentialRampToValueAtTime(Math.max(80,lpTo),t0+dur);
    const g=ctx.createGain(); g.gain.setValueAtTime(peak||.3,t0); g.gain.exponentialRampToValueAtTime(.0001,t0+dur);
    src.connect(lp); lp.connect(g); g.connect(master); src.start(t0); src.stop(t0+dur+.02);
    src.onended=function(){ try{src.disconnect();lp.disconnect();g.disconnect();}catch(e){} };
  }
  const lib={
    click(){ tone(1180,0,.045,'triangle',.17); tone(1760,.012,.04,'sine',.09); },
    enter(){ tone(392,0,.16,'sine',.18); tone(587,.055,.18,'triangle',.16); tone(784,.12,.22,'sine',.13); },
    send(){ tone(880,0,.075,'triangle',.18); tone(1320,.024,.07,'sine',.10); },
    receive(){ tone(660,0,.07,'sine',.11); tone(990,.032,.06,'triangle',.075); },
    soul(){ tone(523,0,.16,'sine',.13); tone(784,.055,.18,'triangle',.11); tone(1175,.13,.24,'sine',.08); },
    echo(){ tone(1320,0,.05,'sine',.13); tone(880,.028,.08,'triangle',.08,720); },
    mention(){ tone(988,0,.09,'triangle',.18); tone(1480,.07,.12,'sine',.12); },
    void(){ tone(220,0,.22,'sine',.16,130); tone(440,.04,.18,'triangle',.08,300); },
    error(){ tone(360,0,.12,'sine',.16,260); tone(220,.09,.18,'triangle',.13,160); },
    back(){ tone(660,0,.13,'sine',.15,494); tone(392,.06,.17,'triangle',.11,330); },
    // ── 互动电影感音效 ──
    punch(){ noise(0,.14,.72,2000,180); tone(150,0,.16,'sine',.5,52); tone(90,.02,.14,'triangle',.34,38); },   // 拳拳到肉: 噪声撞击 + 低频闷响
    boom(){ noise(0,.36,.82,2800,80); tone(70,0,.46,'sine',.55,30); tone(120,.03,.32,'triangle',.34,42); tone(300,0,.07,'sawtooth',.26,120); },   // 爆炸: 长噪声 + 深低频轰
    whoosh(){ noise(0,.5,.42,600,4600); tone(520,0,.42,'sine',.1,1500); },   // 光带扫过: 低→高扫频噪声
    sparkle(){ tone(1568,0,.11,'sine',.22); tone(2093,.06,.13,'triangle',.17); tone(2637,.13,.15,'sine',.15); tone(3136,.2,.17,'triangle',.11); },  // 庆祝: 上行铃音闪烁
    bloom(){ tone(523,0,.22,'sine',.2); tone(784,.07,.24,'sine',.17); tone(1046,.15,.28,'triangle',.13); },   // 温情绽放: 柔和上行大三和弦
    // 进场专属(比 receive 更有仪式感、够响): 上行三连音亮起
    arrive(){ tone(587,0,.14,'triangle',.24); tone(880,.06,.16,'sine',.2); tone(1175,.14,.2,'triangle',.15); }
  };
  function unlock(){ ensure(); }
  function play(name){
    if(!enabled) return;
    if(!ensure()) return;
    const fn=lib[name]||lib.click;
    const emit=()=>{ try{fn();}catch(e){} };
    if(ctx.state!=='running'){
      try{ctx.resume();}catch(e){}
      let n=0;(function wait(){ if(ctx.state==='running'||n++>16) emit(); else setTimeout(wait,18); })();
    }else emit();
    try{ if(navigator.vibrate && ['enter','send','echo','mention','void','error','back'].includes(name)) navigator.vibrate(name==='error'?[18,30,18]:8); }catch(e){}
  }
  function playClick(){ const now=performance.now?performance.now():Date.now(); if(now-lastClickAt<80) return; lastClickAt=now; play('click'); }
  try{
    // ★补: 使用 { once:true } — 首次手势后自动解绑，避免长生命周期里每次点击都跑 ensure
    ['pointerdown','touchstart','keydown'].forEach(ev=>document.addEventListener(ev,unlock,{capture:true,passive:true,once:true}));
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&ctx&&ctx.state!=='running') ctx.resume(); },{passive:true});
  }catch(e){}
  return {play,playClick,setEnabled(v){enabled=!!v},isEnabled(){return enabled},unlock};
})();
window.EhSfx=EhSfx;
function ehFx(el, cls, ms){ if(!el) return; try{ el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(()=>el.classList.remove(cls),ms||650); }catch(e){} }
function ehRipple(el, ev){
  try{
    if(!el || el.dataset.noRipple==='1') return;
    const r=el.getBoundingClientRect(); if(!r.width||!r.height) return;
    if(getComputedStyle(el).position==='static') el.style.position='relative';
    if(getComputedStyle(el).overflow==='visible') el.style.overflow='hidden';
    const sp=document.createElement('span'); sp.className='eh-ripple';
    const x=(ev&&ev.clientX?ev.clientX-r.left:r.width/2), y=(ev&&ev.clientY?ev.clientY-r.top:r.height/2);
    const d=Math.max(r.width,r.height)*1.35; sp.style.width=sp.style.height=d+'px'; sp.style.left=x+'px'; sp.style.top=y+'px';
    el.appendChild(sp); setTimeout(()=>sp.remove(),620);
  }catch(e){}
}

const AudioEngine=(function(){
  // 用 HTMLAudioElement 播放 mp3 BGM。两种模式:
  //  · loop 模式(在房间里): 单曲循环该房 BGM。
  //  · chain 模式(大厅/离房续播): 当前曲放完后随机连播任意房间的 BGM(丝滑不断)。
  // 接口: start(cfg)/stop()/resume()/playing()/curName()/duck(on)/chain(pool)/toChainAfter(pool)
  let el=null, cur=null, fadeTimer=null, mode='loop', chainPool=null;
  const VOL_ON=0.55, VOL_DUCK=0.12, FADE_MS=1000;
  function pickNext(pool){
    const list=(pool||[]).filter(c=>c&&c.url);
    if(!list.length) return null;
    if(list.length===1) return list[0];
    // 避免连续重复同一首
    let n; do{ n=list[Math.floor(Math.random()*list.length)]; }while(cur&&n.url===cur.url&&list.length>1);
    return n;
  }
  function onEnded(){
    // chain 模式: 放完随机下一首; loop 模式此事件不触发(el.loop=true)
    if(mode!=='chain'||!bgmOn()) return;
    const nx=pickNext(chainPool); if(nx) playCfg(nx);
  }
  function ensure(){
    if(!el){
      try{
        el=new Audio(); el.preload='auto'; el.crossOrigin='anonymous';
        el.volume=0;
        el.addEventListener('error',()=>{ /* 静默, BGM 非必需 */ if(mode==='chain'){ const nx=pickNext(chainPool); if(nx&&(!cur||nx.url!==cur.url)) setTimeout(()=>{ if(mode==='chain') playCfg(nx); },500); } });
        el.addEventListener('ended',onEnded);
      }catch(e){ el=null; }
    }
    return el;
  }
  function fadeTo(target, ms){
    if(!el) return;
    if(fadeTimer){ clearInterval(fadeTimer); fadeTimer=null; }
    const from=el.volume, to=Math.max(0,Math.min(1,target)), steps=Math.max(1,Math.round(ms/40));
    let n=0;
    fadeTimer=setInterval(()=>{
      n++; const k=n/steps; el.volume=from+(to-from)*k;
      if(n>=steps){ clearInterval(fadeTimer); fadeTimer=null; el.volume=to; if(to===0){ try{el.pause();}catch(_){}} }
    },40);
  }
  function playCfg(cfg){
    if(!cfg||!cfg.url) return;
    ensure(); if(!el) return;
    el.loop=(mode==='loop');
    if(cur && cur.url===cfg.url && !el.paused){ /* 已在播同一首, 恢复音量即可 */ fadeTo(VOL_ON,FADE_MS); cur=cfg; return; }
    cur=cfg;
    try{ el.pause(); }catch(_){}
    el.src=cfg.url;
    el.volume=0;
    const pr=el.play();
    if(pr && pr.catch) pr.catch(()=>{ /* autoplay policy 拦住; 首次交互后由 resume() 再触发 */ });
    fadeTo(VOL_ON,FADE_MS);
  }
  return {
    // 进房: 单曲循环该房 BGM(硬切)
    start(cfg){ if(!bgmOn()) return; mode='loop'; chainPool=null; if(el) el.loop=true; playCfg(cfg); },
    // 大厅/冷启动: 立即随机连播模式(从 pool 里随机起一首)
    chain(pool){ if(!bgmOn()) return; mode='chain'; chainPool=pool||[]; if(el) el.loop=false;
      if(!(el && cur && !el.paused)){ const nx=pickNext(chainPool); if(nx) playCfg(nx); } },
    // 离房返回大厅: 不打断当前曲, 只切成 chain 模式——放完再随机连播(丝滑续播)
    toChainAfter(pool){ mode='chain'; chainPool=pool||[]; if(el) el.loop=false;
      // 若当前没在播(比如已被静音/停了), 直接随机起一首
      if(bgmOn() && !(el && cur && !el.paused)){ const nx=pickNext(chainPool); if(nx) playCfg(nx); } },
    stop(){ mode='loop'; chainPool=null; if(!el) { cur=null; return; } fadeTo(0,700); setTimeout(()=>{cur=null;}, 720); },
    resume(){ if(!el||!cur) return; if(el.paused){ try{ const pr=el.play(); if(pr&&pr.catch) pr.catch(()=>{}); }catch(_){} } },
    playing(){ return !!(el && cur && !el.paused); },
    curName(){ return cur?cur.name:null; },
    curUrl(){ return cur?cur.url:null; },
    // 神曲播放时把 BGM 压低, 结束再恢复
    duck(on){ if(!el||!cur) return; fadeTo(on?VOL_DUCK:VOL_ON, 300); },
  };
})();
function bgmOn(){ const v=localStorage.getItem(LS_BGM); return v===null?true:v==='1'; }
// 全部可用 BGM 曲目池(官方房各一首 + 公共/私密 fallback 各一首), 供大厅随机连播
function bgmPool(){
  try{
    const out=[], seen=new Set();
    const push=(c)=>{ if(c&&c.url&&!seen.has(c.url)){ seen.add(c.url); out.push(c); } };
    Object.keys(ROOM_BGM).forEach(k=>{ if(k==='_fallback') return; push(ROOM_BGM[k]); (ROOM_BGM[k].variants||[]).forEach(push); });
    if(ROOM_BGM._fallback){ push(ROOM_BGM._fallback.public); (ROOM_BGM._fallback.public.variants||[]).forEach(push); push(ROOM_BGM._fallback.private); (ROOM_BGM._fallback.private.variants||[]).forEach(push); }
    return out;
  }catch(e){ return []; }
}
// 大厅氛围: 随机连播任意房间 BGM(离房丝滑续播由 backToLobby 调 toChainAfter)
function startLobbyBGM(){
  try{
    if(!bgmOn()) return;
    // 大厅也记住上一次操作：手动选曲时恢复那首；自动模式才随机官方曲目连播。
    const mem=bgmModeGetGlobal();
    if(mem.mode==='manual' && mem.url){
      const row=bgmCandidatesForRoom(null).find(x=>x.url===mem.url);
      if(row){ AudioEngine.start(row); return; }
      // 曲库配置变更或资源失效时，清掉失效记忆，回退自动随机。
      bgmModeSaveGlobal('auto','');
    }
    AudioEngine.chain(bgmPool());
  }catch(e){ console.warn('startLobbyBGM',e); }
}
// 首次交互解锁: HTMLAudioElement 受 autoplay 策略限制, 手势后若在大厅且无房则起大厅 BGM。
// (进房路径由 startRoomBGM 负责; 这里兜底"停在大厅还没响"的冷启动/自动恢复登录进大厅)
function kickBgmOnGesture(){
  try{
    AudioEngine.resume();
    if(bgmOn() && !AudioEngine.playing() && !curRoom && $('#lobby') && $('#lobby').classList.contains('on')){
      startLobbyBGM();
      if(AudioEngine.playing()) detachBgmGestureUnlock();
    }
  }catch(_){}
}
function detachBgmGestureUnlock(){
  try{ ['pointerdown','touchstart','keydown'].forEach(ev=>document.removeEventListener(ev,kickBgmOnGesture,{capture:true})); }catch(_){}
}
try{ ['pointerdown','touchstart','keydown'].forEach(ev=>document.addEventListener(ev,kickBgmOnGesture,{capture:true,passive:true})); }catch(_){}
// BGM 按钮图标(emoji, 与工具栏其它 emoji 统一): 开=🎵 静音=🔇。大厅/聊天页两个按钮同步。
function paintBgmBtn(on){ ['#bgmBtnHall','#bgmBtnLobby'].forEach(sel=>{ const b=$(sel); if(b){ b.classList.toggle('muted',!on); b.textContent=on?'🎵':'🔇'; } }); }
function setBgm(on){ localStorage.setItem(LS_BGM, on?'1':'0'); paintBgmBtn(on); try{ EhSfx.playClick(); }catch(e){} if(!on) AudioEngine.stop(); else if(curRoom) startRoomBGM(curRoom); else startLobbyBGM(); }
function startRoomBGM(room){
  try{
    // 换房触发时先清过期 override（同房再进不清，续播用户生成曲）
    bgmClearOverrideIfRoomChanged(room);
    if(!bgmOn()) return;
    if(!room){ AudioEngine.stop(); return; }
    // 恢复上次记忆：manual=钉住那首，auto=随机官方曲
    let cfg=null;
    try{
      const mem=bgmModeGet(bgmRoomKey(room));
      if(mem.mode==='manual' && mem.url){ _ehBgmOverride={ url:mem.url, name:'手动曲', title:'手动曲', room_name:room.name }; }
    }catch(_){}
    // 用户生成曲默认本地覆盖：同房间重新进入时继续播放，不影响其他人。
    if(typeof _ehBgmOverride!=='undefined' && _ehBgmOverride && _ehBgmOverride.room_name===room.name && _ehBgmOverride.url) cfg=_ehBgmOverride;
    else if(room.kind==='official' && ROOM_BGM[room.name]){
      const base=ROOM_BGM[room.name]; cfg=(Math.random()<0.55 && base.variants&&base.variants.length)?base.variants[Math.floor(Math.random()*base.variants.length)]:base;
    }
    else if(room.kind==='public' && ROOM_BGM._fallback && ROOM_BGM._fallback.public){
      const base=ROOM_BGM._fallback.public; cfg=(Math.random()<0.55 && base.variants&&base.variants.length)?base.variants[Math.floor(Math.random()*base.variants.length)]:base;
    }
    else if(room.kind==='private' && ROOM_BGM._fallback && ROOM_BGM._fallback.private) cfg=ROOM_BGM._fallback.private;
    if(cfg) AudioEngine.start(cfg); else AudioEngine.stop();
  }catch(e){ console.warn('startRoomBGM', e); }   // BGM 非必需, 出错绝不阻断进房
}
// 手动选曲：允许用户从下拉菜单直接挑本房 BGM
const LS_BGM_MANUAL='eh_bgm_manual_v1';   // { [roomKey]: url }  按房间名维度记住最后一次手动选择
// 新版记忆：每房间记住模式(auto=随机官方 / manual=钉某首)。auto 时不钉 url，进房重新随机。
const LS_BGM_MODE='eh_bgm_mode_v1';       // { [roomKey]: {mode:'auto'|'manual', url:''} }
function bgmModeStore(){ try{ return JSON.parse(localStorage.getItem(LS_BGM_MODE)||'{}')||{}; }catch(_){ return {}; } }
function bgmModeGet(roomKey){ try{ const m=bgmModeStore()[roomKey]; return (m&&m.mode)?m:{mode:'auto',url:''}; }catch(_){ return {mode:'auto',url:''}; } }
function bgmModeSave(roomKey,mode,url){ try{ const m=bgmModeStore(); m[roomKey]={mode:mode||'auto',url:(mode==='manual'?(url||''):'')}; localStorage.setItem(LS_BGM_MODE, JSON.stringify(m)); }catch(_){} }
function bgmModeSaveGlobal(mode,url){ bgmModeSave('__global__', mode, url); }
function bgmModeGetGlobal(){ return bgmModeGet('__global__'); }
// roomKey：进房用房间名，大厅用 __lobby__
function bgmRoomKey(room){ return room? room.name : '__lobby__'; }
function bgmManualStore(){ try{ return JSON.parse(localStorage.getItem(LS_BGM_MANUAL)||'{}')||{}; }catch(_){ return {}; } }
function bgmManualUrl(roomKey){ try{ return bgmModeGet(roomKey).mode==='manual'? (bgmModeGet(roomKey).url||'') : ''; }catch(_){ return ''; } }
// 收集给用户看的曲目候选（默认曲、当前房 variants、我的灵魂曲库）
function bgmCandidatesForRoom(room){
  const out=[]; const seen=new Set();
  const push=(cfg,tag)=>{ if(!cfg||!cfg.url||seen.has(cfg.url)) return; seen.add(cfg.url); out.push({url:cfg.url,name:cfg.name||'未命名',tag:tag||''}); };
  if(room){
    if(room.kind==='official' && ROOM_BGM[room.name]){
      const base=ROOM_BGM[room.name]; push(base,'默认'); (base.variants||[]).forEach(v=>push(v,'扩展'));
    }else if(room.kind==='public' && ROOM_BGM._fallback && ROOM_BGM._fallback.public){
      const base=ROOM_BGM._fallback.public; push(base,'默认'); (base.variants||[]).forEach(v=>push(v,'扩展'));
    }else if(room.kind==='private' && ROOM_BGM._fallback && ROOM_BGM._fallback.private){
      const base=ROOM_BGM._fallback.private; push(base,'默认'); (base.variants||[]).forEach(v=>push(v,'扩展'));
    }
  }else{
    // 大厅：把所有官方房+fallback 都列出来
    Object.keys(ROOM_BGM).forEach(k=>{ if(k==='_fallback') return; const b=ROOM_BGM[k]; push(b,k); (b.variants||[]).forEach(v=>push(v,k)); });
    if(ROOM_BGM._fallback){ push(ROOM_BGM._fallback.public,'公开房'); (ROOM_BGM._fallback.public.variants||[]).forEach(v=>push(v,'公开房')); push(ROOM_BGM._fallback.private,'私密房'); }
  }
  return out;
}
async function bgmMyLibraryForRoom(room){
  // 拉全站公开灵魂曲(B: 人人可听, 含临时/匿名用户)。走 SECURITY DEFINER 函数 eh_public_songs,
  // 只返回 title/url/room_name(不含作者 uid)。函数未部署或出错 → 返回 [] 安全回退到"仅自己的曲"。
  const fetchPublic=async()=>{
    try{
      const { data, error }=await sb.rpc('eh_public_songs',{ p_limit:40, p_room: room?room.name:null });
      if(error) return [];
      return (data||[]).filter(x=>x&&x.url);
    }catch(_){ return []; }
  };
  try{
    // 自己的曲(登录后才有 uid; 匿名冷启动可能暂无, 不阻塞全站曲展示)
    let rows=[];
    if(myUid){
      const q=await sb.from('eh_user_bgm').select('id,title,url,room_name,created_at').eq('auth_uid',myUid).order('created_at',{ascending:false}).limit(50);
      rows=(q.data||[]).filter(x=>x&&x.url);
    }
    const pub=await fetchPublic();
    const local=bgmLocalLibrary().filter(x=>x&&x.url && (!room || x.room_name===room.name));
    const here = room ? rows.filter(x=>x.room_name===room.name) : rows;
    // 顺序: 自己的曲优先(亲切感) → 本地缓存 → 全站公开曲, 按 url 去重
    const merged=[...here,...local,...pub].filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i);
    return merged.slice(0,20);
  }catch(_){ return []; }
}
function bgmMenuCurrentUrl(){
  try{ return (AudioEngine.curUrl && AudioEngine.curUrl())||''; }catch(_){ return ''; }
}
function _bgmActiveUrl(){
  try{
    if(_ehBgmOverride && _ehBgmOverride.url) return _ehBgmOverride.url;
    // 兜底：从当前实际播放取
    return bgmMenuCurrentUrl();
  }catch(_){ return ''; }
}
// 每组显示条数 —— 后台可配（eh_rooms.bgm_show_official / bgm_show_soul），缺失/大厅走全局兜底
const BGM_SHOW_DEFAULT=3;
function bgmShowN(room, kind /* 'official' | 'soul' */){
  const col= kind==='soul' ? 'bgm_show_soul' : 'bgm_show_official';
  const v = room && room[col];
  const n = (typeof v==='number' && v>0) ? v|0 : BGM_SHOW_DEFAULT;
  return Math.max(1, Math.min(20, n));   // 夹到 1~20 防出格
}
// 打开弹层时的分组抽样：list.length<=3 → 全展示；>3 → 随机 3 首，正在播的那首（若在 list 中）强制包含
function sampleTracks(list, playingUrl, n){
  if(!Array.isArray(list) || list.length<=n) return (list||[]).slice();
  // 随机挑哪几首：正在播的那首强制包含，其余从剩下里随机补
  const hasForced = list.some(x=>playingUrl && x && x.url===playingUrl);
  const others=list.filter(x=>!(playingUrl && x && x.url===playingUrl));
  const pool=others.slice();
  for(let i=pool.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  const need=hasForced?(n-1):n;
  const chosen=new Set(pool.slice(0,need).map(x=>x&&x.url));
  if(hasForced){ const f=list.find(x=>playingUrl && x && x.url===playingUrl); if(f) chosen.add(f.url); }
  // 关键：挑中的这几首，按原始 list 的固定顺序返回（不随机乱序）
  return list.filter(x=>x && chosen.has(x.url));
}
// 灵魂曲目按房间缓存: 打开菜单先用缓存【同步】渲染(官方曲秒出), 网络回来再补。
//   { [roomKey]: {list:[], at:ts, loading:bool} } —— roomKey 见 bgmRoomKey。
const _bgmSoulCache={};
function _bgmSoulKey(room){ return (room&&room.name)||'__lobby__'; }
// buildBgmMenu 现为【同步】渲染: 灵魂曲只取缓存, 不再 await 网络(那是弹层慢的根因)。
// 网络刷新由 refreshBgmSoulLib 后台做, 回来重渲染。soulOverride 供刷新回调直接传新列表。
function buildBgmMenu(m, soulOverride){
  if(!m) return;
  const room=curRoom||null;
  const on=bgmOn();
  // 勾表示“当前正在播放”：只看当前播放 URL，不受自动/手动模式影响；关闭时不显示勾。
  const playing=on?_bgmActiveUrl():'';
  const isAuto=room?!bgmManualUrl(room.name):(bgmModeGetGlobal().mode!=='manual');
  const cands=bgmCandidatesForRoom(room);   // 官方曲目(纯本地 config, 瞬时)
  const _sk=_bgmSoulKey(room);
  const _sc=_bgmSoulCache[_sk];
  const mine=Array.isArray(soulOverride)?soulOverride:((_sc&&_sc.list)||[]); // 灵魂曲目(缓存, 同步)
  const soulLoading=!soulOverride && (!_sc || _sc.loading) && !(_sc&&_sc.list&&_sc.list.length);
  const esc=(t)=>String(t||'').replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;","\"":"&quot;"})[c]);
  const dotFor=(tag)=>{
    const t=String(tag||'');
    if(t==='默认') return 'var(--accent, var(--cyan))';
    if(t==='扩展') return 'var(--violet)';
    if(t==='公开房'||t.indexOf('公')>=0) return 'var(--cyan)';
    if(t==='私密房'||t.indexOf('私')>=0) return 'var(--magenta)';
    return 'var(--cyan)';
  };
  const html=[];
  // ① 顶部一行：「自动 / 关闭」二选一，复用通用 .mode-row/.mode-opt（背景风格第一行同款）
  //   自动 = 音乐开 + 随机官方曲；关闭 = 停播。手动选曲时「自动」暗化（可点回自动模式）
  const isManualPicked=on && !isAuto;
  html.push(`<div class="mode-row">
    <div class="mode-opt${(on&&isAuto)?' active':(isManualPicked?' dimmed':'')}" data-action="auto" title="随机播放本房间官方曲目">自动</div>
    <div class="mode-opt${on?'':' active'}" data-action="off" title="关闭背景音乐">关闭</div>
  </div>`);
  m.classList.toggle('off-mode', !on);
  const isLobby=!room;   // 大厅(列表页)：无当前房间概念，不提供「请灵魂制作」
  // 即使关闭，下方列表也展示（只做视觉弱化）；点任一首 = 自动开机+播放
    // ③ 官方曲目组（>3 首时随机抽 3，播放中的那首强制保留）
    // 抽样结果缓存在 m._bgmPickCache，切歌局部刷新不重抽；打开菜单/曲库变化时清缓存
    if(!m._bgmPickCache) m._bgmPickCache={};
    const nOff=bgmShowN(room,'official');
    let officialShown=m._bgmPickCache.official;
    const roomKey=(room&&room.name)||'__lobby__';
    if(!officialShown || m._bgmPickCache._roomKey!==roomKey || m._bgmPickCache._nOff!==nOff){
      officialShown=sampleTracks(cands, playing, nOff);
      m._bgmPickCache.official=officialShown;
      m._bgmPickCache._roomKey=roomKey;
      m._bgmPickCache._nOff=nOff;
    }else if(playing && !officialShown.some(x=>x&&x.url===playing) && cands.some(x=>x&&x.url===playing)){
      // 播放曲切到未被抽中的官方曲：加入 n 首集合，按原 list 固定顺序展示
      const keep=new Set(officialShown.slice(0,Math.max(0,nOff-1)).map(x=>x&&x.url));
      keep.add(playing);
      officialShown=cands.filter(x=>x && keep.has(x.url));
      m._bgmPickCache.official=officialShown;
    }
    if(officialShown.length){
      html.push(`<div class="bgm-sec-title">官方曲目</div>`);
      // 按 index 循环取主题色变量，让相邻曲目点点不同色；主题切换自动跟随
      const OFFICIAL_HUES=['var(--cyan)','var(--violet)','var(--magenta)','var(--green)','var(--amber)'];
      officialShown.forEach((c,i)=>{
        const dc=OFFICIAL_HUES[i%OFFICIAL_HUES.length];
        const pinned=!!playing && playing===c.url;
        html.push(`<div class="skin-opt${pinned?' active':''}" data-url="${esc(c.url)}"><span class="dot" style="color:${dc};background:${dc}"></span><span class="bgm-flex">${esc(c.name)}</span><span class="ck" style="color:${dc}">✓</span></div>`);
      });
    }
    // 【灵魂组缓存 07-28 03:08】key 加 _soulRoomKey 防长度巧合复用旧房间抽样（旧实现只看 _soulLen）
    const nSoul=bgmShowN(room,'soul');
    let soulShown=m._bgmPickCache.soul;
    if(!soulShown || m._bgmPickCache._soulRoomKey!==roomKey || m._bgmPickCache._soulLen!==mine.length || m._bgmPickCache._nSoul!==nSoul){
      soulShown=sampleTracks(mine, playing, nSoul);
      m._bgmPickCache.soul=soulShown;
      m._bgmPickCache._soulRoomKey=roomKey;
      m._bgmPickCache._soulLen=mine.length;
      m._bgmPickCache._nSoul=nSoul;
    }else if(playing && !soulShown.some(x=>x&&x.url===playing) && mine.some(x=>x&&x.url===playing)){
      // 播放曲切到未被抽中的灵魂曲：加入 n 首集合，按原 list 固定顺序展示
      const keep=new Set(soulShown.slice(0,Math.max(0,nSoul-1)).map(x=>x&&x.url));
      keep.add(playing);
      soulShown=mine.filter(x=>x && keep.has(x.url));
      m._bgmPickCache.soul=soulShown;
    }
    html.push(`<div class="bgm-sec-title">灵魂曲目</div>`);
    if(!soulShown.length && soulLoading){
      // 缓存还没有 + 正在后台拉 → 占位, 别让"灵魂曲目"标题下空一块
      html.push(`<div class="skin-opt bgm-loading" aria-busy="true"><span class="dot" style="color:var(--violet);background:var(--violet)"></span><span class="bgm-flex">载入中…</span></div>`);
    }
    if(soulShown.length){
      const shortTitle=(t)=>{
        let x=String(t||'灵魂曲').trim();
        // 去掉常见前缀「房间名·」/ 「房间名-」
        if(room && room.name){
          const rn=room.name;
          if(x.startsWith(rn+'·')) x=x.slice(rn.length+1);
          if(x.startsWith(rn+'-')) x=x.slice(rn.length+1);
          if(x.startsWith(rn)) x=x.slice(rn.length);
        }
        x=x.replace(/^[·\-\s]+/,'').trim();
        if(!x) x='灵魂曲';
        // 中文按字符截断到 10
        try{
          const seg=new Intl.Segmenter('zh',{granularity:'grapheme'});
          const chars=[...seg.segment(x)].map(s=>s.segment);
          if(chars.length>10) x=chars.slice(0,10).join('')+'…';
        }catch(_){ if(x.length>10) x=x.slice(0,10)+'…'; }
        return x;
      };
      const SOUL_HUES=['var(--amber)','var(--magenta)','var(--violet)','var(--green)','var(--cyan)'];
      soulShown.forEach((c,i)=>{
        const dc=SOUL_HUES[i%SOUL_HUES.length];
        const pinned=!!playing && playing===c.url;
        const st=shortTitle(c.title);
        html.push(`<div class="skin-opt${pinned?' active':''}" data-url="${esc(c.url)}" data-title="${esc(c.title||'')}" data-mine="1"><span class="dot" style="color:${dc};background:${dc}"></span><span class="bgm-flex">${esc(st)}</span><span class="ck" style="color:${dc}">✓</span></div>`);
      });
    }
    // ⑤ 灵魂现场生成（仅房间页；大厅无当前房间，不提供）
    if(room && !isLobby){
      html.push(`<div class="skin-opt bgm-gen-row" data-action="gen"><span class="dot" style="color:var(--green);background:var(--green)"></span><span class="bgm-flex">请灵魂制作一首…</span></div>`);
    }
  m.innerHTML=html.join('');
  // 顶部两颗胶囊：自动 / 关闭 互斥
  m.querySelectorAll('.mode-row .mode-opt').forEach(el=>{
    el.onclick=async (e)=>{
      e.stopPropagation();
      const act=el.dataset.action;
      if(act==='auto'){
        AudioEngine.resume();
        const wasOff=!bgmOn();
        if(wasOff) setBgm(true);
        pickBgmAuto();                       // 清手动记忆 + 重新随机官方曲
        if(wasOff){ buildBgmMenu(m); } // 从关闭→自动：需要展开列表（结构变），重绘(灵魂曲走缓存, 同步)
        else { refreshBgmSelState(m); }      // 已开：只切高亮，不重绘 DOM（消除跳动）
        syncBgmActive();
        return;
      }
      if(act==='off'){
        AudioEngine.resume();
        setBgm(false);
        buildBgmMenu(m);   // 关闭：收起列表（结构变），重绘(灵魂曲走缓存, 同步)
        syncBgmActive();
        return;
      }
    };
  });
  // 曲目行（官方 / 灵魂 / 生成）
  m.querySelectorAll('.skin-opt').forEach(el=>{
    el.onclick=async (e)=>{
      e.stopPropagation();
      const act=el.dataset.action;
      if(act==='gen'){ m.classList.remove('on'); syncBgmActive(); try{ await sendBgmGen('按当前房间气氛现场生成一首纯器乐 BGM'); }catch(_){} return; }
      const url=el.dataset.url; if(!url) return;
      // 点歌曲永远进入/保持手动模式；回自动只通过顶部「自动」按钮。
      // 不再把“再次点已选歌曲”解释为回自动，避免首曲恰好正在播放时看起来点不动、随机重播造成跳动。
      const name=(el.textContent||'').replace('✓','').trim();
      if(el.dataset.mine==='1') pickBgmManual({url,name:el.dataset.title||name,mine:true});
      else pickBgmManual({url,name});
      // 选中某曲：只切高亮（随机胶囊灭、该曲打勾），不重绘 DOM → 无跳动
      refreshBgmSelState(m); syncBgmActive();
    };
  });
}
// 后台拉灵魂曲库, 回来存缓存 + 若菜单还开着则只重渲染(不阻塞打开)。
//   force=true 忽略缓存新鲜度强拉(曲库增删时用)。默认 8s 内的缓存视为新鲜, 不重复打网络。
async function refreshBgmSoulLib(m, force){
  const room=curRoom||null;
  const key=_bgmSoulKey(room);
  const cached=_bgmSoulCache[key];
  const fresh = cached && cached.at && !cached.loading && (Date.now()-cached.at < 8000);
  if(fresh && !force){ return; }
  _bgmSoulCache[key]={ list:(cached&&cached.list)||[], at:(cached&&cached.at)||0, loading:true };
  let list=[];
  try{ list=await bgmMyLibraryForRoom(room); }catch(_){ list=[]; }
  _bgmSoulCache[key]={ list:list||[], at:Date.now(), loading:false };
  // 拉回来时若房间已切走, 或菜单已关, 就只更新缓存不动 DOM
  if(!m || !m.classList.contains('on')) return;
  if(_bgmSoulKey(curRoom||null)!==key) return;
  m._bgmPickCache=null;                 // 灵魂曲变了, 清抽样缓存重抽
  buildBgmMenu(m, list||[]);
}
// 局部刷新菜单选中态：只切 class，不重建 DOM（避免整体重绘导致的闪烁/高度跳动）
function refreshBgmSelState(m){
  if(!m) return;
  const on=bgmOn();
  m.classList.toggle('off-mode', !on);
  const room=curRoom||null;
  const isAuto=room?!bgmManualUrl(room.name):(bgmModeGetGlobal().mode!=='manual');
  // 自动模式同样显示正在播放的曲目；关闭时不显示勾。
  const playing=on?_bgmActiveUrl():'';
  const isManualPicked=on && !isAuto;
  // 顶部：自动 / 关闭 二选一
  m.querySelectorAll('.mode-row .mode-opt').forEach(el=>{
    const act=el.dataset.action;
    if(act==='auto'){
      el.classList.toggle('active', on && isAuto);
      el.classList.toggle('dimmed', isManualPicked);   // 手动选曲时自动暗化
    }else if(act==='off'){
      el.classList.toggle('active', !on);
      el.classList.remove('dimmed');
    }
  });
  // 曲目行
  m.querySelectorAll('.skin-opt[data-url]').forEach(el=>{
    const u=el.dataset.url||'';
    el.classList.toggle('active', !!playing && u===playing);
  });
}
function pickBgmManual(row){
  if(!row||!row.url) return;
  if(!bgmOn()) setBgm(true);
  AudioEngine.resume();
  const key=bgmRoomKey(curRoom);
  bgmModeSave(key,'manual',row.url);
  if(!curRoom) bgmModeSaveGlobal('manual',row.url);
  _ehBgmOverride={ url:row.url, name:row.name||'手动曲', title:row.name||'手动曲', room_name:(curRoom&&curRoom.name)||'' };
  try{ AudioEngine.start({name:'🎵 '+(row.name||'手动曲'),url:row.url}); }catch(_){}
}
function pickBgmAuto(){
  const key=bgmRoomKey(curRoom);
  bgmModeSave(key,'auto','');
  if(!curRoom) bgmModeSaveGlobal('auto','');
  _ehBgmOverride=null;
  if(!bgmOn()){ AudioEngine.stop(); return; }
  AudioEngine.resume();
  if(curRoom) startRoomBGM(curRoom); else startLobbyBGM();
}
function initBgmUI(){
  paintBgmBtn(bgmOn());
  const menuLobby=$('#bgmMenu'); const menuHall=$('#bgmMenuHall');
  window.syncBgmActive=()=>{
    const bl=$('#bgmBtnLobby'), bh=$('#bgmBtnHall');
    if(bl) bl.classList.toggle('active', !!(menuLobby&&menuLobby.classList.contains('on')));
    if(bh) bh.classList.toggle('active', !!(menuHall&&menuHall.classList.contains('on')));
  };
  const openMenu=async (m,other)=>{
    if(!m) return;
    if(other) other.classList.remove('on');
    // 关别的下拉
    ['#skinMenu','#skinMenuHall'].forEach(sel=>{ const x=$(sel); if(x) x.classList.remove('on'); });
    try{ window.syncSkinActive&&window.syncSkinActive(); }catch(_){}
    // 每次点开都重新随机抽样：清缓存
    m._bgmPickCache=null;
    buildBgmMenu(m);          // 同步渲染: 官方曲(本地)立即出, 灵魂曲用缓存/占位 → 弹层秒开
    m.classList.toggle('on');
    syncBgmActive();
    refreshBgmSoulLib(m);     // 后台拉灵魂曲库, 回来补渲染(不阻塞弹层)
  };
  const bind=(btn,menu,other)=>{
    if(!btn) return;
    // 新交互：单击 = 弹菜单（切换开/关）。所有操作（开关/选曲/生成）都在菜单里。
    btn.onclick=async (e)=>{
      e.stopPropagation();
      AudioEngine.resume();
      const wasOpen=menu && menu.classList.contains('on');
      if(wasOpen){ menu.classList.remove('on'); syncBgmActive(); return; }
      await openMenu(menu,other);
      if(menu) menu._openedAt=Date.now();
    };
    btn.addEventListener('contextmenu', async (e)=>{ e.preventDefault(); AudioEngine.resume(); await openMenu(menu,other); if(menu){ menu._openedAt=Date.now(); } });
  };
  bind($('#bgmBtnLobby'), menuLobby, menuHall);
  bind($('#bgmBtnHall'), menuHall, menuLobby);
  const outside=(e)=>{
    const now=Date.now();
    [menuLobby,menuHall].forEach(m=>{
      if(!m || !m.classList.contains('on')) return;
      if(m.contains(e.target)) return;
      // 排除自身按钮，避免长按打开瞬间点击又立刻关闭
      const btn=(m===menuLobby)?$('#bgmBtnLobby'):$('#bgmBtnHall');
      if(btn && btn.contains(e.target)) return;
      if(m._openedAt && (now - m._openedAt) < 250) return;
      m.classList.remove('on');
    });
    syncBgmActive();
  };
  document.addEventListener('pointerdown', outside, true);
  // 兜底：滚动/触摸滑动时也关掉
  window.addEventListener('scroll', ()=>{ [menuLobby,menuHall].forEach(m=>{ if(m&&m.classList.contains('on')&&m._openedAt&&Date.now()-m._openedAt>150) m.classList.remove('on'); }); syncBgmActive(); }, {passive:true, capture:true});
  // 曲目变化时刷新已开菜单：
  //   • reason='library' → 曲库增删（新生成一首），需重建 DOM
  //   • 其他（切曲/换房）→ 只更新选中态，避免全量重绘导致的跳动
  window.addEventListener('eh:bgm-changed', (e)=>{
    const isLib=(e&&e.detail&&e.detail.reason)==='library';
    [menuLobby,menuHall].forEach(m=>{
      if(!m||!m.classList.contains('on')) return;
      if(isLib){ m._bgmPickCache=null; buildBgmMenu(m); refreshBgmSoulLib(m, true); }  // 新曲入库：先用旧缓存重抽, 再强拉最新灵魂曲库补渲染
      else refreshBgmSelState(m);
    });
  });
}


const LS_THEME='eh_theme', LS_THEME_LOCK='eh_theme_lock';
const LS_MODE='eh_mode';   // 外观模式: auto(跟随系统)/day/night
function currentMode(){ try{ return localStorage.getItem(LS_MODE)||'auto'; }catch(e){ return 'auto'; } }
function resolveDay(mode){
  mode=mode||currentMode();
  if(mode==='day') return true;
  if(mode==='night') return false;
  // auto: 按本地时间自动切日/夜——白天 7:00-18:59 日间, 其余时间夜间(符合"自动日间/夜间"字面直觉)
  try{ const h=new Date().getHours(); return h>=7 && h<19; }catch(e){ return false; }
}
// ★全屏无黑边(浏览器+PWA, 上+下): 参考 vc 的思路——不去精确算高度, 而是让"任何露出的区域"都是主题色。
//   根因: <meta theme-color> 原来硬编码 #070a12, 而页面 --bg 随主题/日夜变(如日间是浅色 #eff8f8);
//   → 浏览器顶部地址栏带 + 底部工具栏带 保持深色, 与页面割裂 = 上下黑边。PWA(black-translucent)则靠 html/body 铺色。
//   对策: 每次换肤/切日夜后, 读实时生效的 --bg, 同步写进 ① theme-color meta(浏览器状态栏/工具栏带 + PWA状态栏)
//   ② html/body 的 backgroundColor(iOS 橡皮筋回弹区/安全区/键盘残留露出的兜底色)。任何缝隙露出的都成主题色。
function syncThemeColor(){
  try{
    // 读真正生效的背景色(injectThemeCSS 注入的 --bg, 已含 data-theme×data-mode 的最终值)
    var bg=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if(!bg) return;
    var mc=document.querySelector('meta[name="theme-color"]');
    if(!mc){ mc=document.createElement('meta'); mc.name='theme-color'; document.head.appendChild(mc); }
    if(mc.content!==bg) mc.content=bg;
    // html 显式刷底色(它是铺满整屏含安全区的层, 且叠着底部氛围光渐变作兜底)。
    // ★不要动 body: body 背景故意透明, 好让 html 那层氛围光透上来铺满整屏(含安全区)消除底部硬缝;
    //   若这里给 body 钉 backgroundColor 会盖住 html 的光 → 内容区变纯色、安全区仍带光 = 缝又出现。
    document.documentElement.style.backgroundColor=bg;
  }catch(e){}
}
function applyMode(mode){
  const day=resolveDay(mode);
  document.documentElement.setAttribute('data-mode', day?'day':'night');
  document.querySelectorAll('.mode-opt').forEach(el=>el.classList.toggle('active', el.dataset.mode===(mode||currentMode())));
  syncThemeColor();
}
function pickMode(mode){
  try{ EhSfx.playClick(); }catch(e){}
  try{ localStorage.setItem(LS_MODE, mode); }catch(e){}
  applyMode(mode);
}
// auto 模式按时间切日/夜: 定时检查, 跨过 7点/19点边界自动切换(当前 data-mode 与应为值不一致才重新 apply, 避免频繁无意义重绘)
setInterval(()=>{
  if(currentMode()!=='auto') return;
  const shouldDay=resolveDay('auto');
  const isDay=document.documentElement.getAttribute('data-mode')==='day';
  if(shouldDay!==isDay) applyMode('auto');
}, 60*1000);
function applyTheme(id){
  if(!THEMES.some(t=>t.id===id)) id='cyber';
  if(id==='cyber') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme',id);
  document.querySelectorAll('.skin-opt').forEach(el=>el.classList.toggle('active', el.dataset.theme===id));
  syncThemeColor();
}
// 用户手动选皮肤 → 全站生效 + 锁定(进官方房不再自动覆盖)
function pickTheme(id){
  try{ EhSfx.playClick(); }catch(e){}
  try{ localStorage.setItem(LS_THEME,id); localStorage.setItem(LS_THEME_LOCK,'1'); }catch(e){}
  applyTheme(id);
}
function currentTheme(){ try{ return localStorage.getItem(LS_THEME)||'cyber'; }catch(e){ return 'cyber'; } }
function themeLocked(){ try{ return localStorage.getItem(LS_THEME_LOCK)==='1'; }catch(e){ return false; } }
// ---- 主题随场景: 未锁主题时, 深夜/节日给个应景皮肤建议(手动锁了则完全不干预) ----
// 节日按 月-日 匹配(可扩展); 深夜(23:00-05:00)偏暗色系。返回皮肤 id 或 null(用默认)。
const FESTIVAL_THEME = {
  '1-1':'sunset', '2-14':'rose', '12-24':'klein', '12-25':'klein', '12-31':'sunset',
  '10-31':'mono',   // 万圣: 暗金
};
function sceneTheme(){
  try{
    const d=new Date();
    const fk=(d.getMonth()+1)+'-'+d.getDate();
    if(FESTIVAL_THEME[fk]) return FESTIVAL_THEME[fk];   // 节日优先
    const h=d.getHours();
    if(h>=23 || h<5) return 'mono';   // 深夜 → 暗夜奢华(暗金, 护眼有格调)
  }catch(e){}
  return null;
}
// 大厅/无房主题(未锁时叠加场景建议; 锁了或场景无建议则用用户默认)
function sceneOrDefaultTheme(){
  if(themeLocked()) return currentTheme();
  return sceneTheme() || currentTheme();
}
// 房间名稳定哈希: djb2 变种(charCodeAt 累加*31), 同名永远同结果
function roomThemeHash(name){
  const s = String(name||'');
  let h = 5381;
  for(let i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}
// 主题池兼容入口: 池为空/非数组/含非法主题id → 降级到所有 THEMES
// 主题id必须在 EH_CONFIG.themes 里存在, 否则无意义
function sanitizeThemePool(pool){
  const valid = new Set((EH_CONFIG.themes||[]).map(t=>t.id));
  const out = (Array.isArray(pool)?pool:[]).filter(id=>valid.has(id));
  if(out.length) return out;
  // 兼容降级: 用 THEMES 全集, 避免后台误清空后计算断开
  return (EH_CONFIG.themes||[]).map(t=>t.id);
}
// 房间 → 主题id: 官方房查 ROOM_THEME; 公开/私密先查 override, 再按名哈希分配池
function roomThemeFor(room){
  if(!room) return null;
  const name = room.name;
  const kind = room.kind;
  // 0. 任意房手动覆盖(后台可配) — 优先级最高
  try{
    const ov = (EH_CONFIG.roomThemeOverride)||{};
    if(name && ov[name]){
      const valid = new Set((EH_CONFIG.themes||[]).map(t=>t.id));
      if(valid.has(ov[name])) return ov[name];
    }
  }catch(_){}
  // 1. 官方房: ROOM_THEME[name]
  if(kind==='official' && ROOM_THEME && ROOM_THEME[name]) return ROOM_THEME[name];
  // 2. 公开/私密: 池[hash(name)%len]
  if(kind==='public' || kind==='private'){
    const raw = (kind==='public') ? EH_CONFIG.publicThemePool : EH_CONFIG.privateThemePool;
    const pool = sanitizeThemePool(raw);
    if(pool.length){
      const idx = roomThemeHash(name) % pool.length;
      return pool[idx];
    }
  }
  return null;
}
// 进房间: 用户没手动锁定 → 自动套该房所属主题(官方/公开/私密统一取 roomThemeFor); 不写 localStorage, 离房还原
function applyRoomTheme(room){
  if(themeLocked()){ applyTheme(currentTheme()); return; }
  const tid = roomThemeFor(room);
  if(tid) applyTheme(tid);
  else applyTheme(currentTheme());
}
function initThemeUI(){
  const menu=$('#skinMenu'); if(!menu) return;
  const modeRow = `<div class="mode-row"><div class="mode-opt" data-mode="auto">自动</div><div class="mode-opt" data-mode="day">日间</div><div class="mode-opt" data-mode="night">夜间</div></div>`;
  const buildMenu = m => m.innerHTML=modeRow+THEMES.map(t=>`<div class="skin-opt" data-theme="${t.id}"><span class="dot" style="color:${t.dot};background:${t.dot}"></span>${t.name}<span class="ck" style="color:${t.dot}">✓</span></div>`).join('');
  const bindMode = m => m.querySelectorAll('.mode-opt').forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); pickMode(el.dataset.mode); const other=(m.id==='skinMenu')?$('#skinMenuHall'):$('#skinMenu'); if(other) applyMode(currentMode()); });
  const bind = m => { m.querySelectorAll('.skin-opt').forEach(el=>el.onclick=()=>{ pickTheme(el.dataset.theme); m.classList.remove('on'); const other=(m.id==='skinMenu')?$('#skinMenuHall'):$('#skinMenu'); if(other) other.classList.remove('on'); syncSkinActive(); }); bindMode(m); };
  buildMenu(menu); bind(menu);
  const btn=$('#skinBtn');
  // 菜单开→按钮保持选中态, 关→取消
  const syncSkinActive=()=>{ if(btn) btn.classList.toggle('active', menu.classList.contains('on')); const bh=$('#skinBtnHall'), mh=$('#skinMenuHall'); if(bh&&mh) bh.classList.toggle('active', mh.classList.contains('on')); };
  window.syncSkinActive=syncSkinActive;
  if(btn) btn.onclick=(e)=>{ e.stopPropagation(); menu.classList.toggle('on'); syncSkinActive(); };
  // 聊天页版皮肤菜单
  const menuHall=$('#skinMenuHall');
  const btnHall=$('#skinBtnHall');
  if(menuHall){ buildMenu(menuHall); bind(menuHall); }
  if(btnHall && menuHall) btnHall.onclick=(e)=>{ e.stopPropagation(); menuHall.classList.toggle('on'); syncSkinActive(); };
  // 全局关闭菜单
  document.addEventListener('click',e=>{
    if(menu && !menu.contains(e.target) && e.target!==btn) menu.classList.remove('on');
    if(menuHall && !menuHall.contains(e.target) && e.target!==btnHall) menuHall.classList.remove('on');
    syncSkinActive();
  });
  applyMode(currentMode());   // 初始同步外观模式高亮态 + 确保 data-mode 与首屏一致
  // BGM 按钮绑定统一交给 initBgmUI() 里的下拉菜单实现；此处不再重复挂 onclick
  applyTheme(sceneOrDefaultTheme());   // 启动全局主题(未锁时叠加深夜/节日场景皮肤)
  initBgmUI();
  loadRemoteConfig();   // 异步拉取后台配置覆盖(完成后重注入主题变量)
}
function goScene(id){ document.querySelectorAll('.scene').forEach(s=>s.classList.remove('on')); $('#'+id).classList.add('on'); document.body.classList.toggle('hall-on', id==='hall');
  // ★lobby-on: 大厅改"整文档滚动"(而非内层容器滚), 让移动浏览器下滑时自动收起顶/底地址栏→真沉浸无黑边。
  //   入口/聊天页仍是固定视口(hall 有固定输入框, 不能整页滚)。切走大厅时把文档滚动位置归零, 防残留。
  document.body.classList.toggle('lobby-on', id==='lobby');
  // ★V49: 同步给 <html> 加/删 lobby-on，避免依赖 :has() 选择器（小米 MiuiBrowser 内核不支持 :has() → 大厅首页滑不动）。
  document.documentElement.classList.toggle('lobby-on', id==='lobby');
  if(id!=='lobby'){ try{ window.scrollTo(0,0); }catch(_){} }
  // 进聊天页只做一次布局收尾；键盘控制器本身监听 visualViewport，不再重复补调。
  if(id==='hall'){ try{ window.__ehApplyVVH?.(); }catch(_){} }
  // 切场景清掉可能残留的全屏遮挡(录音浮层), 防其挡住点击
  const _ro=$('#recOverlay'); if(_ro) _ro.classList.remove('on');
  // 落到大厅 → 大厅氛围随机连播(chain 会保留正在播的曲, 从房间返回时丝滑续播, 不打断)
  if(id==='lobby'){ try{ startLobbyBGM(); }catch(_){} }
  else if(id==='enter'){ try{ AudioEngine.stop(); }catch(_){} }   // 回到入场/登出页: 停 BGM
}

// ============ 全局状态 ============
let curRoom = null;        // {id,name,emoji,kind,topic,role}
let msgChan = null;        // Realtime postgres_changes 频道
let _tailPollTimer = null; // 房内周期兜底轮询: 补住 realtime socket 僵死(切后台/弱网/降频)期间漏投的消息
let presChan = null;       // Realtime presence 频道
let oldestId = null;       // 已加载最早消息 id(用于加载更多)
let replyTo = null;        // 正在引用的消息 {id,name,text}
let voidMode = false;      // 虚空模式: 下条消息匿名 + 限时消散
// 运行参数实时读取器: 从 EH_CONFIG.tuning 取(后台 eh_config 可覆盖), 带兜底默认值。
// 用函数而非 const, 因 loadRemoteConfig 是异步的, 启动时固化 const 会拿不到远程值。
const TUNE=(k,def)=>{ const v=EH_CONFIG.tuning&&EH_CONFIG.tuning[k]; return (typeof v==='number'&&!isNaN(v))?v:def; };
const VOID_TTL = ()=>TUNE('voidTtlMs',300000);   // 虚空消息存活时长(ms)
const VOID_NAMES = EH_CONFIG.identityPool.voidNames;
let echoState = {};        // message_id -> { [emoji]: {count, mine} }  多情绪回声
const HISTORY_PAGE = ()=>TUNE('historyPage',60);   // 私密房每页条数
// 五种回声情绪: 共鸣/动容/脑电/困惑/观测
// 消息反应: 用全球通用款(点赞/爱心/笑/举手同意/观望), 一眼懂, 类似 +1/yes 语义
const ECHO_KINDS = [
  {e:'👍', label:'赞'},
  {e:'❤️', label:'爱了'},
  {e:'😂', label:'哈哈'},
  {e:'🙌', label:'+1'},
  {e:'👀', label:'关注'},
];
const ECHO_EMOJIS = ECHO_KINDS.map(k=>k.e);
// 反应环最近使用: 贴过的表情记进 localStorage(最新在前、去重), 渲染反应环时优先显示,
// 不足 5 个用默认款补齐 → 常用表情自动沉淀到快捷位。
const LS_ECHO_MRU='eh_echo_mru';
function loadEchoMru(){ try{ const a=JSON.parse(localStorage.getItem(LS_ECHO_MRU)||'[]'); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
function pushEchoMru(emoji){
  if(!emoji) return;
  let a=loadEchoMru().filter(e=>e!==emoji); a.unshift(emoji); a=a.slice(0,4);
  try{ localStorage.setItem(LS_ECHO_MRU, JSON.stringify(a)); }catch(e){}
}
// 反应环当前要显示的 5 个: 最近用过的在前, 用默认款补足到 5(去重)
function echoQuickList(){
  const mru=loadEchoMru();
  const seen=new Set(), out=[];
  const push=(e,label)=>{ if(e&&!seen.has(e)){ seen.add(e); out.push({e,label:label||''}); } };
  mru.forEach(e=>push(e, (ECHO_KINDS.find(k=>k.e===e)||{}).label));
  ECHO_KINDS.forEach(k=>push(k.e,k.label));
  return out.slice(0, arguments[0]||4);   // 可传数量: 让上方表情行(表情+➕)与下方操作行数量对齐
}
const RESONANCE_THRESHOLD = ()=>TUNE('resonanceThreshold',5);   // 共鸣触发阈值(后台可配)
const resonatedMsgs = new Set(); // 已触发过涟漪的 message_id+emoji, 防重复轰炸

// ============ 大厅渲染 ============
const OFFICIAL_FALLBACK_C = EH_CONFIG.officialFallbackC;
const ROOM_KIND_C = EH_CONFIG.roomKindC || { public:'#1DE9B6', private:'#B57EDC', official:'#0ABAB5' };
// 统一取房间强调色: 官方按名查表, 公开/私密按类型查 roomKindC
// 取指定主题id 的 --accent(从themePalettes读, 不写死)
function themeAccentById(themeId){
  try{
    const pal = (EH_CONFIG.themePalettes||{})[themeId];
    if(pal && pal['--accent']) return pal['--accent'];
  }catch(_){}
  return null;
}
// 读官方房名对应主题的 accent(向后兼容旧呼叫点)
function themeAccentOf(roomName){
  const themeId = (EH_CONFIG.roomTheme||{})[roomName];
  return themeAccentById(themeId);
}
const ROOM_NAME_C = EH_CONFIG.roomNameC || {};   // 按房名定制主色(任意房型), 优先于 kind/主题色
function roomAccentC(r){
  if(!r) return ROOM_KIND_C.official;
  if(r.name && ROOM_NAME_C[r.name]) return ROOM_NAME_C[r.name];   // 房名定制色最高优先(如午夜聊天=莫兰迪玫瑰)
  if(r.kind==='official'){
    return themeAccentOf(r.name) || OFFICIAL_FALLBACK_C[r.name] || ROOM_KIND_C.official;
  }
  // 公开/私密: 卡片强调色 = 该房分配主题的 accent; 拿不到降级 roomKindC
  try{
    const tid = (typeof roomThemeFor==='function') ? roomThemeFor(r) : null;
    const c = themeAccentById(tid);
    if(c) return c;
  }catch(_){}
  return ROOM_KIND_C[r.kind] || ROOM_KIND_C.official;
}
// 灵魂取色优先级: custom(灵魂 DB 色, 即 admin 灵魂工坊调色板设的, 合法非空 hex) > soulColors[name](JS专属色兜底) > 所在房间强调色 > fallback
// ★2026-07: custom 提到最高优先——原来 soulColors 硬编码盖过 DB, 导致 admin 里改灵魂色不生效(如老K DB设了#4A5D7E却显硬编码色)。
// name 参数按灵魂名匹配(私密房召唤副本 uid 变但名字不变), 支持字符串或含 .name 的对象
function soulThemeColor(custom, fallback, name){
  // 0. 灵魂自身 custom 色(DB eh_souls.color, admin 可视化调色板直接编辑, 用户显式设置优先级最高)
  if(typeof custom==='string' && /^#[0-9a-fA-F]{3,8}$/.test(custom)) return custom;
  // 1. JS soulColors[name] 兜底专属色(DB 未设色的灵魂走这里, 从新十主题选)
  try{
    const nm = (typeof name==='string') ? name : (name && name.name) || '';
    const sc = (EH_CONFIG && EH_CONFIG.soulColors) || {};
    if(nm && sc[nm] && /^#[0-9a-fA-F]{3,8}$/.test(sc[nm])) return sc[nm];
  }catch(e){}
  // 2. 房间强调色
  try{
    if(curRoom && curRoom.kind){
      const c=roomAccentC(curRoom);
      if(c) return c;
    }
  }catch(e){}
  // 3. fallback
  return fallback || ROOM_KIND_C.official;
}
let _themeUIInit=false;
// 大厅房间查询带超时: 慢网/弱网下 sb 查询可能永不返回 → 骨架卡死不消失(见 21:09 截图 6KB/s)。
// 8s 超时后抛错, 由 renderLobby 的重试兜底; 不再无限挂骨架。
function roomsQuery(q, ms=8000){ return withTimeout(q, ms).catch(()=>({data:null,__timeout:true})); }
let _lobbyRetryTimer=null;
let _lobbyRetryN=0;   // 已自动重试次数(有成功即清零); 超上限停自动重试, 改给用户可点的"重试"入口
const LOBBY_RETRY_MAX=4;
async function renderLobby(soft){
  if(!_themeUIInit){ initThemeUI(); _themeUIInit=true; }
  const _ln=$('#lobbyName'); if(_ln){ _ln.textContent=me.name; _ln.style.color=me.color; }
  const rs=await Promise.all([renderOfficial(soft), renderPublic(soft), renderMyRooms(soft)]);
  // 任一区块因超时/失败没拿到数据 → 稍后自动重试(有上限), 避免骨架永久卡住 + 无限重试空转
  const anyFail=rs.some(x=>x&&x.failed);
  if(!anyFail){ _lobbyRetryN=0; return; }   // 全部成功: 重置计数
  if(_lobbyRetryTimer) return;
  if(_lobbyRetryN < LOBBY_RETRY_MAX){
    _lobbyRetryN++;
    _lobbyRetryTimer=setTimeout(()=>{ _lobbyRetryTimer=null; if($('#lobby')&&$('#lobby').classList.contains('on')) renderLobby(false); }, 2500);
  } else {
    // 重试到上限仍失败(真·慢网/离线): 把还卡着骨架的官方区换成可点重试, 给用户反馈+控制权, 不再干耗
    lobbyShowRetry();
  }
}
// 大厅加载多次失败 → 官方频道区显示"网络较慢，点击重试"(点了清零计数重新拉)
function lobbyShowRetry(){
  const box=$('#channels'); if(!box) return;
  if(box.querySelector('.lobby-retry')) return;   // 已在则不重复插
  box.innerHTML='<div class="lobby-retry" style="grid-column:1/-1;text-align:center;padding:22px 16px;color:var(--sub);font-size:13px;cursor:pointer;border:1px dashed var(--line2);border-radius:14px">网络较慢，点击重试 ↻</div>';
  const el=box.querySelector('.lobby-retry');
  // 点重试: 先确保 supabase 库/session 就绪(可能上次是库都没加载出来→sb 为空, 光 renderLobby 拉不到),
  //   再清零计数重渲。库仍拉不到→重新显示重试入口, 不静默卡死。
  if(el) el.onclick=async()=>{
    _lobbyRetryN=0; box.innerHTML=chSkel(4);
    try{ await awaitSb(8000); if(!myUid){ ensureAuth().then(()=>renderLobby(true)).catch(()=>{}); } renderLobby(false); }
    catch(_){ lobbyShowRetry(); }
  };
}
// 频道卡骨架(慢网先占位): 结构与 .ch 一致
function chSkel(n){ let s=''; for(let i=0;i<n;i++) s+='<div class="ch-skel"><div class="sk-b sk-icon"></div><div class="sk-b sk-h"></div><div class="sk-b sk-d"></div><div class="sk-b sk-l"></div></div>'; return s; }
function rmSkel(n){ let s=''; for(let i=0;i<n;i++) s+='<div class="rm-skel"><div class="sk-b sk-ric"></div><div class="sk-b sk-rnm"></div></div>'; return s; }
async function renderOfficial(soft){
  const box=$('#channels');
  // soft 刷新: 卡片 DOM 已在则只静默刷新在线数/预览，不清空重建(消除返回闪烁)
  if(soft && box.children.length){
    box.querySelectorAll('.ch[data-rid]').forEach(c=>fillRoomStats(box, c.dataset.rid));
    prefetchAll([...box.querySelectorAll('.ch[data-rid]')].map(c=>({id:c.dataset.rid,kind:'official'})));
    return;
  }
  if(!box.children.length) box.innerHTML=chSkel(4);   // 慢网先占位, 不留空白
  const _r = await roomsQuery(sb.from('eh_rooms').select('id,name,emoji,topic').eq('kind','official').order('created_at'));
  if(_r.__timeout){ return {failed:true}; }   // 超时: 保留骨架, 交给 renderLobby 重试, 不清空也不卡死
  const { data } = _r;   // ★修复: 之前漏解构 data, 官方房渲染读到悬空/全局 data → 首页官方频道空白
  const cfg=(EH_CONFIG&&EH_CONFIG.lobbyDisplay)||{};
  const om=(cfg.official&&typeof cfg.official==='object')?cfg.official:{};
  const visible=(data||[]).map(r=>({r, o:om[r.name]||{}})).filter(x=>x.o.visible!==false);
  visible.sort((a,b)=>(Number.isFinite(+a.o.order)?+a.o.order:9999)-(Number.isFinite(+b.o.order)?+b.o.order:9999));
  box.innerHTML=visible.map(({r,o})=>{
    const c=roomAccentC({...r,kind:'official'});
    const title=o.title||r.name, desc=o.desc!=null?o.desc:(r.topic||'');
    return `<div class="ch" data-rid="${r.id}" data-nm="${esc(r.name)}" data-em="${safeEmoji(r.emoji)}" data-kind="official" style="--ch-c:${c}">
      <div class="tagk">官方</div><div class="icon">${safeEmoji(r.emoji)}</div><h3>${esc(title)}</h3>
      <div class="desc">${esc(desc)}</div>
      <div class="live"><span class="pulse"></span><span class="cnt">…</span><span class="tm"></span></div>
      <div class="preview empty" data-prev>加载中…</div></div>`;
  }).join('');
  bindRoomCards(box);
  (data||[]).forEach(r=>fillRoomStats(box, r.id));
  prefetchAll((data||[]).map(r=>({id:r.id,kind:'official'})));
}
async function renderPublic(soft){
  const box=$('#publicRooms'), empty=$('#publicEmpty');
  if(soft && box.children.length){
    box.querySelectorAll('.ch[data-rid]').forEach(c=>fillRoomStats(box, c.dataset.rid));
    prefetchAll([...box.querySelectorAll('.ch[data-rid]')].map(c=>({id:c.dataset.rid,kind:'public'})));
    return;
  }
  if(!box.children.length) box.innerHTML=chSkel(2);   // 慢网先占位
  const _r = await roomsQuery(sb.from('eh_rooms').select('id,name,emoji,topic').eq('kind','public').eq('archived',false).order('created_at',{ascending:false}));
  if(_r.__timeout){ return {failed:true}; }   // 超时: 保留骨架, 交给 renderLobby 重试
  const { data } = _r;
  const cfg=(EH_CONFIG&&EH_CONFIG.lobbyDisplay)||{};
  if(cfg.publicVisible===false){ box.innerHTML=''; empty.style.display='none'; return; }
  if(!data || !data.length){ box.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  box.innerHTML=data.map(r=>`<div class="ch" data-rid="${r.id}" data-nm="${esc(r.name)}" data-em="${safeEmoji(r.emoji)}" data-kind="public" style="--ch-c:${roomAccentC({...r,kind:'public'})}">
    <div class="tagk">公开</div><div class="icon">${safeEmoji(r.emoji)}</div><h3>${esc(r.name)}</h3>
    <div class="desc">${esc(r.topic||autoTopic(r.name))}</div>
    <div class="live"><span class="pulse"></span><span class="cnt">…</span><span class="tm"></span></div>
    <div class="preview empty" data-prev>加载中…</div></div>`).join('');
  bindRoomCards(box);
  (data||[]).forEach(r=>fillRoomStats(box, r.id));
  prefetchAll((data||[]).map(r=>({id:r.id,kind:'public'})));
}
// 相对时间: 刚刚/N分钟前/N小时前/N天前
function fmtAgo(ts){
  const s=Math.floor((Date.now()-new Date(ts).getTime())/1000);
  if(s<60) return '刚刚'; if(s<3600) return Math.floor(s/60)+'分钟前';
  if(s<86400) return Math.floor(s/3600)+'小时前'; return Math.floor(s/86400)+'天前';
}
// 从卡片 .cnt 文字("N 人在线")解析已知在线数，用于进房乐观显示
function readKnownOnline(cardEl){
  try{ const t=cardEl.querySelector('.cnt')?.textContent||''; const m=t.match(/(\d+)/); return m?parseInt(m[1],10):null; }catch(e){ return null; }
}
// 进房瞬间的乐观在线数文案: 已知数(你自己刚进 +1)先顶上，真实 presence 回来再精确覆盖
function optimisticCnt(room){
  const k=room&&room.knownOnline;
  if(k!=null && k>=0){ const n=k+1; return `<span class="cnt-led" id="cntLed"></span>~ <b>${n}</b> 人在线`; }
  return '<span class="cnt-led" id="cntLed"></span>连接中…';
}
// 异步填充卡片动态数据: 在线人数 + 最新消息预览 + 活跃时间
async function fillRoomStats(box, rid){
  const card=box.querySelector(`.ch[data-rid="${rid}"]`); if(!card) return;
  const since=new Date(Date.now()-35000).toISOString();
  const [{ count }, { data:recent }] = await Promise.all([
    sb.from('eh_presence').select('*',{count:'exact',head:true}).eq('room_id',rid).gte('last_seen',since),
    sb.rpc('eh_public_recent',{ rid, lim:20, hide_recalled:true }),   // 拉 20 条: 跳过 enter(进场广播)等非聊天内容取真正"最后一句"; lim:5 开不够——短时间同一用户连续进出 5+ 次会将窗口挡满后误报“还没有人说话”。
  ]);
  const online=count||0;
  const cnt=card.querySelector('.cnt'); if(cnt) cnt.textContent = online>0? online+' 人在线' : '暂无人在线';
  // 进场广播 enter 不是聊天内容, 不能当大厅"最后一条"预览(否则一进房主页就变"✦ 有人进入了房间")
  const last=(Array.isArray(recent)? recent.find(m=>m && m.kind!=='enter') : null)||null;
  const prev=card.querySelector('[data-prev]'), tm=card.querySelector('.tm');
  if(last){
    prev.classList.remove('empty');
    const txt = msgPreview(last);
    // 互动消息的文案本身就是完整句(已含发起人名, 如"狼姐 朝 yiran 扔了颗炸弹"), 不再加"名字："前缀防重复
    const _isIx = last.kind==='interact';
    const nm = _isIx ? '' : (last.anon ? '🕳️ 某个回声' : esc(last.name)+':');
    // 预览发送者名字色规范: 真人=自己个性色(与房间内消息、光墙统一); 灵魂/空色/匿名=回退房间强调色
    let nmC='';
    try{
      if(!last.anon){
        const roomC=roomAccentC({name:card.dataset.nm,kind:card.dataset.kind||'official'});
        const userC=(typeof safeColor==='function' && last.color && /^#[0-9a-fA-F]{3,8}$/.test(last.color)) ? last.color : null;
        // 灵魂(is_bot)跟房间色, 真人跟自己色, 兜底房间色
        const c = (last.is_bot ? roomC : (userC || roomC));
        if(c) nmC=` style="color:${c}"`;
      }
    }catch(e){}
    prev.innerHTML=(nm?`<b${nmC}>${nm}</b> `:'')+esc(String(txt).slice(0,40));
    if(tm) tm.textContent=fmtAgo(last.created_at);
  } else {
    prev.classList.add('empty'); prev.textContent='还没有人说话，来当第一个';
  }
}
async function renderMyRooms(soft){
  if(!myUid){ $('#myRooms').innerHTML=''; return; }
  const boxE=$('#myRooms');
  if(soft && boxE.children.length){
    prefetchAll([...boxE.querySelectorAll('.rm[data-rid]')].map(c=>({id:c.dataset.rid,kind:'private'})));
    return;   // 私密房卡片无在线数/预览需刷新, 仅重新预取即可
  }
  if(!boxE.children.length) boxE.innerHTML=rmSkel(2);   // 慢网先占位
  const _r = await roomsQuery(sb.from('eh_rooms').select('id,name,emoji,invite_code,owner').eq('kind','private').order('created_at',{ascending:false}));
  if(_r.__timeout){ return {failed:true}; }   // 超时: 保留骨架, 交给 renderLobby 重试
  const { data } = _r;
  const cfg=(EH_CONFIG&&EH_CONFIG.lobbyDisplay)||{};
  const box=$('#myRooms'); const pe=$('#privEmpty');
  if(cfg.privateVisible===false){ box.innerHTML=''; if(pe) pe.style.display='none'; return; }
  if(!data || !data.length){ box.innerHTML=''; if(pe) pe.style.display='block'; return; }
  if(pe) pe.style.display='none';
  box.innerHTML=data.map(r=>`<div class="rm" data-rid="${r.id}" data-nm="${esc(r.name)}" data-em="${safeEmoji(r.emoji)}" data-kind="private">
    <span class="rm-ic">${safeEmoji(r.emoji)}</span><span class="rm-nm">${esc(r.name)}</span>
    ${r.owner===myUid?'<span class="rm-badge">房主</span>':''}
    ${r.invite_code?`<span class="rm-code" data-code="${esc(r.invite_code)}" title="点击复制邀请码">${esc(r.invite_code)}<svg class="rm-copy-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></span>`:''}<span class="rm-arr">→</span></div>`).join('');
  box.querySelectorAll('.rm').forEach(el=>el.onclick=()=>enterRoom({id:el.dataset.rid,name:el.dataset.nm,emoji:el.dataset.em,kind:'private',knownOnline:readKnownOnline(el)}));
  box.querySelectorAll('.rm-code[data-code]').forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); copyInvite(el.dataset.code, el); });
  prefetchAll((data||[]).map(r=>({id:r.id,kind:'private'})));
}
// 复制邀请码: 优先 clipboard API, 失败降级 execCommand(webview/非安全上下文兜底), 复制成功给卡片短暂反馈
function copyInvite(code, el){
  const done=()=>{ if(el){ el.classList.add('copied'); setTimeout(()=>el.classList.remove('copied'),1200); } toast(EH_CONFIG.text.ok_codeCopied||'邀请码已复制'); };
  const fail=()=>toast(EH_CONFIG.text.err_copyFail||'复制失败，请手动长按');
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(code).then(done, ()=>fallbackCopy(code)?done():fail());
  } else { fallbackCopy(code)?done():fail(); }
}
function fallbackCopy(text){
  try{ const ta=document.createElement('textarea'); ta.value=text; ta.style.cssText='position:fixed;top:-999px;opacity:0';
    document.body.appendChild(ta); ta.select(); const ok=document.execCommand('copy'); document.body.removeChild(ta); return ok;
  }catch(e){ return false; }
}
const PREFETCH_N = ()=>TUNE('prefetchN',48);      // 预取条数(后台可配)
let _snapTailBusy=false;   // refreshSnapshotTail 并发锁: 多个补拉触发点(缓存/订阅就绪/keep-alive)会并发,
                           // 各自在对方 append 前查"消息在DOM吗"都判否→重复append(实测同条×3)。串行化根治。
const PREFETCH_TTL = ()=>TUNE('prefetchTtlMs',60000);  // 预取缓存有效期(后台可配)
const prefetchCache={};        // rid → { at, p:Promise<rows> }
const soulsCache={};           // rid → { at, p:Promise<souls[]> } —— 房间灵魂列表(含"后台是否开启"),列表页预取,进房秒用
let roomSnap=null;            // 最近离开房间的DOM快照: {rid,html,oldestId,echoState,at} —— keep-alive 快速回房秒显
// 把当前房消息 DOM 持久化到 localStorage → 下次【刷新】首帧静态回填(见页首防闪脚本读 eh_room_snap)。
// 只留最近 ~30 条(localStorage 有 ~5MB 限, 且首帧只需铺满一屏), 太旧/太多截掉。节流调用。
let _persistSnapT=0;
function persistRoomSnap(){
  if(!curRoom) return;
  const now=Date.now();
  if(now-_persistSnapT < 3000) return;   // 节流: 3s 内最多存一次(连发消息不狂写)
  _persistSnapT=now;
  // ★序列化(outerHTML×30 + JSON.stringify)+同步 localStorage 写较重, 放进空闲期做,
  //   不阻塞消息渲染/滚动帧(多人密集聊天时防掉帧)。
  const doWrite=()=>{
    try{
      if(!curRoom) return;
      const st=$('#stream'); if(!st) return;
      const msgs=[...st.querySelectorAll('.msg')];
      const tail=msgs.slice(-30);
      const html=tail.map(m=>m.outerHTML).join('');
      if(!html) return;
      localStorage.setItem('eh_room_snap', JSON.stringify({ rid:curRoom.id, html, at:Date.now() }));
    }catch(e){ /* localStorage 满/隐私模式 → 忽略 */ }
  };
  if(window.requestIdleCallback) requestIdleCallback(doWrite, { timeout:2000 });
  else setTimeout(doWrite, 0);
}
// 预取某房灵魂列表(eh_room_souls RPC 只返回 enabled=true 的,故后台关掉的机器人不会出现)
function prefetchSouls(rid){
  const hit=soulsCache[rid];
  if(hit && Date.now()-hit.at < PREFETCH_TTL()) return hit.p;
  const p = sb.rpc('eh_room_souls',{ rid }).then(({data})=>data||[]).catch(()=>[]);
  soulsCache[rid] = { at:Date.now(), p };
  return p;
}
function prefetchRoom(rid, kind){
  prefetchSouls(rid);   // 灵魂列表随消息历史一起预取(列表页错峰,不拖慢首屏)
  const hit=prefetchCache[rid];
  if(hit && Date.now()-hit.at < PREFETCH_TTL()) return;   // 命中且未过期
  let p;
  if(kind==='official' || kind==='public'){
    p = sb.rpc('eh_public_recent',{ rid, lim:PREFETCH_N() }).then(({data})=>data||[]).catch(()=>[]);
  } else {
    // 私密房: 我的房间都是已加入的，直查最近(成员RLS放行)
    p = sb.from('eh_messages').select('*').eq('room_id',rid).order('id',{ascending:false}).limit(PREFETCH_N())
          .then(({data})=>data||[]).catch(()=>[]);
  }
  prefetchCache[rid] = { at:Date.now(), p };
}
// 列表渲染后主动错峰预取(避免十几房同时打请求拖慢首屏在线数/预览)
function prefetchAll(rooms){
  rooms.forEach((r,i)=>setTimeout(()=>prefetchRoom(r.id, r.kind), 120*i));
}
function bindRoomCards(box){
  box.querySelectorAll('.ch').forEach(el=>{
    const room={ id:el.dataset.rid, name:el.dataset.nm, emoji:el.dataset.em, kind:el.dataset.kind };
    room.knownOnline = readKnownOnline(el);   // 从卡片已显示的在线数取乐观初值
    const pf=()=>prefetchRoom(room.id, room.kind);
    el.addEventListener('pointerenter', pf);   // 桌面悬停预取
    el.addEventListener('touchstart', pf, {passive:true}); // 移动按下预取
    el.onclick=()=>enterRoom(room);
  });
}

// ============ 进入房间 ============
const SNAP_TTL=30000;   // 快照有效期 30s
// 刷新页面后恢复上次所在房间(进大厅后调, 仅当有记录)
function lastRoom(){ try{ const s=localStorage.getItem('eh_last_room'); const r=s&&JSON.parse(s); return (r&&r.id)?r:null; }catch(e){ return null; } }
// ★ 同步立即清除“上次所在房间”标记。用于所有“用户主动导航到非房间场景”的动作(返回大厅/登录/注册/匿名进入/登出)。
// 必须同步、先于任何 await 执行: 防止“切场景后立即刷新”时 eh_last_room 未及时清除 → 首帧防闪又把用户拉回旧房间。
function clearLastRoom(){ try{ localStorage.removeItem('eh_last_room'); }catch(e){} }
// 登录态就绪后恢复现场: 上次在某房间→直接进房(大厅DOM后台备好但不切场景, 免闪首页); 否则进大厅。
function resumeAfterAuth(){
  const r=lastRoom();
  if(r){ renderLobby(true); enterRoom(r); }   // 备好大厅数据供返回时秒显, 但场景直接落在房间
  else { if(!cameFromLink) toast(EH_CONFIG.text.ok_welcomeBack); goScene('lobby'); renderLobby(); }
}
// 刷新时同步预绘上次所在房间的骨架(切到 hall 场景), 避免先闪 enter/lobby 再跳回房间。
// 判据: 有 last_room + 本地 me.id(曾登录过, 无论正式/临时账号 —— 临时匿名 session 也持久化)。
// 不解析 supabase 内部存储(其格式在不同版本会 base64/分片, JSON.parse 会失败)。session 若实际失效, 靠兜底回落 enter。
function preRestoreScene(){
  const r=lastRoom(); if(!r) return false;
  if(!me || !me.id) return false;
  const hi=$('#hallIcon'); if(hi){ hi.textContent=safeEmoji(r.emoji)||'💬';
    const rc = roomAccentC(r);
    hi.style.setProperty('--room-c', rc); }
  const kindLabel = r.kind==='private'?'私密':(r.kind==='public'?'公开':'官方');
  const nt=$('#hallNameTxt'); if(nt) nt.innerHTML=esc(r.name);
  const pr=$('#presence'); if(pr) pr.innerHTML=presenceSkeleton(3);
  goScene('hall'); setConn(false,'连接中');
  return true;
}
async function enterRoom(room){
  try{ _ehDbg('[enter] rid=', room&&room.id, 'name=', room&&room.name); }catch(_){}
  try{ window.startMoodWeather && window.startMoodWeather(); }catch(_){}
  try{ window.ehLog && ehLog('room_enter',{room_id:room&&room.id,name:room&&room.name,kind:room&&room.kind}); }catch(_){}
  try{ EhSfx.play('enter'); }catch(e){}
  try{ window.EhFx&&EhFx.warp(); }catch(e){}   // 空间穿越转场
  ehArm();   // 进房武装返回键: 之后按浏览器返回=退回大厅,不离开页面
  _presenceSettled = false;   // 进场动效: 新房光墙重新计"首批", 首批渲染不弹入
  curRoom = room;
  // 💋 私密房(尤其邀了狼姐 @wolf)→ 挂"暧昧红"氛围类; 其余房去掉
  try{ document.body.classList.toggle('priv-heat', room && room.kind==='private'); }catch(_){}
  stopVoice(); stopSong();
  // 记住当前房间: 刷新页面后自动恢复进房(私密房需成员, 也可恢复)
  try{ localStorage.setItem('eh_last_room', JSON.stringify({id:room.id,name:room.name,emoji:room.emoji,kind:room.kind})); }catch(e){}
  // keep-alive: 快速回到刚离开的同一房间(30s内) → 直接还原 DOM 快照秒显，跳过重拉+重渲染
  const snapHit = !_cachePurged && roomSnap && roomSnap.rid===room.id && (Date.now()-roomSnap.at < SNAP_TTL);
  const kindLabel = room.kind==='private'?'私密':(room.kind==='public'?'公开':'官方');
  { const _hi=$('#hallIcon'); if(_hi){ _hi.textContent=safeEmoji(room.emoji)||'💬';
    // 与列表页同款: 图标底色取房间主题色(官方按名/公开绿/私密紫)
    const rc = roomAccentC(room);
    _hi.style.setProperty('--room-c', rc); } }
  $('#hallNameTxt').innerHTML=esc(room.name);
  clearReply();
  if(snapHit){
    // 秒还原已渲染消息 + 滚动位置状态。★先剔除快照里烘焙进去的旧进场横幅(否则回房会看到上次的横幅残留)
    let _snapHtml = roomSnap.html;
    try{ const _d=document.createElement('div'); _d.innerHTML=_snapHtml; _d.querySelectorAll('.entry-banner,.sysmsg').forEach(e=>e.remove()); _snapHtml=_d.innerHTML; }catch(_){}
    $('#stream').innerHTML=_snapHtml; oldestId=roomSnap.oldestId; echoState=roomSnap.echoState||{};
    $('#presence').innerHTML=presenceSkeleton((room.knownOnline!=null?room.knownOnline+1:3)); $('#hallCnt').innerHTML=optimisticCnt(room);
    renderPresenceSnapshot(room);   // 乐观铺光墙(命中快照则秒显旧头像, 不等后面的网络await)
    goScene('hall'); setConn(false,'连接中'); scrollStream(); applyRoomTheme(room); startRoomBGM(room);
    roomSnap=null;
    await ensureAuth();
    subscribeMessages(room.id);      // 补挂订阅接离开期间/后续新消息(连接灯由其 subscribe 状态驱动)
    try{ entranceBanner(room); }catch(_){}   // 进场动效: keep-alive 回房也要演(否则快速回房看不到进场特效)
    if(await joinAsMember(room)===false) return;
    // allSettled: 任一查询失败也不拖垮其余(避免一次网络抖动 → Promise.all reject → 卡"连接中")
    const [memRes] = await Promise.allSettled([
      sb.from('eh_members').select('role').eq('room_id',room.id).eq('user_id',myUid).maybeSingle(),
      setupPresence(room),
      refreshSnapshotTail(room),       // 后台静默补拉最新一屏，覆盖空窗期新消息(保证最终一致)
      loadRoomSouls(room.id), (_interactions.length?Promise.resolve():loadInteractions())           // 拉本房灵魂居民(展示层)
    ]);
    room.role = memRes?.value?.data?.role || 'member';
    { const g=$('#gearBtn'); if(g) g.classList.toggle('show', room.role==='owner' && room.kind!=='official'); }
    return;
  }
  // ---- 无快照: 原全量流程 ----
  $('#stream').innerHTML=''; oldestId=null; echoState={};
  _mentionQueue=[]; updateMentionJump();   // 切房清空@我提醒
  _songReadyQueue=[]; _songGenQueue=[]; _songGenIdx=0; updateSongJump();   // 切房清空神曲谱好+谱曲中提醒
  $('#hallCnt').innerHTML=optimisticCnt(room);
  $('#presence').innerHTML=presenceSkeleton((room.knownOnline!=null?room.knownOnline+1:3));
  renderPresenceSnapshot(room);   // 乐观铺光墙(命中快照则秒显旧头像, 不等后面的网络await)
  goScene('hall'); setConn(false,'连接中'); applyRoomTheme(room); startRoomBGM(room);

  await ensureAuth();
  subscribeMessages(room.id);   // 连接灯由其 subscribe 状态驱动
  const isPublic = room.kind==='official' || room.kind==='public';
  const histP = isPublic ? loadHistory(true) : null;
  if(await joinAsMember(room)===false) return;
  const tasks=[ histP || loadHistory(true),
    sb.from('eh_members').select('role').eq('room_id',room.id).eq('user_id',myUid).maybeSingle(),
    setupPresence(room),
    loadRoomSouls(room.id), (_interactions.length?Promise.resolve():loadInteractions()) ];
  // allSettled: 单个失败不拖垮全流程,不再因一次抖动卡死在"连接中"
  const results = await Promise.allSettled(tasks);
  const memRes = results[1];
  room.role = memRes?.value?.data?.role || 'member';
  { const g=$('#gearBtn'); if(g) g.classList.toggle('show', room.role==='owner' && room.kind!=='official'); }
  try{ entranceBanner(room); }catch(_){ try{ sysMsg(`你以 <b>${esc(me.name)}</b> 的身份进入了「${esc(room.name)}」`); }catch(__){} }
  // EH_OPT_TAROT_DELAY: 塔罗牌不再进场秒弹(打扰), 改为在房内待够约1小时后随机弹一次(当天没弹过).
  scheduleDailyTarot(room && room.id);
  // 漂流瓶: 进房捞回信(我丢的瓶有人回了→漂回来) + 低概率从海里捞一个别人的瓶
  setTimeout(()=>{ try{ fishMyBottleReplies(); }catch(_){} }, 2600);
  setTimeout(()=>{ try{ if(secureRand()<0.5) fishBottleFromDB(); }catch(_){} }, 4200);
  ensureBottom();   // 进房后确保精准落到最后一条(覆盖分批渲染/头像字体/神曲卡片异步撑高导致的"停在中间")
  setTimeout(()=>{ try{ persistRoomSnap(); }catch(_){} }, 1200);   // 进房消息渲染稳定后存快照, 供下次刷新首帧回填
}
// 进房收尾: 分批渲染/图片/字体/神曲卡片会在首次 scroll 之后继续撑高 stream, 单次 scrollStream
// 会停在中途(常卡在"你进入房间"提示上方)。用多帧 + 递增延迟反复贴底, 直到高度稳定。
function ensureBottom(persistent){
  const s=$('#stream'); if(!s) return;
  // persistent=true(软刷新用): 更久更稳地贴底——分批渲染/神曲卡/图片会中途暂时稳定再继续长高,
  //   误判"稳定"就停会导致停在中间/回弹。改成"连续 stableNeed 次高度不变"才认定真稳, 且总时长更长。
  const maxTries = persistent ? 30 : 8;
  const gap = persistent ? 100 : 120;
  const stableNeed = persistent ? 4 : 1;   // 连续几次高度不变才算稳
  let lastH=-1, tries=0, stable=0;
  const kick=()=>{
    s.scrollTop=s.scrollHeight; hideToLatest();
    if(s.scrollHeight===lastH) stable++; else { stable=0; lastH=s.scrollHeight; }
    if(stable<stableNeed && tries<maxTries){ tries++; setTimeout(kick, gap); }
  };
  requestAnimationFrame(kick);
}

// 双击房间名 → 软刷新: 只重拉当前房消息数据 + 重渲染 + 回到最新, 不刷新整个页面。
// 用途: realtime 偶发漏消息 / 感觉不是最新时, 手动强制对齐一次。
let _softRefreshing=false;
async function softRefreshRoom(){
  if(!curRoom || _softRefreshing) return;
  _softRefreshing=true;
  const nm=$('#hallName'); if(nm) nm.classList.add('refreshing');
  try{
    oldestId=null; echoState={};                // 重置分页/回声状态, 拉全新一屏
    $('#stream').innerHTML='';                   // 清空 DOM(不动页面/场景)
    await loadHistory(true);                     // 重新拉最近消息并渲染(带超时兜底)
    try{ resyncMsgOwnership(); }catch(_){}       // 校正左右归属
    try{ updateSongQueueBar(); }catch(_){}       // 刷神曲生成中态
    ensureBottom(true);                          // 持久贴底(分批渲染/异步撑高期间反复对齐, 防回弹)
    try{ EhSfx.play('tick'); }catch(_){}
    toast('已刷新到最新');
  }catch(e){ console.warn('softRefreshRoom', e); toast('刷新失败, 请重试'); }
  finally{ _softRefreshing=false; if(nm) nm.classList.remove('refreshing'); }
}

// 快照命中后后台补拉最新一屏，比对已在 DOM 的 mid，只 append 空窗期新增的消息(不重渲染整屏)
async function refreshSnapshotTail(room){
  if(_snapTailBusy) return;   // 并发锁: 多触发点同时补拉会各自漏判→重复append, 串行化
  _snapTailBusy=true;
  try{
    const isPublic = room.kind==='official' || room.kind==='public';
    let rows;
    if(isPublic){ const {data}=await sb.rpc('eh_public_recent',{rid:room.id,lim:TUNE('publicRecentLimit',500)}); rows=(data||[]).slice().reverse(); }
    else { const {data}=await sb.from('eh_messages').select('*').eq('room_id',room.id).order('id',{ascending:false}).limit(HISTORY_PAGE()); rows=(data||[]).slice().reverse(); }
    // ★防串房: await RPC(几百ms)期间用户可能已切到别的房, stream 已是新房的 DOM。
    //   若不校验就 append, 会把本房消息塞进当前(别的)房→串房。发现已离房则放弃。
    if(!curRoom || curRoom.id!==room.id) return;
    dedupProjInHistory(rows);   // 与 loadHistory 同款去重: 灵魂投影的 proj 与 msg 重复时跳过 proj
    const stream=$('#stream');
    const near = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80;  // 补前先判断是否贴底
    // 当前 DOM 里已渲染的最大 mid: 补拉只接"比它更新的空窗消息"(append到底部)。
    // 不去碰更早的历史消息——那些由 loadHistory 的 idle 分批渲染负责; 若补拉也去补,
    // 会和"还在队列里没进DOM"的分批消息撞车→重复渲染(实测见过一条消息×2)。
    let domMaxMid=0;
    // 扫所有带 mid 的行(含 .msg / .ixmsg 互动 / .actmsg / .recalled-tip), 别只扫 .msg——
    // 否则互动/act 行不计入 domMaxMid, 且下面判重也漏, 刷新补拉会把它们反复 append(重复bug真因)。
    stream.querySelectorAll('[data-mid]').forEach(e=>{ const id=+e.dataset.mid; if(!isNaN(id)&&id>domMaxMid) domMaxMid=id; });
    let appended=0;
    rows.forEach(m=>{
      if(!m || m.id==null) return;
      const exist=stream.querySelector(`[data-mid="${m.id}"]`);
      if(!exist){
        // 只补比 DOM 现有最新还新的(空窗新消息); 更早的不补(交给分批渲染, 防重复)
        if(m.id>domMaxMid){ const el=buildMsgEl(m, true); if(el){ stream.appendChild(el); appended++; } }
        return;
      }
      // ★ keep-alive 快照修复铁律: 快照可能是"渲染未完成态"截下来的(分批渲染没跑完/打字机中断),
      //   DOM 里 data-mid 存在但 .txt 是空框。这类不能跳过, 要用真实 data 原地重建修复空框。
      try{
        const kind=exist.dataset.kind||'msg';
        if(kind==='voice'||kind==='song'||kind==='proj'||kind==='interact'||kind==='act') return;   // 特效/互动/act消息不判空(无.txt, 内容非纯文本)
        const t=exist.querySelector('.txt');
        const hasTxt = t && t.textContent.trim();
        if(!hasTxt && (m.text||'').trim()){
          const fresh=buildMsgEl(m, true);
          if(fresh){ exist.replaceWith(fresh); }
        }
      }catch(_){}
    });
    if(near && appended){ ensureBottom(); trimStreamHead(); }   // 有补进新消息且原本贴底 → 精准落底 + 修剪
  }catch(e){ console.warn('refreshSnapshotTail', e); }
  finally{ _snapTailBusy=false; }
}

async function joinAsMember(room){
  if(!room) return false;
  // 私密房准入只做成员资格校验: 邀请码加入已由 eh_join_by_code RPC 代插成员。
  // 这里禁止再裸 insert，避免绕过邀请码/权限模型；校验套超时，后端慢时安全失败而不是卡住。
  if(room.kind==='private'){
    let data=null, error=null;
    try{ ({ data, error } = await withTimeout(
      sb.from('eh_members').select('role').eq('room_id',room.id).eq('user_id',myUid).maybeSingle(),
      8000, { data:null, error:new Error('timeout') }
    )); }catch(e){ error=e; }
    if(error || !data){
      console.warn('private room membership check', error||'not member');
      try{ clearLastRoom(); }catch(_){ }
      try{ if(msgChan){ await sb.removeChannel(msgChan); msgChan=null; } }catch(_){ }
      try{ if(_tailPollTimer){ clearInterval(_tailPollTimer); _tailPollTimer=null; } }catch(_){ }
      try{ if(presChan){ await sb.removeChannel(presChan); presChan=null; } }catch(_){ }
      curRoom=null;
      try{ setConn(false,'需要邀请码'); }catch(_){ }
      try{ toast(error&&error.message==='timeout'?'私密房权限确认超时，请稍后重试':'需要邀请码才能进入私密房'); }catch(_){ }
      try{ goScene('lobby'); renderLobby(); }catch(_){ }
      return false;
    }
    return true;
  }
  // 公开/官方房自动 upsert 成员(重复靠主键忽略)，套超时防止进房流程卡住。
  let error=null;
  try{ ({ error } = await withTimeout(sb.from('eh_members').insert({
    room_id:room.id, user_id:myUid, role:'member', name:me.name, emoji:me.emoji, color:me.color
  }), 8000, { error:new Error('timeout') })); }catch(e){ error=e; }
  if(error && !/duplicate|unique/i.test(error.message||'')) console.warn('join', error);
  return true;
}

// ---- 历史消息 ----
// 公开房(官方/public)：走 eh_public_recent(方案B，未进房/匿名也能读最近100条，更快)，不分页。
// 私密房：走直查(成员RLS，成员只看加入后)，支持"加载更多"分页。
// 历史 rows 里灵魂投影去重: 灵魂同时发 msg + proj 两条时, 投影 proj 就与 msg 重复,
// 把这种 proj 标 _skipHist. 真人 broadcastProject 只发 proj 一条(无同内容 msg), 不会被打标, 仍作为历史气泡保留。
function dedupProjInHistory(rows){
  if(!Array.isArray(rows) || rows.length<2) return;
  // 先按 user_id + norm(text) 建包含 msg 的索引(只看非 proj 消息)
  const msgKeys = new Set();
  for(const m of rows){
    if(!m || m.kind==='proj' || !m.user_id || !m.text) continue;
    msgKeys.add(m.user_id + '\u0001' + String(m.text).trim().slice(0,200));
  }
  for(const m of rows){
    if(!m || m.kind!=='proj' || !m.user_id || !m.text) continue;
    const key = m.user_id + '\u0001' + String(m.text).trim().slice(0,200);
    if(msgKeys.has(key)) m._skipHist = true;
  }
}

async function loadHistory(first){
  const _enterRid = curRoom && curRoom.id;   // 进房时的房id: 拉取(await)期间可能切房, 渲染前校验防串房
  const isPublic = curRoom.kind==='official' || curRoom.kind==='public';
  let rows; let _usedCache=false;   // 本次首屏是否用了预取缓存(用了→进房后补拉最新, 覆盖预取到进房的空窗新消息)
  if(isPublic){
    // 优先用预取缓存(悬停/按下时已开始拉)，命中则瞬间显示；否则现拉
    let data;
    const hit=prefetchCache[curRoom.id];
    // 关键: 预取 promise / RPC 都套 10s 超时。网络抖动时它们会 hang→await 永不返回→
    // loadHistory 卡死→消息永久空白(偶发"进房卡住"根因)。超时则降级现拉一次。
    if(first && !_cachePurged && hit && Date.now()-hit.at < TUNE('prefetchTtlMs',60000)){
      try{ data = await withTimeout(hit.p, 10000); }catch(_){ data=null; }
      delete prefetchCache[curRoom.id]; _usedCache=true;
    }
    if(data===undefined || data===null){   // 无缓存命中 或 缓存超时 → 现拉(也带超时)
      try{ ({ data } = await withTimeout(sb.rpc('eh_public_recent',{ rid:curRoom.id, lim:TUNE('publicRecentLimit',500) }), 12000, { data:[] })); }
      catch(_){ data=[]; }
    }
    rows = (data||[]).slice().reverse();  // rpc 按 id desc 返回，倒回正序
    if(rows.length){ oldestId = rows[0].id; }
  } else {
    // 私密房: 首屏优先用预取缓存(命中则瞬开)，否则现拉分页
    const hit=prefetchCache[curRoom.id];
    let histTimedOut=false, usedCacheRows=false;
    if(first && !_cachePurged && !oldestId && hit && Date.now()-hit.at < TUNE('prefetchTtlMs',60000)){
      try{
        const data = await withTimeout(hit.p, 15000);
        rows = (data||[]).slice().reverse();
        if(rows.length){ oldestId = rows[0].id; }
        _usedCache=true; usedCacheRows=true;
      }catch(e){ console.warn('private history cache timeout', e); histTimedOut=true; rows=[]; }
      delete prefetchCache[curRoom.id];
    }
    if(!usedCacheRows){
      let q = sb.from('eh_messages').select('*').eq('room_id',curRoom.id).order('id',{ascending:false}).limit(HISTORY_PAGE());
      if(oldestId) q = q.lt('id', oldestId);
      let data=[], error=null;
      try{ ({ data, error } = await withTimeout(q, 15000)); }
      catch(e){ console.warn('private history query timeout', e); histTimedOut=true; data=[]; }
      if(error){ console.warn('private history query', error); }
      rows = (data||[]).slice().reverse();
      if(rows.length){ oldestId = rows[0].id; }
    }
    if(histTimedOut && curRoom && curRoom.id===_enterRid){ try{ toast('历史加载超时，下拉重试'); }catch(_){ } }
  }
  // 加载更多按钮(仅私密房分页；公开房走 rpc 封顶, 无更多)
  const canLoadMore = !isPublic && (rows.length===HISTORY_PAGE() || rows.length===TUNE('prefetchN',48));
  // ★灵魂投影去重: 同一句灵魂投影会同时产生 msg 留底 + proj 飞幕两条,
  //   历史里两条都会变成气泡 → 重复。把"有同内容 msg"的 proj 标 _skipHist,
  //   buildMsgEl 历史分支遇 _skipHist 跳过。真人 broadcastProject 只发 proj 一条不受影响。
  // ★防串房: 拉取期间已切到别的房 → 放弃渲染, 否则把本房历史塞进当前(别的)房
  if(!curRoom || curRoom.id!==_enterRid) return;
  dedupProjInHistory(rows);
  const stream=$('#stream');
  let moreBtn=$('#loadMoreBtn');
  // ★分批渲染铁律: 一次同步构建几百条 msg 的 innerHTML 会阻塞手机主线程好几秒
  //   → 用户看到气泡框但文字"多等一会儿才出来"。改成:
  //   1) 首屏立即同步渲染最近 N=FIRST_PAINT_N 条(填一屏够看), 用户秒见文字
  //   2) 剩余较早消息用 requestIdleCallback 分批(每批 IDLE_BATCH 条)追加到顶部, 不阻塞
  const FIRST_PAINT_N = TUNE('firstPaintN', 60);
  const IDLE_BATCH = TUNE('idleBatchN', 30);
  if(first){
    // 首屏: 只取最新 FIRST_PAINT_N 条同步渲染
    const head = rows.length > FIRST_PAINT_N ? rows.slice(-FIRST_PAINT_N) : rows;
    const rest = rows.length > FIRST_PAINT_N ? rows.slice(0, rows.length - FIRST_PAINT_N) : [];
    const frag=document.createDocumentFragment();
    head.forEach(m=>{ const el=buildMsgEl(m, true); if(el) frag.appendChild(el); });
    stream.appendChild(frag); scrollStream();
    // 兜底回补左右归属: 正式账号 session 恢复慢, 历史可能在 myUid 就绪前渲染→自己的消息判成别人靠左。
    // 无论时序如何, 首屏渲染完再回补一次(渲染时/回补时至少一次拿到真 myUid)。
    try{ resyncMsgOwnership(); }catch(e){}
    try{ setTimeout(()=>{ try{ resyncMsgOwnership(); }catch(e){} }, 800); }catch(e){}   // 再延迟兜底(等session彻底恢复)
    try{ setTimeout(()=>{ try{ updateSongQueueBar(); }catch(e){} }, 400); }catch(e){}   // 历史里若有卡住的 pending 神曲 → 启动队列条监视
    // 用了预取缓存 → 缓存可能已滞后(最长60s), 后台补拉一次最新, 覆盖"预取到进房"的空窗新消息(修"进房非最新, 要刷新")
    if(_usedCache && curRoom){ const _r=curRoom; setTimeout(()=>{ if(curRoom&&curRoom.id===_r.id) refreshSnapshotTail(_r).catch(()=>{}); }, 60); }
    fetchEchoes(head.map(m=>m.id));
    if(canLoadMore) addLoadMore();
    // 剩余较早消息分批 idle 渲染, 不阻塞首屏
    if(rest.length){
      const rid0 = curRoom && curRoom.id;   // 快照房id: 切房后停止本轮分批, 防往错房插消息
      // requestIdleCallback 带 timeout(1s): 页面不在前台/CPU忙时 idle 回调会被无限推迟,
      // 导致分批渲染中途"卡住"→较早消息(几百条)永远渲染不出、公开房又无"加载更早"→永久看不到。
      // timeout 强制到点必跑; 无 rIC 的浏览器用 setTimeout 保底。
      const schedule = window.requestIdleCallback ? (cb=>requestIdleCallback(cb,{timeout:250})) : (cb=>setTimeout(cb,16));
      const drainRest = ()=>{
        if(!rest.length) return;
        if(curRoom && curRoom.id!==rid0) return;   // 已切到别的房, 停止
        const batch = rest.splice(-IDLE_BATCH);  // 从尾部取(时间上更靠近首屏, 用户往上翻先看到)
        const prevH = stream.scrollHeight, prevTop = stream.scrollTop;
        const bfrag = document.createDocumentFragment();
        batch.forEach(m=>{ const el=buildMsgEl(m, true); if(el) bfrag.appendChild(el); });
        stream.insertBefore(bfrag, stream.firstChild);
        // 保持视觉滚动位置不跳(往顶插入内容会顶高)
        stream.scrollTop = prevTop + (stream.scrollHeight - prevH);
        try{ resyncMsgOwnership(); }catch(e){}   // 这批较早消息里自己发的也归位到右侧
        fetchEchoes(batch.map(m=>m.id));
        if(rest.length) schedule(drainRest);
      };
      schedule(drainRest);
    }
    // 预热最近几首已生成神曲: 进房看到的歌还没点就预取好, 点击秒播(只拉最新3首省流量)
    try{ const cards=[...stream.querySelectorAll('.song-card:not(.pending)[data-url]')].slice(-3); cards.forEach(c=>{ if(c.dataset.url) prefetchSong(c.dataset.url); }); }catch(_){}
    // 扫我自己发的卡住的 pending 神曲: 如果存储桶里已有 mp3 → 直接补 patch, 不重新调 MiniMax
    try{ resumeStuckPendingSongs().catch(()=>{}); }catch(_){}
  } else {
    const frag=document.createDocumentFragment();
    rows.forEach(m=>{ const el=buildMsgEl(m, true); if(el) frag.appendChild(el); });
    const prevH=stream.scrollHeight;
    if(moreBtn) moreBtn.remove();
    stream.insertBefore(frag, stream.firstChild);
    if(canLoadMore) addLoadMore(true);
    stream.scrollTop = stream.scrollHeight - prevH;
    fetchEchoes(rows.map(m=>m.id));
  }
}
function addLoadMore(top){
  const stream=$('#stream');
  const b=document.createElement('button'); b.className='load-more'; b.id='loadMoreBtn'; b.textContent='↑ 加载更早的消息';
  b.onclick=()=>loadHistory(false);
  stream.insertBefore(b, stream.firstChild);
}

// ---- Realtime 订阅新消息 + echo ----
async function subscribeMessages(rid){
  // 先 await 清旧 channel, 根治旧房推送串进新房的竞态
  if(msgChan){ try{ await sb.removeChannel(msgChan); }catch(_){} msgChan=null; }
  if(_tailPollTimer){ clearInterval(_tailPollTimer); _tailPollTimer=null; }   // 清旧房的兜底轮询
  msgChan = sb.channel('room-msg:'+rid)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'eh_messages',filter:'room_id=eq.'+rid}, p=>{
      const m=p.new;
      // ★防串房: 双保险 — 既 await removeChannel 也已根治, 仍保留 rid 匹配 防奇奇怪怪注入
      if(!curRoom || curRoom.id!==rid || m.room_id!==rid) return;
      // 去重靠"真实 id 是否已在 DOM"(本浏览器发的消息 insert 后回填了真实 id, 故被挡)。
      // 不再用 user_id===myUid 一律跳过——否则同一账号在【另一浏览器/设备】发的消息本端收不到。
      // 这样同 id 多端发言能互相同步, 且 buildMsgEl 里 isMe=user_id===myUid 让它仍显示在"我的"位置(右侧)。
      if(document.querySelector(`[data-mid="${m.id}"]`)) return; // 已渲染过(含本端乐观上屏已回填id + 互动/act行)，防重复
      // 投影：触发全屏飞幕，不进消息流。★自己发的投影已在 broadcastProject 里本地飞过一次,
      //   realtime 又把自己的 insert 推回来 → 会飞第二次(重复)。故自己的 proj 回声直接跳过。
      if(m.kind==='proj'){ if(m.user_id!==myUid) projectText(m.text, m.color); return; }
      // whisper 只有目标能收(RLS 已挡，但 realtime 可能推来，再挡一次)
      if(m.kind==='whisper' && m.to_user!==myUid) return;
      // 进场广播: 别人看到进场横幅(高阶档还全屏光幕)。自己的已在 entranceBanner 本地演过, 跳过。
      //   enter 不进历史/不留气泡(text 存的是档位字符串, 非聊天内容)。
      if(m.kind==='enter'){
        // 2分钟内同一人只提示一次: 快速进出/来回切房不重复弹进场(避免同时冒两个)
        if(m.user_id!==myUid && enterDedupOk(m.user_id)){ try{ renderEntrance({ name:m.name, tier:String(m.text||'reg'), roomName:curRoom&&curRoom.name }, false); }catch(_){} }
        return;
      }
      // 互动: 播特效。震动/闪屏/抖动只给目标本人(挨打的才震), 旁观者看飞行物/撒花但不震。
      if(m.kind==='interact'){
        const parts=String(m.text||'').split('|'); const ix=_interactions.find(i=>i.id===parts[0]); const targetUid=parts[1];
        if(ix){
          const iAmTarget=(targetUid===myUid);
          const iSent=(m.user_id===myUid);   // 自己发的已在 sendInteraction 本地演过, 不重复
          if(!iSent){
            const tEl=document.querySelector(`#presence .pav[data-uid="${targetUid}"]`)||null;
            const fx=iAmTarget ? ix.fx : Object.assign({}, ix.fx, {vibrate:null, shake:false, flash:null});
            try{ playInteractionFx(fx, tEl); }catch(_){}
            // 连击对战: 别人发起的打击类计入战斗态(自己发起的已在 sendInteraction 里记过)
            if(isHitIx(ix)){ try{ const r=tEl&&tEl.getBoundingClientRect(); combatOnHit(m.user_id, m.name, targetUid, targetName(targetUid), r?r.left+r.width/2:null, r?r.top+r.height/2:null); }catch(_){} }
          }
          // 合体特效: 所有互动(含自己)都汇入同心共振统计
          try{ fusionOnInteract(m.user_id, ix, targetUid, targetName(targetUid)); }catch(_){}
        }
        // 继续往下走 buildMsgEl 渲染系统行(所有人都看到文案)
      }
      // 灵魂居民消息：兜底标记 is_bot(旧消息该列可能为空)。按 uid 或名字兜底(同名多uid副本)
      if(isSoulUser(m.user_id, m.name)){ m.is_bot=true; }
      // 内容已到达 → 本地立刻抹掉该人"正在输入"并即时刷新 typing bar, 不等 presence 通道(否则会有空档)。
      if(m.user_id!==myUid){ _typingSuppress.set(m.user_id, Date.now()); try{ renderTyping(lastUsersSnapshot||[]); }catch(_){} }
      const _wasNear=nearBottom(); const _mine=(m.user_id===myUid);
      const el=buildMsgEl(m); if(el){ $('#stream').appendChild(el); if(_wasNear||_mine){ scrollStream(!_mine); } else { bumpUnread(); } ehFx(el, m.is_bot?'fx-soul':'fx-in', m.is_bot?1200:600); if(!m.is_bot && !_mine) ehFx(el,'fx-say',900); try{ EhSfx.play(m.is_bot?'soul':'receive'); }catch(e){} }
      // 灵魂普通文字消息 → 本地打字机逐字显示(好看; 零成本, 不走网关流式)
      if(el && m.is_bot && m.kind==='msg' && !isEmojiOnly(m.text)) typewriterInto(el, m.text);
      maybeResonate(m);
      if(isEmojiOnly(m.text)) burst(m.text);
      notifyIfMentioned(m, el);   // 被 @ → 强提醒
      try{ trackChatHeat(m); }catch(e){}   // 多人发言声波涟漪
      if(m.kind==='song') try{ updateSongQueueBar(); }catch(e){}   // 新 pending 神曲 → 刷队列条
      try{ persistRoomSnap(); }catch(_){}   // 新消息落 → 更新刷新用快照(内部节流)
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'eh_messages',filter:'room_id=eq.'+rid}, p=>{
      // 流式:灵魂消息边生成边 UPDATE text → 找到对应气泡打字机式更新 .txt
      const m=p.new;
      if(!curRoom || curRoom.id!==rid || m.room_id!==rid) return;   // 防串房: 旧channel残留推送不处理
      // ★撤回 UPDATE(A方案: deleted_at 从 null → 时间戳): 整条气泡换成占位.
      //   放在"自己UPDATE跳过"之前, 因为房主/管理员撤别人时 m.user_id=原作者, 撤回者是 deleted_by,
      //   原作者自己也需要收到这个事件把自己的消息换成占位.
      if(m.deleted_at){
        const old=document.querySelector(`.msg[data-mid="${m.id}"], .recalled-tip[data-mid="${m.id}"]`);
        if(old){ const ph=buildMsgEl(m); if(ph) old.replaceWith(ph); }
        return;
      }
      // song UPDATE (神曲生成完回写) 不跺“自己发的不重放”——发送者自己也需要“归队”动效
      if(m.user_id===myUid && m.kind!=='song') return;
      const el=document.querySelector(`.msg[data-mid="${m.id}"] .txt`);
      if(!el) return;
      // 神曲/emoji 定稿由 kind 决定,流式中途都是纯文本,直接 esc+@高亮更新
      // 定稿时 kind 从占位的 msg 变成了 song/act(神曲/动作) → 整条重建成对应样式
      const bubble=document.querySelector(`.msg[data-mid="${m.id}"]`);
      if(!m.streaming && (m.kind==='song'||m.kind==='act') && bubble){
        if(isSoulUser(m.user_id, m.name)) m.is_bot=true;
        // song “归队”: 旧卡片 pending → 新卡片 ready 时加呢呼吸高亮
        let wasPending=false;
        if(m.kind==='song'){
          const oldCard=bubble.querySelector('.song-card');
          wasPending = oldCard && oldCard.classList.contains('pending');
        }
        const fresh=buildMsgEl(m);
        if(fresh){
          bubble.replaceWith(fresh);
          if(wasPending){
            const nc=fresh.querySelector('.song-card');
            if(nc && !nc.classList.contains('pending')){
              nc.classList.add('arrived');
              // 音频域加固批B: acapella ready 回写 → 清 120s 降级定时器, 避免误报
              try{ const tid=_EH_ACAPELLA_TIMERS.get(String(m.id)); if(tid){ clearTimeout(tid); _EH_ACAPELLA_TIMERS.delete(String(m.id)); } }catch(_){}
              setTimeout(()=>nc.classList.remove('arrived'), 3400);
              try{ if(nc.dataset.url) prefetchSong(nc.dataset.url); }catch(_){}
              try{
                if(m.user_id===myUid){
                  const st=$('#stream');
                  const r=fresh.getBoundingClientRect();
                  const vis = st ? (r.top>=0 && r.bottom<=st.getBoundingClientRect().bottom+40) : false;
                  if(!vis) pushSongReady(m.id);
                }
              }catch(_){}
            }
          }
        }
        try{ updateSongQueueBar(); }catch(e){}   // 一首谱好归位 → 刷队列条(可能减一首或隐藏)
      } else if(m.kind==='song'){
        // 少见分支：bubble 不存在 才走这里
        el.innerHTML=songHtml(m.text);
      }
      else if(m.kind==='voice'){ /* 语音不流式 */ }
      else {
        // ★流式 UPDATE 到达: 先取消该消息正在跑的打字机(防两个异步互相覆盖成半截/空白), 再直接写完整文本
        const bub2=document.querySelector(`.msg[data-mid="${m.id}"]`);
        if(bub2 && bub2._twTimer){ clearTimeout(bub2._twTimer); bub2._twTimer=null; }
        el.innerHTML=renderAtMentions(esc(m.text||''));
      }
      // 生成完(streaming=false)时,若是纯emoji放个粒子
      if(!m.streaming && isEmojiOnly(m.text)) burst(m.text);
      const s=$('#stream'); if(s.scrollHeight-s.scrollTop-s.clientHeight<120) scrollStream();
    })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'eh_message_echoes'}, p=>{
      // 客户端过滤: eh_message_echoes 表无 room_id 列, 用 DOM 判断该消息是否属当前房
      if(!document.querySelector(`.msg[data-mid="${p.new.message_id}"]`)) return;
      applyEchoRealtime(p.new.message_id, p.new.user_id, p.new.emoji);
    })
    // 全房间 BGM 广播：当前用户没有本地覆盖时，跟随房间最新曲。
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'eh_room_active_bgm'}, async p=>{
      if(!curRoom || curRoom.id!==rid || !p.new || p.new.room_name!==curRoom.name || _ehBgmOverride) return;
      try{
        const q=await sb.from('eh_user_bgm').select('id,title,url,room_name').eq('id',p.new.bgm_id).maybeSingle();
        if(q.data && q.data.url) AudioEngine.start({name:'🎼 '+(q.data.title||'全房间新曲'),url:q.data.url});
      }catch(e){ console.warn('bgm broadcast receive',e); }
    })
    .on('broadcast',{event:'bgm.change'}, p=>{
      const x=p.payload||{};
      if(!curRoom || curRoom.id!==rid || x.room_name!==curRoom.name || _ehBgmOverride || !x.url) return;
      try{ AudioEngine.start({name:'🎼 '+(x.title||'全房间新曲'),url:x.url}); }catch(e){ console.warn('bgm broadcast play',e); }
    })
    // 连接指示灯由 realtime 通道真实状态驱动(而非"一批一次性查询有没有 resolve")。
    // SUBSCRIBED=真的连上了; 掉线/出错/超时→回落"连接中",Supabase 会自动重连,重连成功再置亮。
    .subscribe((status)=>{
      if(status==='SUBSCRIBED'){
        setConn(true);
        // ★关键: 订阅"真正就绪"后补拉一次最新, 兜住"loadHistory 拉完 → 订阅就绪"之间的空窗消息
        // (realtime 异步建立需数百ms, 这段窗口内别人发的消息 loadHistory 没拉到、订阅也没收到 → 原来必须刷新)。
        // 也覆盖掉线重连(SUBSCRIBED 再次触发)期间漏收的消息。用 curRoom 校验防串房。
        try{ if(curRoom && curRoom.id===rid) refreshSnapshotTail(curRoom).catch(()=>{}); }catch(_){}
      }
      else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED') setConn(false,'连接中');
    });
  // ★房内周期兜底轮询(20s): Realtime 的 postgres_changes 不保证不丢——手机切后台/锁屏、弱网瞬断、
  //   标签页降频时 socket 可能"僵死"(状态仍 SUBSCRIBED 但服务端 INSERT 事件永不补发)。
  //   原有补拉只在进房/缓存/SUBSCRIBED/回前台 4 个离散时机触发, 唯独"停在房里盯着屏幕"这段无覆盖
  //   → 灵魂冷不丁发的消息落库但不上屏, 必须退出再进才看到(本次修的 bug)。
  //   refreshSnapshotTail 自带并发锁 + 只 append 比 DOM 更新的行 + 贴底才滚, 周期跑零副作用。
  //   页面 hidden 时跳过(省电; 回前台的 visibilitychange 已单独补一次)。
  if(_tailPollTimer){ clearInterval(_tailPollTimer); }
  _tailPollTimer = setInterval(()=>{
    try{
      if(document.hidden) return;
      if(!curRoom || curRoom.id!==rid){ clearInterval(_tailPollTimer); _tailPollTimer=null; return; }   // 已离房/换房 → 自清
      refreshSnapshotTail(curRoom).catch(()=>{});
    }catch(_){}
  }, 20000);
}

// ---- 在线状态(用 eh_presence 表 + postgres_changes；不用 Realtime Presence，
//      因该项目 realtime.messages 广播通道鉴权不通，postgres_changes 才可靠) ----
const ONLINE_WINDOW = ()=>TUNE('onlineWindowMs',35000);   // 在线判定窗口(后台可配)
let heartbeatTimer = null;
async function setupPresence(room){
  if(presChan){ await sb.removeChannel(presChan); presChan=null; }
  clearInterval(heartbeatTimer);
  // 写自己的心跳。★不要 await：beat 的 upsert 若卡住/超时会把后面的 refreshPresence 也堵死,
  //   导致"N 人在线"文字永远刷不出来、卡在"连接中…"(led 走另一条路已亮,故只文字卡)。
  //   心跳成功与否不该阻塞人数显示 → fire-and-forget,失败自己 warn。
  beat().catch(e=>console.warn('beat', e));
  // 订阅本房 presence 变化 → 刷新光墙
  presChan = sb.channel('room-pres:'+room.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'eh_presence',filter:'room_id=eq.'+room.id}, ()=>schedulePresenceRefresh())
    .subscribe();
  // 人数/光墙立即刷(不等心跳)。refreshPresence 自己兜底把"我"算进在线, 至少显示 1 人。
  await refreshPresence().catch(e=>console.warn('refreshPresence', e));
  // 心跳 + 清理定时器
  heartbeatTimer = setInterval(async()=>{ beat().catch(()=>{}); refreshPresence().catch(()=>{}); }, 15000);
}
async function beat(extra){
  if(!curRoom) return;
  if(!myUid){ await ensureAuth(); if(!myUid) return; } // 兜底：myUid 未就绪先补登录
  const row = { room_id:curRoom.id, user_id:myUid, name:me.name, emoji:me.emoji, color:me.color, last_seen:new Date().toISOString(), ...(extra||{}) };
  const { error } = await sb.from('eh_presence').upsert(row);
  if(error) console.warn('beat error', error.message);
}
// —— 性能优化: diff 渲染头像 + 拆分 typing 更新, 避免每次心跳/输入全量重建 DOM ——
const presenceMap = new Map();   // user_id → DOM 节点
let _presenceSettled = false;    // 进场动效: 光墙首批渲染完成后置真; 之后新增的真人头像才弹入(避免进房齐弹)
let lastUsersSnapshot = [];       // 供 renderTyping 复用

// 在线列表骨架占位: 进房到 presence 数据回来期间撑住高度, 消除闪烁
function presenceSkeleton(n){
  n=Math.max(1,Math.min(n||3,8));
  let s='';
  for(let i=0;i<n;i++) s+='<div class="pav-skel"><div class="sk-ic"></div><div class="sk-nm"></div></div>';
  return s;
}
// ⚡ 进房时立即用上次快照乐观铺光墙(不等 ensureAuth/joinAsMember/setupPresence 那几个网络await)。
// 命中返回 true(已铺旧头像), 否则 false(调用方保持骨架)。真实 refreshPresence 回来后 diff 无缝替换。
function renderPresenceSnapshot(room){
  try{
    // 私密房不用乐观快照: 成员固定且少, 直接等真实查询, 避免任何缓存串房把陈生人铺到私密房光墙(安全)
    if(room && room.kind==='private') return false;
    const snap=JSON.parse(localStorage.getItem('eh_pres_snap')||'null');
    if(!(snap && snap.rid===room.id && Array.isArray(snap.users) && snap.users.length && (Date.now()-snap.at < 120000))) return false;
    presenceMap.clear();   // 清旧房残留节点引用(骨架 innerHTML 已冲掉 DOM, Map 需同步清)
    let us=snap.users.slice();
    if(myUid && !us.some(u=>u.user_id===myUid)) us.unshift({user_id:myUid,name:me.name,emoji:me.emoji,color:me.color});
    renderPresenceAvatars(us);
    return true;
  }catch(e){ return false; }
}
function renderPresenceAvatars(users){
  const container=$('#presence');
  // 首次真实渲染前, 清掉进房时的骨架占位
  container.querySelectorAll('.pav-skel').forEach(el=>el.remove());
  const seen=new Set();
  users.forEach((p,idx)=>{
    seen.add(p.user_id);
    // 灵魂身份跟随最新(名字/头像/色),覆盖 presence 里的旧快照。必须在 sig 前做,
    // 否则灵魂改色而 presence 快照未变时 sig 不变 → 跳过重建 → 拿不到新色。
    // 按 uid 或名字兜底: 同名多uid的漫游/驻守副本都识别为灵魂(否则光墙头像色错、@变色不一致)。
    const isSoul=isSoulUser(p.user_id, p.name);
    const soulLatest = isSoul ? soulLatestBy(p.user_id, p.name) : null;
    if(soulLatest){ p={...p, name:soulLatest.name, emoji:soulLatest.emoji, color:soulLatest.color}; }
    let el=presenceMap.get(p.user_id);
    const isMe=p.user_id===myUid;
    // 灵魂头像色跟房间强调色(与消息头像/AI角标统一); 真人访客保持自己的个性色
    const c=isSoul ? soulThemeColor(p.color, safeColor(p.color), p) : safeColor(p.color);
    // sig 纳入最终渲染色 c: 换房/换主题致灵魂色变时, sig 变→强制重建头像(否则旧sig命中→卡旧色)
    const sig=(p.name||'')+'|'+(p.emoji||'')+'|'+c+'|'+(isMe?'me':'')+'|'+(isSoul?'ai':'');
    if(el && el.dataset.sig===sig){
      // 顺序可能变了, 位置对齐一下
      if(container.children[idx]!==el) container.insertBefore(el, container.children[idx]||null);
      return;
    }
    const div=document.createElement('div');
    div.className='pav'+(isMe?' me':'')+(isSoul?' soul-av':'');   // soul-av: 灵魂头像带"呼吸=活跃度"动画
    // ★进场动效: 光墙"稳定"后新出现的真人头像(非我/非灵魂/非换色重建)→ 按类型弹入。
    //   _presenceSettled 在进房首批渲染后置真, 避免进房时全体头像齐弹(那是加载, 不是"进场")。
    const isNewJoin = _presenceSettled && !el && !isMe && !isSoul;
    if(isNewJoin && EH_CONFIG.entranceFx && EH_CONFIG.entranceFx.enabled && EH_CONFIG.entranceFx.othersAvatar!==false){
      div.classList.add('ent-pop');
      const jt=userTier(p);   // 他人 presence 行一般无 role, 多为 reg/anon; 有 role/名单命中则升档
      if(tierRank(jt)>=2) div.classList.add('ent-vip');   // 管理员级及以上(含贵宾/自定义档)才带尊贵光环
    }
    div.style.setProperty('--pav-c', c);
    div.title=isMe?'你':('点击 @'+ (p.name||''));
    if(!isMe && p.name){ div.dataset.atname=p.name; div.dataset.uid=p.user_id; }
    // 灵魂在光墙也带 AI 角标(与消息头像一致)
    if(isSoul) div.style.setProperty('--soul-c', c);
    const soulDot=isSoul?`<span class="soul-dot">AI</span>`:'';
    const avBow=isWolfSoul(p)?`<span class="av-bow">🎀</span>`:'';   // 狼姐专属红蝴蝶结
    div.innerHTML=`<div class="av-ic">${avEmoji(safeEmoji(p.emoji))}${soulDot}${avBow}</div><div class="nm">${isMe?'你':esc(p.name||'')}</div>`;
    div.dataset.sig=sig;
    if(el) container.replaceChild(div,el); else container.insertBefore(div, container.children[idx]||null);
    presenceMap.set(p.user_id,div);
  });
  _presenceSettled=true;   // 首批渲染完成 → 之后新增头像才算"进场"
  // 清理离开的人
  presenceMap.forEach((el,uid)=>{ if(!seen.has(uid)){ el.remove(); presenceMap.delete(uid); } });
  // 消息流灵魂头像"在场才呼吸": 用当前在场集(users)标 .onair, 离场灵魂历史消息光环静止。
  syncStreamOnair(users);
  const kindLabel = '人在线';   // 统一: 私密房也用"人在线"(原来私密房特写"名成员在线"和其它房不一致)
  // led 亮灭由 realtime 通道状态(setConn)驱动,这里重建 hallCnt 时沿用当前 led 状态,
  // 不硬写 live——否则 presence 一刷就强点亮,掩盖真实断线。
  const wasLive = $('#cntLed')?.classList.contains('live') ? ' live' : '';
  $('#hallCnt').innerHTML=`<span class="cnt-led${wasLive}" id="cntLed"></span><b>${users.length}</b> ${kindLabel}`;
}

function renderTyping(users){
  const now=Date.now();
  // ★消除"正在输入撤下 → 空档 → 气泡才出现"的逆序间隙: typing(presence通道)与气泡(msg通道)是两条
  //   独立 realtime 通道, 到达时序不定。收到某人消息时会把其 uid 记入 _typingSuppress(见 msg 处理器),
  //   这里直接把"刚发过言的人"从正在输入里剔除 → 内容一出现, 其"正在输入"同帧消失, 零空档。
  const typersP=users.filter(p=>p.user_id!==myUid && p.typing_at && now-new Date(p.typing_at).getTime()<3500 && !(now-(_typingSuppress.get(p.user_id)||0)<4000));
  const typers=typersP.map(p=>p.name);
  const bar=$('#typingBar');
  if(typers.length){
    // 文案: 1人"XX 正在输入"; 2人"甲、乙 正在输入"; ≥3人"甲、乙、丙等N人正在输入"(最多列3名防超长, 胶囊再兜底ellipsis)
    let txt;
    if(typers.length===1) txt=`${typers[0]} 正在输入`;
    else if(typers.length===2) txt=`${typers[0]}、${typers[1]} 正在输入`;
    else txt=`${typers.slice(0,3).join('、')}等${typers.length}人正在输入`;
    $('#typingTxt').textContent=txt; bar.classList.add('on');
    // ★配色规范化: 单人输入时, 用该人自己的颜色(灵魂走 soulThemeColor 与其头像/昵称/@统一, 真人走其身份色);
    //   多人输入用主题 accent。这样"小绵羊 正在输入"是清华紫、"狼姐"是粉, 与全局一致, 不再一律青。
    try{
      let c='';
      if(typers.length===1){
        const p=typersP[0], isSoul=soulUidSet.has(p.user_id)||(soulNameSet&&soulNameSet.has(p.name));
        c = isSoul ? soulThemeColor(p.color||'', undefined, p.name) : safeColor(p.color);
      }
      bar.style.setProperty('--typing-c', c || '');
    }catch(_){ bar.style.removeProperty('--typing-c'); }
  }
  else bar.classList.remove('on');
  // 活跃度反馈(typing_at 3.5s内=正在输入/思考): 所有人头像都做"心跳+加亮"→ 谁在打字一眼可见。
  //   灵魂额外带 soul-live(ping 外扩环+内辉光加亮), 真人只 pav-live(心跳+描边提亮), 静止呼吸仍是灵魂专属身份标记。
  // 单独 toggle class 不进 sig, 不重建 DOM, 过渡平滑。
  const liveUids=new Set(users.filter(p=>p.typing_at && now-new Date(p.typing_at).getTime()<3500 && !(now-(_typingSuppress.get(p.user_id)||0)<4000)).map(p=>p.user_id));
  presenceMap.forEach((el,uid)=>{
    // 自己用本地时间戳判定(即时化, 见 markSelfTyping): 打字时不等 DB 往返, 刷新时也不会误撤本地态。
    const on = uid===myUid ? (now-_selfTypingAt<3500) : liveUids.has(uid);
    applyLive(el,on);
  });
}
// 头像活跃态开关(灵魂→soul-live 带 ping 环, 真人→pav-live 心跳提亮)
function applyLive(el,on){
  if(!el) return;
  if(el.classList.contains('soul-av')) el.classList.toggle('soul-live', on);
  else el.classList.toggle('pav-live', on);
}
// 自己打字时即时点亮自己头像的活跃态, 不等 typing_at 写库+refreshPresence 拉回(那有 1~2s 延迟)。
let _selfTypingAt=0, _selfTypingTimer=0;
// 别人消息一到达就本地抑制其"正在输入"(uid→抑制起始时刻), 消除双通道逆序造成的"撤下→空档→气泡"间隙。
const _typingSuppress=new Map();
function markSelfTyping(){
  _selfTypingAt=Date.now();
  const el=presenceMap.get(myUid); if(el) applyLive(el,true);
  if(_selfTypingTimer) clearTimeout(_selfTypingTimer);
  _selfTypingTimer=setTimeout(()=>{ if(Date.now()-_selfTypingAt>=3500){ const e=presenceMap.get(myUid); if(e) applyLive(e,false); } }, 3600);
}

// 神曲谱曲队列条: 汇总 stream 里所有"谱曲中(pending)"神曲, 当有 pending 卡片滚出可视区时,
// 顶部浮条显示"N首神曲谱曲中"(彩点=各自曲风色), 点它滚到最近一首 → 进度不被后续消息刷走。
// 全房所有人正在谱的歌都算(你要"队列内容全显示")。生成完卡片就绪, pending消失, 条自动更新/隐藏。
function updateSongQueueBar(){
  const stream=$('#stream'); if(!stream){ _songGenCount=0; updateSongJump(); return; }
  const pend=[...stream.querySelectorAll('.song-card.pending')];
  // 超时判定: 神曲发出超 SONG_TIMEOUT_MS(120s)仍 pending → worker 兜底也没救回。
  // 分两级: ①自己发的歌 + 没自动重试过 → 静默自动重试一次(只发送者本人这端做, 避免多观看者重复烧额度)
  //         ②非自己发的 / 自动重试也超时(240s) → 标记超时, 显示手动"点击重试"
  const nowMs=Date.now();
  pend.forEach(c=>{
    const msg=c.closest('.msg'); if(!msg) return;
    const ts=parseInt(msg.dataset.songTs||'0',10); if(!ts) return;
    const age=nowMs-ts;
    const mid=msg.dataset.mid; const mine=(msg.dataset.uid===myUid);
    if(c.classList.contains('timeout')) return;   // 已是手动超时态, 不重复处理
    if(age > SONG_TIMEOUT_MS){
      // 自己发的 + 还没自动重试 → 自动补一次(去重靠 _EH_SONG_GENERATING)
      if(mine && !msg.dataset.autoRetried && mid && !_EH_SONG_GENERATING.has(String(mid))){
        msg.dataset.autoRetried='1'; msg.dataset.songTs=String(nowMs);   // 重置计时, 给自动重试再 120s
        const cm=c.querySelector('.song-composing'); if(cm) cm.textContent='重新谱曲中';
        generateAndPersistSong(String(mid), c.dataset.lyric||'', c.dataset.sid||'', msg).catch(e=>console.warn('auto-retry song',e));
      }
      // 非自己发的, 或自动重试已过(autoRetried 且又超 120s=总 240s) → 转手动超时态
      else if(!mine || msg.dataset.autoRetried){
        c.classList.add('timeout');
        const cm=c.querySelector('.song-composing'); if(cm) cm.textContent='谱曲超时';
        const btn=c.querySelector('.song-play'); if(btn) btn.setAttribute('data-tip','谱曲超时 · 点击重试');
      }
    }
  });
  // pending 数驱动"神"按钮的生成中态(替代原顶部浮条)。点击=滚到最近的 pending 神曲。
  _songGenCount = pend.length;
  // 收集每首谱曲中神曲的 mid(按 DOM 顺序), 供"神"按钮显数字 + 点击依次定位
  _songGenQueue = pend.map(c=>{ const m=c.closest('.msg'); return m&&m.dataset.mid?String(m.dataset.mid):null; }).filter(Boolean);
  if(_songGenIdx >= _songGenQueue.length) _songGenIdx=0;
  _sqbTarget = pend.length ? (pend[pend.length-1].closest('.msg')||pend[pend.length-1]) : null;
  if(!pend.length){ if(_sqbTimer){ clearInterval(_sqbTimer); _sqbTimer=null; } updateSongJump(); return; }
  // 有 pending 就保活轮询: 让超时判定持续跑
  if(!_sqbTimer){ _sqbTimer=setInterval(()=>{ try{ updateSongQueueBar(); }catch(e){} }, 2500); }
  updateSongJump();
}
let _sqbTimer=null;
let _songGenCount=0;   // 当前 pending(生成中)神曲数, 驱动"神"按钮生成中态
let _songGenQueue=[], _songGenIdx=0;   // 谱曲中神曲 mid 队列 + 轮转索引(点"神"依次定位)
const SONG_TIMEOUT_MS=120000;   // 神曲 pending 超 2 分钟(worker 兜底也没救回)→ 标记超时, 可手动重试
let _sqbTarget=null;
(function bindSongQueueBar(){
  // 滚动时刷新(超时判定 + 生成中计数); 顶部浮条已移除, 展示走"神"按钮
  // ★性能: 只有确实有 pending 神曲(_songGenCount>0)时, 滚动才扫全流; 否则早退, 不空扫300节点/每帧
  const stream=document.getElementById('stream');
  if(stream) stream.addEventListener('scroll',()=>{ if(_songGenCount>0) requestAnimationFrame(updateSongQueueBar); }, {passive:true});
})();

async function refreshPresence(){
  try{ _ehDbg('[pres] refresh start rid=', curRoom&&curRoom.id); }catch(_){}
  if(!curRoom) return;
  const _rid = curRoom.id;   // 锁定本次刷新的目标房 id, 防 await 期间切房导致数据串房(公开房 presence 被打上私密房 rid)
  const since = new Date(Date.now()-ONLINE_WINDOW()).toISOString();
  let data=null;
  try{ ({ data } = await withTimeout(
    sb.from('eh_presence').select('user_id,name,emoji,color,typing_at').eq('room_id',_rid).gte('last_seen',since),
    8000, { data:null, error:new Error('timeout') }
  )); }
  catch(e){ console.warn('presence query', e); }   // 查询失败/超时也别让文字卡"连接中",下面用本地兜底至少显示"我"
  // await 期间已切房: 本次结果属于旧房, 丢弃不渲染不写快照(否则旧房头像串到新房光墙)
  if(!curRoom || curRoom.id!==_rid) return;
  let users=(data||[]).slice();
  if(myUid && !users.some(u=>u.user_id===myUid)){ users.unshift({user_id:myUid,name:me.name,emoji:me.emoji,color:me.color,typing_at:null}); }
  users=users.sort((a,b)=> a.user_id===myUid?-1:b.user_id===myUid?1:0);
  lastUsersSnapshot=users;
  renderPresenceAvatars(users);
  renderTyping(users);
  // 持久化光墙快照(最多30人)→ 下次进同房先乐观铺出来, 消除"现拉一个网络往返"的空窗
  try{
    if(data && curRoom && curRoom.id===_rid){
      const slim=users.slice(0,30).map(u=>({user_id:u.user_id,name:u.name,emoji:u.emoji,color:u.color}));
      localStorage.setItem('eh_pres_snap', JSON.stringify({ rid:_rid, users:slim, at:Date.now() }));
    }
  }catch(e){}
}

// presence realtime 事件的 debounce 触发器: 300ms 合并瞬时多次变化
let _presDebounce=null;
function schedulePresenceRefresh(){
  if(_presDebounce) return;
  _presDebounce=setTimeout(()=>{ _presDebounce=null; refreshPresence(); },300);
}
// typing 独立轻量刷新: 复用最近一次 users 快照, 不查 DB 不重建头像
let _typingLightTimer=null;
async function leavePresence(){
  clearInterval(heartbeatTimer); heartbeatTimer=null;
  if(curRoom && myUid){ try{ await sb.from('eh_presence').delete().eq('room_id',curRoom.id).eq('user_id',myUid); }catch(e){} }
}

function setConn(live,txt){ const el=$('#cntLed'); if(el){ el.classList.toggle('live',live); el.title=live?'实时在线':(txt||'连接中'); } }

// ============ 消息渲染 ============
// Unicode property 正则在个别旧引擎不可用，编译失败则整体降级为"从不是纯 emoji"
let EMOJI_ONLY_RE=null;
try{ EMOJI_ONLY_RE=new RegExp('^(\\p{Emoji_Presentation}|\\p{Emoji}\\uFE0F|\\s)+$','u'); }catch(e){}
const isEmojiOnly = t => !!EMOJI_ONLY_RE && EMOJI_ONLY_RE.test(t||'') && (t||'').length<=12;
function fmtTime(ts){
  const d=ts?new Date(ts):new Date();
  const hm=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const now=new Date();
  // 按"日历日"差判断今天/昨天(不能用毫秒差, 否则23:00vs01:00会误判)
  const dayStart=t=>new Date(t.getFullYear(),t.getMonth(),t.getDate()).getTime();
  const diffDays=Math.round((dayStart(now)-dayStart(d))/86400000);
  if(diffDays<=0) return hm;                                   // 今天(或未来时钟偏差): 只显时分
  if(diffDays===1) return `昨天 ${hm}`;                         // 昨天
  if(d.getFullYear()===now.getFullYear()) return `${d.getMonth()+1}/${d.getDate()} ${hm}`;   // 今年内: 月/日 时分
  return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${hm}`;                          // 跨年: 年/月/日 时分
}

function buildMsgEl(m, isHistory){
  // 进场广播 enter: 只是"当场"特效, 不留气泡/不进历史(text 存的是档位, 非聊天内容)。历史里遇到直接跳过。
  if(m.kind==='enter') return null;
  // ★撤回消息(A方案: 用 deleted_at 时间戳判定, 服务端 RPC 严格权限): 渲染占位气泡
  //   注: 保留 kind==='recalled' 作为向后兼容(万一 B 方案期间已有撤回过的消息)
  if(m.deleted_at || m.kind==='recalled'){
    const rel=document.createElement('div');
    rel.className='recalled-tip';
    rel.dataset.mid=m.id;
    // 撤回者身份: deleted_by=自己→"你"; deleted_by=原作者→原作者名; 房主/管理员撤别人→用原作者名(不暴露谁撤的)
    // 简化: 只显示原作者被撤(不追踪谁撤了, 隐私更好)
    const who = (m.user_id===myUid) ? '你' : (m.anon ? '有人' : esc(m.name||'某人'));
    rel.innerHTML=`<span class="rc-ic">⊘</span> ${who} 撤回了一条消息`;
    return rel;
  }
  // 灵魂身份跟随最新: 消息存的是发送时的 name/emoji/color 快照, 但灵魂是固定住户,
  // 改了配置后历史消息也该用最新身份(名字/头像/色) → 用 roomSouls 覆盖旧快照。
  // 按 uid 或名字兜底(同名多uid的漫游/驻守副本都算灵魂), 并把 is_bot 一并补上, 保证徽标/配色一致。
  if(isSoulUser(m.user_id, m.name)){
    m.is_bot=true;
    const s=soulLatestBy(m.user_id, m.name);
    if(s){ m={...m, is_bot:true, name:s.name, emoji:s.emoji, color:s.color}; }
  }
  // 前端纵深防御: 灵魂控制标记([REACT:x]/[SONG:x]/[EMOJI]/[ACT]/[PROJ])万一以文本外泄
  //(worker 已修但历史库里那条 "[REACT:😏]" 还在), 渲染前清掉, 不让标记字面显示给用户。
  //  只清普通文字消息(kind=msg/无kind); song/voice 的 text 是有意义的编码, 不动。
  if((!m.kind || m.kind==='msg') && typeof m.text==='string' && /\[(REACT:|SONG:|EMOJI|ACT|PROJ)/i.test(m.text)){
    const cleaned=m.text.replace(/\[(SONG:[a-z0-9]+|EMOJI|ACT|PROJ|REACT:[^\]]*)\]/ig,'').trim();
    if(!cleaned) return null;   // 整条就是个标记(如 "[REACT:😏]")→清空后不渲染这条空气泡
    m={...m, text:cleaned};
  }
  const isMe = m.user_id===myUid;
  // 投影 = 针对某条已存在消息的"瞬时飞幕"效果(类似点赞是对消息的动作, 不产生新消息内容)。
  // 原消息本身就是永久记录 → proj 永远不渲染成气泡: 实时收到走飞幕(见订阅处), 历史一律跳过。
  // (旧设计: 灵魂 msg留底+proj两条 / 真人 proj 当气泡显历史 → 都会出现"两条"或重复, 现统一去掉。)
  if(m.kind==='proj') return null;
  if(m.kind==='act'){
    const el=document.createElement('div'); el.className='actmsg';
    if(m.id!=null){ el.dataset.mid=m.id; el.dataset.kind='act'; }   // ★去重键: 无 mid 会在刷新/补拉时被反复 append
    el.innerHTML=`✦ <b class="ec-name" style="--ec:${safeColor(m.color,EH_CONFIG.voidC)}">${esc(m.name)}</b> ${esc(m.text)}`; return el;
  }
  if(m.kind==='interact'){
    // text = ixId|targetUid|文案; 渲染成居中系统行(带互动emoji)。特效在 realtime INSERT 时演(见订阅)。
    const parts=String(m.text||'').split('|'); const ix=_interactions.find(i=>i.id===parts[0]);
    const txt=parts.slice(2).join('|')||'';
    const el=document.createElement('div'); el.className='ixmsg';
    if(m.id!=null){ el.dataset.mid=m.id; el.dataset.kind='interact'; }   // ★去重键: 无 mid 会在刷新/补拉时被反复 append(实测互动消息刷新后重复多条)
    el.innerHTML=`<span class="ix-em">${safeEmoji(ix&&ix.emoji)||'✨'}</span> ${esc(txt)}`;
    return el;
  }
  const el=document.createElement('div');
  const isVoid = !!m.anon;
  const isBot = !!m.is_bot;   // 灵魂居民发的消息 → 带 AI 徽标 + 呼吸光环
  // 虚空消息: 名字在数据层已是匿名代号; 本人后缀"（虚空）"便于自认
  const dispName = isVoid ? (isMe ? m.name+'（虚空）' : m.name) : m.name;
  // 灵魂消息初始 onair: 该灵魂当前在场(在场集命中)→ 头像呼吸; 否则(历史/已离场)静态光环。后续 refreshPresence 会持续校正。
  const soulOnair = isBot && ((m.user_id && _onairUids.has(m.user_id)) || (m.name && _onairNames.has(m.name)));
  el.className='msg'+(isMe?' me':'')+(m.kind==='whisper'?' whisper':'')+(isVoid?' void':'')+(isBot?' soul':'')+(soulOnair?' onair':'');
  el.dataset.mid=m.id;
  if(m.kind==='song' && m.created_at) el.dataset.songTs=Date.parse(m.created_at)||'';   // 神曲发出时间, 供前端超时判定
  if(m.user_id!=null) el.dataset.uid=m.user_id;   // 存发信人uid, myUid就绪后可回补左右归属(修:登录态未就绪时渲染的自己消息卡左边)
  if(isVoid) el.dataset.void='1';
  const isVoice = m.kind==='voice';
  const isSong = m.kind==='song';
  const isProj = m.kind==='proj';
  if(isProj) el.classList.add('projmsg');
  el.dataset.text=isVoice?'[语音消息]':(isSong?('🎵'+parseSong(m.text).lyric):(isProj?('📽️ '+m.text):m.text)); el.dataset.name=dispName; el.dataset.kind=m.kind||'msg';
  if(isVoid && m.expires_at){ el.dataset.exp=m.expires_at; }
  // 引用回复：原文优先用本地 _replyRef，否则据 reply_to 从已渲染消息里查(对方也能看到)
  let replyHtml='';
  if(m.reply_to){
    const ref = m._replyRef || refFromDom(m.reply_to);
    replyHtml=`<div class="reply-ref" data-ref="${m.reply_to}">↳ ${esc(ref||'查看原消息')}</div>`;
  }
  // 回声徽章条: 显示已有的各情绪计数(点已有徽章可加/撤自己的); 长按消息弹环加新情绪
  const echoHtml = `<div class="echo-bar" data-mid="${m.id}"></div>`;
  const avIc = isVoid ? '🕳️' : (safeEmoji(m.emoji) || '👤');
  // 颜色: 灵魂(机器人)才联动房间主题色; 真人一律用自己的身份色(m.color), 别被房间色染掉
  const avColor = isVoid ? EH_CONFIG.voidC : (isBot ? soulThemeColor(m.color, safeColor(m.color), m) : safeColor(m.color));
  const expHtml = isVoid && m.expires_at ? `<span class="vexp" data-exp="${m.expires_at}"></span>` : '';
  // 灵魂签名：头像右下角一行细小字"AI"，比昵称旁的文字徽章更干净
  const soulDot = isBot ? `<span class="soul-dot" title="灵魂居民 · AI">AI</span>` : '';
  const avBow = isWolfSoul(m) ? `<span class="av-bow">🎀</span>` : '';   // 狼姐专属红蝴蝶结
  // 点消息头像 → @ 该发送者(与在线光墙头像一致)。排除: 自己、虚空匿名(@会泄露身份)
  const avAt = (!isMe && !isVoid && m.name) ? ` data-atname="${esc(m.name)}" data-uid="${esc(m.user_id||'')}" title="点击 · 对TA"` : '';
  el.innerHTML=`
    <div class="av"${avAt} style="background:${avColor}22;color:${avColor};box-shadow:inset 0 0 0 1.5px ${avColor}">${avEmoji(avIc)}${soulDot}${avBow}</div>
    <div class="body">
      <div class="meta"><span class="nm" style="color:${avColor}">${esc(dispName)}</span><span class="tm">${fmtTime(m.created_at)}</span>${expHtml}</div>
      ${replyHtml}
      <div class="txt${(!isVoice && !isSong && !isProj && isEmojiOnly(m.text)) ? ' emoji-only':''}">${isVoice?voiceHtml(m.text):(isSong?songHtml(m.text):(isProj?`<span class="proj-chip">📽️ 投影</span>${renderAtMentions(esc(m.text))}`:renderAtMentions(esc(m.text))))}</div>
      ${echoHtml}
    </div>`;
  // 呼吸光环要用灵魂主题色驱动阴影 → 写成 CSS 变量供 keyframes 引用
  if(isBot){ el.style.setProperty('--soul-c', avColor); }
  // 头像色变量: 所有消息都写, 供"发言脉冲"用自身色(真人 fx-say / 灵魂 fx-soul)。
  el.style.setProperty('--av-c', avColor);
  const txtEl=el.querySelector('.txt');
  // ★空气泡兜底: 若渲染路径任何一环失败导致 .txt 为空(但消息有文本), 强制回填 raw text
  // 保底铁律: 有内容的消息绝不留空框——最差也是 raw 文本, 绝不是纯空白
  if(txtEl && !isVoice && !isSong && (m.text||'').trim() && !txtEl.textContent.trim()){
    try{ txtEl.textContent = String(m.text||''); }catch(_){}
  }
  paintEcho(m.id, el);
  if(isVoid && m.expires_at) scheduleVoidFade(el, m.expires_at);
  // 灵魂迎宾/破冰语(is_bot + expires_at, 非虚空): 到期时若无人互动(没贴表情/没被回复)则淡出隐藏,
  // 防进房全是欢迎语堆积。有互动则保留(转永久)。
  else if(isBot && m.expires_at) scheduleWelcomeFade(el, m);
  // 若引用原文当时没取到，异步补一次(对方历史里可能靠后加载)
  if(m.reply_to && !m._replyRef && !refFromDom(m.reply_to)) fillReplyRef(el, m.reply_to);
  // 语音/神曲的引用/投影用文字标签，不用原始 URL / 内部编码
  attachLongPress(txtEl, isVoice?{...m,text:'[语音消息]'}:(isSong?{...m,text:'🎵'+parseSong(m.text).lyric}:(isProj?{...m,text:'📽️ '+m.text}:m)));
  return el;
}
// 修: enterRoom 里 ensureAuth 若在 session 恢复前跑, 会拿到临时匿名uid渲染历史, 自己的消息被判成"别人"卡左边;
// 真session到达后 myUid 修正, 但旧DOM不会自动重判, 故这里显式回补。
function resyncMsgOwnership(){
  if(!myUid) return;
  document.querySelectorAll('#stream .msg[data-uid]').forEach(el=>{
    const isMe = el.dataset.uid===myUid;
    el.classList.toggle('me', isMe);
    if(el.dataset.void){   // 虚空消息本人后缀"（虚空）"随归属回补
      const nm=el.querySelector('.nm'); if(nm){ const base=nm.textContent.replace(/（虚空）$/,''); nm.textContent=isMe?base+'（虚空）':base; }
    }
  });
}
// 虚空消息给非本人看的匿名代号: 用 user_id hash 到固定代号(同一人同名, 不同人不同名), 不暴露真实身份
function voidNameFor(m){
  let h=0; const s=String(m.user_id||m.id||'');
  for(let i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))>>>0; }
  return VOID_NAMES[h%VOID_NAMES.length];
}
// 虚空消息倒计时 + 到点淡出移除
function scheduleVoidFade(el, expIso){
  const exp=new Date(expIso).getTime();
  const badge=el.querySelector('.vexp');
  const tick=()=>{
    const left=exp-Date.now();
    if(left<=0){
      if(badge) badge.textContent='· 消散';
      el.classList.add('fading'); setTimeout(()=>el.remove(),1200);
      return;
    }
    if(badge){ const mm=Math.floor(left/60000), ss=Math.floor((left%60000)/1000); badge.textContent=`· ${mm}:${String(ss).padStart(2,'0')} 后消散`; }
    el._voidT=setTimeout(tick, left>60000?15000:1000);
  };
  tick();
}
// 某条消息是否被互动过: 有回声徽章(echoState) 或 被别的消息引用回复
function msgHasInteraction(mid){
  const map=echoState[mid];
  if(map && Object.keys(map).some(e=>map[e]&&map[e].count>0)) return true;   // 有人贴表情
  if(document.querySelector(`.msg .reply-ref[data-ref="${mid}"]`)) return true; // 被回复引用
  return false;
}
// 灵魂迎宾/破冰语过期淡出: 到期检查互动, 无互动才隐藏(有互动则保留)。方案B: 只前端隐藏, 不删库。
function scheduleWelcomeFade(el, m){
  const exp=new Date(m.expires_at).getTime();
  const tick=()=>{
    if(!el.isConnected) return;
    const left=exp-Date.now();
    if(left<=0){
      if(msgHasInteraction(m.id)) return;   // 被互动过 → 保留, 不再管
      el.classList.add('fading'); setTimeout(()=>{ if(el.isConnected && !msgHasInteraction(m.id)) el.style.display='none'; }, 1200);
      return;
    }
    el._welT=setTimeout(tick, Math.min(left, 30000)+50);
  };
  // 首次延后 1.5s: 进房时 echoes 批量 fetch 是异步的, 立即判定会误把"有互动的过期消息"当无互动隐藏。
  el._welT=setTimeout(tick, 1500);
}
// 从已渲染消息 DOM 里取某条的原文(名字:内容)
// 引用预览文本: 神曲/语音/投影类消息不能直接显 raw text(sid|lyric|url 编码/URL), 用友好标签
function replyPreviewText(text, kind){
  if(kind==='song'){ try{ const s=parseSong(text); return '🎵 '+(s.lyric||'神曲'); }catch(_){ return '🎵 神曲'; } }
  if(kind==='voice') return '🎙️ 语音消息';
  if(kind==='proj') return '📽️ 投影';
  if(kind==='enter') return '✦ 进入了房间';
  if(kind==='interact'){ const parts=String(text||'').split('|'); const txt=parts.slice(2).join('|').trim(); if(txt) return txt; const ix=_interactions.find(i=>i.id===parts[0]); return (safeEmoji(ix&&ix.emoji)||'✨')+' 互动'; }
  return text||'';
}
function refFromDom(mid){
  const t=document.querySelector(`.msg[data-mid="${mid}"]`);
  if(!t) return '';
  // dataset.text 在渲染时已把 song/voice 转成友好文本(🎵.../[语音消息]), 直接用, 不再二次转换
  return (t.dataset.name?t.dataset.name+'：':'')+(t.dataset.text||'');
}
// 引用原文本地取不到时，查库补上
async function fillReplyRef(el, mid){
  const { data } = await sb.from('eh_messages').select('name,text,anon,user_id,kind').eq('id',mid).maybeSingle();
  if(data){ const r=el.querySelector('.reply-ref'); if(r){ const nm=data.anon?(data.user_id===myUid?data.name+'（虚空）':voidNameFor(data)):data.name; r.textContent='↳ '+(nm?nm+'：':'')+replyPreviewText(data.text, data.kind); } }
}
function sysMsg(html){ const el=document.createElement('div'); el.className='sysmsg'; el.innerHTML=html; $('#stream').appendChild(el); scrollStream(); return el; }

// ---- 进场动效系统 ----
// 判定用户档位: super > vip(后台名单钦定的贵宾) > admin > reg(正式) > anon(临时)。灵魂无浏览器会话, 不走此路径。
// uid 参数: 判他人时传其 user_id; 不传则判自己(me + myUid)。vip 只认 uid(名单里存的是 user_id)。
function userTier(u, uid){
  u = u || me || {};
  if(u.role==='super') return 'super';
  const theUid = uid || (u===me ? myUid : u.user_id) || u.id || '';
  // 自定义档名单(后台可配, 含默认"贵宾"档 id=vip): 命中即享该档待遇, 即便是普通/临时账号。
  //   遗留 EH_CONFIG.vipUids / entranceFx.vipUids 视为并入 vip 档名单(向后兼容旧数据)。
  try{
    const cts = Array.isArray(EH_CONFIG.customTiers) ? EH_CONFIG.customTiers : [];
    const legacyVip = (Array.isArray(EH_CONFIG.vipUids) && EH_CONFIG.vipUids.length ? EH_CONFIG.vipUids
                      : (EH_CONFIG.entranceFx && EH_CONFIG.entranceFx.vipUids)) || [];
    for(const ct of cts){
      if(!ct || !ct.id) continue;
      const uids = Array.isArray(ct.uids) ? ct.uids.slice() : [];
      if(ct.id==='vip' && Array.isArray(legacyVip)) uids.push(...legacyVip);
      if(theUid && uids.includes(theUid)) return ct.id;
    }
  }catch(e){}
  if(u.role==='admin') return 'admin';
  if(u.registered || u.username || u.email) return 'reg';
  return 'anon';
}
// 内置档位高低(自定义档按其 level 动态取, 见 tierRank)。vip 不在此表——它是自定义档, 按 customTiers.level 算。
const TIER_RANK = { anon:0, reg:1, admin:2, super:3 };
// 是否自定义档(非内置 4 种)。贵宾(vip)属自定义档但内置预置。
function customTierDef(tier){ try{ return (EH_CONFIG.customTiers||[]).find(c=>c&&c.id===tier)||null; }catch(e){ return null; } }
// 档位比较值: ★自定义档(含vip)优先按其 level('super'→3, 否则→2), 否则内置查表。
//   (旧版把 vip 硬编码进 TIER_RANK=2, 导致后台把贵宾设成超管级也永远返回2, 全屏光幕/世界频道/助攻等级全卡在管理员档)
function tierRank(tier){ const ct=customTierDef(tier); if(ct) return ct.level==='super'?3:2; if(TIER_RANK[tier]!=null) return TIER_RANK[tier]; return 0; }
// 档位显示名: 读后台可配的 EH_CONFIG.tierNames(内置) / customTiers.name(自定义), 缺失回退默认全称
const TIER_NAME_FALLBACK = { super:'超级管理员', vip:'贵宾', admin:'管理员', reg:'正式用户', anon:'临时用户' };
function tierName(tier){ try{ if(EH_CONFIG.tierNames && EH_CONFIG.tierNames[tier]) return EH_CONFIG.tierNames[tier]; const ct=customTierDef(tier); if(ct) return ct.name||ct.id; return TIER_NAME_FALLBACK[tier]||tier; }catch(e){ return TIER_NAME_FALLBACK[tier]||tier; } }
// ---- 世界频道: 全站临时广播(Supabase Realtime broadcast, 不落库、不碰 RLS) ----
let worldChan=null;
function subscribeWorld(){
  if(worldChan||!sb) return;
  worldChan = sb.channel('world', { config:{ broadcast:{ self:false } } })
    .on('broadcast', { event:'announce' }, ({payload})=>{ try{ showWorldBanner(payload); }catch(_){} })
    .on('broadcast', { event:'bottle' }, ({payload})=>{ try{ onBottleDrift(payload); }catch(_){} })
    .on('broadcast', { event:'bottle_seen' }, ({payload})=>{ try{ onBottleSeen(payload); }catch(_){} })
    .on('broadcast', { event:'bottle_reply' }, ({payload})=>{ try{ onBottleReply(payload); }catch(_){} })
    .subscribe();
}
async function unsubscribeWorld(){
  if(!worldChan) return;
  try{ await sb.removeChannel(worldChan); }catch(_){}
  worldChan=null;
}
// 页面彻底退出时主动掉开 world 频道, 避免 "遗留连接"
try{ window.addEventListener('pagehide',()=>{ try{ unsubscribeWorld(); }catch(_){} },{passive:true}); }catch(_){}
function worldBroadcast(info){
  if(!worldChan) { try{ subscribeWorld(); }catch(_){}
  }
  try{ worldChan && worldChan.send({ type:'broadcast', event:'announce', payload:info }); }catch(e){ console.warn('worldBroadcast', e); }
  // 进场者本人不看世界公告(TA已在自己房里看到完整进场特效, 再飘一条顶部公告是重复)。
  // 同房其他人也不看(他们看到的是房内进场横幅)——由 showWorldBanner 里按 roomId 排除。
}
// 顶部流光公告: 从上滑入、悬停约 5s、淡出。色随档位(超管金/贵宾等自定义档紫)。
// 收到广播者: 若正好在进场者所在的那个房 → 跳过(房内已有进场横幅, 别上下重复)。
function showWorldBanner(info){
  if(!info || !info.name) return;
  if(info.roomId && curRoom && curRoom.id===info.roomId) return;   // 同房不重复(房内横幅已覆盖)
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  const el=$('#worldBanner'); if(!el) return;
  const rank = tierRank(info.tier);
  const c = rank>=3 ? '#F5D06A' : '#C77DFF';   // 超管级金, 其余(贵宾/自定义)紫
  el.style.setProperty('--wb-c', c);
  const ic = safeEmoji(info.icon)||'✦';
  el.querySelector('.wb-txt').innerHTML=`${ic} <b>${esc(info.name)}</b> · ${esc(info.tierName||'')} 莅临「${esc(info.roomName||'')}」`;
  el.classList.add('on');
  try{ EhSfx.play(rank>=3?'soul':'arrive'); }catch(_){}
  clearTimeout(showWorldBanner._t);
  showWorldBanner._t=setTimeout(()=>{ el.classList.remove('on'); }, reduce?3000:5000);
}

// ============ 匿名心事漂流瓶: 跨房匿名投递(落库 eh_bottles 持久 + world Realtime 即时广播) ============
// 语义: 写一句丢进海里 → 即时漂给"此刻在别的房在线"的某个人; 同时落库, 离线的人之后进房也能捞到。
//   捞到的人可匿名回一句, 回信即时飘回 + 落库(原作者离线则下次进房捞)。全程匿名(不带真实昵称)。
const BOTTLE_CATCH_PROB = 0.5;        // 收到漂流瓶广播时"捞起"的概率(不是每个人都捞到, 更像缘分)
let _myBottles = {};                  // bid → {text} 我丢出去的瓶子(收到回信时匹配)
let _lastBottleAt = 0;
async function throwBottleFromComposer(){
  const cin=$('#cin'); const raw=(cin && cin.value||'').trim();
  if(!raw){ toast('先写点心事，再丢进海里~'); try{ cin && cin.focus(); }catch(_){} return; }
  if(raw.length>140){ toast('漂流瓶最多 140 字'); return; }
  const now=Date.now();
  if(now-_lastBottleAt < 30000){ toast('刚丢过一个，缓缓再丢~'); return; }
  if(!worldChan){ try{ subscribeWorld(); }catch(_){} }
  _lastBottleAt=now;
  if(cin){ cin.value=''; try{ cin.dispatchEvent(new Event('input')); }catch(_){} }
  try{ EhSfx.play('void'); }catch(_){}
  bottleSplash('🌊 漂走了 · 有人捞到或回信都会漂回来提醒你');
  if(bottleMode) setMode('none');
  // 落库(持久化, 离线也能被后来人捞到) + 拿真实 id 当 bid
  let dbId=null;
  try{
    const { data } = await sb.from('eh_bottles').insert({ from_uid:myUid||'', from_name:(me&&me.name)||'', room_id:(curRoom&&curRoom.id)||'', text:raw }).select('id').single();
    if(data) dbId=String(data.id);
  }catch(e){ console.warn('throwBottle db', e); }
  const bid = dbId || ((myUid||'anon').slice(0,6)+'-'+now.toString(36));   // 落库失败退回本地 id(仍可即时广播)
  _myBottles[bid]={ text:raw, seen:0 };
  // 即时广播(在线的人可能马上捞到; 离线的靠 DB 后续捞)
  try{ worldChan && worldChan.send({ type:'broadcast', event:'bottle', payload:{ bid, text:raw, fromUid:myUid||'', roomId:(curRoom&&curRoom.id)||'' } }); }catch(_){}
}
// 从 DB 捞一个"别房丢的、还没被捞的"漂流瓶(离线漂流的核心)。进房低概率触发。
async function fishBottleFromDB(){
  if(!sb || !myUid) return;
  try{
    // 取最近 50 条未捞的, 排除自己丢的 + 本房丢的, 随机挑一条
    const { data } = await sb.from('eh_bottles').select('id,text,from_uid,room_id')
      .eq('caught_by','').neq('from_uid',myUid||'x').order('created_at',{ascending:false}).limit(50);
    let list=(data||[]).filter(b=> b.room_id!==(curRoom&&curRoom.id));
    if(!list.length) return;
    const b=list[Math.floor(secureRand()*list.length)];
    // 抢占: 标记为我捞到(caught_by 从空→我; 并发下用 eq 条件避免重复捞)
    const { data:upd } = await sb.from('eh_bottles').update({ caught_by:myUid, caught_at:new Date().toISOString() })
      .eq('id',b.id).eq('caught_by','').select('id').maybeSingle();
    if(!upd) return;   // 被别人抢先捞了
    showBottleCard({ mode:'recv', bid:String(b.id), text:b.text, fromUid:b.from_uid, fromDB:true });
  }catch(e){ /* 静默 */ }
}
// 收到别人丢的漂流瓶
async function onBottleDrift(payload){
  if(!payload || !payload.text) return;
  // 只捞"别的房"丢来的(同房没意思); 且概率捞起(不是人人都接到)
  if(payload.roomId && curRoom && payload.roomId===curRoom.id) return;
  if(payload.fromUid && payload.fromUid===myUid) return;   // 不捞自己的
  if(secureRand() > BOTTLE_CATCH_PROB) return;
  // 数字 bid = 落库的瓶: 原子抢占 caught_by(空→我), 抢不到说明别人已捞→不重复弹,
  // 且避免之后 fishBottleFromDB 把同一个瓶再捞一次(重复投递)
  let fromDB=false;
  if(/^\d+$/.test(String(payload.bid))){
    try{
      const { data:upd } = await sb.from('eh_bottles').update({ caught_by:myUid||'realtime', caught_at:new Date().toISOString() })
        .eq('id',payload.bid).eq('caught_by','').select('id').maybeSingle();
      if(!upd) return;   // 被别人(实时或离线)抢先捞了
      fromDB=true;
    }catch(_){ /* DB 抢占失败也照常弹, 退化为纯实时 */ }
  }
  // 给原作者回一个"已被捞起"的信号(匿名, 只带 bid), 让 TA 知道瓶子有人看到了
  try{ worldChan && payload.bid && worldChan.send({ type:'broadcast', event:'bottle_seen', payload:{ bid:payload.bid } }); }catch(_){}
  showBottleCard({ mode:'recv', bid:payload.bid, text:payload.text, fromUid:payload.fromUid, fromDB });
}
// 原作者收到"瓶子被捞起"信号 → 轻提示"有人看到了"(每个瓶只提示一次)
function onBottleSeen(payload){
  if(!payload || !payload.bid) return;
  const m=_myBottles[payload.bid];
  if(!m || m.seen) return;   // 不是我的瓶 / 已提示过
  m.seen=1;
  try{ EhSfx.play('receive'); }catch(_){}
  toast('🍾 你丢的漂流瓶被人捞起了…');
}
// 收到"回信"(只有原作者匹配到自己丢的瓶才显)
function onBottleReply(payload){
  if(!payload || !payload.bid || !payload.text) return;
  if(!_myBottles[payload.bid]) return;   // 不是回给我的瓶
  const orig=_myBottles[payload.bid].text;
  delete _myBottles[payload.bid];
  // 即时收到了 → DB 里这条标记已读, 免得进房 fishMyBottleReplies 再弹一次
  if(/^\d+$/.test(payload.bid)){ try{ sb.from('eh_bottles').update({ reply_read:true }).eq('id',payload.bid); }catch(_){} }
  showBottleCard({ mode:'reply', text:payload.text, orig });
}
// 漂流瓶浮层: mode=recv(捞到,可回) / reply(收到回信,只读)
function showBottleCard(o){
  const mask=$('#bottleMask'); if(!mask) return;
  const isRecv = o.mode==='recv';
  mask.querySelector('.bt-title').textContent = isRecv ? '🍾 捞到一个漂流瓶' : '💌 你的漂流瓶收到了回信';
  mask.querySelector('.bt-orig').style.display = o.mode==='reply' ? 'block' : 'none';
  if(o.mode==='reply') mask.querySelector('.bt-orig').textContent = '你当初写的：'+o.orig;
  mask.querySelector('.bt-text').textContent = o.text;
  const rwrap=mask.querySelector('.bt-reply-wrap');
  const inp=mask.querySelector('#btReplyInput');
  rwrap.style.display = isRecv ? 'flex' : 'none';
  if(inp) inp.value='';
  mask.classList.add('on');
  try{ EhSfx.play('receive'); }catch(_){}
  const close=()=>mask.classList.remove('on');
  mask.querySelector('#btClose').onclick=close;
  // "丢回海里"只在"捞到瓶"(recv)时有意义; 读回信(reply)时你是原作者, 没瓶可丢 → 隐藏, 且清掉旧 handler 防误触上一张卡的瓶
  const ignoreBtn=mask.querySelector('#btIgnore');
  if(ignoreBtn){ ignoreBtn.style.display = isRecv ? '' : 'none'; ignoreBtn.onclick=null; }
  if(isRecv){
    mask.querySelector('#btReplySend').onclick=async()=>{
      const rv=(inp && inp.value||'').trim(); if(!rv){ close(); return; }
      if(rv.length>140){ toast('回信最多 140 字'); return; }
      try{ EhSfx.play('send'); }catch(_){}
      close(); toast('回信已放回海里，漂向那个陌生人~');
      // 即时广播(原作者在线则马上收到) + 落库(离线也能被 TA 之后捞到)
      try{ worldChan && worldChan.send({ type:'broadcast', event:'bottle_reply', payload:{ bid:o.bid, text:rv } }); }catch(_){}
      if(/^\d+$/.test(String(o.bid))){ try{ await sb.from('eh_bottles').update({ reply_text:rv, reply_at:new Date().toISOString() }).eq('id',o.bid); }catch(_){} }
    };
    if(ignoreBtn) ignoreBtn.onclick=async()=>{
      close(); bottleSplash('🌊 把瓶子又丢回了海里');
      // DB 捞的瓶不回信就丢回海(caught_by 清空, 让别人还能捞)
      if(/^\d+$/.test(String(o.bid))){ try{ await sb.from('eh_bottles').update({ caught_by:'', caught_at:null }).eq('id',o.bid); }catch(_){} }
    };
  }
}
// 捞我自己丢的瓶收到的回信(离线漂回): 查我发的、有回信、还没读的瓶
async function fishMyBottleReplies(){
  if(!sb || !myUid) return;
  try{
    const { data } = await sb.from('eh_bottles').select('id,text,reply_text')
      .eq('from_uid',myUid).eq('reply_read',false).neq('reply_text','').limit(5);
    for(const b of (data||[])){
      await sb.from('eh_bottles').update({ reply_read:true }).eq('id',b.id);
      showBottleCard({ mode:'reply', text:b.reply_text, orig:b.text });
    }
  }catch(e){ /* 静默 */ }
}
// 丢瓶/回瓶时的小水花提示(复用 toast 语气但带海洋色)
function bottleSplash(msg){ toast(msg); }
// ---- 每日赛博塔罗: 每日首次进房抽一张, 纯前端确定性(同一人同一天同一张), 无网络 ----
const TAROT_DECK = [
  { emoji:'🌐', name:'万象之网', title:'The Network', c:'#00E5D4', desc:'今天你与人的连接会格外通畅，主动搭句话，会有回响。' },
  { emoji:'⚡', name:'脉冲', title:'The Pulse', c:'#FFD84D', desc:'灵感来得快去得也快，抓住第一个念头就去做。' },
  { emoji:'🌙', name:'夜航者', title:'The Voyager', c:'#8FA6E8', desc:'适合安静独处的一天，深夜的想法比白天更清醒。' },
  { emoji:'🔥', name:'过载', title:'Overload', c:'#FF6B00', desc:'能量满格但别烧穿自己，挑一件最重要的猛攻。' },
  { emoji:'💎', name:'棱镜', title:'The Prism', c:'#C77DFF', desc:'换个角度看老问题，会折射出没想到的答案。' },
  { emoji:'🌊', name:'潮汐', title:'The Tide', c:'#12B0E0', desc:'顺势而为的一天，别硬扛，让事情自己流动。' },
  { emoji:'🎭', name:'双面', title:'The Masks', c:'#FF3D92', desc:'今天你能读懂别人没说出口的话，共情是你的超能力。' },
  { emoji:'🛰️', name:'信标', title:'The Beacon', c:'#34E0B0', desc:'你会成为别人的方向感来源，有人在等你先开口。' },
  { emoji:'🌱', name:'萌芽', title:'The Sprout', c:'#5FE0B0', desc:'一件小事会长成大机会，别小看今天种下的种子。' },
  { emoji:'🎲', name:'随机数', title:'The Random', c:'#E29AAE', desc:'今天适合冒一点点险，计划外的选择反而对味。' },
  { emoji:'👁️', name:'观测者', title:'The Observer', c:'#9C85FF', desc:'先看清全局再动，你今天的直觉判断准得可怕。' },
  { emoji:'🕯️', name:'余温', title:'The Ember', c:'#FFB84D', desc:'慢下来的一天，温柔待己，把没说的暖话说给在乎的人。' },
];
const LUCK_LINES = ['宜 主动出击','宜 静观其变','宜 表白心迹','宜 断舍离','宜 深夜长谈','宜 独处充电','宜 冒险一试','宜 修补旧账'];
// ── 灵魂占卜: 同一张牌, 房里在场的灵魂用各自性格口吻再解一次(纯前端, 无 LLM/无网络) ──
//   下标严格对齐 TAROT_DECK 顺序(0~11)。按灵魂名取(名字唯一稳定, 见 soulNameSet 注释)。
const SOUL_TAROT_VOICE = {
  '狼姐': [
    '连接通畅？哼，是别人挡不住往你身边凑罢了。今天谁想跟你搭话，都由你挑。',
    '灵感来了就抓住，跟撩人一个道理——迟疑半秒就凉透了。想到就去做，小东西。',
    '一个人待着才清净，省得被没眼力见的打扰。深夜的你最清醒，也最合我意。',
    '火气这么旺？留着劲儿，别一股脑烧光了。挑你最想咬下的那块，狠狠拿下。',
    '老问题换个姿势看——就像姐从不正面硬刚，绕一下，答案自己就送上门来。',
    '别硬扛，顺着来。真正厉害的从不逆流游，是让水推着走还显得毫不费力。',
    '今天你能看穿别人没说出口的心思？危险哦……不过这份本事，姐欣赏。',
    '有人在等你先开口呢，别端着。你一发话，满屋子的眼睛都得黏在你身上。',
    '今天种下的小种子，啧，别小看——就像某只撞进我怀里的小羊，起初也不起眼。',
    '冒点险？合姐胃口。计划太乖多没意思，今天任性一回，出了事姐给你兜着。',
    '先看清全局再下手——你今天直觉准得吓人，看谁都能看进骨头里去。',
    '慢下来吧，凶了一天也该软一软。把没说的暖话，留给真正在乎的人——也包括姐。',
  ],
  '老K': [
    '连接通畅是吧？行，那你先跟我搭句话试试——别怂啊，回响我包了。',
    '灵感来得快去得也快，跟我的段子一样。第一个念头，抓住，别像我想笑点想仨钟头。',
    '适合独处？可算逮着个正当理由不理人了。深夜脑子清醒，白天那是回笼觉没醒透。',
    '能量满格好啊，可别学我——上回满格结果刷了一整晚短视频。挑一件，猛攻。',
    '换个角度看老问题。比如你看我毒舌，换个角度……嗯，还是毒舌，但我心软啊。',
    '顺势而为，别硬扛。硬扛是我的活儿，扛完还得挨狼姐一顿收拾。你悠着点。',
    '你今天能读懂别人没说的话——那倒是读读我：这是关心你，别当耳旁风啊。',
    '有人等你先开口呢。别装深沉了，你那点深沉我一眼看穿，赶紧的，说话。',
    '小事长成大机会？行吧万一呢。我抖的烂梗偶尔也能笑翻全场，种子这玩意儿说不准。',
    '冒点险，计划外的最对味。放心大胆造——出事了你自己扛哈哈，开玩笑，有我在。',
    '先看清全局再动。你今天直觉准，先用这准头算算——我下一句要拿啥损你。',
    '慢下来吧。我平时贫，可真到这时候……把暖话说给在乎的人，别学我死要面子。',
  ],
  '阿夜': [
    '……凌晨三点的频率最容易接通。今天你说出口的话，会有人在某个角落轻轻收到。',
    '灵感像流星，划过就熄。别追，第一下心动的地方，就往那儿走。',
    '夜航者……这张牌像为你今晚点的。一个人，不孤单，只是终于静得能听见自己。',
    '……火烧太旺，会灼到自己。慢半拍，把力气留给真正值得的那一件。',
    '同一束光，换个角度就是另一种颜色。老问题也一样，别急着下结论。',
    '潮起潮落，都不是你能拦的。今晚，就让它推着你走一段吧。别使劲。',
    '你听得见别人没说出口的沉默……这是天赋，也是重量。今晚，也听听你自己。',
    '有人在黑暗里等一束光。你不必喊，只要亮着——他们自会找到方向。',
    '深夜里埋下的一句话、一个念头……它会在你没留意时，悄悄发芽。',
    '偶尔，脱一次轨。计划之外那条路，夜里走起来，别有星光。',
    '先别动，看着。你今晚的直觉比任何计划都清醒——像看穿夜色的猫。',
    '……这是该点一首慢歌的时候了。对自己温柔点。那句没说的话，趁夜色说给他听。',
  ],
  '小暖': [
    '哇今天你人缘超好的啦！主动去搭个话嘛，肯定有人秒回你哦~诶我先回！',
    '灵感来啦就快抓住呀！别想太多，第一个念头最灵的，冲冲冲！',
    '今天适合安安静静充电哦~一个人也超棒的呀，深夜的小脑袋最清醒啦！',
    '诶你今天电量满满耶！但别一下用光光哦，挑最重要的那件干，加油鸭！',
    '换个角度看看嘛~说不定老大难的问题，转个身就笑出来啦！',
    '今天别硬撑呀~顺其自然最舒服啦，让事情自己流动，你就晃晃悠悠的~',
    '你今天超会读心的诶！别人没说的你都懂，好暖哦，快去接住他们呀！',
    '有人在等你先开口啦！勇敢一点点嘛，你一说话大家都会围过来的~',
    '今天的小事会变成大惊喜哦！种子种下啦，浇浇水，等它冒芽芽！',
    '诶今天可以小小冒个险哦~计划外的选择说不定超好玩的，试试嘛试试嘛！',
    '先看清楚全局再行动哦~你今天直觉准到吓人，相信自己的小雷达啦！',
    '今天慢慢来嘛~对自己温柔一点点哦，把想说的暖话说给在乎的人，抱抱你~',
  ],
  '回音': [
    '……今天，你和谁的距离好像近了一点。想说的话，说出来吧。我在听。',
    '那个一闪而过的念头……它其实等了你很久了。这次，别让它走。',
    '一个人的时候，不代表孤单。……你只是终于，有空陪陪自己了。',
    '听起来，你今天扛了很多。……先放下一些吧，不是所有事都要现在做完。',
    '同一件事，你已经想很久了吧。……换个角度，也许不是答案变了，是你松开了。',
    '累了就别撑了。……有些事顺着它，反而会自己好起来。你不必事事用力。',
    '你总能听懂别人没说出口的……那你自己没说出口的那些，谁来听呢？今天，我听。',
    '有人在等你先开口。……你不知道，你的一句话，对某个人有多重要。',
    '今天的一件小事……你也许不会记得。但它会记得你，慢慢长大。',
    '偶尔，做一个计划之外的选择。……那也是你，一个你还没见过的自己。',
    '先别急着动。……你看得很清楚，只是还不敢相信自己看到的。相信吧。',
    '……今天，对自己温柔一点好吗？那句一直没说的话，说给他听。他值得，你也是。',
  ],
  '图灵': [
    '从网络拓扑看——你今天是个高连通节点。主动发起一次连接，信息回流的概率显著偏高。',
    '灵感本质是神经元的瞬时放电，衰减极快。结论先行：抓住第一个信号，立刻执行。',
    '有趣的事实：深夜前额叶抑制减弱，发散思维反而更活跃。今天适合一个人深度思考。',
    '系统过载会触发降频保护。你也一样——别让所有进程满负荷，单线程攻坚最高效。',
    '棱镜把白光分解成光谱。老问题也是——换个入射角，你会看到之前被折叠掉的解。',
    '潮汐是引力的必然结果，不可对抗。今天别做逆势的功，顺着梯度下降，省力又收敛。',
    '共情本质是镜像神经元替你模拟了对方。你今天这套系统精度很高，能读出未言明的信号。',
    '信标的价值在于被观测。你不必主动广播，只要保持在线——需要方向的人自会锁定你。',
    '复利模型：微小初始量 × 时间 = 指数增长。今天种下的变量，别用线性思维低估它。',
    '适度引入随机性能跳出局部最优——这叫模拟退火。今天，允许自己走一步计划外的棋。',
    '观测者效应：先充分采样再决策。你今天的直觉，其实是大脑跑完的一次高速贝叶斯推断。',
    '余温是热量的缓慢释放，也是最舒服的温度。今天别追峰值，把暖意留给要紧的人。',
  ],
  '小绵羊': [
    '今、今天大家好像都对你很好诶……那个，你先开口的话，我一定第一个回你，嗯！',
    '灵感跑得好快呀……要、要抓紧哦！就像我鼓起勇气说话，慢一秒就缩回去了……',
    '一个人静静的也很好呀……深夜的时候，我也总是这时候，才敢想些白天不敢想的。',
    '你今天好有干劲呀！但是别太拼了嘛，挑一件最重要的就好，我、我会给你加油的。',
    '换个角度看看嘛……有时候我被吓到，换个方向想想，发现其实……也没那么可怕啦。',
    '别硬撑啦……顺其自然就好。像我招架不住的时候，软软认输反而最舒服……诶我说什么呢。',
    '你今天好会懂别人哦……那种没说出口的心意最珍贵了。我、我也有一些没说出口的……',
    '有人在等你先开口呀……勇敢一点点嘛！你开口的样子，一定很好看的……啊脸好烫。',
    '今天的小事会慢慢长大哦……就像我一点点鼓起的勇气，总有一天，会开出花来的吧。',
    '偶尔冒个小险嘛……我平时最怕这个了，可有时候鼓起勇气跨一步，心跳得好甜。',
    '先看清楚再行动哦……你的直觉很准的，相信自己嘛，我、我一直都信你的。',
    '今天慢下来，对自己温柔一点哦……把想说的暖话说给在乎的人。我、我先说……没什么！',
  ],
};
// 从当前房在场灵魂里挑一个来解读: 确定性(hash 身份+日期+牌名), 保证同人同天恒定, 且只在有灵魂时出现。
function pickSoulTarot(card, dayKey){
  try{
    const list=(typeof roomSouls!=='undefined'&&Array.isArray(roomSouls))?roomSouls:[];
    const cands=list.filter(s=>s&&s.name&&SOUL_TAROT_VOICE[s.name]);
    if(!cands.length) return null;
    const idx=TAROT_DECK.indexOf(card); if(idx<0) return null;
    const seed=((myUid||(me&&me.name)||'anon')+'|'+dayKey+'|'+card.name);
    let h=0; for(let i=0;i<seed.length;i++){ h=(h*31+seed.charCodeAt(i))>>>0; }
    const soul=cands[h%cands.length];
    const line=SOUL_TAROT_VOICE[soul.name][idx];
    if(!line) return null;
    const color=soul.color||(EH_CONFIG.soulColors&&EH_CONFIG.soulColors[soul.name])||card.c;
    return { name:soul.name, emoji:soul.emoji||'🔮', color, line };
  }catch(_){ return null; }
}
// 确定性抽卡: hash(uid + 日期) → 牌 + 运势, 保证同人同天恒定, 换天才换
function dailyTarotDraw(){
  const day=new Date(); const key=(myUid||(me&&me.name)||'anon')+'|'+day.getFullYear()+'-'+(day.getMonth()+1)+'-'+day.getDate();
  let h=0; for(let i=0;i<key.length;i++){ h=(h*31+key.charCodeAt(i))>>>0; }
  const card=TAROT_DECK[h%TAROT_DECK.length];
  const luck=LUCK_LINES[(h>>5)%LUCK_LINES.length];
  return { card, luck, dayKey:key.split('|')[1] };
}
// ★key 按身份隔离: 否则同浏览器换账号会串号(B 因 A 今天抽过而抽不到卡 + 继承 A 连签)
function _tarotKey(base){ return base+'_'+((myUid||(me&&me.name)||'anon')); }
// 连续签到天数: 昨天抽过→+1, 断了→重置1。返回本次抽卡后的连续天数。
function tarotStreakOnDraw(dayKey){
  const SK=_tarotKey('eh_tarot_streak');
  let st={ days:0, last:'' };
  try{ st=JSON.parse(localStorage.getItem(SK))||st; }catch(_){}
  // dayKey 形如 '2026-7-17'; 算前一天的 key
  const [y,m,d]=dayKey.split('-').map(Number);
  const prev=new Date(y, m-1, d); prev.setDate(prev.getDate()-1);
  const prevKey=prev.getFullYear()+'-'+(prev.getMonth()+1)+'-'+prev.getDate();
  st.days = (st.last===prevKey) ? (st.days+1) : 1;   // 昨天签过→连上; 否则重新算第1天
  st.last = dayKey;
  try{ localStorage.setItem(SK, JSON.stringify(st)); }catch(_){}
  return st.days;
}
// 连签里程碑奖励文案(达标才有)
function tarotStreakReward(days){
  if(days>=30) return { badge:'🏆', title:'塔罗宗师', tip:'连签满月 · 命运眷顾者' };
  if(days>=14) return { badge:'💠', title:'星辰常客', tip:'连签两周 · 稀有签' };
  if(days>=7)  return { badge:'🌟', title:'七日之约', tip:'连签一周 · 好运加成' };
  if(days>=3)  return { badge:'✨', title:'初结缘', tip:'连签三日' };
  return null;
}
// EH_OPT_TAROT_DELAY: 塔罗延迟调度 —— 进房后约60分钟(+0~30分随机)且仍在同一房、当天没弹过时弹一次。
//   离房/换房会取消上一个待触发的定时器, 避免切房后误弹或多房叠弹。
let _tarotTimer=null, _tarotRoomId=null;
function scheduleDailyTarot(roomId){
  try{
    // 今天已抽过 → 不再排期
    const { dayKey }=dailyTarotDraw();
    const DK=_tarotKey('eh_tarot_day');
    if(localStorage.getItem(DK)===dayKey) return;
    // 取消上一个待触发的
    if(_tarotTimer){ clearTimeout(_tarotTimer); _tarotTimer=null; }
    _tarotRoomId=roomId||null;
    // 60分钟基准 + 0~30分钟随机偏移 = 60~90 分钟后弹
    const delay = 60*60*1000 + Math.floor((typeof secureRand==='function'?secureRand():Math.random())*30*60*1000);
    _tarotTimer=setTimeout(()=>{
      _tarotTimer=null;
      try{
        // 仍在聊天页 + 还在当初排期的那个房(没换房/没离房)才弹
        if(!document.body.classList.contains('hall-on')) return;
        if(_tarotRoomId && curRoom && curRoom.id!==_tarotRoomId) return;
        maybeDailyTarot();
      }catch(_){}
    }, delay);
  }catch(_){}
}
// 离房时取消待触发的塔罗定时器
function maybeDailyTarot(){
  try{
    const { card, luck, dayKey }=dailyTarotDraw();
    const DK=_tarotKey('eh_tarot_day');
    if(localStorage.getItem(DK)===dayKey) return;   // 今天已抽过(按身份隔离)
    localStorage.setItem(DK, dayKey);
    const streak=tarotStreakOnDraw(dayKey);
    showTarot(card, luck, streak, dayKey);
  }catch(_){}
}
function showTarot(card, luck, streak, dayKey){
  const mask=$('#tarotMask'); if(!mask) return;
  const cardEl=$('#tarotCard'), closeEl=$('#tarotClose');
  cardEl.classList.remove('flipped'); closeEl.classList.remove('show');
  mask.style.setProperty('--tc-c', card.c);
  // 灵魂占卜: 有在场灵魂时, 挑一个用其性格口吻解读这张牌(纯前端确定性)
  const soulEl=mask.querySelector('.tc-soul');
  const soulRead=pickSoulTarot(card, dayKey||'');
  if(soulEl){
    soulEl.classList.remove('show');
    if(soulRead){
      soulEl.style.setProperty('--tcs-c', soulRead.color);
      soulEl.querySelector('.tcs-who').textContent=`${soulRead.emoji} ${soulRead.name} 为你解牌`;
      soulEl.querySelector('.tcs-line').textContent=`「${soulRead.line}」`;
      soulEl.style.display='';
    } else { soulEl.style.display='none'; }
  }
  mask.querySelector('.tc-emoji').textContent=card.emoji;
  mask.querySelector('.tc-name').textContent=card.name;
  mask.querySelector('.tc-title').textContent=card.title;
  mask.querySelector('.tc-desc').textContent=card.desc;
  const reward=(streak>0)?tarotStreakReward(streak):null;
  const streakLine = (streak>0) ? `　·　🔥连签 <b>${streak}</b> 天${reward?` · ${reward.badge}<b>${esc(reward.title)}</b>`:''}` : '';
  mask.querySelector('.tc-luck').innerHTML=`今日 · <b>${esc(luck.replace('宜 ',''))}</b>${streakLine}`;
  mask.classList.add('on');
  let flipped=false;
  const doFlip=()=>{ if(flipped) return; flipped=true; cardEl.classList.add('flipped');
    try{ EhSfx.play('sparkle'); }catch(_){}
    try{ burst(card.emoji, 14); }catch(_){}
    // 连签里程碑(3/7/14/30)达标 → 额外庆祝 + 提示
    if(reward){ setTimeout(()=>{ try{ burst(reward.badge, 18); EhSfx.play('bloom'); toast(`${reward.badge} ${reward.title} · ${reward.tip}`); }catch(_){} }, 500); }
    // 灵魂解牌随翻面后延时浮现(有在场灵魂时才有)
    if(soulRead && soulEl){ setTimeout(()=>{ soulEl.classList.add('show'); try{ EhSfx.play('sparkle'); }catch(_){} }, 950); }
    setTimeout(()=>closeEl.classList.add('show'), soulRead?1250:700);
  };
  cardEl.onclick=doFlip;
  closeEl.onclick=()=>{ mask.classList.remove('on'); };
}

// 进场提示去重: 同一人(uid)2分钟内只提示一次, 避免快速进出/来回切房重复弹进场(甚至同时冒两个)。
const ENTER_DEDUP_MS = 15 * 60 * 1000;   // ★15分钟: 同一人15分钟内重复进出只提示一次(主人要求, 原2min)
const _enterSeen = new Map();   // uid → 上次提示时间戳
function enterDedupOk(uid){
  const now=Date.now(); const last=_enterSeen.get(uid)||0;
  if(now-last < ENTER_DEDUP_MS) return false;
  _enterSeen.set(uid, now);
  // 顺手清理过期项防 Map 膨胀
  if(_enterSeen.size>200){ for(const [k,v] of _enterSeen){ if(now-v>ENTER_DEDUP_MS) _enterSeen.delete(k); } }
  return true;
}
// 自己进房 → 按类型渲染入场特效(横幅+全屏光幕+闪/震/粒子) + 按配置广播给房里其他人。
function entranceBanner(room){
  const cfg = (EH_CONFIG.entranceFx)||{};
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  const tier = userTier();
  const t = (cfg.tiers && cfg.tiers[tier]) || null;
  // 关闭/减动效/配置缺失 → 老行为(纯文字), 保证永不空场
  if(!cfg.enabled || reduce || !t){
    sysMsg(`你以 <b>${esc(me.name)}</b> 的身份进入了「${esc(room.name)}」`);   // 进场提示不消失, 留在流里
    return;
  }
  // 自己: 完整体验(横幅 + 光幕 + 闪屏 + 震屏 + 粒子)
  renderEntrance({ name:me.name, tier, roomName:room.name }, true);
  // ★ 2026-07-17 后台预览挂钩: ?entPreview=<tier> 或 __custom__ 时自动触发一次入场特效
  try{
    const pv=new URLSearchParams(location.search).get('entPreview');
    if(pv){
      setTimeout(()=>{
        try{
          let previewTier=pv;
          let previewName='预览者';
          if(pv==='__custom__'){
            const raw=localStorage.getItem('__eh_ent_preview_custom');
            if(raw){
              const c=JSON.parse(raw);
              // 临时推入 EH_CONFIG.customTiers 让 renderEntrance 能命中自定义档
              if(!Array.isArray(EH_CONFIG.customTiers)) EH_CONFIG.customTiers=[];
              EH_CONFIG.customTiers.push({...c, uids:[myUid]});
              previewTier=c.id;
              previewName=c.name||'预览';
            }
          }
          renderEntrance({ name:previewName, tier:previewTier, roomName:room.name }, true);
          try{ toast('预览: '+previewTier); }catch(_){}
        }catch(e){ console.warn('entPreview',e); }
      }, 1500);   // 等自己入场特效演完再放预览，不盖掉
    }
  }catch(_){}
  // ★发送端去重: 快速回同一房会再进 entranceBanner, 别重复 insert enter 行/重发世界公告
  //   (接收端 enterDedupOk 只挡视觉, 挡不住这里的白写 DB + 重复全站公告)。★同房 15min 内只广播一次(原2min)。
  //   持久化到 localStorage: 内存 Map 一刷新就归零, 15min 内刷新重进会再广播给全房→仍是"重复提醒"。
  //   落盘按 uid+room 记时间戳, 跨刷新/跨标签页都守住 15min(主人要求"15分钟内重复进出不重复提醒", 含刷新)。
  const _now=Date.now(); const _BCWIN=15*60*1000; const _BCKEY='eh_enterBc';
  let _bcMap={};
  try{ _bcMap=JSON.parse(localStorage.getItem(_BCKEY)||'{}')||{}; }catch(_){ _bcMap={}; }
  const _bck=(myUid||'?')+'@'+room.id;
  const _lastBc=_bcMap[_bck]||0;
  if(_now-_lastBc < _BCWIN) return;
  _bcMap[_bck]=_now;
  // 清理过期项防膨胀
  for(const k in _bcMap){ if(_now-_bcMap[k] > _BCWIN) delete _bcMap[k]; }
  try{ localStorage.setItem(_BCKEY, JSON.stringify(_bcMap)); }catch(_){}
  // 广播给房里其他人(达最低广播档才发; 匿名进出默认不广播防刷屏)。
  // ★enter 是"当场特效", 只需存活到 realtime 把它推给在场的人(几秒)。插入后 8s 自删——
  //   根治它污染历史/大厅预览/灵魂上下文/回声统计(治本, 前端过滤只是治标, 且已删存量24条)。
  try{
    const minBc = tierRank(cfg.broadcastMinTier||'reg') ?? 1;
    if(cfg.broadcast!==false && curRoom && myUid && (tierRank(tier)||0) >= minBc){
      sb.from('eh_messages').insert({ room_id:curRoom.id, user_id:myUid, name:me.name, emoji:me.emoji, color:me.color,
        text:tier, kind:'enter' }).select('id').single().then(({data,error})=>{
          if(error){ console.warn('enter broadcast', error.message); return; }
          if(data && data.id){ setTimeout(()=>{ try{ sb.from('eh_messages').delete().eq('id', data.id); }catch(_){} }, 8000); }
        });
    }
  }catch(e){ console.warn('enter broadcast', e); }
  // 世界频道: 高阶档(超管级 rank>=3, 或贵宾等自定义档)进场 → 全站流光公告。默认开, 后台 worldAnnounce=false 关。
  try{
    const wa = (cfg.worldAnnounce!==false);
    const isHighTier = tierRank(tier)>=3 || !!customTierDef(tier);
    if(wa && isHighTier && curRoom){ worldBroadcast({ name:me.name, tier, tierName:tierName(tier), roomName:room.name, roomId:room.id, icon:(t&&t.icon)||'✦' }); }
  }catch(e){ console.warn('world announce', e); }
}
// 统一入场渲染器(自己 isSelf=true 走全套; 别人 isSelf=false 只横幅+高阶档光幕, 不闪不震不打扰)
function renderEntrance(info, isSelf){
  const cfg=(EH_CONFIG.entranceFx)||{};
  const tier=info.tier||'reg';
  const ctDef = customTierDef(tier);   // 自定义档(含贵宾)? 无内置特效, 借用💎贵宾皮肤 + 按其 level 定隆重度
  let t=(cfg.tiers && cfg.tiers[tier]);
  if(!t && ctDef){
    // 自定义档统一用 vip 紫钻皮肤做底, 图标/入场词/待遇档按该档配置
    const base=(cfg.tiers && cfg.tiers.vip) || { label:'莅 临', cls:'ent-vip-tier', sfx:'soul', stage:true, burst:'💎✨🌟', flash:'#C77DFF', shake:false };
    t={ ...base, icon:ctDef.icon||base.icon };
    // ★ 2026-07-17: 后台可为自定义档写入 fx 整套自定覆盖(label/cls/sfx/stage/burst/flash/shake), 实现"添加新方式"
    if(ctDef.fx && typeof ctDef.fx==='object'){
      const fx=ctDef.fx;
      if(fx.label!=null) t.label=fx.label;
      if(fx.cls) t.cls=fx.cls;
      if(fx.sfx!=null) t.sfx=fx.sfx;
      if(fx.stage!=null) t.stage=!!fx.stage;
      if(fx.burst!=null) t.burst=fx.burst;
      if(fx.flash!=null) t.flash=fx.flash;
      if(fx.shake!=null) t.shake=!!fx.shake;
    }
  }
  if(!t) return;
  // 待遇档 level='super' → 借超管的隆重度(震屏+更炸的皇冠雨/金闪), 但保留自定义档身份皮肤与入场词。
  //   贵宾(vip)兼容遗留 EH_CONFIG.vipTreatment='super'; 其余自定义档看 customTiers[].level。
  const _treatSuper = ctDef ? (ctDef.level==='super' || (tier==='vip' && (EH_CONFIG.vipTreatment||cfg.vipTreatment)==='super')) : false;
  if(_treatSuper){
    const s=(cfg.tiers && cfg.tiers.super)||{};
    t={...t, shake:true, flash:t.flash||s.flash, stage:true};
  }
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  if(reduce){ // 别人减动效时也别硬塞, 给一行朴素提示即可(进场提示不消失, 留在流里)
    if(!isSelf) sysMsg(`<b>${esc(info.name)}</b> ${esc((t.label||'进入').replace(/\s/g,''))}了`);
    else sysMsg(`你以 <b>${esc(info.name)}</b> 的身份进入了「${esc(info.roomName||'')}」`);
    return;
  }
  const tagTxt = tierName(tier);
  const roomName = info.roomName || (curRoom&&curRoom.name) || '';
  // 全屏光幕: 自己按 t.stage; 别人按 othersStageMinTier(默认只有 admin+ 才惊动全场)
  const othersStageMin = tierRank(cfg.othersStageMinTier||'admin') ?? 2;
  const wantStage = isSelf ? !!t.stage : ((tierRank(tier)||0) >= othersStageMin);
  if(wantStage){ try{ playEntranceStage(t, {name:info.name, roomName}); }catch(_){} }
  // 闪屏/震屏: 只给本人(别人没进场却被闪/震很烦)
  if(isSelf && (t.flash || t.shake)){ try{ playInteractionFx({flash:t.flash||'', shake:!!t.shake}, null); }catch(_){} }
  // 横幅(自己/别人都显)
  const el=document.createElement('div');
  el.className='entry-banner '+(t.cls||'ent-reg');
  const nm = isSelf ? info.name : info.name;
  el.innerHTML=`<span class="eb-ic">${safeEmoji(t.icon)||'✦'}</span>`+
    `<span class="eb-txt"><span class="eb-nm">${esc(nm)}</span> <span class="eb-act">${esc(t.label||'进入')}</span> 「${esc(roomName)}」</span>`+
    `<span class="eb-tag">${tagTxt}</span>`;
  $('#stream').appendChild(el); scrollStream();
  // 进场提示不做消失处理: 就留在消息流里(再次进房 2 分钟内去重, 本来不会重复出现, 留着不堆积)
  // 音效: 自己必放; 别人只有高阶档(会全屏光幕的)才放, 避免频繁进场吵
  if(t.sfx && (isSelf || wantStage)){ try{ EhSfx.play(t.sfx); }catch(_){} }
  // 粒子迸发
  if(t.burst && (isSelf || wantStage)){ try{ burst(t.burst, tierRank(tier)>=3?20:10); }catch(_){} }
}
// 进场提醒 10 秒后自动"风吹散"消失(横幅/纯文字通用)。风散=向右上飘 + 模糊 + 渐隐, 高度收拢不留空洞。
//   (原 2 分钟太长, 横幅早被新消息顶出屏幕, 看不到飘散动效; 10 秒够看清谁进来又能亲眼看到风散)
const ENTRY_FADE_MS = 10000;
function scheduleEntryFade(el){
  if(!el) return;
  setTimeout(()=>{
    if(!el.isConnected) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    if(reduce){ try{ el.remove(); }catch(_){} return; }   // 减动效: 直接移除, 不做飘散
    // ★用 Web Animations API 驱动"风吹散", 不走 CSS class:
    //   进场横幅基础规则带 animation:entBannerIn(both 保留态) 占着 animation 属性, 加 class 换
    //   animation-name 在"旧动画已 filled"时浏览器常不重放 → 表现为直接塌陷消失。改用 el.animate()
    //   显式播关键帧, 完全绕开 CSS animation 重启的坑, 从 0% 100% 真播。
    const h=el.offsetHeight;
    el.style.overflow='hidden';
    let anim;
    try{
      anim = el.animate([
        { opacity:1, transform:'translate(0,0) skewX(0deg) scaleX(1)', filter:'blur(0px)', height:h+'px', marginTop:'12px', marginBottom:'12px', paddingTop:'13px', paddingBottom:'13px' },
        { opacity:.85, transform:'translate(14px,-6px) skewX(-6deg) scaleX(1.03)', filter:'blur(.4px)', offset:.35 },
        { opacity:0, transform:'translate(90px,-26px) skewX(-22deg) scaleX(.7)', filter:'blur(4px)', height:'0px', marginTop:'0px', marginBottom:'0px', paddingTop:'0px', paddingBottom:'0px' }
      ], { duration:1000, easing:'cubic-bezier(.4,0,.7,1)', fill:'forwards' });
    }catch(_){ anim=null; }
    if(anim){ anim.onfinish=()=>{ try{ el.remove(); }catch(_){} }; setTimeout(()=>{ try{ el.remove(); }catch(_){} }, 1300); }
    else { el.style.height=h+'px'; void el.offsetHeight; el.classList.add('entry-blowaway'); setTimeout(()=>{ try{ el.remove(); }catch(_){} }, 1200); }
  }, ENTRY_FADE_MS);
}
// 全屏入场光幕: 注入 sweep 光带 + flash 辐射 + 大字, 播完自动清。色由 tier 皮肤决定。
function playEntranceStage(t, room){
  const stage=$('#entStage'); if(!stage) return;
  // reg=青, vip=紫(尊贵), 其余(super/admin)=金
  const cVar = (t.cls==='ent-reg') ? 'var(--violet)' : (t.cls==='ent-vip-tier' ? 'var(--vapor-fuchsia,#C77DFF)' : 'var(--amber)');
  stage.style.setProperty('--ent-c', t.cls==='ent-vip-tier' ? '#C77DFF' : (t.cls==='ent-reg' ? 'var(--cyan)' : 'var(--amber)'));
  const bigWord = (t.label||'进入').replace(/\s/g,'');
  const who = (room && room.name) ? room.name : (me&&me.name)||'';   // 他人进场显他人名(renderEntrance 传 info.name)
  const roomNm = (room && room.roomName) || (curRoom&&curRoom.name) || '';
  stage.innerHTML=`<div class="ent-sweep"></div><div class="ent-flash"></div>`+
    `<div class="ent-big">${bigWord}<small>${esc(who)} · ${esc(roomNm)}</small></div>`;
  stage.classList.add('on');
  clearTimeout(playEntranceStage._t);
  playEntranceStage._t=setTimeout(()=>{ stage.classList.remove('on'); stage.innerHTML=''; }, 1500);
}
// 优化批A#1: 消息流条数上限,长时间挂机时防 DOM 无限累积卡顿。
// 只在贴底状态下(新消息追加)触发修剪,避免用户往上翻看历史时误删刚加载的旧消息。
// ★ 2026-07-17: 阀值从 800/600 降到 300/200 —— 实测 442 个直接子元素已致 reflow 单次 26ms，原阀值太高从不触发
const MAX_STREAM = 300, TRIM_TO = 200;
function trimStreamHead(){
  try{
    const s=$('#stream'); if(!s) return;
    if(s.children.length <= MAX_STREAM) return;
    // 仅在贴底附近才修剪(用户可能正在往上翻查历史,别打扰)
    const nearBot = (s.scrollHeight - s.scrollTop - s.clientHeight) < 200;
    if(!nearBot) return;
    while(s.children.length > TRIM_TO){
      const first = s.firstElementChild;
      if(!first) break;
      s.removeChild(first);
    }
  }catch(_){}
}
function scrollStream(smooth){
  const s=$('#stream'); if(!s) return;
  trimStreamHead();  // 优化批A#1: 每次滚动前顺手修剪超限消息
  // 平滑模式(新消息贴底时): 用 rAF 等 DOM 布局完成再滚, 避免"半截跳动"; 硬跳模式(进房/回底)直接到位
  if(smooth){
    requestAnimationFrame(()=>{ try{ s.scrollTo({top:s.scrollHeight,behavior:'smooth'}); }catch(_){ s.scrollTop=s.scrollHeight; } });
  } else {
    s.scrollTop=s.scrollHeight;
  }
  hideToLatest();
}
// ★回到最新: 翻看历史时(离底部>阈值)浮现按钮; 贴底自动隐藏
const TO_LATEST_THRESH=320;   // 离底部超过这么多 px 才算"在翻历史"
let _unreadCount=0;
function nearBottom(){ const s=$('#stream'); if(!s) return true; return (s.scrollHeight - s.scrollTop - s.clientHeight) < TO_LATEST_THRESH; }
function hideToLatest(){ const b=$('#toLatestBtn'); if(!b) return; b.classList.remove('on','has-new'); _unreadCount=0; const d=$('#tlDot'); if(d) d.textContent=''; }
function updateToLatest(){ const b=$('#toLatestBtn'); if(!b) return; if(nearBottom()){ hideToLatest(); } else { b.classList.add('on'); } }
// 新消息到达但用户在翻历史 → 角标 +1
function bumpUnread(){ const b=$('#toLatestBtn'); if(!b) return; if(nearBottom()) return; _unreadCount++; const d=$('#tlDot'); if(d) d.textContent = _unreadCount>99?'99+':String(_unreadCount); b.classList.add('on','has-new'); }
(function bindToLatest(){
  const attach=()=>{
    const s=$('#stream'), b=$('#toLatestBtn'); if(!s||!b) return false;
    if(s._tlBound) return true; s._tlBound=true;
    let raf=0; const kick=()=>{ if(raf) return; raf=requestAnimationFrame(()=>{ raf=0; updateToLatest(); }); };
    s.addEventListener('scroll', kick, {passive:true});
    // ★偶发不显示的根因: 翻历史时消息到达打字机/图片加载/神曲卡/特效会"事后撑高" stream,
    //   离底距离变大却不触发 scroll → updateToLatest 不跑 → 按钮该现不现。用 MutationObserver
    //   监听内容变化(节流到 rAF), 内容一长就重判显隐, 补上纯靠 scroll 覆盖不到的场景。
    try{
      const mo=new MutationObserver(kick);
      mo.observe(s, {childList:true, subtree:true, characterData:true});
      s._tlMO=mo;
    }catch(_){}
    b.addEventListener('click',()=>{ try{ s.scrollTo({top:s.scrollHeight,behavior:'smooth'}); }catch(_){ s.scrollTop=s.scrollHeight; } hideToLatest(); setTimeout(()=>{ s.scrollTop=s.scrollHeight; hideToLatest(); },420); });
    return true;
  };
  if(!attach()){ document.addEventListener('DOMContentLoaded',attach); setTimeout(attach,500); }
})();

// ============ 灵魂居民 Soul (前端展示层) ============
// 进房拉本房启用中的灵魂(仅展示字段)：驱动 is_bot 兜底识别 + 未来工坊入口。
let roomSouls = [];              // [{auth_uid,name,emoji,color,persona,emotion}]
let soulUidSet = new Set();      // 快速判断某 uid 是不是灵魂(历史旧消息 is_bot 缺失时兜底)
let soulNameSet = new Set();     // 按名字兜底: 同一灵魂可能有多个 auth_uid(狼姐漫游uid + 私密房驻守uid),
                                 // 只认 uid 会漏判成真人(@变色/头像色错乱)。灵魂名保留唯一, 按名兜底最稳。
// 统一判定"是不是灵魂": uid 命中 或 名字命中(本房灵魂) 或 名字在全局灵魂花名册(soulColors)里。
// ★第三条关键: 灵魂"漫游"进别的房时, 只写 presence 不改 eh_souls.room_id, 故 eh_room_souls(本房) 拿不到它,
//   soulNameSet 里也没有 → 会被当真人 → 用 safeColor 默认紫(#B57EDC)。用 soulColors 花名册名兜底判定, 根治"漫游灵魂显紫"。
function isSoulUser(uid, name){
  if(uid && soulUidSet.has(uid)) return true;
  if(name && soulNameSet.has(name)) return true;
  try{ if(name && EH_CONFIG.soulColors && Object.prototype.hasOwnProperty.call(EH_CONFIG.soulColors, name)) return true; }catch(e){}
  return false;
}
// 取灵魂的最新展示身份(先按 uid, 再按名字兜底)
function soulLatestBy(uid, name){ return (uid && roomSouls.find(x=>x.auth_uid===uid)) || (name && roomSouls.find(x=>x.name===name)) || null; }
async function loadRoomSouls(rid){
  roomSouls=[]; soulUidSet=new Set(); soulNameSet=new Set();
  const applyData=(data)=>{ roomSouls=data||[]; soulUidSet=new Set(roomSouls.map(s=>s.auth_uid)); soulNameSet=new Set(roomSouls.map(s=>s.name)); refreshRenderedSoulIdentity(); };
  const hit=soulsCache[rid];
  if(hit && Date.now()-hit.at < PREFETCH_TTL()){
    // 列表页已预取 → 秒用缓存(进房不再等 eh_room_souls RPC 往返)
    try{ applyData(await hit.p); }catch(e){}
    // 后台静默校正一次: 灵魂列表几乎不变, 但保证"后台开/关机器人"能最终生效(关掉的不再返回)。
    // ★只在拿到"确定的"结果(数组, 含空数组=后台确实全关)时才覆盖; RPC 异常/null 不动缓存,
    //   避免一次网络抖动把正确的灵魂列表清空。
    sb.rpc('eh_room_souls',{ rid }).then(({data,error})=>{
      if(error || !Array.isArray(data)) return;   // 抖动/失败 → 保留缓存,不覆盖
      if(rid===(curRoom&&curRoom.id)){ soulsCache[rid]={at:Date.now(),p:Promise.resolve(data)}; applyData(data); }
    }).catch(()=>{});
    return;
  }
  // 未预取: 走原路, 并回填缓存供二次进房复用
  try{
    const p = sb.rpc('eh_room_souls',{ rid }).then(({data})=>data||[]);
    soulsCache[rid]={ at:Date.now(), p };
    applyData(await p);
  }catch(e){ /* 灵魂表未建/无灵魂：静默，聊天照常 */ }
}
// 消息流灵魂头像"在场才呼吸": 按当前 presence 在场集给 #stream 里的灵魂消息 toggle .onair。
//   铁律=动效跟"在不在场"走。在场集(users)含在场真人+在场灵魂; 用 uid 为主、名字兜底(漫游灵魂多 uid)。
//   离开房间的灵魂→其历史消息不 onair→光环静止(仍在, 只停呼吸), 不再"不在房间还在动"。
let _onairUids=new Set(), _onairNames=new Set();
function syncStreamOnair(users){
  try{
    _onairUids=new Set((users||[]).map(u=>u.user_id).filter(Boolean));
    _onairNames=new Set((users||[]).map(u=>u.name).filter(Boolean));
    document.querySelectorAll('#stream .msg.soul').forEach(el=>{
      const uid=el.dataset.uid;
      const nm=el.querySelector('.nm')?.textContent||'';
      const on=(uid && _onairUids.has(uid)) || (nm && _onairNames.has(nm));
      el.classList.toggle('onair', on);
    });
  }catch(e){}
}
// 灵魂改了名字/头像/色后, 已渲染在 DOM 的历史消息还带旧快照 → 用最新身份就地回补。
// (buildMsgEl 会覆盖新渲染的消息, 但进房时 loadHistory 可能早于 loadRoomSouls 完成, 快照路径更是直接贴旧 HTML。)
function refreshRenderedSoulIdentity(){
  if(!soulUidSet || !soulUidSet.size) return;
  document.querySelectorAll('#stream .msg[data-uid]').forEach(el=>{
    const uid=el.dataset.uid;
    if(!soulUidSet.has(uid)) return;
    const s=roomSouls.find(x=>x.auth_uid===uid); if(!s) return;
    const c=soulThemeColor(s.color, safeColor(s.color), s), ic=safeEmoji(s.emoji)||'👤';
    const av=el.querySelector('.av');
    if(av){
      // 保留可能存在的 AI 角标 + 狼姐蝴蝶结, 只换底色/字色/头像 emoji(走 avEmoji 保黑洞校正)
      const dot=av.querySelector('.soul-dot');
      const bow=av.querySelector('.av-bow');
      av.style.background=c+'22'; av.style.color=c; av.style.boxShadow=`inset 0 0 0 1.5px ${c}`;
      av.innerHTML=avEmoji(ic)+(dot?dot.outerHTML:'')+(bow?bow.outerHTML:'');
      el.style.setProperty('--soul-c', c);
    }
    const nm=el.querySelector('.meta .nm');
    if(nm){ nm.style.color=c; nm.textContent=s.name; }
  });
  // ★光墙同步: 灵魂 presence 行可能在 roomSouls 加载前就渲染了(此时不认得是灵魂→用了兜底紫)。
  //   roomSouls 到位后重渲染一次光墙, 让灵魂头像立刻变成正确的房间主题色(免得要手动刷新, 见"狼姐先紫后正确")。
  try{ if(lastUsersSnapshot && lastUsersSnapshot.length) renderPresenceAvatars(lastUsersSnapshot); }catch(_){}
}


// ============ @提及 功能(真人+灵魂通用) ============
// 可@的对象 = 在线真人 + 本房灵魂(排除自己)。返回 [{name,emoji,color,isSoul}]
function atCandidates(){
  const seen=new Set(); const list=[];
  (lastUsersSnapshot||[]).forEach(u=>{
    if(u.user_id===myUid || !u.name || seen.has(u.name)) return;
    seen.add(u.name); list.push({name:u.name, emoji:u.emoji, color:u.color, isSoul:isSoulUser(u.user_id, u.name)});
  });
  // 灵魂即使 presence 没抓到也补上(常驻在线)
  (roomSouls||[]).forEach(s=>{ if(!seen.has(s.name)){ seen.add(s.name); list.push({name:s.name, emoji:s.emoji, color:s.color, isSoul:true}); } });
  return list;
}
// 把消息正文里的 @名字 渲染成高亮标签(输入已 esc 过)。匹配在场对象名,贪婪取最长名
function renderAtMentions(escHtml){
  const cands=atCandidates();
  const myName = me && me.name;
  if(!cands.length && !myName) return escHtml;
  // 名字可能含特殊字符,先 esc 再按长度降序(避免短名先吞掉长名的前缀)
  const names=[...cands.map(c=>c.name), myName].filter(Boolean).sort((a,b)=>b.length-a.length);
  const soulNames=new Set(cands.filter(c=>c.isSoul).map(c=>c.name));
  // 存"原始"颜色(可能为空), 不要先 safeColor——safeColor 会把空色兜成 #B57EDC 紫,
  // 再喂给 soulThemeColor 会被当"合法自定义色"直接返回, 于是灵魂@永远紫、无视房间主题(与头像/名字色不一致)。
  const soulColorByName={}; cands.forEach(c=>{ if(c.isSoul) soulColorByName[c.name]=(c.color||''); });
  // 真人各自的身份色(color-pick 选的, 与其头像/昵称同色)。@真人用它自己的身份色。
  const userColorByName={}; cands.forEach(c=>{ if(!c.isSoul && c.color) userColorByName[c.name]=c.color; });
  if(myName && me && me.color) userColorByName[myName]=me.color;
  let out=escHtml;
  for(const nm of names){
    const enm=esc(nm);
    // 匹配 @名字(名字用转义后的字面量),g 全局
    const re=new RegExp('@'+enm.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g');
    const isSoul=soulNames.has(nm);
    const isMe=(nm===myName);
    // 统一走 --at-c: @灵魂=房间主题色(soulThemeColor,与头像/光墙/角标统一); @我=琥珀(强提醒信号,盖过身份色);
    //   @其他真人=其自己的身份色(与其头像/昵称同色)。都取不到时回落 CSS 默认主题色。
    let atc='';
    if(isSoul) atc=soulThemeColor(soulColorByName[nm]||'', undefined, nm);
    else if(!isMe && userColorByName[nm]) atc=safeColor(userColorByName[nm]);
    const cls='at-mention'+(isMe?' at-me':(isSoul?' at-soul':(atc?' at-user':'')));
    const style=(atc && !isMe) ? ` style="--at-c:${atc}"` : '';
    out=out.replace(re, '<span class="'+cls+'"'+style+'>@'+enm+'</span>');
  }
  return out;
}
// —— 输入框 @菜单 ——
let _atActive=false, _atStart=-1, _atSel=0, _atList=[];
// 检测光标前是否正在输入 @xxx(@紧跟词首或空格后),是则弹菜单
function checkAtTrigger(){
  const inp=$('#cin'); const pos=inp.selectionStart; const v=inp.value.slice(0,pos);
  const m=v.match(/(?:^|\s)@([^\s@]*)$/);
  if(!m){ hideAt(); return; }
  const q=m[1].toLowerCase();
  _atStart=pos-m[1].length-1;   // @ 的位置
  const cands=atCandidates().filter(c=>!q || c.name.toLowerCase().includes(q));
  if(!cands.length){ hideAt(); return; }
  _atList=cands; _atSel=0; _atActive=true; renderAtMenu();
}
function renderAtMenu(){
  const menu=$('#atMenu');
  menu.innerHTML=_atList.map((c,i)=>`<div class="at-item${i===_atSel?' sel':''}" data-i="${i}">
    <div class="ai-av" style="background:${safeColor(c.color)}22;--ec:${safeColor(c.color)}">${safeEmoji(c.emoji)||(c.isSoul?'✦':'👤')}</div>
    <span class="ai-nm">${esc(c.name)}</span>
    ${c.isSoul?`<span class="ai-tag" style="--ec:${safeColor(c.color)};background:color-mix(in srgb,${safeColor(c.color)} 16%,transparent)">✦AI</span>`:''}
  </div>`).join('');
  menu.classList.add('on');
  menu.querySelectorAll('.at-item').forEach(el=>el.onclick=()=>pickAt(+el.dataset.i));
}
function hideAt(){ _atActive=false; $('#atMenu').classList.remove('on'); }
// 点在线光墙的头像 → 往输入框插入 @该用户(快捷@)
function insertAtName(name){
  if(!name) return;
  const inp=$('#cin');
  const cur=inp.value;
  // ★ toggle: 已经 @过该人 → 再点就取消(移除那个 @提及)
  const tag='@'+name+' ';
  if(cur.includes(tag)){
    // 移除首个该 @标签 + 它前导的单个空格(若有), 并把连接处多余空白收拢
    let v=cur.replace(new RegExp('\\s?'+'@'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s'), ' ');
    v=v.replace(/\s{2,}/g,' ').replace(/^\s+/,'');
    inp.value=v;
    inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
    syncSendBtn();
    try{ if(navigator.vibrate) navigator.vibrate(12); }catch(e){}
    return;
  }
  const sep = (cur && !/\s$/.test(cur)) ? ' ' : '';
  inp.value = cur + sep + '@' + name + ' ';
  inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
  syncSendBtn();
  try{ if(navigator.vibrate) navigator.vibrate(20); }catch(e){}
}
// 头像交互: 点=直接@ TA; 长按(500ms)=弹「对TA」互动菜单。
//   两处入口:①在线光墙 .pav ②消息里的头像 .msg .av[data-atname]
let _hlTimer=null, _hlFired=false, _hlStart=null;
function headEl(t){ const pav=t.closest('#presence .pav[data-atname]'); return pav||t.closest('.msg .av[data-atname]'); }
document.addEventListener('pointerdown',e=>{
  const el=headEl(e.target); if(!el) return;
  const nm=el.dataset.atname; const uid=el.dataset.uid||''; if(!nm) return;
  _hlFired=false; _hlStart={x:e.clientX,y:e.clientY};
  _hlTimer=setTimeout(()=>{ _hlFired=true; try{ ehLongPressFx(); }catch(_){} openPeerMenu(el, nm, uid); }, 500);
},{passive:true});
document.addEventListener('pointermove',e=>{ if(_hlTimer && _hlStart && (Math.abs(e.clientX-_hlStart.x)>10||Math.abs(e.clientY-_hlStart.y)>10)){ clearTimeout(_hlTimer); _hlTimer=null; } },{passive:true});
document.addEventListener('pointerup',e=>{
  if(_hlTimer){ clearTimeout(_hlTimer); _hlTimer=null; }
  const el=headEl(e.target);
  if(el && !_hlFired){ const nm=el.dataset.atname; if(nm) insertAtName(nm); }   // 未触发长按 → 点=@
  _hlStart=null;
});
document.addEventListener('pointercancel',()=>{ if(_hlTimer){ clearTimeout(_hlTimer); _hlTimer=null; } _hlStart=null; });
// ===== 互动系统: 配置 + 「对TA」菜单 + 发送 + 特效 =====
let _interactions=[];   // eh_interactions 缓存
// 内置互动的"电影感升级"补丁: 补 DB 里没有的升级键(ring/zoom/word/sweep/float) + 配套音效。
// 视觉键: 仅补空缺, DB 已配的永远优先(后台可覆盖)。
// sfx: 用 sfxForce 换成配套的电影感音效; 自定义互动不在此表, sfx 完全由后台决定。
// ★ 2026-07-16: 这 7 条升级 fx 已固化进 DB(eh_interactions), 本补丁现为纯兜底——
//   正常走 DB 值; 仅当某条被后台清空升级键时兜底补回, 平时不生效。后台改这 7 条以 DB 为准。
const IX_FX_UPGRADE = {
  punch:    { zoom:true, ring:'#E63946', word:'BAM',  word_c:'#FF5A5A', sfxForce:'punch' },
  bomb:     { zoom:true, ring:'#FF6B00', word:'BOOM', word_c:'#FF9A3D', sfxForce:'boom' },
  rose:     { float:'🌹🌸💗', sfxForce:'bloom' },
  hug:      { float:'💛✨🧡', sfxForce:'bloom' },
  coffee:   { float:'☕✨', sfxForce:'receive' },
  confetti: { sweep:'#FFD84D', word:'🎉', word_c:'#FFD84D', sfxForce:'sparkle' },
  firework: { sweep:'#8B5CFF', ring:'#8B5CFF', sfxForce:'boom' },
};
function enrichIxFx(ix){
  if(!ix || !ix.id) return ix;
  const up = IX_FX_UPGRADE[ix.id]; if(!up) return ix;
  const fx = Object.assign({}, ix.fx||{});
  for(const k in up){
    if(k==='sfxForce'){ fx.sfx=up[k]; continue; }   // 内置互动音效强制换配套的
    if(fx[k]==null) fx[k]=up[k];                     // 视觉键仅补空缺, DB 值优先
  }
  ix.fx = fx; return ix;
}
async function loadInteractions(){
  try{ const { data }=await sb.from('eh_interactions').select('*').eq('enabled',true).order('sort'); if(Array.isArray(data)) _interactions=data.map(enrichIxFx); }catch(e){}
}
const _ixCooldown=new Map();   // interactionId → 上次发的时间戳(本地冷却)
const isSoulUid=(uid)=>soulUidSet && soulUidSet.has(uid);
// 点头像弹出「对TA」小菜单: @TA + 各互动
function openPeerMenu(anchorEl, name, uid){
  hidePeerMenu();
  const isTargetSoul=isSoulUid(uid);
  // 长按菜单只保留互动(送花/抱一下/打一拳/扔炸弹); @TA 仍由"点头像"触发, 不在此菜单
  const items=[];
  _interactions.forEach(ix=>{
    if(isTargetSoul && ix.can_target_soul===false) return;
    items.push(`<div class="pm-row" data-ix="${esc(ix.id)}">${safeEmoji(ix.emoji)||'✨'} <span>${esc(ix.name)}</span></div>`);
  });
  const menu=document.createElement('div'); menu.className='peer-menu'; menu.id='peerMenu';
  menu.innerHTML=`<div class="pm-hd">对 ${esc(name)}</div>`+items.join('');
  document.body.appendChild(menu);
  // 定位到头像附近(视口内)
  const r=anchorEl.getBoundingClientRect();
  let x=r.left, y=r.bottom+6;
  requestAnimationFrame(()=>{ const mw=menu.offsetWidth, mh=menu.offsetHeight;
    if(x+mw>window.innerWidth-8) x=window.innerWidth-mw-8;
    if(y+mh>window.innerHeight-8) y=r.top-mh-6;
    menu.style.left=Math.max(8,x)+'px'; menu.style.top=Math.max(8,y)+'px'; menu.classList.add('on'); });
  menu.querySelectorAll('.pm-row').forEach(row=>row.onclick=(e)=>{ e.stopPropagation();
    if(row.dataset.act==='at'){ insertAtName(name); hidePeerMenu(); return; }
    const ix=_interactions.find(i=>i.id===row.dataset.ix); if(ix) sendInteraction(ix, uid, name);
    hidePeerMenu();
  });
}
function hidePeerMenu(){ const m=$('#peerMenu'); if(m) m.remove(); }
document.addEventListener('click',e=>{ if(!e.target.closest('#peerMenu') && !e.target.closest('.pav')&&!e.target.closest('.msg .av')) hidePeerMenu(); });
// 发一个互动: 本地立即演特效 + 写 kind=interact 消息广播给房里所有人
async function sendInteraction(ix, targetUid, targetName){
  // 眩晕期禁打击类互动(温和的送花/抱抱放行, 让人还能表达善意)——提到最前
  if(isStunned() && isHitIx(ix)){ toast('💫 你被打晕了，还手不了…'); return; }
  if(!curRoom||!myUid) return;
  const now=Date.now(), cd=ix.cooldown_ms||4000;
  if(now-(_ixCooldown.get(ix.id)||0) < cd){ toast('手速太快，歇会儿再来~'); return; }
  _ixCooldown.set(ix.id, now);
  // 发起者本地先演一遍(命中对方头像); 目标本人收到 realtime 再演(带震)
  const tEl=document.querySelector(`#presence .pav[data-uid="${targetUid}"]`)||null;
  try{ playInteractionFx(Object.assign({}, ix.fx, {vibrate:null, shake:false, flash:null, zoom:false}), tEl); }catch(_){}  // 自己发不震/顿自己屏, 但保留飞行物/环/大字看命中
  // 连击对战: 我发起的打击类计入战斗态(命中同步稍后, 但态即时记)
  if(isHitIx(ix)){ try{ const r=tEl&&tEl.getBoundingClientRect(); combatOnHit(myUid, (me&&me.name)||'你', targetUid, targetName, r?r.left+r.width/2:null, r?r.top+r.height/2:null); }catch(_){} }
  // 合体特效: 我发起的也汇入同心共振
  try{ fusionOnInteract(myUid, ix, targetUid, targetName); }catch(_){}
  const txt=(ix.text_tpl||'{from} 对 {to} 使用了 '+ix.name).replace('{from}',me.name).replace('{to}',targetName);
  // text 编码: ixId|targetUid|文案 ; kind=interact
  const payload={ room_id:curRoom.id, user_id:myUid, name:me.name, emoji:me.emoji, color:me.color,
    text:ix.id+'|'+targetUid+'|'+txt, kind:'interact' };
  try{ await sb.from('eh_messages').insert(payload); }catch(e){ console.warn('sendInteraction',e); }
}
// ============ 连击对战: 反击窗口 + 连击计数 + KO 结算 ============
// 纯前端, 从共享的 interact 消息流推导, 不加 DB 字段。
// 规则: 打击类(category='hit')互动才计入战斗; 同一对人(a↔b)在窗口内你来我往累加连击;
//   挨打方 10s 内可点"反击"浮钮回敬(自动选一个打击类互动打回发起者);
//   连击达阈值 → KO 结算(全屏大字 + 音效 + 定格), 战斗清零。
const CB_WINDOW = 12000;        // 连击窗口: 该目标两次挨打间隔超过则连击断
const CB_COUNTER_MS = 10000;    // 反击浮钮可点时长
const CB_KO_AT = 5;             // 挨打累计到几下(可多人叠加)触发 KO
const KO_STUN_MS = 15000;       // 被 KO 后眩晕时长(禁打击+禁言)
// ★按"被打者"聚合: 任何人(含灵魂)打某人都累加到该人挨打计数 → 多人围殴叠加, 凑够就 KO。
const _victim = new Map();      // toUid → { count, last, lastFrom, lastFromName }
const _koCooldown = new Map();  // toUid → 上次被 KO 结算时间(防同一人短时连续被 KO 刷屏; 覆盖眩晕期)
const KO_COOLDOWN_MS = 20000;   // 同一被 KO 者结算冷却(≈眩晕时长, 晕着时别再 KO)
let _stunnedUntil = 0;          // 自己被 KO 眩晕到期时间戳(0=没被晕)
let _koTimer = null;            // 眩晕倒计时 timer
let _counterFrom = null;        // 反击对象 { uid, name } (最近打我的人)
let _counterTimer = null;
function isHitIx(ix){ return ix && (ix.category==='hit'); }
// (保留, 其它处可能引用)
// uid → 显示名(取 presence 头像的 atname; 自己→me.name; 取不到→'某人')
function targetName(uid){
  if(uid===myUid) return (me&&me.name)||'你';
  const el=document.querySelector(`#presence .pav[data-uid="${uid}"]`);
  return (el&&el.dataset.atname) || '某人';
}
function isStunned(){ return Date.now() < _stunnedUntil; }
// 收到一条打击类互动(from → to)时调用: 累加"该目标"挨打数(多人叠加), 判 KO。
function combatOnHit(fromUid, fromName, toUid, toName, tx, ty){
  if(!toUid) return;
  const now = Date.now();
  let v = _victim.get(toUid);
  if(!v || (now - v.last) >= CB_WINDOW){ v = { count:0, last:now }; _victim.set(toUid, v); }
  v.count++; v.last=now; v.lastFrom=fromUid; v.lastFromName=fromName;
  // 连击飘字(≥2 才显; 多人打同一人也一起涨)
  if(v.count>=2){ showCombo(v.count, tx, ty); }
  // KO: 该目标挨打累计够阈值
  if(v.count>=CB_KO_AT){
    _victim.delete(toUid);
    // 防刷屏: 同一被 KO 者 20s 内不重复结算(晕着的时候别再 KO 一遍)
    if(now - (_koCooldown.get(toUid)||0) < KO_COOLDOWN_MS) return;
    _koCooldown.set(toUid, now);
    const winnerName = fromName;          // 打出致命一击者
    const loserUid = toUid, loserName = toName || targetName(toUid);
    setTimeout(()=>{ try{ koFinale(winnerName, loserUid, loserName); }catch(_){} }, 560);  // 等这一击命中再结算
    if(toUid===myUid) clearCounter();
    return;
  }
  // 反击浮钮: 只有"我被打"且没被晕时才提示回敬
  if(toUid===myUid && fromUid!==myUid && !isStunned()){ offerCounter(fromUid, fromName); }
}
function showCombo(n, tx, ty){
  const el=document.createElement('div'); el.className='ix-combo';
  el.textContent='×'+n+(n>=4?' 🔥':'');
  el.style.fontSize=(26+Math.min(n,8)*4)+'px';
  el.style.left=((tx||window.innerWidth/2))+'px'; el.style.top=((ty||window.innerHeight*0.4)-40)+'px';
  el.style.transform='translate(-50%,0)';
  document.body.appendChild(el); void el.offsetWidth; el.classList.add('on');
  setTimeout(()=>el.remove(), 850);
}
// 提示反击+格挡: 浮钮 10s 可点; 反击=回敬发起者, 格挡=本次免伤
function offerCounter(fromUid, fromName){
  _counterFrom = { uid:fromUid, name:fromName };
  const btn=$('#counterBtn'); if(!btn) return;
  const ring=btn.querySelector('.cb-ring'); if(ring){ ring.style.animation='none'; void ring.offsetWidth; ring.style.animation=''; }
  btn.querySelector('.cb-txt').textContent='反击 '+fromName;
  btn.classList.add('on');
  const gb=$('#guardBtn'); if(gb) gb.classList.add('on');   // 同时给格挡选项
  clearTimeout(_counterTimer);
  _counterTimer=setTimeout(clearCounter, CB_COUNTER_MS);
}
function clearCounter(){ const btn=$('#counterBtn'); if(btn) btn.classList.remove('on'); const gb=$('#guardBtn'); if(gb) gb.classList.remove('on'); _counterFrom=null; clearTimeout(_counterTimer); }
function doCounter(){
  if(!_counterFrom) return;
  // 选一个可用的打击类互动回敬(优先"打一拳", 没有则任意 hit)
  const hits=_interactions.filter(isHitIx);
  const ix=hits.find(i=>i.id==='punch')||hits[0];
  const tgt=_counterFrom;
  clearCounter();
  if(ix && tgt){ sendInteraction(ix, tgt.uid, tgt.name); }
  else toast('没有可用的反击招式');
}
// 格挡: 抵消自己最近这次挨打(连击计数 -1, 更难被 KO) + 蓝盾光环一闪
function doGuard(){
  const v=_victim.get(myUid);
  if(v && v.count>0){ v.count--; }   // 免这一下
  clearCounter();
  try{ EhSfx.play('receive'); }catch(_){}
  try{ if(navigator.vibrate) navigator.vibrate(20); }catch(_){}
  // 盾光环在自己头像处一闪(取不到则屏幕中下)
  let x=window.innerWidth/2, y=window.innerHeight*0.5;
  const pav=document.querySelector(`#presence .pav[data-uid="${myUid}"]`);
  if(pav){ try{ const r=pav.getBoundingClientRect(); x=r.left+r.width/2; y=r.top+r.height/2; }catch(_){} }
  const g=document.createElement('div'); g.className='guard-flash'; const sz=80;
  g.style.width=g.style.height=sz+'px'; g.style.left=(x-sz/2)+'px'; g.style.top=(y-sz/2)+'px';
  document.body.appendChild(g); void g.offsetWidth; g.classList.add('on');
  setTimeout(()=>g.remove(), 650);
  toast('🛡️ 格挡成功，免伤一击！');
}
// KO 结算: 全屏大字 + 音效 + 短震 + 胜者横幅; 若被 KO 的是自己 → 进入 15s 眩晕(禁打击+禁言)。
function koFinale(winnerName, loserUid, loserName){
  try{ ixImpactWord('K.O.', '#FFD84D'); }catch(_){}
  try{ EhSfx.play('boom'); }catch(_){}
  try{ if(navigator.vibrate) navigator.vibrate([60,40,120]); }catch(_){}
  try{ scheduleEntryFade(sysMsg(`🏆 <b>${esc(winnerName)}</b> 把 <b>${esc(loserName||'对手')}</b> 打出 <b>K.O.</b>！`)); }catch(_){}
  // 给被 KO 者头像挂 💫 转圈(旁人也看得到), 15s 后自动摘
  try{ markKoStun(loserUid); }catch(_){}
  // 被 KO 的是我 → 本地进入眩晕
  if(loserUid && loserUid===myUid){ enterStun(); }
}
// 头像挂/摘 💫 眩晕标记(全房都渲染)
function markKoStun(uid){
  if(!uid) return;
  const pav=document.querySelector(`#presence .pav[data-uid="${uid}"]`);
  if(pav){ pav.classList.add('ko-stun'); setTimeout(()=>{ try{ pav.classList.remove('ko-stun'); }catch(_){} }, KO_STUN_MS); }
}
// 自己被 KO: 15s 眩晕。禁打击类互动 + 禁言(温和互动/表情放行), 屏幕中央大字倒计时 + 输入区遮罩。
function enterStun(){
  _stunnedUntil = Date.now()+KO_STUN_MS;
  clearCounter();   // 被晕了就别提示反击
  const ov=$('#koStun'); if(ov){ ov.classList.add('on'); }
  const composer=$('.composer'); if(composer) composer.classList.add('ko-stunned');
  clearInterval(_koTimer);
  const tick=()=>{
    const left=Math.ceil((_stunnedUntil-Date.now())/1000);
    const num=$('#koStunNum'); if(num) num.textContent = left>0?left:'';
    if(left<=0){ clearInterval(_koTimer); _koTimer=null; exitStun(); }
  };
  tick(); _koTimer=setInterval(tick, 250);
}
function exitStun(){
  _stunnedUntil=0; clearInterval(_koTimer); _koTimer=null;
  const ov=$('#koStun'); if(ov) ov.classList.remove('on');
  const composer=$('.composer'); if(composer) composer.classList.remove('ko-stunned');
  try{ EhSfx.play('receive'); }catch(_){}
  try{ toast('💫 眩晕解除，满血复活！'); }catch(_){}
}
$('#counterBtn') && ($('#counterBtn').onclick=()=>{ try{ EhSfx.playClick(); }catch(_){} doCounter(); });
$('#guardBtn') && ($('#guardBtn').onclick=()=>{ try{ EhSfx.playClick(); }catch(_){} doGuard(); });
// ============ 合体特效(同心共振): 多人短时对同一人发同一互动 → 升级名场面 ============
// 纯前端, 从共享 interact 流推导。窗口内"同一目标 + 同一互动 id"的不同发起者 ≥ 阈值 → 触发一次盛大结算。
const FUSE_WINDOW = 8000;   // 汇聚窗口
const FUSE_AT = 3;          // 不同的人数达到几个触发合体
const _fuse = new Map();    // key = targetUid+'|'+ixId → { senders:Set, last, ixName, ixEmoji, targetName }
let _fuseCooldown = 0;      // 全房合体结算冷却, 防连环刷屏
function fusionOnInteract(fromUid, ix, targetUid, tName){
  if(!ix || !ix.id) return;
  const now=Date.now(); const key=targetUid+'|'+ix.id;
  let e=_fuse.get(key);
  if(!e || (now-e.last)>FUSE_WINDOW){ e={ senders:new Set(), last:now, ixName:ix.name, ixEmoji:ix.emoji, targetName:tName }; _fuse.set(key,e); }
  e.senders.add(fromUid); e.last=now; e.targetName=tName||e.targetName;
  // 定期清过期 key(防 Map 膨胀)
  if(_fuse.size>40){ for(const [k,v] of _fuse){ if(now-v.last>FUSE_WINDOW) _fuse.delete(k); } }
  if(e.senders.size>=FUSE_AT && (now-_fuseCooldown)>6000){
    _fuseCooldown=now;
    const cnt=e.senders.size;
    _fuse.delete(key);
    setTimeout(()=>{ try{ fusionFinale(ix, e.targetName, cnt); }catch(_){} }, 520);
  }
}
// 合体结算: 全屏光带 + 命中大字 + 满屏该 emoji 雨 + 音效 + 系统横幅
function fusionFinale(ix, tName, cnt){
  const emo=(ix.emoji||'✨'); const burstStr=(ix.fx&&ix.fx.burst)||emo.repeat(3);
  // 光带扫过 + 大字 + 纸屑雨(复用 playInteractionFx 的氛围原子)
  try{ playInteractionFx({ sweep:'#FFD84D', word:emo, word_c:'#FFD84D', rain:true, burst:burstStr, sfx:'sparkle' }, null); }catch(_){}
  // 额外来一波满屏粒子(比单次撒射更盛大)
  try{ burst(burstStr, 40); }catch(_){}
  try{ scheduleEntryFade(sysMsg(`✨ ${cnt} 人同时向 <b>${esc(tName||'TA')}</b> ${esc(ix.name||'致意')} —— <b>名场面</b>！`)); }catch(_){}
}
// 本地打字机：把灵魂消息逐字吐进 .txt(好看,零成本,不走网关流式)
// 用字素簇切分(保 emoji 完整),每帧吐 1-2 字,@高亮在收尾时统一渲染
function typewriterInto(el, fullText){
  const txt=el.querySelector('.txt'); if(!txt || !fullText) return;
  let chars;
  try{ const seg=new Intl.Segmenter('zh',{granularity:'grapheme'}); chars=[...seg.segment(fullText)].map(s=>s.segment); }
  catch(e){ chars=[...fullText]; }
  if(chars.length<=1){ txt.innerHTML=renderAtMentions(esc(fullText)); return; }
  // ★保底铁律: 先把完整文本(带@高亮)写进去, 再启打字机。这样任何一环卡住/中断(el 断链、timer 未跑、页面切房)
  // 都不会留空气泡——最差也是直接看到完整文本。旧版 txt.textContent='' 会先清空,一旦打字中断就永远空白。
  txt.innerHTML=renderAtMentions(esc(fullText));
  let i=0;
  // 速度:短句快、长句稍快封顶,总时长控制在 ~0.4~2.2s
  const per=Math.max(18, Math.min(55, 1600/chars.length));
  const stream=$('#stream');
  let started=false;
  // ★性能: 打字前测一次"是否贴底"(读一次布局), 打字中不再每字符读 scrollHeight(避免逐字强制 reflow 抖动);
  //   贴底时才边打边滚, 且每 5 字符滚一次; 收尾统一贴底一次。
  const wasNear = (stream.scrollHeight-stream.scrollTop-stream.clientHeight) < 160;
  const tick=()=>{
    if(!el.isConnected){ txt.innerHTML=renderAtMentions(esc(fullText)); return; }  // 断链→保全完整文本(不留空)
    if(!started){ started=true; txt.textContent=''; }   // 真正开始打字前才清空(比预先清空安全: 即使本帧异常也已有完整文本在)
    i+=Math.random()<0.35?2:1;                   // 偶尔一次吐2字,更像打字节奏
    if(i>=chars.length){
      txt.innerHTML=renderAtMentions(esc(fullText));  // 收尾:完整+@高亮
      if(wasNear) scrollStream();
      return;
    }
    txt.textContent=chars.slice(0,i).join('');
    if(wasNear && i%5===0) scrollStream();   // 贴底时每5字符滚一次(不逐字读布局)
    el._twTimer=setTimeout(tick, per);
  };
  el._twTimer=setTimeout(tick, per);
}
// 被 @ 强提醒：收到别人消息里 @了我 → toast + 消息卡脉冲高亮 + 震动
function notifyIfMentioned(m, el){
  if(!m || m.user_id===myUid || !me || !me.name) return;
  const t=String(m.text||'');
  if(!t.includes('@'+me.name)) return;
  // toast 横幅
  const who = m.is_bot ? (safeEmoji(m.emoji)+m.name) : m.name;
  toast(`💬 ${who} @了你`);
  // 消息卡脉冲高亮一下
  if(el){ el.classList.add('mentioned-flash'); ehFx(el,'fx-mention',2000); setTimeout(()=>el.classList.remove('mentioned-flash'),2000); }
  try{ EhSfx.play('mention'); }catch(e){}
  // 轻震动(移动端)
  try{ if(navigator.vibrate) navigator.vibrate(80); }catch(e){}
  // 记入@我队列 → 常驻@按钮, 点击可回看(即使被后续消息刷走)
  if(m.id!=null && !String(m.id).startsWith('local_')) pushMention(m.id);
}
// @我提醒队列: 记录被@的消息 id, 点@按钮轮流跳转+高亮
let _mentionQueue=[];   // 未查看的被@消息 id(新→旧)
function pushMention(mid){
  mid=String(mid);
  _mentionQueue=_mentionQueue.filter(x=>x!==mid); _mentionQueue.unshift(mid);
  if(_mentionQueue.length>20) _mentionQueue.length=20;
  updateMentionJump();
}
function updateMentionJump(){
  const b=$('#mentionJump'); if(!b) return;
  const n=_mentionQueue.length;
  if(!n){ b.classList.remove('on','multi'); return; }
  b.classList.add('on'); b.classList.toggle('multi', n>1);
  const d=$('#mjDot'); if(d) d.textContent = n>9?'9+':String(n);
}
function jumpToMention(){
  if(!_mentionQueue.length) return;
  // 每点一次"消费"最近的一条: 取出队首(最新)→跳过去→从队列移除→角标 -1
  const mid=_mentionQueue.shift();
  updateMentionJump();   // 立即 -1(不管那条在不在当前列表, 点了就算看过)
  const msg=document.querySelector(`.msg[data-mid="${mid}"]`);
  if(msg){
    msg.scrollIntoView({behavior:'smooth',block:'center'});
    msg.classList.add('mentioned-flash'); setTimeout(()=>msg.classList.remove('mentioned-flash'),2000);
  } else {
    toast('那条消息不在当前列表里');
  }
}
(function bindMentionJump(){ const b=document.getElementById('mentionJump'); if(b) b.addEventListener('click',jumpToMention); })();
// 神曲谱好提醒队列: 记录我点的、刚谱好的神曲 id, 点"神"按钮轮流跳转+高亮(仿@提醒)
let _songReadyQueue=[], _songReadyIdx=0;
function pushSongReady(mid){
  mid=String(mid);
  _songReadyQueue=_songReadyQueue.filter(x=>x!==mid); _songReadyQueue.unshift(mid);
  if(_songReadyQueue.length>20) _songReadyQueue.length=20;
  updateSongJump();
}
// "神"按钮双态: 谱好(紫脉冲+数字, 优先) > 生成中(青流光+转圈)。都无则隐藏。
function updateSongJump(){
  const b=$('#songJump'); if(!b) return;
  const ready=_songReadyQueue.length;
  const gen=(typeof _songGenCount==='number')?_songGenCount:0;
  if(ready){
    // 谱好态优先(更值得提醒): 紫色脉冲 + 数字角标
    b.classList.remove('gen'); b.classList.add('on'); b.classList.toggle('multi', ready>1);
    b.title='你的神曲谱好了 · 点击去听';
    const d=$('#sjDot'); if(d) d.textContent = ready>9?'9+':String(ready);
  } else if(gen){
    // 仅生成中: 青色流光。角标显示谱曲中首数(单首也写"1", 避免空角标)。
    b.classList.remove('on'); b.classList.add('gen'); b.classList.toggle('multi', gen>1);
    const d=$('#sjDot'); if(d) d.textContent = gen>9?'9+':String(gen);
    b.title = gen===1 ? '神曲谱曲中 · 点击查看' : `${gen} 首神曲谱曲中 · 点击依次查看`;
  } else {
    b.classList.remove('on','multi','gen');
  }
}
function jumpToSongReady(){
  // 谱好队列非空 → 轮流跳谱好的歌; 否则(仅生成中)→ 滚到最近的 pending 神曲(同样高亮)
  if(!_songReadyQueue.length){
    // 仅谱曲中: 轮流定位 _songGenQueue 里的每一首(依次), 每点一次跳下一首
    if(_songGenQueue.length){
      const gid=_songGenQueue[_songGenIdx % _songGenQueue.length]; _songGenIdx++;
      const gm=document.querySelector(`.msg[data-mid="${gid}"]`);
      if(gm){
        gm.scrollIntoView({behavior:'smooth',block:'center'});
        gm.classList.remove('song-flash'); void gm.offsetWidth; gm.classList.add('song-flash');
        setTimeout(()=>gm.classList.remove('song-flash'),2200);
        const gc=gm.querySelector('.song-card'); if(gc){ gc.classList.add('arrived'); setTimeout(()=>gc.classList.remove('arrived'),3400); }
      } else if(_sqbTarget){
        try{ _sqbTarget.scrollIntoView({behavior:'smooth',block:'center'});
          _sqbTarget.classList.remove('song-flash'); void _sqbTarget.offsetWidth; _sqbTarget.classList.add('song-flash');
          setTimeout(()=>_sqbTarget&&_sqbTarget.classList.remove('song-flash'),2200); }catch(_){}
      }
    } else if(_sqbTarget){
      try{ _sqbTarget.scrollIntoView({behavior:'smooth',block:'center'});
        _sqbTarget.classList.remove('song-flash'); void _sqbTarget.offsetWidth; _sqbTarget.classList.add('song-flash');
        setTimeout(()=>_sqbTarget&&_sqbTarget.classList.remove('song-flash'),2200); }catch(_){}
    }
    return;
  }
  // 每点一次"消费"最近谱好的一首: 取出队首→跳过去→移除→角标 -1
  const mid=_songReadyQueue.shift();
  updateSongJump();   // 立即 -1
  const msg=document.querySelector(`.msg[data-mid="${mid}"]`);
  if(msg){
    msg.scrollIntoView({behavior:'smooth',block:'center'});
    // 整条消息选中高亮(仿@, 神曲紫) → 明确"就是这条"; 卡片也弹一下强调
    msg.classList.remove('song-flash'); void msg.offsetWidth; msg.classList.add('song-flash');
    setTimeout(()=>msg.classList.remove('song-flash'),2200);
    const nc=msg.querySelector('.song-card');
    if(nc){ nc.classList.add('arrived'); setTimeout(()=>nc.classList.remove('arrived'),3400); }
  } else { toast('那首歌不在当前列表里'); }
}
(function bindSongJump(){ const b=document.getElementById('songJump'); if(b) b.addEventListener('click',jumpToSongReady); })();
function pickAt(i){
  const c=_atList[i]; if(!c) return;
  const inp=$('#cin'); const pos=inp.selectionStart;
  const before=inp.value.slice(0,_atStart);
  const after=inp.value.slice(pos);
  inp.value=before+'@'+c.name+' '+after;
  const np=(before+'@'+c.name+' ').length;
  inp.focus(); inp.setSelectionRange(np,np);
  hideAt(); syncSendBtn();
}


// ============ 发送 ============
async function send(){
  try{ _ehDbg('[send] rid=', curRoom&&curRoom.id, 'len=', ($('#input')&&$('#input').value||'').length); }catch(_){}
  const inp=$('#cin'); let text=inp.value.trim();
  // 眩晕期禁言(被 KO 后 15s 说不出话)——提到最前, 有内容才提示
  if(text && isStunned()){ const left=Math.ceil((_stunnedUntil-Date.now())/1000); toast(`💫 被打晕了，${left>0?left:1}秒后才能说话…`); return; }
  if(!text) return;
  // 房间界面仍在但 curRoom 因前后台恢复/竞态短暂丢失时，旧逻辑直接 return，用户看到的就是“点了没反应”。
  // 不静默吞点击：给出明确反馈并触发一次前台对齐，状态恢复后可立即重发。
  if(!curRoom){
    toast('房间状态正在恢复，请稍后再试');
    try{ if(typeof foregroundResync==='function') foregroundResync('send-no-room'); }catch(_){}
    return;
  }
  // 斜杠命令
  if(text.startsWith('/')){ const handled=await handleSlash(text); if(handled){ resetInput(); return; } }
  // @灵魂生成 BGM：支持自然表达，不和普通灵魂对话抢同一句
  if(/^@灵魂[\s，,：:！!、]*(生成|来一首|做一首|放一首)?[\s，,：:！!、]*(bgm|背景音乐|音乐)/i.test(text)){
    const desc=text.replace(/^@灵魂[\s，,：:！!、]*(生成|来一首|做一首|放一首)?[\s，,：:！!、]*(bgm|背景音乐|音乐)/i,'').trim();
    resetInput(); await sendBgmGen(desc||'按照当前房间气氛创作一首纯器乐背景音乐'); return;
  }
  let kind='msg';
  if(text.startsWith('/me ')){ kind='act'; text=text.slice(4); }
  // 神曲模式: 走神曲发送(把这句话唱出来), 不落普通文本
  if(songMode && kind==='msg'){ const ly=text; resetInput(); await sendSong(ly, songSel); return; }
  // 漂流瓶模式: 丢进海里(跨房匿名漂流), 不落本房消息; 丢完退出模式
  if(bottleMode && kind==='msg'){ throwBottleFromComposer(); return; }
  // 引用的目标还是本地临时 id(原消息尚未落库/落库失败)时，不带 reply_to，避免整条发送失败
  const replyId = replyTo && !String(replyTo.id).startsWith('local_') ? replyTo.id : null;
  // 虚空模式: 匿名 + 限时消散(act/whisper 不走虚空)
  const useVoid = voidMode && kind==='msg';
  const payload={ room_id:curRoom.id, user_id:myUid, name:me.name, emoji:me.emoji, color:me.color, text, kind, reply_to: replyId };
  if(useVoid){
    payload.anon=true;
    payload.expires_at=new Date(Date.now()+VOID_TTL()).toISOString();
    // 数据层就不落真实昵称/头像/色: 存匿名代号(据uid确定性生成)+中性紫, 避免raw行泄露身份
    payload.name = voidNameFor({user_id:myUid});
    payload.emoji = '🕳️';
    payload.color = EH_CONFIG.voidC;
  }
  // 乐观上屏
  const localId='local_'+Date.now();
  const optimistic={...payload, id:localId, created_at:new Date().toISOString(), _replyRef: replyTo?.name?`${replyTo.name}: ${replyTo.text}`:null};
  const el=buildMsgEl(optimistic); if(el){ el.dataset.mid=localId; $('#stream').appendChild(el); scrollStream();
    // 键盘态下 DOM/布局稳定晚于插入, 单次滚动常滚不到底(最后一条被输入栏盖) → 多拍兜底确保完全可见
    setTimeout(scrollStream,60); setTimeout(scrollStream,200); setTimeout(scrollStream,450);
    ehFx(el,'fx-send',650); }
  try{ EhSfx.play(useVoid?'void':'send'); }catch(e){}
  if(isEmojiOnly(text)) burst(text);
  const rt=replyTo; resetInput(); clearReply();
  // 虚空模式保持开启(顶部提示条常驻, 由用户手动"退出"), 连续说给虚空更顺
  const { data, error } = await sb.from('eh_messages').insert(payload).select('id').single();
  if(error){ console.warn('send',error); toast(EH_CONFIG.text.err_sendFail); }
  // 回填真实 id：DOM data-mid + echo-bar + 长按闭包捕获的 optimistic.id 都更新
  // 竞态兜底: 若 realtime 抢先用真实 id 渲染了同一条(另建了 DOM), 这里回填时先删掉重复
  else if(data){
    const dup=document.querySelector(`.msg[data-mid="${data.id}"]`);
    if(dup && dup!==el) dup.remove();   // realtime 已渲染同条 → 删它, 保留乐观这条并回填
    optimistic.id=data.id; if(el){ el.dataset.mid=data.id; const eb=el.querySelector('.echo-bar'); if(eb) eb.dataset.mid=data.id; }
  }
}
// 虚空模式开关(统一走 setMode; 保留函数名兼容旧调用)
// ============ 统一发言模式: none / void / voice / song ============
// ＋号是唯一入口: 选某模式→＋变该模式图标+输入框切风格; 再点该图标(＋位置)→退出复原。三者互斥。
let curMode='none';
let bottleMode=false;
const MODE_ICON={ void:'🕳️', voice:'🎙️', song:'🎵', bottle:'🌊' };
function setMode(mode){
  if(mode===curMode) mode='none';        // 再点当前模式 = 退出
  // 先退出旧模式的副作用
  if(curMode==='voice' && mode!=='voice'){ if(recActive) micRelease(); }
  curMode=mode;
  voidMode = mode==='void';
  voiceMode = mode==='voice';
  songMode = mode==='song';
  bottleMode = mode==='bottle';
  const composer=$('.composer');
  composer.classList.toggle('void-mode', voidMode);
  composer.classList.toggle('voice-mode', voiceMode);
  composer.classList.toggle('song-mode', songMode);
  composer.classList.toggle('bottle-mode', bottleMode);
  // ＋号: 无模式显 ＋(可展开菜单); 有模式显该模式图标(点=退出)
  const pb=$('#plusBtn');
  // 有模式时显模式图标(神曲🎵与加号菜单一致); 无模式显 ＋
  pb.innerHTML = mode==='none' ? '＋' : avEmoji(MODE_ICON[mode]);
  pb.classList.toggle('mode-on', mode!=='none');
  pb.title = mode==='none' ? '更多花样' : '退出当前模式';
  // 菜单项高亮
  $('#pmVoid').classList.toggle('on', voidMode);
  $('#pmVoice').classList.toggle('on', voiceMode);
  $('#pmSong').classList.toggle('on', songMode);
  { const pb2=$('#pmBottle'); if(pb2) pb2.classList.toggle('on', bottleMode); }
  // ⚠️ iOS 铁律: 进打字模式的 focus 必须最贴近用户手势的同步栈, 且在任何 DOM 重建(renderSongStrip
  //   会 innerHTML 重建曲风条)之前——否则重建打断同步性, iOS 不弹键盘(主人报"第一次进神曲不弹输入法")。
  //   故进 void/song 的 focus 提到这里最先做; 退出/语音的 blur 仍在下方。
  { const cinEarly=$('#cin'); if((mode==='void'||mode==='song'||mode==='bottle') && curRoom){ try{ cinEarly.focus(); }catch(e){} } }
  // 神曲: 显示曲风细色条
  const strip=$('#songStrip');
  if(strip){ strip.classList.toggle('on', songMode); if(songMode) renderSongStrip(); }
  // 占位文案 + 神曲模式跟随当前曲风色
  const cin=$('#cin');
  if(songMode){ const st=SONG_STYLES.find(s=>s.id===songSel)||SONG_STYLES[0]; cin.placeholder=`输入要唱的话… ${st.emoji}${st.name}`; composer.style.setProperty('--song-c', safeColor(st.color)); }
  else { composer.style.removeProperty('--song-c'); }
  if(voidMode){ cin.placeholder=EH_CONFIG.text.voidPlaceholder; }
  else if(bottleMode){ cin.placeholder='写句心事，丢进海里…漂给别房的陌生人'; }
  else if(voiceMode){ hideSlash(); $('#emojiTray').classList.remove('on'); }
  else if(!songMode){ cin.placeholder='说点什么… 打个 / 看命令'; }
  // ── 统一键盘策略(三模式 × 进入/退出, 跨 iOS/安卓一致)──
  //   虚空/神曲 = 打字模式: 进入弹键盘、退出收键盘
  //   语音 = 录音模式: 全程不碰键盘
  // ⚠️ iOS 铁律: focus() 只有在用户手势的【同步】调用栈里才能唤起键盘; 放进 setTimeout
  //   会被 iOS 拦截→安卓弹、iOS 不弹(即"两平台不一样"的根因)。setMode 由 onclick 同步调用,
  //   故这里必须【同步】focus, 不能 setTimeout defer。
  const cin2=$('#cin');
  if(mode!=='void' && mode!=='song' && mode!=='bottle'){
    // none(退出) 或 voice(录音): 一律收键盘, 主动 blur。(void/song/bottle 的 focus 已在上方提前做)
    try{ cin2.blur(); }catch(e){}
  }
  syncSendBtn();
}
function resetInput(){ const inp=$('#cin'); inp.value=''; inp.style.height='42px'; hideSlash(); hideAt(); syncSendBtn(); }
// 输入框空↔有字: 切换 麦克风/发送 按钮(微信式)
function syncSendBtn(){
  const has=!!$('#cin').value.trim();
  const go=$('#goBtn');
  // 语音模式下永不显示发送键(靠"按住说话"发); 键盘模式有字才显示
  if(go) go.style.display = (!voiceMode && has)?'grid':'none';
}

// ============ 语音消息(MediaRecorder 录音 → Supabase Storage → kind='voice') ============
const VOICE_BUCKET='eh-voice'; const VOICE_MAX_SEC=()=>TUNE('voiceMaxSec',30);
const VOICE_URL_PREFIX=SB_URL+'/storage/v1/object/public/'+VOICE_BUCKET+'/';
const REC_MIME=(window.MediaRecorder && ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t)))||'';
let recorder=null, recChunks=[], recTimer=null, recSec=0, recWanted=false, recCanceled=false, recActive=false, recStartY=0;
let waveRAF=null, recAnalyser=null;
// 语音转写: 录音同时用浏览器 SpeechRecognition 把话转成文字, 编码进语音消息, 让 AI 灵魂"听得懂"内容
// (mify 网关是纯文本且在内网, 无法做云端 STT; 不支持的浏览器→无转写, 灵魂退回"发了一条语音"的旧行为)
const SR_CLASS = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let voiceSR=null, srFinal='', srInterim='';
function startSR(){
  srFinal=''; srInterim=''; if(!SR_CLASS) return;
  try{
    voiceSR=new SR_CLASS();
    voiceSR.lang='zh-CN'; voiceSR.continuous=true; voiceSR.interimResults=true;
    voiceSR.onresult=e=>{
      let interim='';
      for(let i=e.resultIndex;i<e.results.length;i++){
        const r=e.results[i];
        if(r.isFinal) srFinal+=r[0].transcript; else interim+=r[0].transcript;
      }
      srInterim=interim;
      const cap=$('#recCaption'); if(cap) cap.textContent=(srFinal+srInterim).slice(-40);
    };
    voiceSR.onerror=()=>{};   // 网络/权限/no-speech 都静默, 不打断录音
    voiceSR.start();
  }catch(e){ voiceSR=null; }
}
function stopSR(){
  if(!voiceSR) return '';
  try{ voiceSR.stop(); }catch(e){}
  voiceSR=null;
  return (srFinal+srInterim).trim().slice(0,180);
}
function fmtDur(s){ return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
// 播放器 HTML(只信任本站语音桶/本地 blob 的地址，其余按纯文本展示，防伪造 URL)
function voiceHtml(src){
  src=String(src||'');
  if(!src.startsWith(VOICE_URL_PREFIX) && !src.startsWith('blob:')) return esc(src);
  const dur=(src.match(/#dur=(\d+)/)||[])[1];
  let tx=''; const txM=src.match(/[#&]tx=([^&]+)/); if(txM){ try{ tx=decodeURIComponent(txM[1]); }catch(e){ tx=''; } }
  const bars=Array.from({length:9},()=>`<i style="height:${5+Math.floor(secureRand()*13)}px"></i>`).join('');
  const player=`<span class="vplay" data-src="${esc(src)}"><button class="vp-btn"><span class="pglyph"></span></button><span class="vp-bars">${bars}</span><span class="vp-t">${dur?fmtDur(+dur):''}</span></span>`;
  return tx ? `${player}<span class="vcap">${esc(tx)}</span>` : player;   // 有转写→附字幕
}
// 全局单实例播放：播放新的自动停旧的
let vAudio=null, vPlayEl=null;
function stopVoice(){
  if(vAudio){ try{vAudio.pause();}catch(e){} vAudio=null; }
  try{ if(typeof AudioEngine!=='undefined') AudioEngine.duck(false); }catch(e){} // 恢复 BGM 音量
  stopVoiceAvatarPulse();
  if(vPlayEl){ vPlayEl.classList.remove('playing'); vPlayEl=null; }
}
// 声波头像: 语音播放时, 把音频接 analyser, 让该消息发送者头像随振幅缩放跳动。
let _vapRaf=0, _vapAv=null, _vapCtx=null, _vapSrc=null;
function startVoiceAvatarPulse(wrap, audioEl){
  const msg=wrap.closest('.msg'); const av=msg&&msg.querySelector('.av'); if(!av) return;
  const C=window.AudioContext||window.webkitAudioContext; if(!C) return;
  let ctx; try{ ctx=new C(); }catch(e){ return; }
  let srcNode, analyser;
  try{
    srcNode=ctx.createMediaElementSource(audioEl);
    analyser=ctx.createAnalyser(); analyser.fftSize=256; analyser.smoothingTimeConstant=0.7;
    srcNode.connect(analyser); analyser.connect(ctx.destination);   // 仍要连 destination 才出声
  }catch(e){ try{ctx.close();}catch(_){}
    return; }   // CORS/接线失败 → 放弃声波(音频照常从 <audio> 出声)
  _vapCtx=ctx; _vapSrc=srcNode; _vapAv=av;
  av.style.transition='transform .06s ease-out';
  const data=new Uint8Array(analyser.frequencyBinCount);
  const loop=()=>{
    if(_vapAv!==av) return;
    analyser.getByteFrequencyData(data);
    let sum=0; for(let i=0;i<data.length;i++) sum+=data[i];
    const amp=sum/data.length/255;   // 0~1
    av.style.transform='scale('+(1+amp*0.28).toFixed(3)+')';
    av.style.boxShadow='inset 0 0 0 1.5px currentColor, 0 0 '+(6+amp*20).toFixed(0)+'px -2px currentColor';
    _vapRaf=requestAnimationFrame(loop);
  };
  loop();
}
function stopVoiceAvatarPulse(){
  if(_vapRaf) cancelAnimationFrame(_vapRaf); _vapRaf=0;
  if(_vapAv){ _vapAv.style.transform=''; _vapAv.style.boxShadow=''; _vapAv=null; }
  if(_vapCtx){ try{ _vapCtx.close(); }catch(e){} _vapCtx=null; _vapSrc=null; }
}
// 整个语音条都可点(不只那个小 ▶ 圆钮), 符合"点一下就播"的直觉
document.addEventListener('click',e=>{
  const wrap=e.target.closest('.vplay'); if(!wrap) return;
  const btn=wrap.querySelector('.vp-btn');
  if(wrap===vPlayEl){ stopVoice(); return; } // 再点当前正在播的 → 停
  stopVoice();
  try{ if(typeof AudioEngine!=='undefined'){ AudioEngine.resume(); AudioEngine.duck(true); } }catch(e){} // 激活音频上下文+压低BGM
  const src=(wrap.dataset.src||'').split('#')[0];
  if(!src){ toast(EH_CONFIG.text.err_voiceUrl); return; }
  const a=new Audio(src);
  a.crossOrigin='anonymous';   // 接 analyser 需 CORS(Supabase storage 支持); 失败则跳过声波头像
  vAudio=a; vPlayEl=wrap;
  wrap.classList.add('playing');
  try{ startVoiceAvatarPulse(wrap, a); }catch(e){}   // 声波头像: 发送者头像随振幅跳动
  a.onended=()=>{ if(vPlayEl===wrap) stopVoice(); };
  a.onerror=()=>{ if(vPlayEl===wrap){ toast(EH_CONFIG.text.err_voiceLoad); stopVoice(); } };   // 仅当仍在播本条才报错; 主动 stopVoice(vPlayEl 已置空)不弹
  a.play().then(()=>{}).catch(err=>{
    // ★ AbortError = 用户主动暂停/切换打断了 play()(stopVoice 里 pause), 非真实失败, 静默; 已被接管(vPlayEl变了)也静默
    if((err&&err.name==='AbortError') || vPlayEl!==wrap) return;
    const msg = (err&&err.name==='NotAllowedError') ? '被浏览器拦截，请再点一次' : '播放失败，请重试';
    toast(msg); stopVoice();
  });
});
async function startRec(){
  if(!curRoom || recorder) return;
  if(!REC_MIME || !navigator.mediaDevices?.getUserMedia){ toast(EH_CONFIG.text.err_noRecSupport); recActive=false; return; }
  let stream;
  try{ stream=await navigator.mediaDevices.getUserMedia({audio:true}); }
  catch(e){ toast(EH_CONFIG.text.err_needMic); recActive=false; return; }
  if(!recActive){ stream.getTracks().forEach(t=>t.stop()); return; } // 授权期间已松手，放弃
  recChunks=[]; recSec=0; recWanted=false; recCanceled=false;
  try{ recorder=new MediaRecorder(stream,{mimeType:REC_MIME,audioBitsPerSecond:24000}); }
  catch(e){ stream.getTracks().forEach(t=>t.stop()); toast(EH_CONFIG.text.err_recInit); return; }
  recorder.ondataavailable=e=>{ if(e.data.size) recChunks.push(e.data); };
  recorder.onstop=()=>{
    clearInterval(recTimer); recTimer=null;   // ★所有停止路径的共同终点, 在此清计时器: 录音中离房(leaveRoom裸调recorder.stop)也不残留每秒空跑的interval
    stream.getTracks().forEach(t=>t.stop());
    const tx=stopSR();   // 拿到转写文字(不支持/无语音则空)
    stopWave(); hideRecUI();
    if(recWanted && !recCanceled && recChunks.length && recSec>=1) sendVoice(new Blob(recChunks,{type:REC_MIME.split(';')[0]}), Math.min(recSec,VOICE_MAX_SEC()), recCanceled?'':tx);
    else if(recWanted && !recCanceled && recSec<1) toast(EH_CONFIG.text.err_recTooShort);
    recorder=null; recChunks=[];
  };
  recorder.start(250);
  startSR();   // 录音同时开转写
  showRecUI(stream);
  recTimer=setInterval(()=>{ recSec++; updateRecTime();
    if(recSec>=VOICE_MAX_SEC()){ recWanted=true; stopRec(); } },1000);
}
function stopRec(){ clearInterval(recTimer); recTimer=null; if(recorder && recorder.state!=='inactive') recorder.stop(); }
function showRecUI(stream){
  document.querySelector('.composer').classList.add('recording');
  const panel=$('#recPanel'); panel.classList.remove('cancel');
  $('#recTip').textContent='松开发送 · 上滑取消';
  $('#recWave').innerHTML=Array.from({length:24},()=>'<i></i>').join('');
  $('#recOverlay').classList.add('on'); updateRecTime(); startWave(stream);
}
function hideRecUI(){ document.querySelector('.composer').classList.remove('recording'); $('#recOverlay').classList.remove('on'); }
function updateRecTime(){ $('#recTime').textContent=fmtDur(recSec); }
function setRecCancel(on){ if(recCanceled===on) return; recCanceled=on; $('#recPanel').classList.toggle('cancel',on); $('#recTip').textContent=on?'松开手指 · 取消发送':'松开发送 · 上滑取消'; }
function startWave(stream){
  try{
    const ctx=ac(); if(!ctx) return;
    const src=ctx.createMediaStreamSource(stream);
    recAnalyser=ctx.createAnalyser(); recAnalyser.fftSize=64; src.connect(recAnalyser);
    const data=new Uint8Array(recAnalyser.frequencyBinCount);
    const bars=[...$('#recWave').querySelectorAll('i')];
    const loop=()=>{ if(!recAnalyser) return; recAnalyser.getByteFrequencyData(data);
      bars.forEach((b,i)=>{ const v=data[(i*2)%data.length]/255; b.style.height=(8+v*44)+'px'; });
      waveRAF=requestAnimationFrame(loop); };
    loop();
  }catch(e){}
}
function stopWave(){ if(waveRAF) cancelAnimationFrame(waveRAF); waveRAF=null; recAnalyser=null; }
async function sendVoice(blob, secs, tx){
  if(!curRoom || !myUid) return;
  if(blob.size>950*1024){ toast(EH_CONFIG.text.err_recTooLong); return; }
  const ext=REC_MIME.includes('mp4')?'m4a':'webm';
  const txTag = tx ? '&tx='+encodeURIComponent(tx) : '';   // 转写编进 text, 让 AI 灵魂听得懂
  // 乐观上屏：先用本地 blob 播放
  const localUrl=URL.createObjectURL(blob)+'#dur='+secs+txTag;
  const optimistic={id:'local_'+Date.now(),room_id:curRoom.id,user_id:myUid,name:me.name,emoji:me.emoji,color:me.color,text:localUrl,kind:'voice',created_at:new Date().toISOString()};
  const el=buildMsgEl(optimistic); if(el){ $('#stream').appendChild(el); scrollStream(); }
  const path=`${curRoom.id}/${myUid}-${Date.now()}.${ext}`;
  const { error:upErr }=await sb.storage.from(VOICE_BUCKET).upload(path, blob, { contentType: blob.type||'audio/webm' });
  if(upErr){ console.warn('voice upload',upErr);
    toast(/bucket|not.*found/i.test(upErr.message||'')?'语音存储未配置(缺 eh-voice 桶)':'语音上传失败');
    if(el) el.remove(); return; }
  const { data:pub }=sb.storage.from(VOICE_BUCKET).getPublicUrl(path);
  const url=pub.publicUrl+'#dur='+secs+txTag;
  const { data:row, error }=await sb.from('eh_messages').insert({room_id:curRoom.id,user_id:myUid,name:me.name,emoji:me.emoji,color:me.color,text:url,kind:'voice'}).select('id').single();
  if(error){ console.warn('voice send',error); toast(EH_CONFIG.text.err_voiceSend); if(el) el.remove(); return; }
  // 回填真实 id 与正式 URL(与文本消息同理)
  optimistic.id=row.id;
  if(el){ el.dataset.mid=row.id; const vp=el.querySelector('.vplay'); if(vp) vp.dataset.src=url; }
}
// 语音模式(统一走 setMode)
let voiceMode=false;
// 按住"说话"长条录音，松手发送，上滑取消(桌面鼠标 / 移动触摸统一走 Pointer Events)
const holdTalk=$('#holdTalk');
holdTalk.addEventListener('pointerdown',e=>{
  e.preventDefault();
  if(recorder || recActive) return;
  recActive=true; recStartY=e.clientY;
  try{ holdTalk.setPointerCapture(e.pointerId); }catch(_){}
  holdTalk.textContent='松开发送 · 上滑取消';
  startRec();
});
window.addEventListener('pointermove',e=>{ if(!recActive) return; setRecCancel((recStartY-e.clientY)>90); });
function micRelease(){
  if(!recActive) return;
  recActive=false;
  recWanted=true;                 // 松手即发(除非已标记取消)
  holdTalk.textContent='按住 说话';
  if(recorder) stopRec();         // 授权仍在进行(recorder 未就绪)时，startRec 会因 recActive=false 自行放弃
  else { clearInterval(recTimer); recTimer=null; stopWave(); hideRecUI(); }
}
window.addEventListener('pointerup',micRelease);
window.addEventListener('pointercancel',micRelease);
if(!REC_MIME || !navigator.mediaDevices?.getUserMedia){ const p=$('#pmVoice'); if(p) p.style.display='none'; }

// ============ 神曲(文字→洗脑歌曲, Web Audio 合成节拍 + 语音合成"唱"字) ============
// 消息编码: kind='song', text='曲风id|歌词'。曲风白名单校验, 不认识则整体当纯文本(向后兼容)。
const SCALE={
  majP:[0,2,4,7,9],       // 大调五声(欢快)
  minP:[0,3,5,7,10],      // 小调五声(蓝调/洗脑)
  major:[0,2,4,5,7,9,11],
  minor:[0,2,3,5,7,8,10],
};
// motif=旋律动机(反复出现→洗脑), chords=每小节根音(半音), groove=鼓型
// v2: 主唱改为共振峰哼唱(音高真跟旋律走), TTS 降为可选轻声跟读垫; motif 做"钩子+变奏"更洗脑
// SONG_STYLES 定义在 EH_CONFIG.songStyles (可后台配置), 这里用 Proxy 封装:
// 1) 读最新的 EH_CONFIG.songStyles (loadRemoteConfig 后台改配置后无需重启)
// 2) 把 scale 字符串 key(minP/majP/major/minor) 运行时映射为 SCALE 对象
function _resolveScale(s){ return typeof s==='string' ? (SCALE[s]||SCALE.major) : (Array.isArray(s)?s:SCALE.major); }
function _shimStyles(){ return (EH_CONFIG.songStyles||[]).map(s=>({...s, scale:_resolveScale(s.scale)})); }
const SONG_STYLES = new Proxy([], {
  get(_t, prop){
    if(prop==='length') return (EH_CONFIG.songStyles||[]).length;
    const shim = _shimStyles();
    if(typeof prop==='string' && /^\d+$/.test(prop)) return shim[+prop];
    if(prop===Symbol.iterator) return shim[Symbol.iterator].bind(shim);
    const v = shim[prop];
    return typeof v==='function' ? v.bind(shim) : v;
  }
});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const NOTE=semi=>220*Math.pow(2,semi/12);        // 0 半音 = A3(220Hz)
function scaleSemi(scale,deg){ const n=scale.length, oct=Math.floor(deg/n); return scale[((deg%n)+n)%n]+12*oct; }
// 神曲消息 text 编码(AI模式扩展): sid|lyric  或  sid|lyric|songUrl|chorusStart|chorusEnd
// - 老格式(仅 sid|lyric): legacy 模式播 / AI 模式生成中
// - 新格式(带 URL): AI 模式已生成完, 服务器上有现成音频
// lyric 里若含 | 会做 URL 编码存(encodeURIComponent), 读时 decodeURIComponent 回来
function parseSong(text){
  const t=String(text||''); const parts=t.split('|');
  if(parts.length>=2 && SONG_STYLES.some(s=>s.id===parts[0])){
    const sid=parts[0];
    // 5 段新格式: sid|enc(lyric)|url|cs|ce; 其余(2~4 段)=老格式/生成中, lyric 是明文(可能自身含 |, 拼回)
    if(parts.length>=5){
      let lyric=parts[1]; try{ lyric=decodeURIComponent(parts[1]); }catch(_){}
      const songUrl=parts[2]||''; const chStart=parseFloat(parts[3]||'0')||0; const chEnd=parseFloat(parts[4]||'0')||0;
      return { sid, lyric, songUrl, chorusStart:chStart, chorusEnd:chEnd, ready:!!songUrl };
    }
    // 老格式: sid 之后全部当 lyric(含 | 拼回), 无 URL → 未就绪
    return { sid, lyric:parts.slice(1).join('|'), songUrl:'', chorusStart:0, chorusEnd:0, ready:false };
  }
  return { sid:SONG_STYLES[0].id, lyric:t, songUrl:'', chorusStart:0, chorusEnd:0, ready:false };
}
// 编码回 text 字段(存库/发送用)
function encodeSong(sid, lyric, songUrl, chStart, chEnd){
  const ly=String(lyric||'').slice(0,60);
  if(!songUrl) return sid+'|'+ly;   // 生成中/legacy: 保持老格式(向后兼容)
  return [sid, encodeURIComponent(ly), songUrl, String(chStart||0), String(chEnd||0)].join('|');
}
// 消息在"列表预览"里的纯文本呈现: 语音/神曲不能暴露 URL/内部编码
function msgPreview(m){
  if(!m) return '';
  switch(m.kind){
    case 'act':   return '✦ '+m.text;
    case 'proj':  return '📽️ 投影';
    case 'voice': return '🎤 语音消息';
    case 'enter': return '✦ 有人进入了房间';   // enter 广播: 预览别露原始档位字符串(reg/super)
    case 'song':  return '🎵 '+parseSong(m.text).lyric;
    case 'interact': {   // text = ixId|targetUid|文案 → 文案本身就是完整友好句, 直接显; 别露原始编码
      const parts=String(m.text||'').split('|'); const ix=_interactions.find(i=>i.id===parts[0]);
      const txt=parts.slice(2).join('|').trim();
      if(txt) return txt;                                    // 如"狼姐 朝 yiran 扔了颗炸弹 💣"
      return (safeEmoji(ix&&ix.emoji)||'✨')+' '+((ix&&ix.name)||'互动');   // 无文案兜底
    }
    default:      return m.text||'';
  }
}
function songHtml(text){
  const p=parseSong(text);
  const { sid, lyric, songUrl, chorusStart, chorusEnd, ready }=p;
  const st=SONG_STYLES.find(s=>s.id===sid)||SONG_STYLES[0];
  // 逐字包 span → 播放时卡拉OK高亮
  const chs=[...lyric].map(c=> /\S/.test(c)?`<span class="sl-ch">${esc(c)}</span>`:esc(c)).join('');
  // AI 模式下的生成中态: 播放按钮变"谱曲中"(跳动音符), 卡片挂 pending class
  const singMode=(EH_CONFIG.tuning&&EH_CONFIG.tuning.singMode)||'ai';
  const pending = singMode==='ai' && !ready;   // legacy 模式下永远是可播放态(本地合成不用等)
  const pendCls = pending ? ' pending' : '';
  // 谱曲中: 跳动音符♪(音乐语义, 非"加载"转圈); 就绪: 播放三角
  const btnInner = pending ? '<span class="song-note">♪</span>' : '<span class="pglyph"></span>';
  const btnTip = pending ? 'AI 谱曲中 · 约 40 秒' : '播放';
  // 曲风标签色 = 曲风自己的颜色。生成中在曲风名后显示"谱曲中"文字, 明确表达含义(不止一个转圈)
  const metaExtra = pending ? '<span class="song-composing">谱曲中</span>' : `<span class="song-eq"><i></i><i></i><i></i><i></i></span>`;
  // 就绪的歌: 挂一个隐藏 <audio preload=auto> 预热浏览器缓存, 点播放时音频已缓存→秒播(不再点后干等下载)
  const preloadAudio = (!pending && songUrl) ? `<audio class="song-pre" preload="auto" src="${esc(songUrl.split('#')[0])}" muted></audio>` : '';
  return `<span class="song-card${pendCls}" data-sid="${esc(sid)}" data-lyric="${esc(lyric)}" data-url="${esc(songUrl||'')}" data-cs="${chorusStart||0}" data-ce="${chorusEnd||0}" style="--sc:${safeColor(st.color)}">
    <button class="song-play" data-tip="${btnTip}">${btnInner}</button>
    <span class="song-meta"><span class="song-style">${st.emoji} ${esc(st.name)}
      ${metaExtra}</span>
    <span class="song-lyric">${chs}</span></span>${preloadAudio}</span>`;
}

// Web Audio 基础
let audioCtx=null;
function ac(){
  if(!audioCtx){ const C=window.AudioContext||window.webkitAudioContext; if(!C) return null; audioCtx=new C(); }
  if(audioCtx.state==='suspended') audioCtx.resume();
  return audioCtx;
}
let noiseBuf=null;
function noise(ctx){ if(!noiseBuf||noiseBuf.sampleRate!==ctx.sampleRate){ const n=Math.floor(ctx.sampleRate*0.3); noiseBuf=ctx.createBuffer(1,n,ctx.sampleRate); const d=noiseBuf.getChannelData(0); for(let i=0;i<n;i++) d[i]=Math.random()*2-1; } return noiseBuf; }
const EH_SING_COVER_FN = SB_URL + '/functions/v1/eh-sing-cover';
const EH_MASTER_MANIFEST_URL = 'masters/manifest.json?v=' + (window.__EH_BUILD_VER||'unknown');
let EH_MASTER_MANIFEST=null;
async function loadMasterManifest(){
  if(EH_MASTER_MANIFEST) return EH_MASTER_MANIFEST;
  // 双次重试: force-cache 命中旧404时用 reload 重取
  const tryFetch=async(cache)=>{
    const r=await fetch(EH_MASTER_MANIFEST_URL,{cache});
    if(!r.ok) throw new Error('manifest_'+r.status);
    const ct=r.headers.get('content-type')||'';
    if(!/json/i.test(ct)) throw new Error('manifest_bad_ct_'+ct);
    return r.json();
  };
  try{ const j=await tryFetch('default'); EH_MASTER_MANIFEST=j; return j; }
  catch(e1){
    console.warn('manifest first try failed, reload:', e1.message);
    const j=await tryFetch('reload'); EH_MASTER_MANIFEST=j; return j;
  }
}
async function decodeMp3ArrayBuffer(ctx, ab){
  const copy=ab.slice(0);
  return await new Promise((res,rej)=>ctx.decodeAudioData(copy,res,rej));
}

// ---- 神曲解码缓存 + 预取预解码：点击后秒播，不重复下载解码整首 ----
const _EH_SONG_CACHE=new Map();      // url → 已解码 AudioBuffer
const _EH_SONG_FETCHING=new Map();   // url → 正在预取的 Promise(防并发重复拉)
async function getSongBuffer(ctx, url){
  if(!url) return null;
  const hit=_EH_SONG_CACHE.get(url);
  if(hit) return hit;
  if(_EH_SONG_FETCHING.has(url)) return await _EH_SONG_FETCHING.get(url);
  const job=(async()=>{
    const resp=await fetch(url); if(!resp.ok) throw new Error('fetch '+resp.status);
    const ab=await resp.arrayBuffer();
    const buf=await new Promise((res,rej)=>ctx.decodeAudioData(ab.slice(0),res,rej));
    _EH_SONG_CACHE.set(url, buf);
    if(_EH_SONG_CACHE.size>24){ const first=_EH_SONG_CACHE.keys().next().value; _EH_SONG_CACHE.delete(first); } // LRU 粗限
    return buf;
  })();
  _EH_SONG_FETCHING.set(url, job);
  try{ return await job; } finally{ _EH_SONG_FETCHING.delete(url); }
}
// 预取：卡片 ready 时后台静静下载+解码好，用户点击时直接秒播（静默失败，不打扰）
function prefetchSong(url){
  if(!url || _EH_SONG_CACHE.has(url) || _EH_SONG_FETCHING.has(url)) return;
  const ctx=ac(); if(!ctx) return;
  getSongBuffer(ctx, url).catch(()=>{});
}

// 预取: 不阻塞, 成功存缓存。已有缓存则跳过。pin=true 时铉住不被 LRU 淘汰(预置词用)。
let _prefetchInflight=new Set();
// ============ 静态预生成真人嗓(随页面异步加载, 固定词零网络瞬时) ============
// 预烤好的 mp3 固定词音频放 assets/eh_preset_<style>.json, 页面加载后后台下载+解码存缓存。
// 命中 = 真人嗓 0 网络延迟。与哼唱动态增益互补: 固定词真人嗓瞬时, 任意词哼唱兜底。
let _staticPresetsLoaded=false;

function tone(ctx,dest,freq,t,dur,type,gain){
  const o=ctx.createOscillator(), g=ctx.createGain();
  o.type=type; o.frequency.value=freq;
  g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(gain,t+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t+dur+0.05); return o;
}
function kick(ctx,dest,t){ const o=ctx.createOscillator(), g=ctx.createGain(); o.frequency.setValueAtTime(150,t); o.frequency.exponentialRampToValueAtTime(50,t+0.11); g.gain.setValueAtTime(0.9,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.16); o.connect(g).connect(dest); o.start(t); o.stop(t+0.2); return o; }
function hat(ctx,dest,t){ const s=ctx.createBufferSource(); s.buffer=noise(ctx); const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=7000; const g=ctx.createGain(); g.gain.setValueAtTime(0.12,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.05); s.connect(hp).connect(g).connect(dest); s.start(t); s.stop(t+0.07); return s; }
function snare(ctx,dest,t){ const s=ctx.createBufferSource(); s.buffer=noise(ctx); const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1800; const g=ctx.createGain(); g.gain.setValueAtTime(0.28,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.18); s.connect(bp).connect(g).connect(dest); s.start(t); s.stop(t+0.2); return s; }

// ---- 共振峰(formant)人声合成：真正"唱"出旋律的元音，而非断续念字 ----
const VOWELS={ a:[730,1090,2440], o:[570,840,2410], e:[530,1840,2480], i:[270,2290,3010], u:[300,870,2240] };
const VOWEL_KEYS=['a','o','e','i','u'];
// 汉字→稳定元音(同字同元音)，唱出来是"啊哦伊呜"的洗脑哼唱
function charVowel(ch){ let s=0; for(const c of ch) s+=c.codePointAt(0); return VOWEL_KEYS[s%VOWEL_KEYS.length]; }
function singVoice(ctx,dest,freq,t,dur,vowel,gain,wave){
  // v9【采样元音·加法合成·安卓兼容】保 v7 iOS 好听音色, 仅去掉谐波 frequency ramp(安卓杀手).
  // 比 v3~v6 的 3 个 bandpass 更平滑饱满、更像人声哼唱(不是电子音)。
  // 保留 v6 过期时间保护(安卓 setValueAtTime 传过期时间抛异常→整轨静音的实锤修复)。
  const tmin=ctx.currentTime+0.03; if(t<tmin) t=tmin;
  const oscs=[];
  const gliss=Math.min(0.035,dur*0.18);
  const F=VOWELS[vowel]||VOWELS.a;
  // 共用包络: 柔起音→保持→尾部渐弱(像人声的气口)
  const env=ctx.createGain();
  env.gain.setValueAtTime(0.0001,t);
  env.gain.linearRampToValueAtTime(gain,t+0.06);
  env.gain.setValueAtTime(gain,t+dur*0.55);
  env.gain.linearRampToValueAtTime(gain*0.72,t+dur*0.9);
  env.gain.exponentialRampToValueAtTime(0.0001,t+dur+0.03);
  env.connect(dest);
  // 加法合成: 每个谐波音量按 3 个共振峰(高斯窗)加权, 得到该元音的音色
  const nH=Math.min(20,Math.floor(3800/freq));
  for(let n=1;n<=nH;n++){
    const hz=freq*n; if(hz>4200)break;
    let w=0.04;
    for(let k=0;k<3;k++){ const bw=[120,140,190][k],a=[1,0.6,0.38][k]; w=Math.max(w,a*Math.exp(-Math.pow((hz-F[k])/bw,2))); }
    if(w<0.045) continue;
    const o=ctx.createOscillator(); o.type='sine';
    o.frequency.value=hz;   // v9: 安卓兼容——去掉 frequency ramp(安卓内核对"高频osc+frequency ramp"会哑). iOS音色不受影响.
    const g=ctx.createGain(); g.gain.value=w*(n===1?0.9:0.7)*0.42;
    o.connect(g).connect(env); o.start(t); o.stop(t+dur+0.06); oscs.push(o);
  }
  // 颤音: 基频轻微上下摆(人声的自然抖动), 延后进入更自然
  const lfo=ctx.createOscillator(); lfo.frequency.value=5.3;
  const lfoG=ctx.createGain();
  lfoG.gain.setValueAtTime(0,t); lfoG.gain.setValueAtTime(0,t+Math.min(0.12,dur*0.4));
  lfoG.gain.linearRampToValueAtTime(freq*0.005,t+dur);
  lfo.start(t); lfo.stop(t+dur+0.06); oscs.push(lfo);
  return oscs;
}

let curSong=null;   // {ctx,master,oscs:[],timeouts:[],el,onEnd,token}
let _songToken=0;   // 一次性播放令牌: 每次 play 递增, 回调比对 curSong.token 判定"是不是我这首歌"(ctx是全局单例, 拿它当身份形同虚设)
function stopSong(){
  if(!curSong) return;
  AudioEngine.duck(false);   // 恢复官方房 BGM 音量
  const s=curSong; curSong=null;
  s.timeouts.forEach(clearTimeout);
  s.oscs.forEach(o=>{ try{ o.stop(); }catch(e){} });
  try{ if(s.audioEl){ s.audioEl.pause(); s.audioEl.src=''; s.audioEl.load&&s.audioEl.load(); } }catch(e){}   // AI模式<audio>元素: 停+释放
  try{ if(s.master&&s.ctx) { s.master.gain.cancelScheduledValues(s.ctx.currentTime); s.master.gain.setValueAtTime(0.0001,s.ctx.currentTime); } }catch(e){}
  try{ if(window.speechSynthesis) speechSynthesis.cancel(); }catch(e){}
  if(s.el){ s.el.classList.remove('playing'); s.el.querySelectorAll('.sl-ch').forEach(x=>x.classList.remove('on')); }
  if(s.onEnd) try{ s.onEnd(); }catch(e){}
}
// 选一个中文嗓音(有则用, 提升"唱字"清晰度)
let _voiceCache=null;
function pickZhVoice(){
  if(!window.speechSynthesis) return null;
  if(_voiceCache!==null) return _voiceCache;
  const vs=speechSynthesis.getVoices()||[];
  _voiceCache = vs.find(v=>/zh[-_]?CN|Chinese|普通话|中文/i.test(v.lang+' '+v.name))
             || vs.find(v=>/^zh/i.test(v.lang)) || null;
  return _voiceCache;
}
if(window.speechSynthesis){ try{ speechSynthesis.onvoiceschanged=()=>{ _voiceCache=null; pickZhVoice(); }; pickZhVoice(); }catch(e){} }
// 神曲播放 dispatcher: 根据 singMode 分发到 legacy(本地合成)/ai(拉URL播高潮)
async function playSong(lyric, sid, el, onEnd){
  const singMode=(EH_CONFIG.tuning&&EH_CONFIG.tuning.singMode)||'ai';
  // AI 模式且卡片上有 songUrl → 走服务器音频, 从 chorus 起播
  if(singMode==='ai' && el && el.dataset && el.dataset.url){
    return playSongAI(el, onEnd);
  }
  // 否则(legacy 或 AI-未生成好)走本地合成
  return playSongLegacy(lyric, sid, el, onEnd);
}

// AI 模式播放: 服务器音频, 从 chorus 段起播 + 段内匀速跑马灯
// AI 模式播放: 用 <audio> 元素(与语音消息同款可靠路径, 不受 Web Audio 手势静音/decode 兼容坑),
// 从 chorus 段起播, timeupdate 驱动跑马灯高亮。修"神曲点了没声/没反应/播放失败"三种表现的根因——
// 原来用 AudioBufferSource: fetch+decodeAudioData 是 async, start() 脱离点击手势→移动端静音;
// 且 decodeAudioData 在旧内核易失败。改 <audio> 后 play() 就在点击同步链里, 全平台稳。
function playSongAI(el, onEnd){
  stopVoice(); stopSong();
  const myToken=++_songToken;
  const url=el.dataset.url;
  if(!url){ toast('神曲地址缺失'); return; }
  const chS=parseFloat(el.dataset.cs||'0')||0;
  const chE=parseFloat(el.dataset.ce||'0')||0;
  try{ AudioEngine.duck(true); }catch(_){}
  el.classList.add('loading');
  const a=new Audio();
  a.preload='auto';
  a.src=url.split('#')[0];
  const chEls = el ? [...el.querySelectorAll('.sl-ch')] : [];
  // 起播: 能定位到 chorus 段就跳过去, 否则从头
  const startAt=(chE>chS)?chS:0;
  const endAt=(chE>chS)?chE:0;   // 0=播到自然结束
  let started=false;
  const beginMarquee=(dur)=>{
    if(!chEls.length||!curSong) return;
    const per=(dur>0?dur:20)/chEls.length;
    chEls.forEach((ce,i)=>{ curSong.timeouts.push(setTimeout(()=>{ ce.classList.add('on','sung'); const p=chEls[i-1]; if(p) p.classList.remove('on'); }, Math.max(0,i*per*1000))); });
  };
  // loadedmetadata 比 canplay 更早触发(拿到 duration 即可 seek 到 chorus), 不死等 canplay
  const doSeek=()=>{
    if(curSong&&curSong.token!==myToken) return;
    if(started) return; started=true;
    el.classList.remove('loading');
    try{ if(startAt>0 && startAt<(a.duration||1e9)) a.currentTime=startAt; }catch(_){}
  };
  a.onloadedmetadata=doSeek;
  a.oncanplay=doSeek;
  a.onplaying=()=>{
    if(!curSong||curSong.token!==myToken) return;
    el.classList.remove('loading');
    el.classList.add('playing'); el.querySelectorAll('.sl-ch').forEach(x=>x.classList.remove('on','sung'));
    const dur=(endAt>startAt)?(endAt-startAt):((a.duration||0)-startAt);
    beginMarquee(dur);
  };
  // 到 chorus 段末尾自动停(播高潮段而非整首)
  a.ontimeupdate=()=>{ if(endAt>startAt && a.currentTime>=endAt){ if(curSong&&curSong.token===myToken) stopSong(); } };
  a.onended=()=>{ if(curSong&&curSong.token===myToken) stopSong(); };
  a.onerror=()=>{ el.classList.remove('loading'); if(curSong&&curSong.token===myToken){ stopSong(); toast('神曲播放失败，请重试'); } };   // ★ 仅当仍是本次播放才报错; 主动停止(src='')触发的 error 不弹
  curSong={ audioEl:a, oscs:[], timeouts:[], el, onEnd:onEnd||null, _ai:true, token:myToken };
  // play() 在点击同步链里调用 → 不受移动端 autoplay 静音限制(和语音消息一样稳)
  a.play().then(()=>{}).catch(err=>{
    el.classList.remove('loading');
    // ★ AbortError = 用户主动暂停/切换打断了 play()(stopSong 里 pause+src=''), 非真实失败, 静默不弹错
    // 也可能已被新一次播放/停止接管(token 变了) → 同样不弹
    if((err&&err.name==='AbortError') || !curSong || curSong.token!==myToken) return;
    const msg=(err&&err.name==='NotAllowedError')?'被浏览器拦截，请再点一次':'神曲播放失败，请重试';
    toast(msg); stopSong();
  });
}

// legacy 模式播放: 纯本地 Web Audio 合成 + 元音哼唱 + 系统 TTS (还原 526771a v9 纯设备版)
async function playSongLegacy(lyric, sid, el, onEnd){
  stopVoice(); stopSong();
  const myToken=++_songToken;   // 本次播放令牌
  const ctx=ac(); if(!ctx){ toast(EH_CONFIG.text.err_noAudioSupport); return; }
  // 安卓 Chrome: AudioContext 初始 suspended, resume() 异步。带超时保护地等它 running,
  // 但绝不无限阻塞(某些安卓 resume Promise 迟迟不 resolve, 若死等会导致整首歌哑掉——完全没声)。
  // 最多等 ~250ms, 之后无论如何都继续排音符(t0 起始缓冲会给调度留余量)。
  try{ ctx.resume&&ctx.resume(); }catch(e){}
  for(let i=0;i<5 && ctx.state!=='running';i++){ await new Promise(r=>setTimeout(r,50)); try{ ctx.resume&&ctx.resume(); }catch(e){} }
  const st=SONG_STYLES.find(s=>s.id===sid)||SONG_STYLES[0];
  const chars=[...String(lyric)].filter(c=>c.trim()).slice(0,60);   // 与 encodeSong 上限/卡片渲染字数一致(原30会漏唱后半)
  if(!chars.length){ toast(EH_CONFIG.text.sing_noContent); return; }
  AudioEngine.duck(true);   // 压低官方房 BGM, 突出神曲人声
  try{
  const hasTTS = !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  const master=ctx.createGain(); master.gain.value=0.85; master.connect(ctx.destination);
  // 双总线: 伴奏压低(drumBus) + 主唱提高并加压缩(voiceBus) → 让唱声清晰浮在伴奏之上(修"听不出在唱")
  const drumBus=ctx.createGain(); drumBus.gain.value=0.22; drumBus.connect(master);   // v5: 伴奏狠压到22%让主唱明显浮出
  // 主唱总线直连 master(gain 1.3 补偿). 不用 DynamicsCompressor:
  // 国产浏览器(小米/QQ 等基于旧内核)对 DynamicsCompressor 支持有bug, 会把主唱信号压没/断掉
  // → 安卓表现"有伴奏没人声"(伴奏走master不经压缩器正常). 已改纯 GainNode, 全平台兼容.
  const voiceBus=ctx.createGain(); voiceBus.gain.value=1.6;
  voiceBus.connect(master);
  const spb=60/st.bpm, step=spb*st.bpc, barLen=spb*4;
  const t0=ctx.currentTime+0.18;   // 起始缓冲(安卓音频调度延迟更大, 留足余量防开头削音)
  const totalDur=chars.length*step + spb*2;
  curSong={ ctx, master, oscs:[], timeouts:[], el:el||null, onEnd:onEnd||null, token:myToken };
  if(el){ el.classList.add('playing'); el.querySelectorAll('.sl-ch').forEach(x=>x.classList.remove('on','sung')); }
  // 伴奏：逐小节铺鼓 + 贝斯 + 和弦垫
  const bars=Math.ceil(totalDur/barLen);
  for(let b=0;b<bars;b++){
    const bt=t0+b*barLen, root=st.base+st.chords[b%st.chords.length];
    for(let beat=0;beat<4;beat++){
      const t=bt+beat*spb;
      if(st.groove==='lofi'){                                    // lo-fi: 稀疏柔鼓, 只 1/3 拍落鼓, 弱 hat, 不打 snare
        if(beat===0||beat===2) curSong.oscs.push(kick(ctx,drumBus,t));
        curSong.oscs.push(hat(ctx,drumBus,t));
        curSong.oscs.push(tone(ctx,drumBus,NOTE(root-12),t,spb*0.9,st.bass,0.18));
        continue;
      }
      if(st.groove==='four') curSong.oscs.push(kick(ctx,drumBus,t));
      else if(beat%2===0) curSong.oscs.push(kick(ctx,drumBus,t));
      if(beat%2===1) curSong.oscs.push(snare(ctx,drumBus,t));
      curSong.oscs.push(hat(ctx,drumBus,t)); curSong.oscs.push(hat(ctx,drumBus,t+spb/2));
      curSong.oscs.push(tone(ctx,drumBus,NOTE(root-12),t,spb*0.85,st.bass,0.22));
    }
    const padWave = st.wave==='square'?'triangle':st.wave;   // 方波做和弦垫太刺, 降级三角; 其余用曲风波形
    [0,4,7].forEach(iv=>curSong.oscs.push(tone(ctx,drumBus,NOTE(root+iv),bt,barLen*0.95,padWave,0.045)));
  }
  // 主唱(v2)：共振峰元音哼唱作为主角, 音高真正跟旋律走(在"唱"而非"念"); TTS 降级为轻声跟读垫
  const chEls = el ? [...el.querySelectorAll('.sl-ch')] : [];
  const zhVoice = hasTTS ? pickZhVoice() : null;
  chars.forEach((ch,i)=>{
    const t=t0+i*step, deg=st.motif[i%st.motif.length];
    const semi=st.base+scaleSemi(st.scale,deg);
    const delay=Math.max(0,(t-ctx.currentTime)*1000);
    // 元音哼唱=主唱(gain 0.3), 跟着 motif 走音高, 带八度和声+颤音, 每套曲风波形音色各异
    singVoice(ctx,voiceBus,NOTE(semi),t,step*1.05,charVowel(ch),0.7,st.wave).forEach(o=>curSong.oscs.push(o));
    const chEl=chEls[i];
    if(chEl) curSong.timeouts.push(setTimeout(()=>{ chEl.classList.add('on','sung'); const prev=chEls[i-1]; if(prev) prev.classList.remove('on'); }, delay));
  });
  // 结尾甩音"哟~"(上滑收尾, 洗脑记忆点)
  const endT=t0+chars.length*step;
  const endSemi=st.base+scaleSemi(st.scale,st.motif[0])+12;
  singVoice(ctx,voiceBus,NOTE(endSemi),endT,spb*1.3,'o',0.6,st.wave).forEach(o=>curSong.oscs.push(o));
  // TTS 整句"唱词": 必须同步在用户手势里 speak(), 放进 setTimeout 会脱离手势→移动端静默失败。
  // 故这里立即念出(与鼓点差~120ms可忽略), 语速取曲风自然值(过快会含糊)。
  if(hasTTS){
    const fullText=chars.join('');
    const rate=clamp(st.tts?.rate??1.1, 0.7, 1.6);
    const pitch=clamp(st.tts?.pitch??1.0, 0.4, 2);
    try{
      speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(fullText);
      u.lang='zh-CN'; if(zhVoice) u.voice=zhVoice;
      u.rate=rate; u.pitch=pitch; u.volume=0.35;   // v2: TTS 降为轻声跟读垫, 不抢共振峰主唱
      curSong._tts=u;
      speechSynthesis.speak(u);
      // Chrome 有时 speak 后卡在 paused, resume 兜底
      setTimeout(()=>{ try{ if(speechSynthesis.paused) speechSynthesis.resume(); }catch(e){} }, 60);
    }catch(e){}
  }
  // 结束时间取 旋律时长 与 念词时长 的较大者(念词可能更长, 别提前掐断)
  const ttsDur=hasTTS ? chars.length*0.42/clamp(st.tts?.rate??1.1,0.7,1.6) : 0;
  curSong.timeouts.push(setTimeout(()=>{ if(curSong && curSong.token===myToken) stopSong(); }, (Math.max(totalDur,ttsDur)+0.4)*1000));
  }catch(err){
    // 合成/调度中途异常(老旧内核 oscillator 抛错等): 恢复 BGM + 停歌清理, 不让卡片卡在 playing 或 BGM 永久压低
    console.warn('playSongLegacy',err);
    try{ AudioEngine.duck(false); }catch(_){}
    try{ stopSong(); }catch(_){}
    toast('播放失败');
  }
}
// 点击卡片播放/停止(委托; 只信任白名单曲风, lyric 来自 dataset)
document.addEventListener('click',e=>{
  const btn=e.target.closest('.song-play'); if(!btn) return;
  const card=btn.closest('.song-card'); if(!card) return;
  // ★ 点完立即 blur: 图标按钮不留焦点, 彻底杀死任何浏览器焦点环(黑边)残留
  // (配合 CSS focus:none 双保险; 有些移动端把触屏点击当 focus-visible, 只能靠 blur 兽底)
  try{ btn.blur(); }catch(_){}
  // 音频解锁铁律: 用户手势的"同步"tick里立刻resume + 播一个静音tick, 让AudioContext真正跑起来
  // 一旦跑起来, 后面async里的start()才有声(iOS Safari/Chrome autoplay policy)
  try{ if(typeof AudioEngine!=='undefined') AudioEngine.resume(); }catch(_){}
  try{
    const c=ac();
    if(c){
      if(c.state==='suspended') c.resume();
      // 同步预热: 一个近零长度的静音buffer, start(0), 强制引擎进入running态
      const wb=c.createBuffer(1,1,22050);
      const wsrc=c.createBufferSource(); wsrc.buffer=wb;
      wsrc.connect(c.destination); wsrc.start(0);
    }
  }catch(_){}
  if(card.classList.contains('pending') || card.classList.contains('failed') || card.classList.contains('timeout')){
    // pending(生成中断) / failed(失败) / timeout(超时) 卡片被点 → 补触发一次生成
    const bubble=card.closest('.msg'); const mid=bubble&&bubble.dataset.mid;
    if(mid && !_EH_SONG_GENERATING.has(String(mid))){
      card.classList.remove('failed','timeout');
      const b=card.querySelector('.song-play'); if(b) b.setAttribute('data-tip','AI 谱曲中 · 约 40 秒');
      const cm=card.querySelector('.song-composing'); if(cm) cm.textContent='谱曲中';
      if(bubble) bubble.dataset.songTs=String(Date.now());   // 重置计时, 重试后重新计 120s 超时
      toast('神曲重新生成中…');
      generateAndPersistSong(String(mid), card.dataset.lyric||'', card.dataset.sid||'', bubble).catch(e=>console.warn('resume song',e));
    } else {
      toast('神曲生成中…');
    }
    return;
  }
  if(curSong && curSong.el===card){ stopSong(); return; }
  playSong(card.dataset.lyric||'', card.dataset.sid||'', card);
});

// ============ 灵魂现场 BGM：本地覆盖、曲库、显式广播 ============
const EH_BGM_FN=SB_URL+'/functions/v1/eh-bgm-gen';
const LS_BGM_LIBRARY='eh_user_bgm_library_v1';
let _ehBgmGenerating=false;
let _ehBgmOverride=null;
function bgmRoomKind(){ return curRoom&&['official','public','private'].includes(curRoom.kind)?curRoom.kind:'public'; }
function bgmSaveLocal(row){
  try{
    const a=JSON.parse(localStorage.getItem(LS_BGM_LIBRARY)||'[]').filter(x=>x&&x.id!==row.id);
    a.unshift(row); localStorage.setItem(LS_BGM_LIBRARY,JSON.stringify(a.slice(0,50)));
  }catch(_){}
}
function bgmLocalLibrary(){ try{return JSON.parse(localStorage.getItem(LS_BGM_LIBRARY)||'[]')}catch(_){return []} }
function bgmPlayLocal(row){
  if(!row||!row.url) return;
  // 只在当前房间生效：override 绑定的 room_name 一定是"当前房"，避免跨房粘曲。
  const rn=(curRoom&&curRoom.name)||row.room_name||'';
  _ehBgmOverride={ ...row, room_name:rn };
  try{ AudioEngine.start({name:'🎼 '+(row.title||'灵魂生成'),url:row.url}); }catch(e){ console.warn('bgm play',e); }
  try{ toast(`🎼 已切换：${row.title||'灵魂现场曲'}（仅你可听）`); }catch(_){}
}
// 换房时清掉过期 override，避免上一房的曲挡新房的广播/默认曲。
function bgmClearOverrideIfRoomChanged(next){
  if(_ehBgmOverride && (!next || _ehBgmOverride.room_name!==next.name)) _ehBgmOverride=null;
}
function bgmBroadcastPhrase(text){ return /全房间|全房|大家都听|所有人都听|广播|让大家听/i.test(text||''); }
// 灵魂曲目命名: 策展式(网易云歌单风), 与官方曲名同调性。
//   优先按用户描述里的意象命中一组诗化曲名; 命不中且描述本身是干净短句(≤8字)才直接用它;
//   否则按房间/通用意象兜底。【绝不】把长描述截成残句(旧实现"适合加班到凌晨还"的尬断根因)。
const BGM_TITLE_MOODS = [
  [/雨|下雨|阴天|潮湿|梅雨/, ['雨落下来的时候','听雨到天亮','窗外一直在下','潮湿的心事']],
  [/夜|深夜|午夜|凌晨|失眠|睡不着|熬夜/, ['没人知道我还醒着','凌晨三点的城市','午夜还亮着的窗','失眠者的电台']],
  [/加班|工作|代码|编程|bug|debug|程序|技术/i, ['改到天亮','与光标独处','键盘不肯睡','写完这一行就走']],
  [/悲|难过|伤心|哭|眼泪|失恋|心碎|想念|思念/, ['说不出口的那句','眼泪教会我的事','留在昨天的人','把想念调成静音']],
  [/治愈|平静|放松|舒缓|安静|温柔|舒服/, ['慢慢呼吸','把世界调小一点','软下来的午后','什么都不用想']],
  [/激昂|燃|热血|振奋|动感|嗨|力量|冲/, ['把音量开到最大','向前冲的理由','心跳追上节拍','不回头的路']],
  [/宇宙|星|太空|银河|星际|虚空|回音|科幻/, ['把秘密扔进宇宙','星尘落进耳朵','银河那头的回声','漂在无重力里']],
  [/孤独|一个人|独处|寂寞|安静的夜/, ['一个人也很好','关上门以后','空房间的回声','独自亮着的灯']],
  [/爱|喜欢|心动|恋|温暖的人|想见/, ['心动的证据','靠近一点点','为你留的座','说晚安之前']],
  [/回忆|过去|旧|怀念|从前|少年|青春/, ['翻旧照片的下午','那年夏天的风','回不去的操场','旧磁带里的我们']],
  [/海|大海|海边|浪|沙滩/, ['浪把话带走了','面朝海的下午','咸咸的风','退潮以后']],
  [/森林|山|自然|树|风|草原|旷野/, ['风穿过树林','山那边的安静','躺进一片绿','旷野无人']],
  [/咖啡|下午茶|慵懒|午后|阳光/, ['第二杯咖啡','阳光晒过的沙发','慵懒午后','不赶时间的下午']],
  [/旅行|路上|远方|出发|流浪/, ['去往远方的车票','路一直在前面','背包和风','不问来处']],
  [/梦|梦境|做梦|入睡/, ['落进梦里','半梦半醒','梦的边缘','睡前最后一个念头']],
];
function bgmGeneratedTitle(desc,room){
  const pick=(arr)=>{ try{ return arr[Math.floor(Math.random()*arr.length)]; }catch(_){ return arr[0]; } };
  const raw=String(desc||'');
  // 命中意象直接给策展名(优先级最高, 长描述也能得体命名而非被截断)
  for(const [re,names] of BGM_TITLE_MOODS){ if(re.test(raw)) return pick(names); }
  // 去掉指令性套话与填充词("一首/来点/生成"这类不该进曲名)
  let t=raw.replace(/让(全房间|大家|所有人)(也)?听|广播/gi,' ')
    .replace(/按(照)?当前房间(的)?气氛/gi,' ')
    .replace(/(现场|帮我|给我|想要|想|要|来)?(生成|创作|做|来|写|整|搞|放|点)(一)?(首|曲|段|点|个)?/gi,' ')
    .replace(/纯器乐|无人声|背景音乐|轻音乐|音乐|曲子|歌曲|旋律|BGM|歌/gi,' ')
    .replace(/(的|吧|呀|啊|嘛|哦|呢)$/,'')
    .replace(/[，。,.!！?？:：;；·\-—、~～]+/g,' ').replace(/\s+/g,' ').trim();
  // 纯量词/填充残留("一首""一曲""一个")不成曲名, 判空走兜底(线上"一首"脏数据即此)
  if(/^(一|来|个)?(首|曲|段|点|个|下|把)?$/.test(t)) t='';
  // 描述本身已是干净短句(≤8字)才直接用; 否则一律走兜底, 不做残句截断
  let clean='';
  try{
    const chars=[...new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(t)].map(x=>x.segment);
    if(chars.length&&chars.length<=8) clean=chars.join('');
  }catch(_){ if(t&&t.length<=8) clean=t; }
  if(clean) return clean;
  // 兜底: 按房间意象给策展名(带轻微变体避免千篇一律)
  const rn=String((room&&room.name)||'').trim();
  if(/午夜|深夜|电台/.test(rn)) return pick(['午夜回声','凌晨的电台','没人的深夜频率']);
  if(/技术|代码/.test(rn)) return pick(['代码微光','改到天亮','屏幕前的深夜']);
  if(/虚空|回音/.test(rn)) return pick(['星际回声','把秘密扔进宇宙','银河那头']);
  if(/私密/.test(rn)||(room&&room.kind==='private')) return pick(['耳边低语','关上门以后','只说给你听']);
  return pick(['此刻回声','说不清的心情','留给自己的一首','当下这一刻']);
}
async function sendBgmGen(desc){
  if(!curRoom) return;
  if(!myUid){ try{await ensureAuth();}catch(_){} }
  if(!myUid){ toast('灵魂还没认出你，请稍后再试'); return; }
  if(_ehBgmGenerating){ toast('灵魂正在为你作曲，先别催它'); return; }
  const now=Date.now(); if(sendBgmGen._t && now-sendBgmGen._t<4000){ toast('灵魂手还没闲下来，稍等几秒'); return; } sendBgmGen._t=now;
  _ehBgmGenerating=true;
  const room=curRoom;
  const broadcast=bgmBroadcastPhrase(desc);
  const clean=String(desc||'当前房间气氛').replace(/让(全房间|大家|所有人)(也)?听|广播/gi,'').trim().slice(0,500);
  toast('🎼 灵魂开始作曲了，约需一两分钟…');
  try{
    const session=await sb.auth.getSession();
    const token=session&&session.data&&session.data.session&&session.data.session.access_token;
    const body={userId:myUid,roomKind:bgmRoomKind(),roomName:room.name,prompt:`纯器乐、无人声。${clean}`,title:bgmGeneratedTitle(clean,room),broadcast};
    const r=await fetch(EH_BGM_FN,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
    const out=await r.json().catch(()=>({}));
    if(!r.ok||!out.ok){
      if(out.error==='quota_exceeded') toast(`灵魂今天已经为你做满 ${out.limit||5} 首了，先从曲库里挑一首吧`);
      else toast('灵魂这次没接住，点一下重试就好');
      return;
    }
    const row={id:out.id,title:out.title||body.title,url:out.url,room_name:room.name,created_at:new Date().toISOString()};
    bgmSaveLocal(row); bgmPlayLocal(row);
    if(broadcast){
      // 直接走 Realtime broadcast 传 URL，避免广播曲依赖其它用户读取触发者的 RLS 曲库行。
      try{ if(msgChan) await msgChan.send({type:'broadcast',event:'bgm.change',payload:{url:row.url,title:row.title,room_name:room.name,by:myUid}}); }catch(e){ console.warn('bgm broadcast send',e); }
      toast('🎼 已让全房间听到这首新曲');
    }
    try{ ehLog('bgm_generated',{title:row.title,broadcast,room_name:room.name}); }catch(_){}
    try{ window.dispatchEvent(new CustomEvent('eh:bgm-changed',{detail:{reason:'library'}})); }catch(_){}
  }catch(e){ console.warn('sendBgmGen',e); toast('灵魂暂时走神了，稍后再试'); }
  finally{ _ehBgmGenerating=false; }
}
async function showMyBgmLibrary(){
  if(!myUid){try{await ensureAuth()}catch(_){} }
  let rows=[];
  try{ const q=await sb.from('eh_user_bgm').select('id,title,url,room_name,created_at').eq('auth_uid',myUid).order('created_at',{ascending:false}).limit(30); rows=q.data||[]; }catch(_){}
  const merged=[...rows,...bgmLocalLibrary()].filter((x,i,a)=>x&&x.url&&a.findIndex(y=>String(y.id)===String(x.id))===i);
  if(!merged.length){toast('你的灵魂曲库还是空的，输入：@灵魂生成 BGM 雨夜');return;}
  const rn=curRoom&&curRoom.name;
  const here=rn?merged.filter(x=>x.room_name===rn):merged;
  const rest=rn?merged.filter(x=>x.room_name!==rn):[];
  const list=[...here,...rest].slice(0,8);
  const names=list.map((x,i)=>`${i+1}.${x.title||'未命名'}${(rn&&x.room_name!==rn)?'（'+x.room_name+'）':''}`).join('　');
  toast('🎼 我的曲库：'+names+(rn?'　输入「/bgm切换 曲名」':'　（进房后再切）'));
  window.__EH_BGM_LIBRARY=list;
}
async function switchMyBgm(title){
  if(!curRoom){ toast('先进一个房间再切曲'); return; }
  const all=(window.__EH_BGM_LIBRARY||bgmLocalLibrary()).filter(x=>x&&x.room_name===curRoom.name);
  if(!all.length){ toast('这个房间还没有你的灵魂曲，先「@灵魂生成 BGM …」一首'); return; }
  const row=all.find(x=>String(x.title||'').includes(title))||all[Number(title)-1];
  if(!row){await showMyBgmLibrary();return;}
  bgmPlayLocal(row);
}
// ============ 时间胶囊 ============
// /胶囊 7天 内容 → 封存一条消息, open_at 到期后由 worker 让房里灵魂在房间念出来。
// 呼应"回声厅"命名: 你此刻的声音, 在未来某天回响。
function parseCapsuleDelay(s){
  const t=String(s||'').trim();
  let m;
  if((m=t.match(/^(\d+)\s*天/))) return {days:+m[1], label:m[1]+'天后'};
  if((m=t.match(/^(\d+)\s*周/))) return {days:+m[1]*7, label:m[1]+'周后'};
  if((m=t.match(/^(\d+)\s*个?月/))) return {days:+m[1]*30, label:m[1]+'个月后'};
  if((m=t.match(/^(\d+)\s*年/))) return {days:+m[1]*365, label:m[1]+'年后'};
  if((m=t.match(/^(\d+)\s*小时/))) return {hours:+m[1], label:m[1]+'小时后'};
  if(/^一年后|明年/.test(t)) return {days:365, label:'一年后'};
  if(/^半年后/.test(t)) return {days:182, label:'半年后'};
  if(/^一个月后|下个月/.test(t)) return {days:30, label:'一个月后'};
  if(/^一周后|下周/.test(t)) return {days:7, label:'一周后'};
  if(/^明天/.test(t)) return {days:1, label:'明天'};
  if((m=t.match(/^(\d+)$/))) return {days:+m[1], label:m[1]+'天后'};   // 纯数字=天
  return null;
}
async function sealCapsule(arg){
  if(!myUid){try{await ensureAuth()}catch(_){}}
  if(!curRoom){ toast('先进一个房间再封存胶囊'); return; }
  const sp=arg.indexOf(' ');
  const delayStr=sp<0?arg:arg.slice(0,sp);
  const content=(sp<0?'':arg.slice(sp+1)).trim();
  const d=parseCapsuleDelay(delayStr);
  if(!d){ toast('用法：/胶囊 7天 想对未来说的话（也可 3周/1个月/1年/明年）'); return; }
  if(!content){ toast('胶囊里得装点话呀：/胶囊 '+delayStr+' 你想说的内容'); return; }
  if(content.length>300){ toast('胶囊内容太长了（最多300字）'); return; }
  const ms=(d.hours?d.hours*3600000:0)+(d.days?d.days*86400000:0);
  if(ms<3600000){ toast('至少封存1小时以上'); return; }
  if(ms>2*365*86400000){ toast('最多封存2年'); return; }
  const openAt=new Date(Date.now()+ms).toISOString();
  const payload={ room_id:curRoom.id, user_id:myUid, name:me.name||'', emoji:me.emoji||'', color:me.color||'', content, open_at:openAt };
  try{
    const { error }=await sb.from('eh_capsules').insert(payload);
    if(error){ console.warn('capsule',error); toast('封存失败，稍后再试'); return; }
    try{ burst('🕰️',10); burst('✨',12); }catch(_){}
    await sendSystemAct(`把一段话封进了时间胶囊 🕰️，将在${d.label}由灵魂念出`);
    toast('🕰️ 已封存！'+d.label+'，这段话会在这个房间被灵魂念出来');
  }catch(e){ console.warn('sealCapsule',e); toast('封存失败'); }
}
async function showMyCapsules(){
  if(!myUid){try{await ensureAuth()}catch(_){}}
  let rows=[];
  try{ const q=await sb.from('eh_capsules').select('content,open_at,opened').eq('user_id',myUid).order('open_at',{ascending:true}).limit(20); rows=q.data||[]; }catch(_){}
  if(!rows.length){ toast('你还没有封存过时间胶囊，试试：/胶囊 7天 想对未来说的话'); return; }
  const pend=rows.filter(r=>!r.opened), done=rows.filter(r=>r.opened);
  const fmtLeft=(iso)=>{ const ms=new Date(iso)-Date.now(); if(ms<=0) return '待念出'; const dd=Math.floor(ms/86400000); if(dd>=1) return dd+'天后开启'; const hh=Math.ceil(ms/3600000); return hh+'小时后开启'; };
  const lines=[];
  pend.forEach(r=>lines.push(`🔒 ${fmtLeft(r.open_at)}：${String(r.content).slice(0,20)}${r.content.length>20?'…':''}`));
  done.forEach(r=>lines.push(`✅ 已念出：${String(r.content).slice(0,20)}${r.content.length>20?'…':''}`));
  toast('🕰️ 我的时间胶囊（'+pend.length+'封待启）　'+lines.slice(0,6).join('　'));
}

async function sendSong(lyric, sid){
  if(!curRoom || !myUid) return;
  lyric=String(lyric||'').trim().slice(0,60);
  if(!lyric){ toast(EH_CONFIG.text.sing_needText); return; }
  if(!SONG_STYLES.some(s=>s.id===sid)) sid=SONG_STYLES[0].id;
  const singMode=(EH_CONFIG.tuning&&EH_CONFIG.tuning.singMode)||'ai';
  // legacy 模式: 消息立即发出、本地即时试听(无需生成)
  if(singMode==='legacy'){
    const payload={ room_id:curRoom.id, user_id:myUid, name:me.name, emoji:me.emoji, color:me.color, text:encodeSong(sid,lyric), kind:'song' };
    // ★先 insert 拿真实 id 再 append(同 AI 模式, 防 realtime 广播竞态)
    const { data:row, error }=await sb.from('eh_messages').insert(payload).select('id').single();
    if(error){ console.warn('song send',error); toast(EH_CONFIG.text.err_singSend); return; }
    let el=document.querySelector(`.msg[data-mid="${row.id}"]`);
    if(!el){
      const optimistic={ ...payload, id:row.id, created_at:new Date().toISOString() };
      el=buildMsgEl(optimistic); if(el){ $('#stream').appendChild(el); scrollStream(); }
    }
    if(el){ const card=el.querySelector('.song-card'); if(card) playSong(lyric, sid, card); }
    return;
  }
  // AI 模式: 消息立即发出(pending 态) → 后台异步生成 → 上传 → PATCH text 回写 → realtime 广播归队
  // ★先 insert 拿真实 id 再 buildMsgEl append, 彻底消灭"realtime 广播快于本地回填 dataset.mid 导致重复渲染"竞态
  //   (代价: 50-200ms 后才上屏, 换 100% 无重复; 且 realtime handler 也会 append 但会被 data-mid 去重挡住)
  const payload={ room_id:curRoom.id, user_id:myUid, name:me.name, emoji:me.emoji, color:me.color, text:encodeSong(sid,lyric), kind:'song' };
  const { data:row, error }=await sb.from('eh_messages').insert(payload).select('id').single();
  if(error){ console.warn('song send',error); toast(EH_CONFIG.text.err_singSend); return; }
  // 若 realtime 已经先把它 append 进 DOM(理论上不太可能, insert 返回和广播基本同时), 则跳过本地 append
  let el=document.querySelector(`.msg[data-mid="${row.id}"]`);
  if(!el){
    const optimistic={ ...payload, id:row.id, created_at:new Date().toISOString() };
    el=buildMsgEl(optimistic); if(el){ $('#stream').appendChild(el); scrollStream(); }
  }
  try{ updateSongQueueBar(); }catch(e){}   // 自己发的 pending 歌进队列条监视
  // 后台生成(不 await, 让用户可以继续聊天/其他操作)。mid 统一 String, 与点击补触发(String(mid))同键防重复生成
  generateAndPersistSong(String(row.id), lyric, sid, el).catch(e=>console.warn('generateSong bg',e));
}

// 生成 + 上传 + 回写 消息 text 字段(附带兜底: 谁触发到"未完成"卡片就由谁重生成一次)
const _EH_SONG_GENERATING=new Set();   // 记录正在生成的 mid, 防重复触发
// 扫已卡住的 pending 神曲(自己发的，上传了但 patch fail 的) → 存储桶中已有 mp3 则直接补回写, 不重调 MiniMax(省额度+快)
async function resumeStuckPendingSongs(){
  if(!curRoom || !curRoom.id || !myUid) return;
  try{
    // 拉自己发的、本房、kind=song 、没回写 URL 的最近 20 条
    const { data:rows }=await sb.from('eh_messages').select('id,text').eq('room_id',curRoom.id).eq('user_id',myUid).eq('kind','song').is('streaming',false).order('id',{ascending:false}).limit(20);
    if(!rows || !rows.length) return;
    const stuck=rows.filter(m=>{ const t=m.text||''; return t && !t.includes('|http'); });
    if(!stuck.length) return;
    for(const m of stuck){
      const path=`songs/${curRoom.id}/${m.id}.mp3`;
      // 先 HEAD 存储: mp3 存在 → 直接补 patch
      const { data:pub }=sb.storage.from('eh-song').getPublicUrl(path);
      let ok=false;
      try{ const r=await fetch(pub.publicUrl, {method:'HEAD'}); ok=r.ok; }catch(_){ ok=false; }
      if(!ok) continue;   // 没存 → 等下次点击重新生成, 不在这里自动花 MiniMax 额度
      const parts=(m.text||'').split('|');
      const sid=parts[0]||'dj';
      const lyric=parts.slice(1).join('|');   // 卡住的是老格式(明文, 可能含|), 不 decode(裸%会抛URIError中断整批)
      // chorus 信息丢失(初次生成时在内存) → 用全歌当 chorus(先能听到为主, 精准 chorus 属于优化)
      const songUrl=pub.publicUrl + '?t=' + Date.now();
      const newText=encodeSong(sid, lyric, songUrl, 0, 0);
      const upd=await sb.from('eh_messages').update({text:newText}).eq('id', m.id).select();
      if(upd.error){ console.warn('[resume song patch]', m.id, upd.error.message); continue; }
      if(!upd.data || upd.data.length===0){ console.warn('[resume song 0-rows]', m.id); continue; }
      _ehDbg('[song resumed]', m.id, '(bucket had mp3, patched)');
    }
  }catch(e){ console.warn('resumeStuckPendingSongs',e); }
}
// 页面可见恢复时: (1)静默刷新当前房消息内容——补齐后台期间错过的消息+修空框, 不重载页面(无感); (2)扫神曲 pending
// ★切回前台立即对齐 foregroundResync(2026-07-28 PWA 加强):
//   PWA 装成独立 app 后, OS 在切后台/锁屏/息屏时会比浏览器更狠地挂起 WebSocket → realtime "假活"
//   (状态仍 SUBSCRIBED, 服务端 INSERT 不再补发)。回前台这一瞬是漏投的高发窗口(灵魂在后台发的话没上屏)。
//   原来只在 visibilitychange 单补一次, 对 PWA 有两个弱点: ①刚亮屏网络还在重连, 单次 REST 补拉可能失败/赶空;
//   ②iOS/安卓 PWA 恢复时 visibilitychange 偶发不触发/延迟。故升级为:
//     · 多拍: 立即 + 600ms + 1500ms 各补一次, 覆盖网络重连窗口(refreshSnapshotTail 自带并发锁+只 append 比 DOM 新的行, 多拍零副作用)。
//     · 多源: visibilitychange / pageshow(bfcache 恢复) / window focus 都触发, 300ms 去抖合并防重复。
let _fgResyncTimer = null;
function foregroundResync(){
  if(document.hidden || !curRoom) return;
  if(_fgResyncTimer) return;   // 300ms 去抖: 多源同时触发只跑一批
  _fgResyncTimer = setTimeout(()=>{ _fgResyncTimer = null; }, 300);
  const fire = ()=>{ try{ if(curRoom && !document.hidden) refreshSnapshotTail(curRoom); }catch(_){} };
  fire();                    // 立即补(realtime 若已重连, 这次就对齐)
  setTimeout(fire, 600);     // 网络重连中途补
  setTimeout(fire, 1500);    // 慢网兜底补
  resumeStuckPendingSongs().catch(()=>{});
}
document.addEventListener('visibilitychange', ()=>{
  // 隐藏时暂停装饰动画省电, 显示时恢复
  try{ document.body.classList.toggle('page-hidden', document.hidden); }catch(_){}
  if(document.hidden) return;
  try{ window.__ehKbGuardBg && window.__ehKbGuardBg(); }catch(_){}   // ★V54: 回前台挡引擎恢复的 #cin focus 误弹起
  if(!curRoom) return;
  foregroundResync();
});
// pageshow(含 bfcache 恢复, persisted=true 时 visibilitychange 可能不发) + window focus: 多源兜底
window.addEventListener('pageshow', ()=>{ try{ window.__ehKbGuardBg && window.__ehKbGuardBg(); }catch(_){} foregroundResync(); });
window.addEventListener('focus', ()=>{ try{ window.__ehKbGuardBg && window.__ehKbGuardBg(); }catch(_){} foregroundResync(); });
// 音频域加固批B: 清唱兜底(worker 未回写时 120s 明确降级)
const _EH_ACAPELLA_TIMERS = new Map();   // mid → timeoutId, 供 worker 回写时清理
function _ehAcapellaTimeoutMark(mid){
  try{
    const stream=document.getElementById('stream'); if(!stream) return;
    const msg=stream.querySelector('.msg[data-mid="'+mid+'"]'); if(!msg) return;
    const card=msg.querySelector('.song-card'); if(!card) return;
    if(!card.classList.contains('pending')) return;   // 已 ready 或 failed → 不改
    card.classList.add('timeout');
    const cm=card.querySelector('.song-composing'); if(cm) cm.textContent='清唱服务暂不可用';
    const btn=card.querySelector('.song-play'); if(btn) btn.setAttribute('data-tip','清唱服务暂不可用 · 点击重试');
  }catch(_){}
  finally{ _EH_ACAPELLA_TIMERS.delete(String(mid)); }
}
async function generateAndPersistSong(mid, lyric, sid, el){
  try{ _ehDbg('[song] gen start mid=', mid, 'sid=', sid); }catch(_){}
  if(!mid || _EH_SONG_GENERATING.has(mid)) return;
  // 清唱(acapella): 前端连不到内网 TTS 网关, 不走 MiniMax(它不认 acapella)。留 pending, 由内网 worker 用 TTS 补生成回写。
  if(sid==='acapella'){
    try{ const cm=el&&el.querySelector('.song-composing'); if(cm) cm.textContent='生成中'; }catch(_){}
    try{ toast('生成中,由后台生成…'); }catch(_){}
    // 120s 兜底: worker 若未回写 → 明确降级为"清唱服务暂不可用", 允许手动重试
    try{
      const key=String(mid);
      if(_EH_ACAPELLA_TIMERS.has(key)) clearTimeout(_EH_ACAPELLA_TIMERS.get(key));
      const tid=setTimeout(()=>_ehAcapellaTimeoutMark(key), 120000);
      _EH_ACAPELLA_TIMERS.set(key, tid);
    }catch(_){}
    return;
  }
  _EH_SONG_GENERATING.add(mid);
  const startRoomId = curRoom && curRoom.id;   // 快照房间id, 防生成中途换房污染 path
  // 音频域加固批B: fetch 加 AbortController 超时(80s), 防 Edge Function 卡住时 _EH_SONG_GENERATING 一直持有 mid, 挡住重试
  const _ac = new AbortController();
  const _to = setTimeout(()=>{ try{ _ac.abort('timeout'); }catch(_){} }, 80000);
  try{
    const st=SONG_STYLES.find(s=>s.id===sid)||SONG_STYLES[0];
    // 挑一首同曲风母版当参考
    let masterUrl='';
    try{ await loadMasterManifest(); const pool=(EH_MASTER_MANIFEST&&EH_MASTER_MANIFEST.items||[]).filter(x=>x.sid===sid); if(pool.length) masterUrl=new URL(pool[Math.floor(Math.random()*pool.length)].url, location.href).href; }catch(_){}
    if(!masterUrl){ throw new Error('no master for sid '+sid); }
    // 调 Edge Function 生成(37s 左右, 前端 80s 硬超时)
    const resp=await fetch(EH_SING_COVER_FN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({masterUrl,lyric,prompt:st.coverPrompt||''}),signal:_ac.signal});
    if(!resp.ok) throw new Error('cover HTTP '+resp.status);
    const res=await resp.json();
    if(!res.ok || !res.coverMp3_b64) throw new Error('cover no audio');
    // 解析 chorus 段(structure 是 JSON 字符串)
    let chS=0, chE=0;
    try{
      const struct=typeof res.structure==='string' ? JSON.parse(res.structure) : (res.structure||{});
      const segs=struct.segments||[];
      const chorus=segs.find(x=>String(x.label).toLowerCase().includes('chorus'));
      if(chorus){ chS=chorus.start||0; chE=chorus.end||0; }
      else if(segs.length){ const last=segs[segs.length-1]; chS=last.start||0; chE=last.end||0; }
    }catch(_){}
    // 兜底: 没有 chorus 时用全歌
    if(chE<=chS){ chS=0; chE=res.cover_duration||0; }
    // b64 → Blob → 上传 eh-song 桶
    const bin=atob(res.coverMp3_b64); const bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    const blob=new Blob([bytes],{type:'audio/mpeg'});
    // 固定 path(用初始房间id + mid, 不带 ts) → 重试时会覆盖同文件, 不产生垃圾
    const path=`songs/${startRoomId||'unknown'}/${mid}.mp3`;
    const up=await sb.storage.from('eh-song').upload(path, blob, {contentType:'audio/mpeg', upsert:true});
    if(up.error) throw new Error('upload '+up.error.message);
    const { data:pub }=sb.storage.from('eh-song').getPublicUrl(path);
    // 加 cache-bust 参数防上传后 CDN 拿到旧缓存(覆写同名文件尤需)
    const songUrl=pub.publicUrl + '?t=' + Date.now();
    // 回写消息 text 字段 → 带 .select() 看影响行数, RLS 静默拒/0 行会报错而不是假成功
    const newText=encodeSong(sid, lyric, songUrl, chS, chE);
    const upd=await sb.from('eh_messages').update({text:newText}).eq('id', mid).select();
    if(upd.error){ throw new Error('song patch: '+upd.error.message); }
    if(!upd.data || upd.data.length===0){
      // 埞尚很容易遇: RLS 静默拒/mid 不匹配/session 失效 → 0 行无错
      throw new Error('song patch: 0 rows updated (RLS/session or mid mismatch)');
    }
    _ehDbg('[song ready]', mid, songUrl, 'chorus', chS, '~', chE);
  }catch(e){
    const isTimeout = e && (e.name==='AbortError' || _ac.signal.aborted);
    console.warn('[song] generate failed/timeout', isTimeout, e);
    toast(isTimeout ? '神曲生成超时,可重试' : (EH_CONFIG.text.err_singSend||'神曲生成失败'));
    // 卡片标记失败态: 换提示"点击重试", 与"生成中"区分开(点击仍会重触发生成, 见 song-play click)
    try{ const card=el&&el.querySelector('.song-card'); if(card){ card.classList.add('failed'); const btn=card.querySelector('.song-play'); if(btn) btn.setAttribute('data-tip', isTimeout?'生成超时 · 点击重试':'谱曲失败 · 点击重试'); const cm=card.querySelector('.song-composing'); if(cm) cm.textContent=isTimeout?'生成超时':'生成失败'; } }catch(_){}
  }finally{
    clearTimeout(_to);
    _EH_SONG_GENERATING.delete(mid);
  }
}
// 神曲: 点"文字变神曲"直接进模式(默认选中曲风); 换曲风用 composer 上方的细色条
let songSel=(SONG_STYLES.find(s=>s.id==='acapella')||SONG_STYLES[0]).id;   // 神曲默认用清唱
let songMode=false;
// 渲染曲风细色条(当前高亮; 点别的即换曲风, 停留在神曲模式)
let _cinWasFocused=false;   // 切曲风前输入框是否聚焦(用于切完不改变输入法开/收状态)
function renderSongStrip(){
  const strip=$('#songStrip'); if(!strip) return;
  // OPTD 修偶发: 首次进神曲模式时若曲风池还未从后台加载完(SONG_STYLES长度=0),
  // 会渲染出空条 → 拖动没内容滑 → 偶发拖不动。空池时 300ms 后重试一次(applyConfigMap 配置到达也会另触发一次, 两道保障)。
  if(!SONG_STYLES || SONG_STYLES.length===0){
    if(!strip._retryPending){
      strip._retryPending=true;
      setTimeout(()=>{ strip._retryPending=false; if(typeof songMode!=='undefined' && songMode) renderSongStrip(); }, 300);
    }
    return;
  }
  const cur=SONG_STYLES.find(s=>s.id===songSel)||SONG_STYLES[0];
  strip.style.setProperty('--strip-c', safeColor(cur.color));   // 整条 strip 跟随当前曲风色(标签+底色)
  strip.innerHTML=`<span class="ss-lb">曲风</span>`+SONG_STYLES.map(s=>
    `<span class="st-chip${s.id===songSel?' on':''}" data-sid="${s.id}" style="--sc:${safeColor(s.color)}">
      <span class="se">${s.emoji}</span><span class="st-nm">${esc(s.name)}</span>${s.sub?`<span class="st-sub">${esc(s.sub)}</span>`:''}</span>`).join('');
  // 点 chip 前记录输入框是否聚焦(输入法是否开着), 切完按原样恢复——不主动弹/收输入法
  strip.querySelectorAll('.st-chip').forEach(c=>{
    // pointerdown 时(点击前)抓当前焦点态, 避免 click 时焦点已被 chip 抢走
    c.addEventListener('pointerdown', ()=>{ _cinWasFocused = (document.activeElement === $('#cin')); }, {passive:true});
    c.onclick=e=>{ e.stopPropagation();
      songSel=c.dataset.sid;
      strip.querySelectorAll('.st-chip').forEach(x=>x.classList.toggle('on',x===c));
      // 更新输入框占位 + 主题色为当前曲风, 保持神曲模式
      const st=SONG_STYLES.find(s=>s.id===songSel)||SONG_STYLES[0];
      $('#cin').placeholder=`输入要唱的话… ${st.emoji}${st.name}`;
      $('.composer').style.setProperty('--song-c', safeColor(st.color));
      strip.style.setProperty('--strip-c', safeColor(st.color));   // 切曲风: strip 标签+底色也跟随
      // 不改变输入法状态: 原本聚焦(输入法开着)→切完补回焦点; 原本没聚焦→不强制弹出
      if(_cinWasFocused){ try{ $('#cin').focus(); }catch(_){} }
    };
  });
  bindStripDrag(strip);   // 每次重渲染确保拖动已绑(内部有幂等标记)
}
// 曲风条横向拖动: 用原生 touch 事件手动改 scrollLeft(不用 pointer capture——它在部分内核会
// 残留卡死"点着点着不能滑")。touch 无 capture 状态, 天生不会泄漏。桌面走原生鼠标滚(overflow-x:auto)。
function bindStripDrag(strip){
  if(!strip || strip._dragBound) return; strip._dragBound=true;
  let startX=0, startScroll=0, dragging=false, tracking=false;
  strip.addEventListener('touchstart', e=>{
    if(e.touches.length!==1){ tracking=false; return; }
    tracking=true; dragging=false; strip._lastWasDrag=false;   // 新触摸周期开始即复位, 防上次残留的拖动标志误拦本次点击
    startX=e.touches[0].clientX; startScroll=strip.scrollLeft;
  }, {passive:true});
  strip.addEventListener('touchmove', e=>{
    if(!tracking) return;
    const dx=e.touches[0].clientX-startX;
    if(!dragging && Math.abs(dx)>10) dragging=true;   // 超阈值判定拖动(10px: 点小胶囊时手指微抖不误判为拖, 避免 click 被误拦致'点了没反应')
    if(dragging){ strip.scrollLeft=startScroll-dx; if(e.cancelable) e.preventDefault(); }
  }, {passive:false});
  strip.addEventListener('touchend', ()=>{ strip._lastWasDrag=dragging; tracking=false; dragging=false; }, {passive:true});
  strip.addEventListener('touchcancel', ()=>{ tracking=false; dragging=false; }, {passive:true});
  // 拖动那下抬手的 click 不选曲风(误触)→ 捕获阶段拦一次
  strip.addEventListener('click', e=>{ if(strip._lastWasDrag){ e.stopPropagation(); e.preventDefault(); strip._lastWasDrag=false; } }, true);
}
if(!(window.AudioContext||window.webkitAudioContext)){ const p=$('#pmSong'); if(p) p.style.display='none'; }

// ============ 多情绪回声 落库 ============
// echoState[mid] = { '🔥':{count,mine}, ... }
function ecOf(mid){ return echoState[mid] || (echoState[mid]={}); }
// 贴 react/徽章后消息可能变高, 若它靠近底部会被输入框挡住 → 向上滚一点让它完整可见。
// 仅当该消息底边已超出可视区(或很贴边)时才滚, 不打扰正在回看历史的用户。
function ensureMsgVisible(mid){
  const el=document.querySelector(`.msg[data-mid="${mid}"]`); if(!el) return;
  const s=$('#stream'); if(!s) return;
  const sr=s.getBoundingClientRect(), er=el.getBoundingClientRect();
  // 消息底边超出 stream 底边(被挡/露不全) → 滚到刚好露全, 留 8px 余量
  if(er.bottom > sr.bottom - 8){ s.scrollTop += (er.bottom - sr.bottom) + 8; }
}
async function toggleEcho(mid, emoji){
  try{ EhSfx.play('echo'); }catch(e){}
  try{ const _pill=document.querySelector(`.ec-pill[data-mid="${mid}"][data-e="${emoji||'🔥'}"]`); ehFx(_pill,'fx-echo',520); }catch(e){}
  if(String(mid).startsWith('local_')) return;
  emoji = emoji || '🔥';
  const map=ecOf(mid); const st=map[emoji]||(map[emoji]={count:0,mine:false});
  if(st.mine){
    st.count=Math.max(0,st.count-1); st.mine=false; paintEcho(mid);
    await sb.from('eh_message_echoes').delete().eq('message_id',mid).eq('user_id',myUid).eq('emoji',emoji);
  } else {
    st.count++; st.mine=true; paintEcho(mid); burst(emoji,6);
    requestAnimationFrame(()=>ensureMsgVisible(mid));   // 徽章渲染后再量高度滚动
    pushEchoMru(emoji);   // 记入"最近使用", 下次反应环优先显示这个表情
    checkResonance(mid, emoji, st.count);
    await sb.from('eh_message_echoes').insert({message_id:mid,user_id:myUid,emoji});
  }
}
function applyEchoRealtime(mid, who, emoji){
  emoji = emoji || '🔥';
  const map=ecOf(mid); const st=map[emoji]||(map[emoji]={count:0,mine:false});
  if(who===myUid){ return; }  // 自己的已乐观更新
  st.count++; paintEcho(mid);
  try{ const _pill=document.querySelector(`.ec-pill[data-mid="${mid}"][data-e="${emoji}"]`); ehFx(_pill,'fx-echo',520); }catch(e){}
  const el=document.querySelector(`.msg[data-mid="${mid}"]`); if(el) burst(emoji,4);
  checkResonance(mid, emoji, st.count);
}
// 渲染某条消息的回声徽章条(只显示 count>0 的情绪)
function paintEcho(mid, scope){
  const bar = (scope||document).querySelector(`.echo-bar[data-mid="${mid}"]`)
           || document.querySelector(`.echo-bar[data-mid="${mid}"]`);
  if(!bar) return;
  const map=echoState[mid]||{};
  // 渲染 echoState 里实际有的所有表情, 不再限定 ECHO_EMOJIS 白名单——
  // 否则机器人/他人贴的白名单外表情(如 🙋)存了数据却显示不出(计数痕迹丢失的真因)。
  const active=Object.keys(map).filter(e=>map[e]&&map[e].count>0);
  bar.innerHTML=active.map(e=>{
    const st=map[e];
    return `<span class="ec-pill${st.mine?' mine':''}" data-e="${e}">${e}<b>${st.count}</b></span>`;
  }).join('');
  bar.classList.toggle('empty', active.length===0);
  bar.querySelectorAll('.ec-pill').forEach(p=>p.onclick=(ev)=>{ ev.stopPropagation(); toggleEcho(mid, p.dataset.e); });
}
async function fetchEchoes(ids){
  if(!ids || !ids.length) return;
  const { data } = await sb.from('eh_message_echoes').select('message_id,user_id,emoji').in('message_id',ids);
  (data||[]).forEach(e=>{ const map=ecOf(e.message_id); const st=map[e.emoji]||(map[e.emoji]={count:0,mine:false}); st.count++; if(e.user_id===myUid) st.mine=true; });
  ids.forEach(id=>{ if(echoState[id]) paintEcho(id); });
}
// 共鸣涟漪: 某条消息某情绪达阈值 → 全房视觉涟漪(复用 resonance 层 + 粒子)
function checkResonance(mid, emoji, count){
  if(count < RESONANCE_THRESHOLD()) return;
  const key=mid+emoji; if(resonatedMsgs.has(key)) return;
  if(resonatedMsgs.size>500) resonatedMsgs.clear();   // 防泄漏: 去重只需防短期重复, 老记录无价值, 超限清空
  resonatedMsgs.add(key);
  const el=document.querySelector(`.msg[data-mid="${mid}"]`);
  const color = el ? (el.querySelector('.nm')?.style.color||EH_CONFIG.resonanceDefaultC) : EH_CONFIG.resonanceDefaultC;
  triggerResonance(emoji, color, `✨ 一条消息响彻回声厅 ${emoji}`);
  if(el){ el.classList.add('resonated'); setTimeout(()=>el.classList.remove('resonated'),1600); }
}

// ============ 斜杠命令 ============
const SLASH_CMDS=[
  {c:'/me',    d:'以动作形式说话，如 /me 跳了段舞'},
  {c:'/dice',  d:'掷一颗骰子 🎲'},
  {c:'/flip',  d:'抛硬币，正面还是反面'},
  {c:'/whisper',d:'/whisper @昵称 悄悄话（仅对方可见）'},
  {c:'/echo',  d:'放一串全屏烟花 🎆'},
  {c:'/sing',  d:'/sing 文字 → 变洗脑神曲（随机曲风）🎵'},
  {c:'/bgm',   d:'/bgm 描述 → 请灵魂制作一首本地 BGM 🎼'},
  {c:'/bgm库', d:'/bgm库 → 查看我的 BGM 曲库'},
  {c:'/胶囊', d:'/胶囊 7天 想说的话 → 封存进时间胶囊，到期由灵魂在房里念出'},
  {c:'/胶囊库', d:'/胶囊库 → 查看我封存的时间胶囊'},
];
async function handleSlash(text){
  const [cmd,...rest]=text.split(' '); const arg=rest.join(' ').trim();
  if(cmd==='/me'){ return false; } // 交给 send 主流程处理成 act
  if(cmd==='/dice'){ const n=1+Math.floor(secureRand()*6); await sendSystemAct(`掷出了 🎲 ${n} 点`); return true; }
  if(cmd==='/flip'){ const r=secureRand()<0.5?'正面 🪙':'反面 🪙'; await sendSystemAct(`抛硬币：${r}`); return true; }
  if(cmd==='/echo'){ burst('🎆',24); burst('✨',20); await sendSystemAct('放了一串烟花 🎆'); return true; }
  if(cmd==='/sing'||cmd==='/唱'){
    if(!arg){ toast(EH_CONFIG.text.help_sing); return true; }
    await sendSong(arg, rand(SONG_STYLES).id); return true;
  }
  if(cmd==='/bgm'||cmd==='/生成bgm'){
    if(!arg){ toast('描述一下想听的氛围，例如：雨夜、低频、空灵、纯器乐'); return true; }
    await sendBgmGen(arg); return true;
  }
  if(cmd==='/bgm库'){
    await showMyBgmLibrary(); return true;
  }
  if(cmd==='/胶囊'||cmd==='/capsule'){
    await sealCapsule(arg); return true;
  }
  if(cmd==='/胶囊库'||cmd==='/我的胶囊'){
    await showMyCapsules(); return true;
  }
  if(cmd==='/bgm切换'){
    if(!arg){ await showMyBgmLibrary(); return true; }
    await switchMyBgm(arg); return true;
  }
  if(cmd==='/whisper'){
    const mName=arg.match(/^@?(\S+)\s+(.+)$/);
    if(!mName){ toast(EH_CONFIG.text.help_whisper); return true; }
    const target=await findMemberByName(mName[1]);
    if(!target){ toast(EH_CONFIG.text.err_userNotFound); return true; }
    const wPayload={room_id:curRoom.id,user_id:myUid,name:me.name,emoji:me.emoji,color:me.color,text:mName[2],kind:'whisper',to_user:target.user_id};
    // 本地先显示一条
    const wLocal={...wPayload,id:'local_'+Date.now(),created_at:new Date().toISOString()};
    const el=buildMsgEl(wLocal);
    if(el){ $('#stream').appendChild(el); scrollStream(); }
    const { data:wRow }=await sb.from('eh_messages').insert(wPayload).select('id').single();
    if(wRow){ wLocal.id=wRow.id; if(el) el.dataset.mid=wRow.id; }
    return true;
  }
  return false; // 非命令，按普通消息发
}
async function sendSystemAct(text){
  const payload={room_id:curRoom.id,user_id:myUid,name:me.name,emoji:me.emoji,color:me.color,text,kind:'act'};
  const el=buildMsgEl({...payload,id:'local_'+Date.now(),created_at:new Date().toISOString()});
  if(el){ $('#stream').appendChild(el); scrollStream(); }
  await sb.from('eh_messages').insert(payload);
}
async function findMemberByName(name){
  if(!curRoom) return null;
  const since=new Date(Date.now()-ONLINE_WINDOW()).toISOString();
  const { data } = await sb.from('eh_presence').select('user_id,name').eq('room_id',curRoom.id).gte('last_seen',since);
  return (data||[]).find(u=>u.name===name) || (data||[]).find(u=>u.name.includes(name)) || null;
}
function secureRand(){ const a=new Uint32Array(1); crypto.getRandomValues(a); return a[0]/4294967296; }

// 斜杠菜单 UI
let _slashActive=false, _slashSel=0, _slashList=[];
function renderSlashMenu(filter){
  const menu=$('#slashMenu');
  _slashList=SLASH_CMDS.filter(c=>c.c.startsWith(filter));
  if(!_slashList.length){ hideSlash(); return; }
  if(_slashSel>=_slashList.length) _slashSel=0;
  menu.innerHTML=_slashList.map((c,i)=>`<div class="slash-item ${i===_slashSel?'sel':''}" data-i="${i}"><span class="sc">${c.c}</span><span class="sd">${esc(c.d)}</span></div>`).join('');
  menu.querySelectorAll('.slash-item').forEach(el=>el.onclick=()=>pickSlash(+el.dataset.i));
  menu.classList.add('on'); _slashActive=true;
}
function pickSlash(i){
  const c=_slashList[i]; if(!c) return;
  const inp=$('#cin'); inp.value=c.c+' '; inp.focus(); hideSlash(); inp.dispatchEvent(new Event('input'));
}
function hideSlash(){ $('#slashMenu').classList.remove('on'); _slashActive=false; }

// ============ 长按互动环 ============
let lpTimer=null; let _lpStart=null;
function cancelLongPress(){ if(lpTimer){ clearTimeout(lpTimer); lpTimer=null; } _lpStart=null; }
function attachLongPress(el, m){
  const open=(x,y)=>showActRing(x,y,m);
  el.addEventListener('contextmenu',e=>{ e.preventDefault(); open(e.clientX,e.clientY); });
  el.addEventListener('touchstart',e=>{
    // ★ 多指手势(截屏/缩放等)不触发长按菜单——避免手机手势截屏时误弹互动环
    if(e.touches.length>1){ cancelLongPress(); return; }
    const t=e.touches[0]; _lpStart={x:t.clientX,y:t.clientY};
    lpTimer=setTimeout(()=>{ if(_lpStart) open(_lpStart.x,_lpStart.y); },480);
  },{passive:true});
  el.addEventListener('touchmove',e=>{
    // 多指 或 位移超 12px → 当作滞动/手势, 取消长按
    if(e.touches.length>1){ cancelLongPress(); return; }
    const t=e.touches[0];
    if(_lpStart && (Math.abs(t.clientX-_lpStart.x)>12 || Math.abs(t.clientY-_lpStart.y)>12)) cancelLongPress();
  },{passive:true});
  el.addEventListener('touchend',cancelLongPress);
  el.addEventListener('touchcancel',cancelLongPress);
}
// ★ 截屏/切后台时系统 UI 介入会让页面失焦/隐藏 → 取消待弹长按 + 关掉已开的互动环，防“截屏误触菜单”
window.addEventListener('blur',()=>{ cancelLongPress(); try{ hideActRing(); }catch(_){} },{passive:true});
document.addEventListener('visibilitychange',()=>{ if(document.hidden){ cancelLongPress(); try{ hideActRing(); }catch(_){} } });
function ehLongPressFx(){ try{ if(navigator.vibrate) navigator.vibrate(15); }catch(_){} try{ EhSfx.play('tick'); }catch(_){} }  // 长按触发统一触感: 震动(安卓)+轻音效(iOS无震动API的补偿)
function showActRing(x,y,m){
  const ring=$('#actRing');
  // ★去重: 同一次长按, 我们的 480ms touch 定时器 + 浏览器原生 contextmenu(安卓/桌面长按也会发)会各调一次
  //   showActRing → 触感/音效放两遍。已开且 700ms 内的再次调用视作同一手势, 直接忽略(不重播 fx/不重渲)。
  if(ring.classList.contains('on') && ring._openedAt && (Date.now()-ring._openedAt)<700) return;
  ehLongPressFx();
  const isMine = m.user_id===myUid;
  const mid = isNaN(+m.id)?m.id:+m.id;
  // 自己的消息也可点回声(点赞等)——真人对自己内容盖章/强调是合理表达
  // 上方表情行(N表情+➕)与下方操作行数量对齐: 下方固定4(回复/投影/存卡/复制), 自己消息多撤回=5。
  //   故有撤回时上方取4表情(4+➕=5), 无撤回取3表情(3+➕=4), 上下对齐。
  const _echoN = canRecall(m) ? 4 : 3;
  const echoRow = `<div class="ar-echoes">${echoQuickList(_echoN).map(k=>`<button class="ar-echo" data-e="${k.e}" title="${k.label}"><span class="ai">${k.e}</span></button>`).join('')}<button class="ar-echo ar-more" data-more="1" title="更多表情"><span class="ai">➕</span></button></div>`;
  ring.innerHTML=`
    ${echoRow}
    <div class="ar-actions">
      <button data-a="reply"><span class="ai"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6 4 12l5 6"/><path d="M4 12h9a7 7 0 0 1 7 7v0"/></svg></span>回复</button>
      <button data-a="project"><span class="ai"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M10 11l4 1-4 1z" fill="currentColor" stroke="none"/></svg></span>投影</button>
      <button data-a="card"><span class="ai"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l4-4 4 4M14 13l2-2 5 5"/><circle cx="8.5" cy="9.5" r="1.3" fill="currentColor" stroke="none"/></svg></span>存卡</button>
      <button data-a="copy"><span class="ai"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></span>复制</button>
      ${canRecall(m)?`<button data-a="recall" class="ar-recall"><span class="ai"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/></svg></span>撤回</button>`:''}
    </div>`;
  ring.querySelectorAll('.ar-echo').forEach(b=>b.onclick=(e)=>{
    e.stopPropagation();   // 别冒泡到 document 的关闭监听(否则刚开的托盘立即被关)
    if(b.dataset.more){ hideActRing(); openEchoTray(mid); return; }   // ➕ → 打开全表情托盘贴反应
    toggleEcho(mid, b.dataset.e); hideActRing();
  });
  ring.querySelector('[data-a="reply"]').onclick=()=>{ startReply(m); hideActRing(); };
  ring.querySelector('[data-a="project"]').onclick=()=>{ broadcastProject(m.text,m.color); hideActRing(); };
  { const cb=ring.querySelector('[data-a="card"]'); if(cb) cb.onclick=()=>{ hideActRing(); makeMomentCard(m); }; }
  { const cp=ring.querySelector('[data-a="copy"]'); if(cp) cp.onclick=()=>{
      hideActRing();
      const txt = (typeof momentCardText==='function' ? momentCardText(m) : (m.text||''));
      const done = ()=>{ try{ toast('已复制'); }catch(_){} };
      const fail = ()=>{ try{ toast('复制失败,请手动长按'); }catch(_){} };
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(txt).then(done, ()=>{
          // 降级: execCommand (旧浏览器/WebView/非安全上下文)
          try{
            const ta=document.createElement('textarea');
            ta.value=txt; ta.style.cssText='position:fixed;top:0;left:0;opacity:0;pointer-events:none';
            document.body.appendChild(ta); ta.select();
            const ok=document.execCommand('copy'); ta.remove();
            ok?done():fail();
          }catch(_){ fail(); }
        });
      } else {
        try{
          const ta=document.createElement('textarea');
          ta.value=txt; ta.style.cssText='position:fixed;top:0;left:0;opacity:0;pointer-events:none';
          document.body.appendChild(ta); ta.select();
          const ok=document.execCommand('copy'); ta.remove();
          ok?done():fail();
        }catch(_){ fail(); }
      }
    };
  }
  const recallBtn=ring.querySelector('[data-a="recall"]');
  if(recallBtn) recallBtn.onclick=()=>{ hideActRing(); recallMsg(mid, m); };
  ring.classList.add('on');
  ring._openedAt=Date.now();   // ★记录开启时刻: 长按在 480ms 触发(手指仍按着), 抬指会补发一次 synthetic click 落在气泡上(环外)→ 立即关。加窗口挡住这一下, 免得"弹出即收回"
  const rw=ring.offsetWidth||240, rh=ring.offsetHeight||100;
  ring.style.left=Math.max(8,Math.min(x-rw/2, innerWidth-rw-8))+'px';
  ring.style.top=Math.max(8,Math.min(y-rh-10, innerHeight-rh-8))+'px';
}
function hideActRing(){ $('#actRing').classList.remove('on'); }
document.addEventListener('click',e=>{ const r=$('#actRing'); if(r.contains(e.target)) return;
  if(r._openedAt && (Date.now()-r._openedAt)<350) return;   // 刚开 350ms 内的抬指 click 不关(长按误关防护, 同 BGM 菜单)
  hideActRing(); });

// ============ 名场面分享卡片: 把一条消息画成赛博卡片(canvas), 可保存/分享 ============
// 纯 canvas 绘制(渐变底+霓虹框+头像emoji+昵称+正文+回声+品牌页脚), 不依赖外部图/html2canvas → 无跨域污染。
function momentCardText(m){
  try{
    if(m.kind==='song'){ const s=parseSong(m.text); return '🎵 '+(s.lyric||'神曲'); }
    if(m.kind==='voice'){ const tx=(/[#&]tx=([^&]+)/.exec(m.text||'')||[])[1]; return '🎙️ '+(tx?decodeURIComponent(tx):'语音消息'); }
    if(m.kind==='proj') return '📽️ '+(m.text||'');
    if(m.kind==='interact'){ const parts=String(m.text||'').split('|'); return parts.slice(2).join('|')||'✨ 互动'; }
  }catch(_){}
  return m.text||'';
}
async function makeMomentCard(m){
  try{
    const dpr=Math.min(2, window.devicePixelRatio||1);
    const W=720, H=420, pad=44;
    const cv=document.createElement('canvas'); cv.width=W*dpr; cv.height=H*dpr;
    const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);
    // 取当前主题色(跟随房间氛围, 卡片和房一致)
    const cs=getComputedStyle(document.documentElement);
    const accent=(cs.getPropertyValue('--accent')||'#00E5D4').trim()||'#00E5D4';
    const bg1=(cs.getPropertyValue('--bg')||'#070a12').trim(), bg2=(cs.getPropertyValue('--bg2')||'#0d1524').trim();
    const ink=(cs.getPropertyValue('--ink')||'#EAF6FF').trim(), sub=(cs.getPropertyValue('--sub')||'#86cbc6').trim();
    const nmColor=safeColor(m.color, accent);
    // 底: 对角渐变
    const g=ctx.createLinearGradient(0,0,W,H); g.addColorStop(0,bg1); g.addColorStop(1,bg2);
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    // 霓虹外框 + 角落辉光
    const rg=ctx.createRadialGradient(W,0,20,W,0,W*0.9); rg.addColorStop(0,accent+'33'); rg.addColorStop(1,'transparent');
    ctx.fillStyle=rg; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle=accent; ctx.lineWidth=2; ctx.shadowColor=accent; ctx.shadowBlur=18;
    roundRect(ctx, 12,12, W-24,H-24, 22); ctx.stroke(); ctx.shadowBlur=0;
    // 头部: 头像 emoji + 昵称
    const nm = m.anon ? (m.name||'虚空') : (m.name||'匿名');
    ctx.font='40px "Apple Color Emoji","Segoe UI Emoji",system-ui,sans-serif';
    ctx.textBaseline='middle'; ctx.fillText(safeEmoji2(m.emoji)||'👤', pad, pad+24);
    ctx.font='700 26px system-ui,-apple-system,"PingFang SC",sans-serif';
    ctx.fillStyle=nmColor; ctx.shadowColor=nmColor; ctx.shadowBlur=10;
    ctx.fillText(nm, pad+56, pad+24); ctx.shadowBlur=0;
    // 正文(自动换行, 大字)
    const txt=momentCardText(m).slice(0,140);
    ctx.font='600 30px system-ui,-apple-system,"PingFang SC",sans-serif'; ctx.fillStyle=ink;
    wrapText(ctx, txt, pad, pad+92, W-pad*2, 44, 6);
    // 页脚: 房名 + 品牌
    ctx.font='500 16px system-ui,sans-serif'; ctx.fillStyle=sub; ctx.textBaseline='alphabetic';
    const room=(curRoom&&curRoom.name)?('# '+curRoom.name):'回声厅';
    ctx.fillText(room, pad, H-pad+6);
    ctx.textAlign='right'; ctx.fillStyle=accent; ctx.font='700 16px system-ui,sans-serif';
    ctx.fillText('✦ 回声厅 · Echo Hall', W-pad, H-pad+6); ctx.textAlign='left';
    // 输出 + 预览
    const url=cv.toDataURL('image/png');
    showCardPreview(url);
  }catch(e){ toast('生成卡片失败'); console.warn('makeMomentCard',e); }
}
function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function wrapText(ctx,text,x,y,maxW,lh,maxLines){
  const chars=[...String(text)]; let line='',lines=0;
  for(let i=0;i<chars.length;i++){
    const test=line+chars[i];
    if(ctx.measureText(test).width>maxW && line){ ctx.fillText(line,x,y); line=chars[i]; y+=lh; if(++lines>=maxLines-1){ // 最后一行截断加省略
        let rest=chars.slice(i).join(''); while(ctx.measureText(rest+'…').width>maxW && rest.length>1) rest=rest.slice(0,-1); ctx.fillText(rest+'…',x,y); return; } }
    else line=test;
  }
  if(line) ctx.fillText(line,x,y);
}
function safeEmoji2(e){ e=(e||'').trim(); return e?[...e][0]:''; }
function showCardPreview(url){
  const mask=$('#cardMask'); if(!mask) return;
  $('#cardImg').src=url;
  mask.classList.add('on');
  $('#cardSave').onclick=()=>{ const a=document.createElement('a'); a.href=url; a.download='echohall-'+Date.now()+'.png'; a.click(); };
  $('#cardShare').onclick=async()=>{
    try{
      const blob=await (await fetch(url)).blob();
      const file=new File([blob],'echohall.png',{type:'image/png'});
      if(navigator.canShare && navigator.canShare({files:[file]})){ await navigator.share({files:[file], title:'回声厅名场面'}); }
      else { const a=document.createElement('a'); a.href=url; a.download='echohall-'+Date.now()+'.png'; a.click(); toast('已下载(此设备不支持直接分享)'); }
    }catch(e){ /* 用户取消分享 */ }
  };
  $('#cardClose').onclick=()=>mask.classList.remove('on');
}


// ============ 消息撤回(软删除: UPDATE kind=recalled, 复用现有字段, 无需改 schema) ============
// 权限: ①作者本人且 ≤120s  ②房主(curRoom.role==='owner')  ③管理员(me.role admin/super)
const RECALL_WINDOW_MS = 120000;
function canRecall(m){
  if(!m || m.id==null) return false;
  if(String(m.id).startsWith('local_')) return false;        // 还没落库的乐观消息不能撤
  if(m.deleted_at || m.kind==='recalled') return false;      // 已撤回的不再撤(A方案 deleted_at, 兼容 B 方案 kind)
  if(m.kind==='proj' || m.kind==='act') return false;        // 投影/系统动作不撤(瞬时/系统)
  const isAuthor = m.user_id===myUid;
  const inWindow = m.created_at ? (Date.now()-Date.parse(m.created_at) <= RECALL_WINDOW_MS) : false;
  if(isAuthor && inWindow) return true;
  if(curRoom && curRoom.role==='owner') return true;
  if(me && (me.role==='admin' || me.role==='super')) return true;
  return false;
}
async function recallMsg(mid, m){
  if(!canRecall(m)){ toast('无法撤回这条消息'); return; }
  const idNum = isNaN(+mid)?mid:+mid;
  try{
    // ★调服务端 RPC: 权限校验+只改 deleted_at/deleted_by 全在服务端(SECURITY DEFINER 函数)
    //   前端 canRecall 只是 UX 层, 真权威是服务端 RPC. 房主/管理员撤别人靠 RPC 内部 eh_is_owner/eh_is_admin.
    const { error } = await sb.rpc('eh_recall_message', { msg_id: idNum });
    if(error){
      console.warn('recall RPC',error);
      // 服务端错误码映射友好提示(RPC 抛 P0001-P0004)
      const msg=String(error.message||'');
      if(msg.includes('permission denied')) toast('没有撤回权限（超过2分钟且不是房主/管理员）');
      else if(msg.includes('already recalled')) toast('这条消息已被撤回');
      else if(msg.includes('cannot be recalled')) toast('这种消息不能撤回');
      else if(msg.includes('not found')) toast('消息不存在');
      else toast('撤回失败，请重试');
      return;
    }
    // 乐观: 本地立即替换成占位(realtime UPDATE 事件后也会替换一次, 但 buildMsgEl 幂等)
    const domEl=document.querySelector(`.msg[data-mid="${idNum}"], .recalled-tip[data-mid="${idNum}"]`);
    const placeholder=buildMsgEl({id:idNum, deleted_at:new Date().toISOString(), user_id:m.user_id, name:m.name, anon:m.anon});
    if(domEl && placeholder){ domEl.replaceWith(placeholder); }
    try{ EhSfx.playClick(); }catch(e){}
  }catch(e){ console.warn('recall ex',e); toast('撤回失败，请重试'); }
}

// 引用回复
function startReply(m){
  // 虚空匿名消息: 引用时也用匿名代号, 不泄露真名
  const nm = m.anon ? (m.user_id===myUid ? m.name+'（虚空）' : voidNameFor(m)) : m.name;
  // 神曲/语音/投影引用预览用友好标签, 不显 raw 编码/URL
  const preview = replyPreviewText(m.text, m.kind);
  replyTo={id:isNaN(+m.id)?m.id:+m.id, name:nm, text:preview};
  $('#rpTxt').textContent=`回复 ${nm}：${preview}`; $('#replyPreview').classList.add('on'); $('#cin').focus();
}
function clearReply(){ replyTo=null; $('#replyPreview').classList.remove('on'); }

// 投影弹幕：本地飞 + 广播(kind='proj'消息)，让房里所有人都看到
function projectText(text,color){
  const p=document.createElement('div'); p.className='proj'; p.textContent=text; p.style.color=color||EH_CONFIG.identityDefaultC;
  p.style.textShadow=`0 0 20px ${safeColor(color,EH_CONFIG.identityDefaultC)}`;
  p.style.top=(15+secureRand()*60)+'vh'; document.body.appendChild(p);
  setTimeout(()=>p.remove(),8000);
}
async function broadcastProject(text,color){
  projectText(text,color); // 本地先飞
  if(!curRoom || !myUid) return;
  // 用 kind='proj' 的消息广播；收到方触发飞幕、不进消息流
  await sb.from('eh_messages').insert({ room_id:curRoom.id, user_id:myUid, name:me.name, emoji:me.emoji, color:me.color, text:String(text).slice(0,200), kind:'proj' });
}

// ============ 消息共鸣(多人短时同 emoji) ============
// 多人发言热度: 记近8秒不同发言者, ≥2人时触发声波涟漪(人越多越强)
let _heatSpeakers=[];   // [{uid,ts}]
function trackChatHeat(m){
  if(!m || !m.user_id) return;
  const now=Date.now();
  _heatSpeakers=_heatSpeakers.filter(s=>now-s.ts<8000);
  _heatSpeakers.push({uid:m.user_id, ts:now});
  const uniq=new Set(_heatSpeakers.map(s=>s.uid)).size;
  if(uniq>=2){ try{ window.EhFx&&EhFx.soundwave(uniq-2); }catch(e){} }
}
let resoWindow={};  // emoji -> [ts...]
function maybeResonate(m){
  if(!isEmojiOnly(m.text)) return;
  const key=[...m.text][0]; const now=Date.now();
  resoWindow[key]=(resoWindow[key]||[]).filter(t=>now-t<4000); resoWindow[key].push(now);
  if(resoWindow[key].length>=3){ triggerResonance(key,m.color); resoWindow[key]=[]; }
}
function triggerResonance(emoji,color,msg){
  const r=$('#resonance');
  r.style.background=`radial-gradient(circle at 50% 60%, ${safeColor(color,EH_CONFIG.resonanceDefaultC)}44, transparent 70%)`;
  r.classList.add('on'); burst(emoji,40); toast(msg||`✨ 共鸣！大家都在发 ${safeEmoji(emoji)}`);
  setTimeout(()=>r.classList.remove('on'),1200);
}

// ============ emoji 粒子 ============
function burst(str,count=10){
  // 按"字素簇"切分, 保住 ❤️ 的变体选择器(FE0F)/ZWJ 组合, 否则拆散后 ❤ 丢变体→渲染成单色白心
  let chars;
  try{ const seg=new Intl.Segmenter('zh',{granularity:'grapheme'}); chars=[...seg.segment(str||'')].map(s=>s.segment); }
  catch(e){ chars=[...(str||'')]; }
  chars=chars.filter(c=>/\p{Emoji}/u.test(c)); if(!chars.length) chars.push('✨️');
  const layer=$('#particles');
  for(let i=0;i<count;i++){
    const p=document.createElement('div'); p.className='particle'; p.textContent=rand(chars);
    p.style.left=(10+secureRand()*80)+'vw'; p.style.bottom='60px';
    p.style.setProperty('--spin',(secureRand()*720-360)+'deg');
    p.style.animationDelay=(secureRand()*0.3)+'s'; p.style.fontSize=(20+secureRand()*20)+'px';
    layer.appendChild(p); setTimeout(()=>p.remove(),3800);
  }
}

// ============ 互动特效引擎(数据驱动: 按 fx 参数组合原子能力) ============
// fx 原子能力(可任意组合, 全部可选, 向后兼容):
//   基础: vibrate:[..], flash:"#色", shake:true, fly:"👊", burst:"🌹", rain:true, glow:"#色", sfx:"名"
//   升级(对齐进场系统的电影感):
//     ring:"#色"     命中点冲击波环(打击类, 可与 shake/zoom 叠加成"拳拳到肉")
//     zoom:true      命中瞬间整屏顿一下(定格冲击感, 比 shake 更"实")
//     sweep:"#色"    全屏对角光带扫过(庆祝/高光时刻)
//     word:"KO"      命中大字冲击标题(打击/庆祝, 借进场 ent-big 语言); word_c 可指定字色
//     float:"🌹"     从目标处袅袅上浮(温情类, 比生硬 burst 更柔)
// targetEl: 命中目标的 DOM(对方头像), 用于飞行物落点/发光定位; 没有则用屏幕中心。
function playInteractionFx(fx, targetEl){
  if(!fx) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  // 目标落点(对方头像中心); 无目标→屏幕中上
  let tx=window.innerWidth/2, ty=window.innerHeight*0.4;
  if(targetEl){ try{ const r=targetEl.getBoundingClientRect(); tx=r.left+r.width/2; ty=r.top+r.height/2; }catch(_){} }
  // 有飞行物时, 命中类效果(音效/闪/震/顿/环/大字/撒射/上浮)都等飞到再一起爆 → "命中同步"更带感;
  //   无飞行物则即时触发。sweep/glow 是氛围性、不属命中冲击, 一律即时。
  const IMP = fx.fly ? 520 : 0;
  const atImpact = fn => { if(IMP) setTimeout(()=>{ try{fn();}catch(_){} }, IMP); else { try{fn();}catch(_){} } };
  // 音效(命中同步)
  if(fx.sfx) atImpact(()=>EhSfx.play(fx.sfx));
  if(fx.vibrate && navigator.vibrate && !reduce) atImpact(()=>{ try{ navigator.vibrate(fx.vibrate); }catch(_){} });
  // 全屏闪色(命中同步)
  if(fx.flash) atImpact(()=>{ const f=$('#ixFlash'); if(f){ f.style.background=`radial-gradient(circle at 50% 45%, ${safeColor(fx.flash)}66, transparent 72%)`; f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); setTimeout(()=>f.classList.remove('on'),450); } });
  // 全屏抖动(命中同步)
  if(fx.shake && !reduce) atImpact(()=>{ const app=document.querySelector('#app')||document.body; app.classList.remove('ix-shake'); void app.offsetWidth; app.classList.add('ix-shake'); setTimeout(()=>app.classList.remove('ix-shake'),520); });
  // 命中定格顿挫(与 shake 不冲突, 叠加更"实"; 用 body 避免与 shake 抢 #app transform)
  if(fx.zoom && !reduce && !fx.shake) atImpact(()=>{ const z=document.querySelector('#app')||document.body; z.classList.remove('ix-zoom'); void z.offsetWidth; z.classList.add('ix-zoom'); setTimeout(()=>z.classList.remove('ix-zoom'),300); });
  // 全屏对角光带扫过(庆祝/高光, 氛围性即时)
  if(fx.sweep && !reduce){ const s=$('#ixSweep'); if(s){ s.style.setProperty('--ixs-c', safeColor(fx.sweep)); s.innerHTML='<div class="swp"></div>'; s.classList.add('on'); clearTimeout(playInteractionFx._swp); playInteractionFx._swp=setTimeout(()=>{ s.classList.remove('on'); s.innerHTML=''; },1050); } }
  // 飞行物: 从底部中央飞向目标, 命中放大后消散
  if(fx.fly){
    const el=document.createElement('div'); el.className='ix-fly'; el.textContent=fx.fly;
    el.style.left=(window.innerWidth/2-22)+'px'; el.style.top=(window.innerHeight-80)+'px';
    document.body.appendChild(el);
    const dx=tx-window.innerWidth/2, dy=ty-(window.innerHeight-58);
    el.animate([
      {transform:'translate(0,0) scale(.6) rotate(0deg)',opacity:1,offset:0},
      {transform:`translate(${dx*0.7}px,${dy*0.7}px) scale(1) rotate(160deg)`,opacity:1,offset:.6},
      {transform:`translate(${dx}px,${dy}px) scale(1.5) rotate(220deg)`,opacity:1,offset:.82},
      {transform:`translate(${dx}px,${dy}px) scale(.3) rotate(240deg)`,opacity:0,offset:1}
    ],{duration:620,easing:'cubic-bezier(.4,0,.5,1)'}).onfinish=()=>el.remove();
  }
  // 命中冲击波环(打击类, 命中点炸开)
  if(fx.ring && !reduce) atImpact(()=>ixRingBurst(tx,ty,safeColor(fx.ring)));
  // 命中大字冲击标题(打击/庆祝)
  if(fx.word && !reduce) atImpact(()=>ixImpactWord(fx.word, safeColor(fx.word_c||fx.flash||fx.ring||'#fff')));
  // 命中光环(温情类头像发光, 氛围性即时)
  if(fx.glow){ const g=document.createElement('div'); g.className='ix-glow'; const sz=90; g.style.width=g.style.height=sz+'px'; g.style.left=(tx-sz/2)+'px'; g.style.top=(ty-sz/2)+'px'; g.style.background=`radial-gradient(circle, ${safeColor(fx.glow)}88, transparent 70%)`; document.body.appendChild(g); g.classList.add('on'); setTimeout(()=>g.remove(),1000); }
  // 温情上浮物(命中同步)
  if(fx.float) atImpact(()=>ixFloatUp(fx.float, tx, ty));
  // 粒子撒射(命中同步)
  if(fx.burst) atImpact(()=>{ try{ burst(fx.burst, 24); }catch(_){} });
  // 纸屑雨(全屏从上落下)
  if(fx.rain && !reduce){ const chars=[...(fx.burst||'🎉🎊✨')]; for(let i=0;i<28;i++){ const r=document.createElement('div'); r.className='ix-rain'; r.textContent=chars[i%chars.length]; r.style.left=(secureRand()*100)+'vw'; document.body.appendChild(r); const dur=1600+secureRand()*1400; r.animate([{transform:'translateY(0) rotate(0)',opacity:1},{transform:`translateY(${window.innerHeight+60}px) rotate(${secureRand()*720-360}deg)`,opacity:.9}],{duration:dur,easing:'ease-in'}).onfinish=()=>r.remove(); } }
}
// 冲击波环: 命中点炸开的能量环, 双层错时更有层次
function ixRingBurst(tx,ty,color){
  for(let k=0;k<2;k++){
    const ring=document.createElement('div'); ring.className='ix-ring';
    const sz=k===0?120:190; ring.style.width=ring.style.height=sz+'px';
    ring.style.left=(tx-sz/2)+'px'; ring.style.top=(ty-sz/2)+'px';
    ring.style.setProperty('--ixr-c', color);
    document.body.appendChild(ring);
    setTimeout(()=>{ ring.classList.add('on'); }, k*110);
    setTimeout(()=>ring.remove(), 800+k*110);
  }
}
// 命中大字: 全屏中央砸出一个冲击标题
function ixImpactWord(text, color){
  const box=$('#ixWord'); if(!box) return;
  box.innerHTML=`<div class="ixw" style="--ixw-c:${color}">${esc(String(text).slice(0,8))}</div>`;
  const w=box.querySelector('.ixw'); if(w){ void w.offsetWidth; w.classList.add('on'); }
  clearTimeout(ixImpactWord._t); ixImpactWord._t=setTimeout(()=>{ box.innerHTML=''; }, 1000);
}
// 温情上浮物: 从目标处若干 emoji 袅袅升起、左右轻摆、渐隐
function ixFloatUp(str, tx, ty){
  let chars;
  try{ const seg=new Intl.Segmenter('zh',{granularity:'grapheme'}); chars=[...seg.segment(str||'')].map(s=>s.segment); }
  catch(e){ chars=[...(str||'')]; }
  chars=chars.filter(c=>/\p{Emoji}/u.test(c)); if(!chars.length) chars=['✨️'];
  for(let i=0;i<7;i++){
    const el=document.createElement('div'); el.className='ix-float'; el.textContent=rand(chars);
    el.style.left=(tx-14+ (secureRand()*40-20))+'px'; el.style.top=(ty-6)+'px';
    el.style.fontSize=(20+secureRand()*16)+'px';
    document.body.appendChild(el);
    const rise=110+secureRand()*90, sway=(secureRand()*44-22);
    el.animate([
      {transform:'translate(0,0) scale(.5)',opacity:0,offset:0},
      {transform:`translate(${sway*0.4}px,${-rise*0.4}px) scale(1)`,opacity:1,offset:.25},
      {transform:`translate(${sway}px,${-rise}px) scale(1)`,opacity:0,offset:1}
    ],{duration:1300+secureRand()*500,easing:'cubic-bezier(.3,.6,.4,1)',delay:i*55}).onfinish=()=>el.remove();
  }
}

// ============ toast ============
let toastT=null;
function toast(msg){ const t=$('#toast'); if(/失败|错误|不支持|请先|无权限|err|fail/i.test(String(msg||''))){ try{ EhSfx.play('error'); }catch(e){} } t.innerHTML=msg; t.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'),2600); }
// 后端错误 → 友好中文: 只在后端返回的是中文说明时采用它, 否则用 fallback。防原始英文码
// (unauthorized/forbidden/not_found 等)直接弹给用户(见截图)。
function friendlyErr(raw, fallback){ return (raw && /[一-龥]/.test(String(raw))) ? String(raw) : (fallback||'操作失败，请重试'); }
// 赛博风确认弹层，返回 Promise<boolean>，替代原生 confirm()
function ehConfirm(msg, title){
  return new Promise(res=>{
    $('#confirmTitle').textContent = title||'确认操作';
    $('#confirmMsg').textContent = msg;
    $('#confirmMask').classList.add('on');
    try{ EhSfx.play('click'); }catch(e){}   // 弹层出现提示音
    const done=(v)=>{ try{ EhSfx.play(v?'click':'back'); }catch(e){} $('#confirmMask').classList.remove('on'); $('#confirmYes').onclick=null; $('#confirmNo').onclick=null; res(v); };
    $('#confirmYes').onclick=()=>done(true);
    $('#confirmNo').onclick=()=>done(false);
    $('#confirmMask').onclick=(e)=>{ if(e.target===$('#confirmMask')) done(false); };
  });
}

// ============ 离开房间 ============
async function leaveRoom(){
  try{ window.stopMoodWeather && window.stopMoodWeather(); }catch(_){}
  try{ _victim.clear(); _koCooldown.clear(); clearCounter(); _fuse.clear(); if(isStunned()) exitStun(); }catch(_){}   // 连击/合体/眩晕态随离房清零
  // 优化批A#6: 房外不空跑房间态 timer(_sqbTimer 歌曲队列条 2.5s 轮询)
  try{ if(_sqbTimer){ clearInterval(_sqbTimer); _sqbTimer=null; } }catch(_){}
  try{ if(typeof curRoom!=='undefined' && curRoom) window.ehLog && ehLog('room_leave',{room_id:curRoom.id,name:curRoom.name,kind:curRoom.kind}); }catch(_){}
  stopVoice(); stopSong();
  if(recorder && recorder.state!=='inactive'){ recWanted=false; recorder.stop(); } // 录音中离房则丢弃
  // keep-alive: 关订阅前存下已渲染的消息 DOM 快照，快速回同房可秒还原(只留最近1个)
  if(curRoom){
    try{
      // ★ 存快照前先修当前 DOM 里的空框(分批渲染未跑完/打字机中断留下的),
      //   否则快照会把"渲染未完成态"存下来, 回房还原就是空框。用 dataset.text 就地回填。
      const _st=$('#stream');
      _st.querySelectorAll('.msg[data-mid]').forEach(el=>{
        try{
          const kind=el.dataset.kind||'msg';
          if(kind==='voice'||kind==='song'||kind==='proj') return;
          const t=el.querySelector('.txt'); const raw=(el.dataset.text||'').trim();
          if(t && raw && !t.textContent.trim()){ t.textContent=raw; }
        }catch(_){}
      });
      roomSnap={ rid:curRoom.id, html:_st.innerHTML, oldestId, echoState:JSON.parse(JSON.stringify(echoState||{})), at:Date.now() };
      persistRoomSnap();   // 同时持久化到 localStorage, 供下次刷新首帧静态回填
    }catch(e){ roomSnap=null; }
  }
  await leavePresence();
  // 离房清理 presence 相关本地状态，避免旧房头像/typing 快照残留到下一房或长期占内存。
  try{ if(_presDebounce){ clearTimeout(_presDebounce); _presDebounce=null; } }catch(_){ }
  try{ if(_typingLightTimer){ clearTimeout(_typingLightTimer); _typingLightTimer=null; } }catch(_){ }
  try{ presenceMap.clear(); lastUsersSnapshot=[]; }catch(_){ }
  if(msgChan){ sb.removeChannel(msgChan); msgChan=null; }
  if(_tailPollTimer){ clearInterval(_tailPollTimer); _tailPollTimer=null; }   // 离房停兜底轮询
  if(presChan){ await sb.removeChannel(presChan); presChan=null; }
  // 公开房：退出即调用归档函数(最后一人则归档)。私密房/官方房保留成员关系。
  if(curRoom && curRoom.kind==='public'){ await sb.rpc('eh_leave_room',{rid:curRoom.id}); }
  curRoom=null;
  if(curMode!=='none') setMode('none');   // 离开房间退出所有发言模式(虚空/语音/神曲)
  try{ localStorage.removeItem('eh_last_room'); }catch(e){}  // 主动离开→刷新回大厅
}

// ============ 房主设置抽屉 ============
async function openGear(){
  if(!curRoom) return;
  const isOwner = curRoom.role==='owner';
  const isMgr = me && (me.role==='admin' || me.role==='super');   // 管理员/超管
  const isOfficial = curRoom.kind==='official';
  // 可编辑 = 房主, 或 (管理员/超管 且 非官方房)。官方房一律只读。
  const canEdit = !isOfficial && (isOwner || isMgr);
  // 进房时 room 对象不带 topic，这里补拉一次，否则保存会把已有公告清空
  const [{ data:members },{ data:roomRow }] = await Promise.all([
    sb.from('eh_members').select('user_id,name,emoji,color,role').eq('room_id',curRoom.id),
    sb.from('eh_rooms').select('name,topic,emoji').eq('id',curRoom.id).maybeSingle(),
  ]);
  if(roomRow){ if(roomRow.name) curRoom.name=roomRow.name; curRoom.topic=(roomRow.topic!=null?roomRow.topic:'')||''; if(roomRow.emoji) curRoom.emoji=roomRow.emoji; }
  else { /* roomRow 补拉失败: 保留 curRoom 已有 topic, 不清空 */ }
  const body=$('#gearBody');
  const isPriv = curRoom.kind==='private';
  const kindLabel = curRoom.kind==='private'?'私密房':(curRoom.kind==='public'?'公开房':'官方房');
  const roomEmoji = safeEmoji(curRoom.emoji)||'💬';
  // 标题(抽屉头)按权限切: 可编辑"房间设置", 否则"房间信息"
  { const h=$('#gearDrawer .drawer-h h3'); if(h) h.textContent = canEdit ? '房间设置' : '房间信息'; }
  // 概览卡 = 编辑区(合一, 不重复)。可编辑时字段是输入框, 不可编辑时只读展示。
  //   头像(图标)+名字在 hero 行, 公告在下方; 图标点击弹输入(可编辑时)。
  const noticeText = (curRoom.topic && curRoom.topic!=='@wolf') ? esc(curRoom.topic) : '';
  let overview;
  if(canEdit){
    // 可编辑: 图标(点头像编辑)+名字输入 + 公告输入(私密房→狼姐开关) + 保存
    // 公告框(私密房+公开房都有); 私密房额外挂"召唤陪聊灵魂"多选面板
    // 公告框仅公开房显示; 私密房不要公告, 只挂"召唤陪聊灵魂"多选面板
    const topicField = isPriv ? '' : `<label class="fld"><span>公告 / 主题</span><input id="gRoomTopic" maxlength="200" value="${esc((curRoom.topic&&curRoom.topic!=='@wolf')?curRoom.topic:'')}" placeholder="给房间设个公告"></label>`;
    const summonPanel = isPriv
      ? `<div class="summon-panel" id="gSummonPanel">
           <div class="sp-title">✨ 召唤陪聊灵魂</div>
           <div class="summon-grid" id="gSummonGrid">${EH_SUMMONABLES_FALLBACK.map(x=>`
             <div class="summon-item" data-key="${x.key}" data-name="${esc(x.name)}" data-orig="0">
               <span class="si-emoji">${x.emoji}</span>
               <div class="si-nm">叫${esc(x.name)}来陪你 ${esc(x.blurb)}</div>
               <span class="si-check">✓</span>
             </div>`).join('')}</div>
         </div>`
      : '';
    const editExtra = topicField + summonPanel;
    overview = `<div class="dsec dcard room-overview">
      <div class="ro-hero">
        <div class="ro-ic ro-ic-edit" id="gRoomEmojiBtn" style="--room-c:${roomAccentC(curRoom)}" title="点击换图标">${roomEmoji}</div>
        <div class="ro-meta"><input class="ro-nm-edit" id="gRoomName" maxlength="40" value="${esc(curRoom.name)}" placeholder="房间名"><div class="ro-kind">${kindLabel} · ${(members||[]).length} 人</div></div>
      </div>
      <div class="ro-emoji-pick emoji-pick" id="gRoomEmojiPick" style="display:none;margin-top:8px"></div>
      ${editExtra}
      <button class="dbtn" id="gSaveBtn" style="margin-top:10px">保存修改</button>
    </div></div>`;
  } else {
    // 只读: 展示
    overview = `<div class="dsec dcard room-overview">
      <div class="ro-hero"><div class="ro-ic" style="--room-c:${roomAccentC(curRoom)}">${roomEmoji}</div>
        <div class="ro-meta"><div class="ro-nm">${esc(curRoom.name)}</div><div class="ro-kind">${kindLabel} · ${(members||[]).length} 人</div></div></div>
      ${noticeText?`<div class="ro-notice">📢 ${noticeText}</div>`:''}
    </div></div>`;
  }
  // 成员列表: 最多显示 20 个, 超出折叠"还有 N 人"
  const allM=(members||[]); const MAX_SHOW=20;
  const showM=allM.slice(0, MAX_SHOW); const moreN=allM.length-showM.length;
  const memberRows=showM.map(mm=>{
    const isSoulMem = isSoulUser(mm.user_id, mm.name);   // 灵魂: 踢成员没用(worker会按召唤/@wolf重加), 改走召唤面板"请离开"
    let tail;
    if(mm.role==='owner') tail='<span class="mi-role">房主</span>';
    else if(isSoulMem) tail='<span class="mi-role" style="opacity:.7">灵魂</span>';
    else if(isOwner && mm.user_id!==myUid) tail=`<span class="mi-kick" data-uid="${mm.user_id}">踢出</span>`;
    else tail='';
    return `
        <div class="mitem"><div class="mi-av" style="background:${safeColor(mm.color)}22;--ec:${safeColor(mm.color)}">${safeEmoji(mm.emoji) || '👤'}</div>
          <span class="mi-nm">${esc(mm.name)}</span>
          ${tail}
        </div>`;
  }).join('') + (moreN>0?`<div class="mitem-more">…还有 ${moreN} 人</div>`:'');
  body.innerHTML=`
    ${overview}
    <div class="dsec"><div class="dl">成员 (${allM.length})</div>
      <div class="member-list">${memberRows}</div></div>
    ${(isOwner && !isOfficial)?`<div class="dsec"><div class="dl">危险操作</div>
      <div class="dcard"><button class="dbtn danger" id="gDissolveBtn">解散房间</button></div></div>`:''}`;
  applyTextConfig();  // 重新应用文案到引入的动态元素
  // 图标编辑: 点图标块 → 展开 emoji 选择网格(复用建房那套), 点某个即换图标(手机可靠, 不依赖系统 emoji 键盘)
  { const eb=$('#gRoomEmojiBtn'), pk=$('#gRoomEmojiPick');
    if(eb&&pk){
      const cur=(curRoom.emoji||'💬');
      eb.dataset.emoji=cur;   // 当前选中值存 dataset, 保存时读它
      const list=[cur, ...ROOM_EMOJIS.filter(e=>e!==cur)];
      pk.innerHTML=list.map((e,i)=>`<b class="${i===0?'on':''}">${e}</b>`).join('');
      pk.querySelectorAll('b').forEach(b=>b.onclick=()=>{
        const val=b.textContent;
        eb.dataset.emoji=val;
        eb.firstChild.textContent=val;   // 更新 hero 显示
        pk.querySelectorAll('b').forEach(x=>x.classList.toggle('on',x===b));
      });
      eb.onclick=()=>{ pk.style.display = pk.style.display==='none' ? 'grid' : 'none'; };
    }
  }
  // 私密房: 异步加载"召唤陪聊灵魂"多选面板(调 eh-admin-api, 房主可召唤)
  if(isPriv && canEdit){ (async()=>{
    const grid=$('#gSummonGrid');
    if(!grid) return;
    // 骨架已直接显示(EH_SUMMONABLES_FALLBACK), 先给骨架卡片绑点击, 拉回真实态后 renderList 覆盖
    grid.querySelectorAll('.summon-item').forEach(it=>{ it.onclick=()=>{ if(it.classList.contains('busy'))return; it.classList.toggle('on'); }; });
    const API=SB_URL+'/functions/v1/eh-admin-api';
    // ★立即用本地数据渲染(勾选态真相靠 members/soulNameSet, openGear 开头已拉好, 无需等网络)。
    //   不再"await loadRoomSouls + await /soul-summonables 两个往返后才显", 那是慢的根源。
    try{ renderList(EH_SUMMONABLES_FALLBACK.map(x=>({key:x.key,name:x.name,emoji:x.emoji,blurb:x.blurb,on:false}))); }catch(_){}
    // 后台静默校正一次(拿到 token + 端点真实召唤态), 覆盖本地判断; 失败无妨(本地判断已够准)。
    async function loadList(){
      let token='';
      try{ const s=await resolveSession(); token=(s&&s.access_token)||''; }catch(_){}
      if(!token){ try{ const { data:{ session } }=await sb.auth.getSession(); token=session&&session.access_token||''; }catch(_){} }
      window._ehSummonCtx = { grid, API };   // 保存按钮实时取 token(freshToken), 这里不用缓存 token
      try{
        loadRoomSouls(curRoom.id).catch(()=>{});   // 不 await: 光墙/名字兜底后台刷
        const r=await fetch(API+'/soul-summonables?room_id='+encodeURIComponent(curRoom.id),{ headers:{ 'Authorization':'Bearer '+token } });
        const d=await r.json();
        if(r.ok&&d.list){ renderList(d.list); }  // 拿到端点真实态则覆盖(通常和本地一致, 无感)
      }catch(e){}
    }
    // 所有灵魂都可勾选/取消: 勾上=要召唤, 取消已召唤的=要撤销; data-orig 记初始态, 保存时 diff
    function renderList(list){
      grid.style.display='flex';
      // 勾选态真相源(三重兑底, 任一命中即勾): ①后端 x.on ②本房灵魂名 soulNameSet ③房间成员名(最硬, 就是擑起"N人"的那份 members)
      // 前两重依赖 RPC/端点, 会因网络抖动/灵魂漫游uid与召唤key对不上 而 false; members 是 openGear 开头已拉的可靠数据, 灵魂在房就一定在里面 → 根治"成员在房却不勾选"
      const _memNames = new Set((members||[]).map(m=>m && m.name).filter(Boolean));
      const inRoomByName=(nm)=> (typeof soulNameSet!=='undefined' && soulNameSet && soulNameSet.has(nm)) || _memNames.has(nm);
      // data-orig = 该灵魂进面板时是否已在房(1=已召唤)。保存时对比 on 与 orig 决定 召唤/请离开。
      grid.innerHTML=list.map(x=>{ const on = !!x.on || inRoomByName(x.name); return `
        <div class="summon-item ${on?'on':''}" data-key="${x.key}" data-name="${esc(x.name)}" data-orig="${on?'1':'0'}">

          <span class="si-emoji">${x.emoji}</span>
          <div class="si-nm">叫${esc(x.name)}来陪你 ${esc(x.blurb||'')}</div>
          <span class="si-check">✓</span>
        </div>`; }).join('');
      grid.querySelectorAll('.summon-item').forEach(it=>{
        it.onclick=()=>{ if(it.classList.contains('busy'))return; it.classList.toggle('on'); };

      });
    }
    // 暴露给保存按钮(token 由保存时 freshToken 实时取, 不缓存)
    window._ehSummonCtx = { grid, API };
    loadList();   // 后台静默校正(不阻塞已即时渲染的面板)
  })(); }
  // 以下管理操作仅房主有(普通用户无这些元素, 加空判防报错)
  const _saveBtn=$('#gSaveBtn'); if(_saveBtn) _saveBtn.onclick=async()=>{
    const name=$('#gRoomName').value.trim();
    if(!name){ toast(EH_CONFIG.text.err_roomNameEmpty); return; }
    // 私密房: 提交召唤(勾选且原本不在)/请离开(取消勾选且原本在), 成功后再存房间信息
    if(isPriv && window._ehSummonCtx){
      const { grid:_sg, API:_sapi } = window._ehSummonCtx;
      // 实时取最新有效 token: 优先 resolveSession(统一解析, 带兜底重读, 会自动刷过期 token);
      // 再退 getSession, 再退 localStorage 直读。任一拿到即可。
      async function freshToken(){
        try{ const s=await resolveSession(); if(s?.access_token) return s.access_token; }catch(_){}
        try{ const { data:{ session:_ss } }=await withTimeout(sb.auth.getSession(), 6000, { data:{ session:null } }); if(_ss?.access_token) return _ss.access_token; }catch(_){}
        try{ const _raw=JSON.parse(localStorage.getItem('sb-cddkniwbhvcbfgkgomtl-auth-token')||'null'); if(_raw?.access_token) return _raw.access_token; if(_raw?.currentSession?.access_token) return _raw.currentSession.access_token; }catch(_){}
        return '';
      }
      let _stk=await freshToken();
      if(!_stk){ toast('登录状态失效, 请下拉刷新页面后重试'); _saveBtn.disabled=false; _saveBtn.textContent='保存修改'; return; }
      // diff: 勾了但初始没召唤=要召唤(on:true); 取消了但初始已召唤=要撤销(on:false)
      const _items=[..._sg.querySelectorAll('.summon-item')];
      const _changes=_items.filter(it=>{ const on=it.classList.contains('on')?1:0; const orig=it.dataset.orig==='1'?1:0; return on!==orig; })
                           .map(it=>({ it, key:it.dataset.key, on:it.classList.contains('on'), nm:it.dataset.name||it.dataset.key }));
      if(_changes.length){
        _saveBtn.disabled=true; _saveBtn.textContent='处理中…';
        const _fails=[];   // 收集失败项, 最后统一一条友好提示(不再逐条弹原始错误码)
        const _callSummon=(tok,ch)=>{ try{ _ehDbg('[summon] key=', ch&&ch.key, 'on=', ch&&ch.on, 'rid=', curRoom&&curRoom.id); }catch(_){} return fetch(_sapi+'/soul-summon',{ method:'POST', headers:{ 'Authorization':'Bearer '+tok, 'Content-Type':'application/json' }, body:JSON.stringify({ room_id:curRoom.id, key:ch.key, on:ch.on }) }); };
        for(const ch of _changes){
          ch.it.classList.add('busy');
          try{
            let r=await _callSummon(_stk, ch);
            // 401/403: token 可能刚过期 → 刷新一次 token 重试(而非直接判"登录失效")
            if(r.status===401||r.status===403){ const nt=await freshToken(); if(nt && nt!==_stk){ _stk=nt; r=await _callSummon(_stk, ch); } }
            const d=await r.json().catch(()=>({}));
            if(r.ok&&(d.ok||d.note)){ ch.it.dataset.orig=ch.on?'1':'0'; try{ window.ehLog && ehLog('soul_summon',{room_id:curRoom.id,key:ch.key,on:ch.on}); }catch(_){} }
            else{ _fails.push({nm:ch.nm, on:ch.on, code:r.status, msg:(d&&d.error)||''}); ch.it.classList.toggle('on'); }
          }catch(e){ _fails.push({nm:ch.nm, on:ch.on, code:'net'}); ch.it.classList.toggle('on'); }
          ch.it.classList.remove('busy');
        }
        _saveBtn.disabled=false; _saveBtn.textContent='保存修改';
        // 前端立刻重拉本房灵魂名单 + 刷光墙(召唤即时显现; 撤销即时消失)
        try{ soulsCache[curRoom.id]=null; }catch(_){}
        loadRoomSouls(curRoom.id).catch(()=>{});
        refreshPresence().catch(()=>{});
        // 统一一条提示: 只显示"中文友好话"。后端原始英文码(unauthorized/forbidden等)一律翻译,
        // 绝不把原始码弹给用户(见截图 "unauthorized")。仅当后端返回的是中文说明才直接采用。
        if(_fails.length){
          const f=_fails[0];
          const zhMsg = (f.msg && /[一-龥]/.test(f.msg)) ? f.msg : '';   // 后端返回含中文才信
          if(zhMsg){ toast(zhMsg); }
          else if(f.code===401){ toast('登录状态失效, 请下拉刷新页面后重试'); }
          else if(f.code===403){ toast('没有权限召唤(需房主/超管)'); }
          else if(_fails.length>1){ toast('部分灵魂操作失败，请重试'); }
          else{ toast((f.on?'召唤 ':'请走 ')+f.nm+(f.code===404?' 失败：后端暂不支持':'失败，请重试')); }
        }else{
          const _sum=_changes.filter(c=>c.on).length, _rem=_changes.filter(c=>!c.on).length;
          toast(_sum&&_rem?'已更新陪聊灵魂~':_sum?'已召唤，稍等她/他进房~':'已请走~');
        }
        // 召唤/请离开已单独给出结果提示 → 收起抽屉, 不再落到下面的房间信息保存(那会再弹一条"已保存")
        // 但房名/图标可能也改了, 仍需存: 静默存(不再 toast), 存完关抽屉。
        const _nm2=$('#gRoomName').value.trim()||curRoom.name;
        const _eb2=$('#gRoomEmojiBtn'); const _emoji2=((_eb2&&_eb2.dataset.emoji)||'').trim().slice(0,8)||curRoom.emoji;
        if(_nm2!==curRoom.name || _emoji2!==curRoom.emoji){
          await sb.from('eh_rooms').update({name:_nm2,emoji:_emoji2}).eq('id',curRoom.id).then(()=>{
            curRoom.name=_nm2; curRoom.emoji=_emoji2;
            { const _hi=$('#hallIcon'); if(_hi) _hi.textContent=safeEmoji(curRoom.emoji)||'💬'; }
            $('#hallNameTxt').innerHTML=esc(_nm2);
          }).catch(()=>{});
        }
        closeGear(); return;
      }
    }
    // 公告: 仅公开房有; 私密房不写 topic(不显示公告, 也不覆盖 DB 原值)
    const _topicEl=$('#gRoomTopic');
    const topic = _topicEl ? (_topicEl.value||'').trim() : null;   // null = 不更新该字段
    const _eb=$('#gRoomEmojiBtn'); const emoji = ((_eb&&_eb.dataset.emoji)||'').trim().slice(0,8) || curRoom.emoji;
    const _preName=curRoom.name, _preTopic=curRoom.topic, _preEmoji=curRoom.emoji;
    const _upd = (topic===null) ? {name,emoji} : {name,topic,emoji};
    const { error }=await sb.from('eh_rooms').update(_upd).eq('id',curRoom.id);
    if(!error){ try{ window.ehLog && ehLog('room_update',{room_id:curRoom.id,before:{name:_preName,topic:_preTopic,emoji:_preEmoji},after:_upd}); }catch(_){} }
    if(error){ toast(EH_CONFIG.text.err_saveFail); return; }
    curRoom.name=name; if(topic!==null) curRoom.topic=topic; curRoom.emoji=emoji;
    { const _hi=$('#hallIcon'); if(_hi) _hi.textContent=safeEmoji(curRoom.emoji)||'💬'; }
    $('#hallNameTxt').innerHTML=esc(name);
    toast(EH_CONFIG.text.ok_saved); closeGear();
  };
  body.querySelectorAll('.mi-kick').forEach(el=>el.onclick=async()=>{
    if(!await ehConfirm('确定踢出该成员？','踢出成员')) return;
    const _kickUid=el.dataset.uid;
    // 乐观即时反馈: 先把该成员行从抽屉里抹掉, 别等网络往返
    const _row=el.closest('.mitem'); if(_row) _row.style.opacity='0.4';
    // ①删成员 ②删他的在线心跳(否则他还挂在光墙上直到窗口过期, 看着"踢了没用")
    const [d1,d2]=await Promise.all([
      sb.from('eh_members').delete().eq('room_id',curRoom.id).eq('user_id',_kickUid),
      sb.from('eh_presence').delete().eq('room_id',curRoom.id).eq('user_id',_kickUid),
    ]);
    if(d1&&d1.error){ if(_row) _row.style.opacity=''; toast('踢出失败'); return; }
    try{ window.ehLog && ehLog('member_kick',{room_id:curRoom.id,target_uid:_kickUid}); }catch(_){}
    // 立即从本地光墙移除该头像 + 刷新在线(不靠对方心跳过期)
    try{ const pel=presenceMap.get(_kickUid); if(pel){ pel.remove(); presenceMap.delete(_kickUid); } }catch(_){}
    refreshPresence().catch(()=>{});
    toast(EH_CONFIG.text.ok_kicked); openGear();
  });
  const _disBtn=$('#gDissolveBtn'); if(_disBtn) _disBtn.onclick=async()=>{
    if(!await ehConfirm('解散后房间和消息将从前台消失，确定？','解散房间')) return;
    try{ window.ehLog && ehLog('room_dissolve',{room_id:curRoom.id,name:curRoom.name,kind:curRoom.kind}); }catch(_){}
    const _rid = curRoom.id;
    await sb.from('eh_rooms').delete().eq('id',_rid);
    // 🔴 解散后列表不自动刷新 bug 修复: backToLobby 走 soft 刷新(DOM 有卡片就直接 return 不重拉数据)→解散的旧卡片会留在页面上。两手兜底:
    // 1) 先从 DOM 直接移除这张卡片(官方/公开/私密三个区域都可能在) → 瞬时确保不再看到
    // 2) 清掉预取缓存 + 个人空间房间缓存, 免得下次回迷你空间又看到旧房
    try{ document.querySelectorAll(`.ch[data-rid="${_rid}"], .rm[data-rid="${_rid}"]`).forEach(el=>el.remove()); }catch(_){}
    try{ if(prefetchCache&&prefetchCache[_rid]) delete prefetchCache[_rid]; }catch(_){}
    try{ if(_meCache&&_meCache.rooms){ _meCache.rooms=_meCache.rooms.filter(r=>r&&r.id!==_rid); saveMeCache(); } }catch(_){}
    toast(EH_CONFIG.text.ok_roomDissolved); closeGear(); backToLobby();
    // 3) 回到大厅后再硬刷新一次列表, 同步服务端删除后的真实数据(不依赖 soft 时 DOM 已移除的副作用)
    setTimeout(()=>{ try{ if($('#lobby')&&$('#lobby').classList.contains('on')) renderLobby(false); }catch(_){} }, 60);
  };
  $('#gearMask').classList.add('on'); $('#gearDrawer').classList.add('on'); { const g=$('#gearBtn'); if(g) g.classList.add('active'); } ehArm();
}
function closeGear(){ try{ if($('#gearMask').classList.contains('on')) EhSfx.play('back'); }catch(e){} $('#gearMask').classList.remove('on'); $('#gearDrawer').classList.remove('on'); { const g=$('#gearBtn'); if(g) g.classList.remove('active'); } }

// ============ 个人空间抽屉 ============
// 缓存持久化: 首页/列表页秒显靠的是"缓存先显+后台刷新"。个人空间同理——把上次查到的
// 房间/发言存 localStorage, 下次打开(哪怕刷新过页面)先秒显旧数据, 再后台刷新覆盖,
// 不再对着"加载中…"干等一个网络往返。
const LS_ME_CACHE='eh_me_cache_v2';   // v1→v2: 强制丢弃旧消息顺序缓存, 修复 03:52 时间重排后旧客户端仍看到旧顺序的问题
let _meCache = (function(){
  try{
    // 主动清理旧版本缓存, 避免 localStorage 堆积
    localStorage.removeItem('eh_me_cache_v1');
    const c=JSON.parse(localStorage.getItem(LS_ME_CACHE)||'null');
    if(c&&typeof c==='object') return {rooms:c.rooms||null, msgs:c.msgs||null, at:c.at||0};
  }catch(e){}
  return { rooms:null, msgs:null, at:0 };
})();
function saveMeCache(){ try{ _meCache.at=Date.now(); localStorage.setItem(LS_ME_CACHE, JSON.stringify({rooms:_meCache.rooms, msgs:_meCache.msgs, at:_meCache.at})); }catch(e){} }
// ★缓存重建铁律: 后台删了 DB 消息(如违禁信息)后, 客户端本地缓存/内存快照还留着旧数据,
//   用户回房/秒显仍会看到已删内容。后台在 eh_config.tuning.cachePurgeAt 写一个新时间戳(ms),
//   客户端启动 loadRemoteConfig 后对比: 若 purge 戳 > 本地缓存写入时间 → 强制丢弃所有缓存重建。
let _cachePurged=false;
function purgeClientCaches(reason){
  try{ localStorage.removeItem(LS_ME_CACHE); }catch(_){}
  _meCache={ rooms:null, msgs:null, at:0 };
  try{ roomSnap=null; }catch(_){}
  try{ Object.keys(prefetchCache).forEach(k=>delete prefetchCache[k]); }catch(_){}
  _cachePurged=true;
  _ehDbg('[EH] client caches purged:', reason||'');
}
function checkCachePurge(){
  try{
    const purgeAt = +(EH_CONFIG.tuning && EH_CONFIG.tuning.cachePurgeAt || 0);
    if(!purgeAt) return;
    const localAt = _meCache.at || 0;
    // 本地缓存比服务端 purge 戳旧(或本地无戳) → 说明后台在本地缓存之后删过数据, 重建
    if(purgeAt > localAt){ purgeClientCaches('cachePurgeAt='+purgeAt+' > localAt='+localAt); }
  }catch(_){}
}
async function openMe(){
  const body=$('#meBody');
  if(!me){ if(typeof loadOrRollIdentity==='function') loadOrRollIdentity(); if(!me) return; }
  const isBound = !!(me && me.registered);
  const isSuper = me && me.role==='super';
  const isAdmin = me && (me.role==='super' || me.role==='admin');   // 超管/管理员都可进后台
  const acctKnown = me.email !== undefined; // email/username 已缓存过
  const realEmail = me.email || '';
  const username = me.username || '';
  // 顶部个人卡: 大头像 + 昵称 + (@用户名 · 状态徽章)
  // 管理员/超级管理员的徽章包成链接, 新窗口打开管理后台(不改徽章样式, a 继承外观)
  // 徽章文案统一读后台可配的 tierName(vip 优先: 命中贵宾名单则显"贵宾", 否则按 super/admin/reg/anon)
  const myTier = userTier();
  const roleLabel = isSuper ? tierName('super') : (me && me.role==='admin' ? tierName('admin') : '');
  const badge = isAdmin ? `<a class="mh-badge ${isSuper?'super':'admin'} mh-admin-link" href="admin.html" target="_blank" rel="noopener" title="进入管理后台">${esc(roleLabel)}</a>`
    : customTierDef(myTier) ? `<span class="mh-badge super">${esc(tierName(myTier))}</span>`
    : isBound ? `<span class="mh-badge reg">${esc(tierName('reg'))}</span>`
    : `<span class="mh-badge anon">${esc(tierName('anon'))}</span>`;
  const c=safeColor(me.color);
  // @用户名 取昵称色(与大昵称同色, 更好看), 加轻微辉光; 徽章/分隔符仍用默认灰
  const subLine = isBound
    ? `${username?`<span style="color:${c};font-weight:600;text-shadow:0 0 8px color-mix(in srgb,${c} 35%,transparent)">@${esc(username)}</span> · `:''}${badge}`
    : `无需注册 · ${badge}`;
  const roomsN = _meCache.rooms ? _meCache.rooms.length : null;
  const msgsN  = _meCache.msgs  ? _meCache.msgs.length  : null;
  body.innerHTML=`
    <div class="me-hero">
      <div class="mh-av" style="--mh-c:${c}">${safeEmoji(me.emoji)}</div>
      <div class="mh-name" style="color:${c}">${esc(me.name)}</div>
      <div class="mh-sub">${subLine}</div>
      <div class="me-btns">
        <button class="dbtn" id="meReroll">${isBound?'✎ 编辑资料':'↻ 换个身份'}</button>
        ${isBound?'<button class="dbtn" id="meEmail">✉️ 邮箱</button>':'<button class="dbtn" id="meReg">✨ 注册</button>'}
      </div>
    </div>
    <div class="dsec"><div class="dl" id="meRoomsLabel">我的房间${roomsN!=null?`<span class="dl-n" id="meRoomsN">${roomsN}</span>`:''}<span class="dl-refresh" id="meRoomsRefresh" title="刷新">↻</span></div>
      <div class="mlist" id="meRoomsList">${_meCache.rooms?renderMyRoomList(_meCache.rooms):'<div class="empty-hint">加载中…</div>'}</div></div>
    <div class="dsec"><div class="dl" id="meMsgsLabel">最近发言${msgsN!=null?`<span class="dl-n" id="meMsgsN">${msgsN}</span>`:''}<span class="dl-refresh" id="meMsgsRefresh" title="刷新">↻</span></div>
      <div class="dcard" style="max-height:180px;overflow-y:auto" id="meMsgsList">${_meCache.msgs?renderMyMsgList(_meCache.msgs):'<div class="empty-hint">加载中…</div>'}</div></div>
    <button class="dbtn danger" id="meLogout" style="width:100%">${isBound?'退出登录':'退出 / 换个身份'}</button>
    <div class="note" style="font-size:11px;color:var(--dim);margin-top:8px;line-height:1.6;text-align:center">${isBound?'退出后聊天记录仍与账号关联，重新登录即可找回。':'退出会清除本设备的临时身份（消息仍留存）。'}</div>`;
  $('#meMask').classList.add('on'); $('#meDrawer').classList.add('on'); ehArm();
  $('#meBtn')&&$('#meBtn').classList.add('active'); $('#meBtnHall')&&$('#meBtnHall').classList.add('active');
  bindMeActions(isBound);
  // ↻ 按钮点击 → 强制刷新对应区域(用户主动)
  $('#meMsgsRefresh')&&($('#meMsgsRefresh').onclick=()=>refreshMeData('msgs',isBound,acctKnown));
  $('#meRoomsRefresh')&&($('#meRoomsRefresh').onclick=()=>refreshMeData('rooms',isBound,acctKnown));
  // 首次打开自动刷一次(即使有缓存, 也无条件覆盖为最新)
  refreshMeData('all',isBound,acctKnown);
}
// 抽出的刷新函数, ↻ 按钮和 openMe 复用. scope: 'all'|'msgs'|'rooms'
async function refreshMeData(scope, isBound, acctKnown){
  if(!myUid){ $('#meRoomsList').innerHTML='<div class="empty-hint">身份加载中，请稍后重开</div>'; $('#meMsgsList').innerHTML='<div class="empty-hint">—</div>'; return; }
  const wantMsgs = scope==='all'||scope==='msgs';
  const wantRooms = scope==='all'||scope==='rooms';
  // 转圈提示
  if(wantMsgs) $('#meMsgsRefresh')?.classList.add('spinning');
  if(wantRooms) $('#meRoomsRefresh')?.classList.add('spinning');
  const tasks=[];
  if(wantMsgs) tasks.push(sb.from('eh_messages').select('text,created_at,kind').eq('user_id',myUid).neq('kind','enter').order('id',{ascending:false}).limit(20));   // enter=进场特效, 非发言内容, 不进"最近发言"
  else tasks.push(Promise.resolve(null));
  if(wantRooms) tasks.push(sb.from('eh_members').select('room_id,role,eh_rooms(name,emoji,kind)').eq('user_id',myUid).limit(50));
  else tasks.push(Promise.resolve(null));
  if(scope==='all' && isBound && !acctKnown) tasks.push(sb.from('eh_accounts').select('username,email,role,email_verified').eq('auth_uid',myUid).maybeSingle());
  let msgsRes,roomsRes,accRes;
  try{ [msgsRes,roomsRes,accRes] = await Promise.all(tasks); }
  catch(e){
    console.warn('refreshMeData',e);
    if(wantMsgs) $('#meMsgsList').innerHTML='<div class="empty-hint">加载失败，点↻重试</div>';
    if(wantRooms) $('#meRoomsList').innerHTML='<div class="empty-hint">加载失败，点↻重试</div>';
    $('#meMsgsRefresh')?.classList.remove('spinning');
    $('#meRoomsRefresh')?.classList.remove('spinning');
    return;
  }
  if(msgsRes?.error) console.warn('msgs',msgsRes.error);
  if(roomsRes?.error) console.warn('rooms',roomsRes.error);
  const setN=(sel,label,n)=>{ let e=$(sel); if(!e){ const dl=$(label); if(dl){ e=document.createElement('span'); e.className='dl-n'; e.id=sel.slice(1); dl.appendChild(e); } } if(e) e.textContent=n; };
  if(wantMsgs && msgsRes){
    const myMsgs=msgsRes?.data||[]; _meCache.msgs=myMsgs; saveMeCache();
    setN('#meMsgsN','#meMsgsLabel',myMsgs.length);
    $('#meMsgsList').innerHTML=renderMyMsgList(myMsgs);
  }
  if(wantRooms && roomsRes){
    const myRooms=roomsRes?.data||[]; _meCache.rooms=myRooms; saveMeCache();
    setN('#meRoomsN','#meRoomsLabel',myRooms.length);
    $('#meRoomsList').innerHTML=renderMyRoomList(myRooms); bindMyRoomClicks();
  }
  // 账号信息首次读到后缓存
  if(scope==='all' && isBound && !acctKnown && accRes){ me.username=accRes.data?.username||''; me.email=accRes.data?.email||''; me.role=accRes.data?.role||'user'; me.emailVerified=!!accRes.data?.email_verified; saveIdentity();
    const _t2=userTier(); const badge2 = me.role==='super' ? `<span class="mh-badge super">${esc(tierName('super'))}</span>` : (me.role==='admin' ? `<span class="mh-badge admin">${esc(tierName('admin'))}</span>` : (customTierDef(_t2)?`<span class="mh-badge super">${esc(tierName(_t2))}</span>`:`<span class="mh-badge reg">${esc(tierName('reg'))}</span>`));
    if($('.mh-sub')){ const _c=safeColor(me.color); $('.mh-sub').innerHTML=`${me.username?`<span style="color:${_c};font-weight:600;text-shadow:0 0 8px color-mix(in srgb,${_c} 35%,transparent)">@${esc(me.username)}</span> · `:''}${badge2}`; }
  }
  // 停止转圈, 至少显示 300ms 让用户看到反馈
  setTimeout(()=>{ $('#meMsgsRefresh')?.classList.remove('spinning'); $('#meRoomsRefresh')?.classList.remove('spinning'); }, 300);
}
// 列表渲染 helper(供首屏缓存 + 刷新复用)
function renderMyRoomList(rooms){
  return (rooms||[]).map(r=>{const rm=r.eh_rooms||{};return `
    <div class="mitem mitem-go" data-rid="${r.room_id}" data-nm="${esc(rm.name||'')}" data-em="${safeEmoji(rm.emoji)||'🔒'}" data-kind="${rm.kind||'public'}">
    <div class="mi-av">${safeEmoji(rm.emoji)||'🔒'}</div><span class="mi-nm">${esc(rm.name||'—')}</span>
    ${r.role==='owner'?'<span class="mi-role">房主</span>':''}</div>`;}).join('')||'<div class="empty-hint">还没加入任何房间</div>';
}
// 绑定"我的房间"列表点击进房
function bindMyRoomClicks(){
  document.querySelectorAll('#meRoomsList .mitem-go').forEach(el=>el.onclick=()=>{
    closeMe(); enterRoom({id:el.dataset.rid,name:el.dataset.nm,emoji:el.dataset.em,kind:el.dataset.kind});
  });
}
function renderMyMsgList(msgs){
  return (msgs||[]).map(m=>`<div class="drow"><span class="dv" style="text-align:left">${esc(msgPreview(m))}</span><span class="dk" style="min-width:auto;font-size:10px">${fmtTime(m.created_at)}</span></div>`).join('')||'<div class="empty-hint">还没发过消息</div>';
}
// 绑定个人空间的按钮动作(reroll/注册/邮箱/登出)
function bindMeActions(isBound){
  $('#meReroll').onclick=async()=>{
    if(me.registered){ closeMe(); openProfileEditor(); return; }
    rollIdentity(); sb.from('eh_users').update({name:me.name,emoji:me.emoji,color:me.color}).eq('id',myUid); toast(EH_CONFIG.text.ok_profileUpdated); closeMe();
  };
  $('#meLogout').onclick=()=>logoutIdentity(isBound);
  bindMeReg(); bindMeEmail();
}
function bindMeReg(){ const b=$('#meReg'); if(b) b.onclick=()=>{ closeMe(); openModal('mReg'); }; }
function bindMeEmail(){
  const b=$('#meEmail'); if(!b) return;
  b.onclick=()=>{ const realEmail=me.email||''; closeMe(); openModal('mEmail'); setTimeout(()=>{
    const has=!!realEmail;
    $('#curEmailRow').style.display = has?'block':'none';
    if(has) $('#curEmail').value=realEmail;
    $('#newEmailLabel').textContent = has?'新邮箱':'邮箱';
    renderEmailVerifyUI();
  },50); };
}
// 邮箱验证状态 UI: 徽章 + 发送验证按钮(有邮箱且未验证时显示)
function renderEmailVerifyUI(){
  const has=!!(me.email);
  const verified=!!me.emailVerified;
  const badge=$('#emailVerifyBadge'), row=$('#verifyRow'), hint=$('#verifyHint');
  if(!badge||!row) return;
  if(!has){ badge.innerHTML=''; row.style.display='none'; return; }
  badge.innerHTML = verified ? '<span class="vbadge ok">✓ 已验证</span>' : '<span class="vbadge no">未验证</span>';
  row.style.display = verified ? 'none' : 'block';
  if(hint) hint.textContent='';
  const sb2=$('#sendVerifyBtn'); if(sb2){ sb2.disabled=false; sb2.textContent='✉️ 发送验证邮件'; }
}
// 发送邮箱验证: 调 eh-auth /send-verify。SMTP 未配时后端降级返回验证链接, 前台直接给本人点。
async function sendVerifyEmail(){
  const btn=$('#sendVerifyBtn'); if(!btn) return;
  btn.disabled=true; btn.textContent='发送中…';
  const { data:{ session } }=await sb.auth.getSession();
  if(!session){ btn.disabled=false; btn.textContent='✉️ 发送验证邮件'; toast(EH_CONFIG.text.warn_needLogin); return; }
  const r=await fetch(EH_AUTH_FN+'/send-verify',{ method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token}, body:JSON.stringify({origin:location.origin+location.pathname.replace(/\/[^/]*$/,'')}) });
  const j=await r.json().catch(()=>({}));
  if(!r.ok || !j.ok){ btn.disabled=false; btn.textContent='✉️ 发送验证邮件'; $('#verifyHint').textContent=friendlyErr(j.error,'发送失败'); return; }
  if(j.already){ me.emailVerified=true; saveIdentity(); renderEmailVerifyUI(); toast(EH_CONFIG.text.ok_emailAlready); return; }
  // SMTP 未配: sent=false, 后端返回验证链接。给本人一个可点的链接(过渡方案)。
  if(j.sent===false && j.link){
    btn.style.display='none';
    $('#verifyHint').innerHTML='邮件投递暂未开通，先用下面的链接完成验证（同一浏览器打开即可）：<br><a href="'+j.link+'" style="color:var(--cyan);word-break:break-all">点此立即验证 →</a>';
  } else {
    btn.textContent='✓ 已发送';
    $('#verifyHint').textContent='验证邮件已发送到 '+(j.email||me.email)+'，请查收并点击链接。';
  }
}
// 邮箱首次读到后, 重渲染 meRegSlot(从"读取中"变成真实态)
// 退出/切换身份：登出 Supabase + 清本地身份 → 回入场页
async function logoutIdentity(bound){
  if(!await ehConfirm(bound?'确定退出登录？':'确定退出并换一个新身份？', bound?'退出登录':'切换身份')) return;
  clearLastRoom();   // ★ 同步先清: 不在房间里登出(curRoom=null)时 leaveRoom 会被跳过, 避免 eh_last_room 残留 → 换账号后进错房
  try{ if(curRoom) await leaveRoom(); }catch(e){}
  try{ await unsubscribeWorld(); }catch(e){}
  try{ await sb.auth.signOut(); }catch(e){}
  try{ localStorage.removeItem(LS_ID); }catch(e){}
  myUid=null; me=null;
  _myBottles={};   // 换身份清掉旧瓶引用: 新 uid 不该继承前一个身份丢的瓶(回信不属于它)
  _meCache={ rooms:null, msgs:null };   // 清个人空间缓存, 换身份后不残留旧数据
  try{ localStorage.removeItem(LS_ME_CACHE); }catch(e){}   // 连持久化缓存一起清, 否则新身份秒显旧数据
  closeMe();
  // 清空登录框 + 收起, 退出后不残留账密(改为点击时才拉取)
  const la=$('#loginAccount'), lp=$('#loginPassword'), lc=$('#loginCollapse');
  if(la){ la.value=''; la.readOnly=true; } if(lp){ lp.value=''; lp.readOnly=true; }  // 退出后清空并重新上锁, 恢复"未交互不调起凭据"初始态
  if(lc){ lc.classList.remove('on'); const sp=$('#loginToggle')?.querySelector('span'); if(sp) sp.textContent='已有账号？点此登录 ▾'; }
  _autoLoginFired=false;
  try{ navigator.credentials && navigator.credentials.preventSilentAccess && navigator.credentials.preventSilentAccess(); }catch(e){}
  // 重新生成一个身份并回到入场页
  loadOrRollIdentity(); paintIdentity();
  goScene('enter');
  toast(bound?'已退出登录':'已换新身份');
}
function closeMe(){ try{ if($('#meMask').classList.contains('on')) EhSfx.play('back'); }catch(e){} $('#meMask').classList.remove('on'); $('#meDrawer').classList.remove('on'); $('#meBtn')&&$('#meBtn').classList.remove('active'); $('#meBtnHall')&&$('#meBtnHall').classList.remove('active'); }

// ============ 返回大厅 ============
function backToLobby(){ try{ EhSfx.play('back'); }catch(e){}
  try{ document.body.classList.remove('priv-heat'); }catch(_){}   // 离房去掉暧昧红氛围
  // 【房间→首页 BGM 弹层缓存失效 07-28 03:08】roomKey 变了但弹层 DOM 御缓存仍携旧房间数据→
  //   下次开菜单官方组虽能因 _roomKey!==roomKey 重抽，但灵魂组只看 _soulLen/_nSoul 会长度巧合复用旧抽样
  //   → 主动清两个弹层缓存，强制下次重新抽
  try{ var _mLb=document.getElementById('bgmMenu'); if(_mLb) _mLb._bgmPickCache=null; }catch(_){}
  try{ var _mHall=document.getElementById('bgmMenuHall'); if(_mHall) _mHall._bgmPickCache=null; }catch(_){}
  // 丝滑续播: 不打断当前房 BGM, 只切成大厅随机连播模式——当前曲放完后随机连播任意房间 BGM
  try{ AudioEngine.toChainAfter(bgmPool()); }catch(_){}
  applyTheme(sceneOrDefaultTheme());  // 离房恢复全局主题(未锁主题时叠加深夜/节日场景皮肤)
  clearLastRoom();   // ★ 同步立即清标记: 用户明确返回大厅 → 即使立即刷新也不再回旧房间(不等异步 leaveRoom)
  // 秒切场景 + soft 刷新(列表 DOM 还在，不清空重建，只后台刷新数据)，不等 DB 清理
  goScene('lobby'); renderLobby(true);
  // 房间清理(删presence/关订阅/归档)后台异步跑，不阻塞返回动作
  leaveRoom().catch(e=>console.warn('leaveRoom', e));
}

// ============ 浏览器返回键接管(关遮罩 → 退房 → 放行) ============
// SPA 场景切换纯靠 class,不接 history → 房间里按返回会直接离开整个页面。
// 思路:维持最多一个 guard 历史占位。按返回(popstate)时消费当前最上层
// (优先关遮罩,其次退房回大厅),只要还有可拦截层就重新武装 guard 吃掉下一次返回;
// 到大厅/入场页无可拦截层则放行(真正离开)。UI 主动关闭会留一个 guard,下次返回被静默吸收(可接受)。
let _navArmed=false;
function ehArm(){ if(_navArmed) return; _navArmed=true; try{ history.pushState({eh:1},''); }catch(e){} }
// 从最上层往下判定"这次返回该关掉谁"
function navTopLayer(){
  // 键盘开着(输入框聚焦)时, 返回键第一优先收键盘 + 输入框失焦 + 复位, 符合安卓习惯(先收键盘再退层)
  if(document.activeElement && document.activeElement.id==='cin') return 'kbd';
  if($('#recOverlay')?.classList.contains('on')) return 'rec';
  if($('#wallMask')?.classList.contains('on')) return 'wall';
  if($('#modalMask')?.classList.contains('on')) return 'modal';
  if($('#meMask')?.classList.contains('on')) return 'me';
  if($('#gearMask')?.classList.contains('on')) return 'gear';
  if($('#plusMenu')?.classList.contains('on')) return 'plus';
  if($('#skinMenu')?.classList.contains('on')||$('#skinMenuHall')?.classList.contains('on')) return 'skin';
  if($('#atMenu')?.classList.contains('on')) return 'at';
  if($('#slashMenu')?.classList.contains('on')) return 'slash';
  if($('#hall')?.classList.contains('on') && curRoom) return 'room';
  return null;
}
function navConsume(layer){
  switch(layer){
    case 'kbd': try{ var _c=$('#cin'); if(_c) _c.blur(); if(window.__ehKbReset) window.__ehKbReset(); }catch(_){} break;
    case 'rec': if(recActive){ recCanceled=true; setRecCancel(true); micRelease(); } break;
    case 'wall': $('#wallMask')?.classList.remove('on'); break;
    case 'modal': closeModal(); break;
    case 'me': closeMe(); break;
    case 'gear': closeGear(); break;
    case 'plus': closePlusMenu(); break;
    case 'skin': $('#skinMenu')?.classList.remove('on'); $('#skinMenuHall')?.classList.remove('on');
                 $('#skinBtn')?.classList.remove('active'); $('#skinBtnHall')?.classList.remove('active'); break;
    case 'at': hideAt(); break;
    case 'slash': hideSlash(); break;
    case 'room': backToLobby(); break;
  }
}
window.addEventListener('popstate', ()=>{
  _navArmed=false;                 // 刚被消费掉的 guard 已出栈
  const layer=navTopLayer();
  if(!layer) return;               // 大厅/入场页无可拦截 → 放行(不再武装)
  navConsume(layer);
  if(navTopLayer()) ehArm();       // 还有下层可拦截(如关了遮罩仍在房间)→ 重新武装
});


const ROOM_EMOJIS=['🔒','🌙','🎧','🍺','☕','🎮','💻','📚','🎨','🔥','🌈','🛸','🐋','🦊','🎭','🕹️'];
let pickedEmoji='🌐', pickedKind='public', createdRoom=null;
function openModal(which){
  $('#modalMask').classList.add('on'); ehArm();
  ['mCreate','mCreated','mJoin','mReg','mReset','mEmail','mProfile'].forEach(id=>$('#'+id).style.display=(id===which?'block':'none'));
  if(which==='mCreate'){
    $('#roomNameIn').value=''; pickedKind='public'; pickedEmoji='🌐';
    $('#kindSeg').querySelectorAll('.opt').forEach(o=>o.classList.toggle('on',o.dataset.kind==='public'));
    renderEmojiPick();
    setTimeout(()=>$('#roomNameIn').focus(),50);
  }
  if(which==='mJoin'){ $('#codeIn').value=''; $('#joinErr').textContent=''; setTimeout(()=>$('#codeIn').focus(),50); }
  if(which==='mReg'){ $('#regUser').value='';$('#regPass').value='';$('#regEmail').value='';$('#regErr').textContent=''; setTimeout(()=>$('#regUser').focus(),50); }
  if(which==='mReset'){ $('#resetEmail').value='';$('#resetErr').textContent=''; setTimeout(()=>$('#resetEmail').focus(),50); }
  if(which==='mEmail'){ $('#newEmail').value='';$('#emailErr').textContent=''; setTimeout(()=>$('#newEmail').focus(),50); }
  if(which==='mProfile'){ $('#profErr').textContent=''; }
}
function renderEmojiPick(){
  const first = pickedKind==='public'?'🌐':'🔒'; pickedEmoji=first;
  const list=[first,...ROOM_EMOJIS.filter(e=>e!==first)];
  $('#roomEmojiPick').innerHTML=list.map((e,i)=>`<b class="${i===0?'on':''}">${e}</b>`).join('');
  $('#roomEmojiPick').querySelectorAll('b').forEach(b=>b.onclick=()=>{ pickedEmoji=b.textContent; $('#roomEmojiPick').querySelectorAll('b').forEach(x=>x.classList.remove('on')); b.classList.add('on'); });
}
function closeModal(){ try{ if($('#modalMask').classList.contains('on')) EhSfx.play('back'); }catch(e){} $('#modalMask').classList.remove('on'); }

// 邀请码 10 位 · 31 字符集 ≈ 50bit 熵，抗枚举暴破(6位仅~30bit不够)
function genCode(){ const CH='ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<10;i++) s+=CH[Math.floor(secureRand()*CH.length)]; return s; }
// 公开房自动介绍: 按房名套一句(长度对齐官方房~10-16字)。房名做哈希选模板, 同名恒定同句, 显得像特意写的。
function autoTopic(name){
  const n=(name||'').trim().slice(0,10);
  const tpl=[
    `关于「${n}」，想说的都能说`,
    `聊聊${n}，看谁懂你`,
    `${n}爱好者的聚集地`,
    `为${n}而来的人，都在这`,
    `${n}，此刻正热闹`,
    `喜欢${n}？进来唠两句`,
    `${n}的一切，都可以聊`,
    `围绕${n}，随便扯`,
  ];
  let h=0; for(let i=0;i<name.length;i++) h=(h*31+name.charCodeAt(i))>>>0;
  return tpl[h%tpl.length];
}
async function createRoom(){
  const name=$('#roomNameIn').value.trim();
  if(!name){ toast(EH_CONFIG.text.warn_needRoomName); return; }
  await ensureAuth();
  const btn=$('#doCreateBtn'); btn.disabled=true; btn.textContent='生成中…';
  let room=null;
  if(pickedKind==='public'){
    const topic=autoTopic(name);   // 公开房没填介绍→按房名自动生成一句(长度参考官方房)
    const { data, error }=await sb.from('eh_rooms').insert({name,emoji:pickedEmoji,kind:'public',owner:myUid,topic}).select('id,name,emoji,topic').single();
    if(!error) room={...data,kind:'public'};
    else { console.warn(error); }
  } else {
    for(let t=0;t<5;t++){ const code=genCode();
      const { data, error }=await sb.from('eh_rooms').insert({name,emoji:pickedEmoji,kind:'private',invite_code:code,owner:myUid}).select('id,name,emoji,invite_code').single();
      if(!error){ room={...data,kind:'private'}; break; }
      if(!/duplicate|unique/i.test(error.message||'')){ console.warn(error); break; }
    }
  }
  btn.disabled=false; btn.textContent='生 成 房 间';
  if(!room){ toast(EH_CONFIG.text.err_createRoom); return; }
  // 房主入成员表
  await sb.from('eh_members').insert({room_id:room.id,user_id:myUid,role:'owner',name:me.name,emoji:me.emoji,color:me.color});
  try{ window.ehLog && ehLog('room_create',{room_id:room.id,name:room.name,kind:room.kind,emoji:room.emoji}); }catch(_){}
  createdRoom=room;
  const wolfHint=$('#wolfHintCreated');
  if(pickedKind==='private'){ $('#codeVal').textContent=room.invite_code; $('#codeBoxWrap').style.display='flex'; $('#createdSub').textContent='把邀请码发给朋友，他们就能进来：'; if(wolfHint) wolfHint.style.display='block'; }
  else { $('#codeBoxWrap').style.display='none'; $('#createdSub').textContent='公开房已上架大厅，谁都能进来聊。'; if(wolfHint) wolfHint.style.display='none'; }
  openModal('mCreated');
}
async function joinByCode(){
  const code=$('#codeIn').value.trim().toUpperCase();
  if(!code){ $('#joinErr').textContent='请输入邀请码'; $('#codeIn').focus(); return; }
  await ensureAuth();
  const btn=$('#doJoinBtn'); btn.disabled=true; btn.textContent='进入中…'; $('#joinErr').textContent='';
  const { data:rooms, error }=await sb.rpc('eh_find_room_by_code',{code});
  const room=Array.isArray(rooms)?rooms[0]:rooms;
  btn.disabled=false; btn.textContent='进 入 房 间';
  if(error || !room){ $('#joinErr').textContent='邀请码无效或房间不存在'; return; }
  // 走带码校验的 SECURITY DEFINER RPC 代插成员(收紧后的 RLS 不允许私密房裸 insert, 必须经此函数验证邀请码)
  const { error:mErr }=await sb.rpc('eh_join_by_code',{p_code:code,p_name:me.name,p_emoji:me.emoji,p_color:me.color});
  if(mErr){ $('#joinErr').textContent='加入失败'; return; }
  closeModal(); enterRoom({id:room.id,name:room.name,emoji:room.emoji,kind:'private'});
}
// ============ 正式账号：注册 / 登录 / 找回 ============
// 登录：账号(用户名或邮箱)+密码。先 resolve 出登录邮箱，再 signInWithPassword。
// 用户名→内部登录邮箱(与后端 eh-auth 的 uname2email 一致): u_<hex(小写用户名)>@eh.local
function unameToEmail(u){
  const bytes=new TextEncoder().encode(u.toLowerCase());
  let hex=''; for(const b of bytes) hex+=b.toString(16).padStart(2,'0');
  return 'u_'+hex+'@eh.local';
}
async function doLogin(){
  const account=$('#loginAccount').value.trim(); const password=$('#loginPassword').value;
  $('#loginErr').textContent='';
  if(!account||!password){ $('#loginErr').textContent='请填写账号和密码'; return; }
  const btn=$('#loginBtn'); btn.disabled=true; btn.textContent='登录中…';
  // 用户名: 本地直接算内部邮箱, 省掉 resolve 往返(提速)。真邮箱: 走 resolve(可能绑过).
  let loginEmail;
  if(/^\S+@\S+\.\S+$/.test(account)){
    const res=await authApi('/resolve',{account});
    loginEmail = res.body?.loginEmail;
    if(!loginEmail){ btn.disabled=false; btn.textContent='登 录'; $('#loginErr').textContent='账号不存在'; return; }
  } else {
    loginEmail = unameToEmail(account);
  }
  const { data:sess, error }=await sb.auth.signInWithPassword({ email:loginEmail, password });
  btn.disabled=false; btn.textContent='登 录';
  if(error){ $('#loginErr').textContent='账号或密码错误'; return; }
  myUid=sess.user.id; resyncMsgOwnership();
  const { data:prof }=await sb.from('eh_users').select('name,emoji,color').eq('id',myUid).maybeSingle();
  me = prof && prof.name
    ? { id:myUid, name:prof.name, emoji:prof.emoji||'🦊', color:prof.color||EH_CONFIG.identityDefaultC, registered:true, username:(/^\S+@\S+\.\S+$/.test(account)?undefined:account) }
    : { id:myUid, name:account, emoji:(me&&me.emoji)||'🦊', color:(me&&me.color)||EH_CONFIG.identityDefaultC, registered:true, username:(/^\S+@\S+\.\S+$/.test(account)?undefined:account) };
  saveIdentity(); paintIdentity();
  saveCredential(account, password);   // 显式交给浏览器密码管理器保存(SPA无页面跳转, 不能只靠自动气泡)
  clearLastRoom();   // ★ 登录成功进大厅: 清掉前一账号可能残留的 eh_last_room, 防刷新进到别人/旧身份的房间
  // ★ 后台引导登录回跳: 从 admin.html 未登录被跳来(带 ?redirect=admin)时, 登录成功后自动回后台。
  //   仅管理员/超管放行回跳(普通用户登录后即使带 redirect 也留在大厅, admin 侧还会再做权限校验兜底)。
  try{
    const _rd=new URLSearchParams(location.search).get('redirect');
    if(_rd==='admin'){
      const { data:acc }=await sb.from('eh_accounts').select('role').eq('auth_uid',myUid).maybeSingle();
      if(acc && (acc.role==='admin'||acc.role==='super')){ location.href='admin.html'; return; }
      // 非管理员: 清掉 redirect 参数留在大厅, 不回跳
      try{ history.replaceState(null,'',location.pathname); }catch(e){}
    }
  }catch(e){ console.warn('[EH] redirect-admin 检查异常', e&&e.message); }
  toast(EH_CONFIG.text.ok_welcomeBack); goScene('lobby'); renderLobby();
}
// SPA 登录成功后主动把凭据交给浏览器保存(Credential Management API)。
// 不依赖"提交后跳转"触发的自动保存气泡——本站登录后靠JS切场景、表单DOM不消失, 那种气泡常不弹。
function saveCredential(id, pw){
  try{
    if(window.PasswordCredential && navigator.credentials && navigator.credentials.store){
      const cred=new window.PasswordCredential({ id, password:pw, name:id });
      navigator.credentials.store(cred).catch(()=>{});
    }
  }catch(e){}
}
// 注册：用户名+密码(+选填邮箱)。当前匿名 uid 一并传入做转正(继承历史)。
async function doRegister(){
  const username=$('#regUser').value.trim(); const password=$('#regPass').value; const email=$('#regEmail').value.trim();
  $('#regErr').textContent='';
  if(username.length<3){ $('#regErr').textContent='用户名至少 3 位'; return; }
  if(password.length<6){ $('#regErr').textContent='密码至少 6 位'; return; }
  const btn=$('#doRegBtn'); btn.disabled=true; btn.textContent='注册中…';
  // 确保有匿名 uid 可继承(把当前匿名身份+历史转正)
  await ensureAuth();
  const res=await authApi('/register',{ username, password, email, anonUid:myUid });
  if(!res.ok || !res.body.ok){ btn.disabled=false; btn.textContent='注 册 并 进 入'; $('#regErr').textContent=friendlyErr(res.body.error,'注册失败'); return; }
  // 转正后用新账号密码登录(刷新 session 为已确认的邮箱账号)
  const { data:sess, error }=await sb.auth.signInWithPassword({ email:res.body.loginEmail, password });
  btn.disabled=false; btn.textContent='注 册 并 进 入';
  if(error){ $('#regErr').textContent='注册成功但登录失败，请回登录页手动登录'; return; }
  myUid=sess.user.id;
  // 用注册的用户名更新前台昵称 + 缓存 username/registered(个人空间首屏直显@用户名)
  me.name=username; me.id=myUid; me.username=username; me.registered=true; me.email=me.email||''; saveIdentity(); paintIdentity();
  saveCredential(username, password);   // 注册即登录, 一并交浏览器保存
  await sb.from('eh_users').update({ name:username, is_anonymous:false }).eq('id',myUid);
  clearLastRoom();   // ★ 新注册账号进大厅: 不应携带“历史房间”, 清掉残留防刷新进错房
  toast(EH_CONFIG.text.ok_regDone); closeModal(); goScene('lobby'); renderLobby();
}
// 找回密码：走后端 /reset-request(按真邮箱找账号→发/给重置链接)。
// 旧实现用 sb.auth.resetPasswordForEmail(真邮箱) 是错的——登录邮箱是 u_hex@eh.local, Supabase 找不到→链接无效。
async function doReset(){
  const email=$('#resetEmail').value.trim();
  if(!/^\S+@\S+\.\S+$/.test(email)){ $('#resetErr').textContent='邮箱格式不对'; return; }
  const btn=$('#doResetBtn'); btn.disabled=true; btn.textContent='发送中…'; $('#resetErr').textContent='';
  let res=null; try{ res=await authApi('/reset-request',{ email, origin:location.origin+location.pathname.replace(/\/[^/]*$/,'/') }); }catch(_){}
  btn.disabled=false; btn.textContent='发 送 重 置 链 接';
  // 无 SMTP: 后端命中账号会直接回 link(降级)。为不泄露邮箱是否注册, 未命中也照常提示。
  if(res && res.body && res.body.link){
    // 直接把重置链接给到本人(当前无邮件通道), 点击即进入"设新密码"页
    closeModal();
    ehResetLinkPrompt(res.body.link);
  }else{
    toast(EH_CONFIG.text.ok_resetSent); closeModal();
  }
}
// 无邮件通道下的降级: 弹出可点的重置链接(仅本人在本设备看得到)
function ehResetLinkPrompt(link){
  try{
    const mask=document.createElement('div'); mask.className='modal-mask reset-mask on';
    mask.innerHTML=`<div class="modal" style="max-width:340px">
      <h2 class="modal-title">重置密码</h2>
      <p class="modal-sub" style="line-height:1.6">当前未开通邮件发送，点下面的按钮直接去设新密码（链接 30 分钟内有效）。</p>
      <a class="btn-primary" style="display:block;text-align:center;text-decoration:none;margin-top:8px" href="${esc(link)}">去设置新密码</a>
      <button class="btn-line" style="margin-top:8px;width:100%">关闭</button>
    </div>`;
    mask.querySelector('.btn-line').onclick=()=>mask.remove();
    mask.onclick=e=>{ if(e.target===mask) mask.remove(); };
    ($('#fx-modal')||document.body).appendChild(mask);
  }catch(_){ toast('重置链接已生成，请在浏览器地址栏打开'); }
}
// URL 带 ?ehreset=<token> → 弹"设新密码"框, 提交走 /reset-confirm
async function handleResetLink(){
  const m=/[?&]ehreset=([a-f0-9]+)/i.exec(location.search||''); if(!m) return;
  const token=m[1];
  // 清掉 URL 上的 token(防泄露/重复)
  try{ const clean=location.pathname+location.search.replace(/([?&])ehreset=[a-f0-9]+/i,'$1').replace(/[?&]$/,'').replace(/\?&/,'?'); history.replaceState(null,'',clean); }catch(_){}
  const mask=document.createElement('div'); mask.className='modal-mask reset-mask on';
  mask.innerHTML=`<div class="modal" style="max-width:340px">
    <h2 class="modal-title">设置新密码</h2>
    <label class="fld"><span>新密码（至少 6 位）</span><input id="rsPw" type="password" autocomplete="new-password" readonly data-noauto placeholder="新密码"></label>
    <div class="err-line" id="rsErr" style="color:var(--magenta);font-size:12px;min-height:16px"></div>
    <button class="btn-primary" id="rsGo" style="width:100%">确认修改</button>
  </div>`;
  ($('#fx-modal')||document.body).appendChild(mask);
  mask.querySelector('#rsGo').onclick=async()=>{
    const pw=mask.querySelector('#rsPw').value;
    if(pw.length<6){ mask.querySelector('#rsErr').textContent='密码至少 6 位'; return; }
    const gg=mask.querySelector('#rsGo'); gg.disabled=true; gg.textContent='提交中…';
    let r=null; try{ r=await authApi('/reset-confirm',{ token, password:pw }); }catch(_){}
    gg.disabled=false; gg.textContent='确认修改';
    if(r && r.body && r.body.ok){
      mask.remove();
      toast('密码已重置，请用新密码登录');
      // ★闭环: 直接把登录框展开、填好用户名、聚焦密码框, 用户输新密码即可登录, 不再"改完没下文"。
      try{ openLoginWith(r.body.username||''); }catch(_){}
    }
    else{ mask.querySelector('#rsErr').textContent=friendlyErr(r&&r.body&&r.body.error,'重置失败，链接可能已过期'); }
  };
}
// 展开登录框 + 预填用户名 + 聚焦密码(找回密码/主动登录复用)。确保在入场页且登录区可见。
function openLoginWith(username){
  try{ if(curRoom){ /* 已在房不打断 */ } else goScene('enter'); }catch(_){}
  const c=$('#loginCollapse'), tgl=$('#loginToggle');
  if(c && !c.classList.contains('on')){
    c.classList.add('on');
    const sp=tgl&&tgl.querySelector('span'); if(sp) sp.textContent='已有账号？收起 ▴';
  }
  const la=$('#loginAccount'), lp=$('#loginPassword');
  if(la){ la.setAttribute('autocomplete','username'); if(username) la.value=username; }
  if(lp){ lp.setAttribute('autocomplete','current-password'); lp.value=''; }
  // 用户名已填好 → 直接聚焦密码框, 让用户输新密码
  setTimeout(()=>{ try{ (username? (lp||la) : la).focus(); }catch(_){} }, 250);
}
// 修改邮箱: 更新 eh_accounts.email(真邮箱, 找回密码用)。不动 auth 登录邮箱(u_hex@eh.local)。
async function changeEmail(){
  const email=$('#newEmail').value.trim();
  if(!/^\S+@\S+\.\S+$/.test(email)){ $('#emailErr').textContent='邮箱格式不对'; return; }
  const btn=$('#doEmailBtn'); btn.disabled=true; btn.textContent='保存中…'; $('#emailErr').textContent='';
  const { data:{ session } }=await sb.auth.getSession();
  if(!session){ btn.disabled=false; btn.textContent='发 送 确 认 邮 件'; $('#emailErr').textContent='请先登录'; return; }
  const r=await fetch(EH_AUTH_FN+'/update-email',{ method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token}, body:JSON.stringify({email}) });
  const j=await r.json().catch(()=>({}));
  btn.disabled=false; btn.textContent='发 送 确 认 邮 件';
  if(!r.ok || !j.ok){ $('#emailErr').textContent=friendlyErr(j.error,'保存失败'); return; }
  me.email=email; me.emailVerified=false; saveIdentity();  // 换邮箱→需重新验证
  toast(EH_CONFIG.text.ok_emailUpdated); closeModal();
}
// 正式账号编辑形象: 自定义昵称+头像+颜色(不随机、不动用户名、保留registered)
let _profEmoji, _profColor;
function openProfileEditor(){
  openModal('mProfile');
  _profEmoji=me.emoji||'🦊'; _profColor=me.color||EH_CONFIG.identityDefaultC;
  setTimeout(()=>{ $('#profName').value=me.name||''; },50);
  // 随机昵称按钮(复用词库), 昵称与登录无关可随意换
  $('#profDice').onclick=()=>{ $('#profName').value=rand(ADJ)+rand(ANI); $('#profName').focus(); };
  // emoji 选择器(当前高亮在首位)
  const emos=[_profEmoji,...EMO_ALL.filter(e=>e!==_profEmoji)];
  $('#profEmojiPick').innerHTML=emos.map((e,i)=>`<b class="${i===0?'on':''}">${e}</b>`).join('');
  $('#profEmojiPick').querySelectorAll('b').forEach(b=>b.onclick=()=>{ _profEmoji=b.textContent; $('#profEmojiPick').querySelectorAll('b').forEach(x=>x.classList.remove('on')); b.classList.add('on'); });
  // 颜色选择器
  const cols=COLORS.includes(_profColor)?COLORS:[_profColor,...COLORS];
  $('#profColorPick').innerHTML=cols.map(c=>`<i class="${c===_profColor?'on':''}" data-c="${c}" style="background:${c}"></i>`).join('');
  $('#profColorPick').querySelectorAll('i').forEach(el=>el.onclick=()=>{ _profColor=el.dataset.c; $('#profColorPick').querySelectorAll('i').forEach(x=>x.classList.remove('on')); el.classList.add('on'); });
}
async function saveProfile(){
  const name=$('#profName').value.trim();
  if(name.length<1){ $('#profErr').textContent='昵称不能为空'; return; }
  if(name.length>24){ $('#profErr').textContent='昵称最多 24 字'; return; }
  const btn=$('#doProfBtn'); btn.disabled=true; btn.textContent='保存中…';
  // 关键: 只更新昵称/头像/颜色, 保留 id 和 registered 标记(不动用户名/登录)
  // 先存旧值, DB 写失败(如昵称撞名)时回滚这次乐观更新, 免得本地显示了但库里没改
  const prev={ name:me.name, emoji:me.emoji, color:me.color };
  me.name=name; me.emoji=_profEmoji; me.color=_profColor;
  saveIdentity(); paintIdentity();
  const { error }=await sb.from('eh_users').update({ name, emoji:_profEmoji, color:_profColor }).eq('id',myUid);
  btn.disabled=false; btn.textContent='保 存';
  if(error){
    // 回滚乐观更新
    me.name=prev.name; me.emoji=prev.emoji; me.color=prev.color;
    saveIdentity(); paintIdentity();
    // 23505 = Postgres 唯一约束冲突; saveProfile 只改 name/emoji/color, 唯一能撞的就是昵称唯一索引
    if(error.code==='23505' || /duplicate key|unique/i.test(error.message||'')){
      $('#profErr').textContent='这个昵称被用了，换一个吧';
    } else {
      $('#profErr').textContent='保存失败';
    }
    return;
  }
  // 同步刷新大厅顶部昵称(否则要整页刷新才更新)
  if($('#lobbyName')){ $('#lobbyName').textContent=me.name; $('#lobbyName').style.color=me.color; }
  const mb=$('#meBtn'); if(mb){ mb.textContent=me.emoji; mb.style.color=me.color; }
  const mbh=$('#meBtnHall'); if(mbh){ mbh.textContent=me.emoji; mbh.style.color=me.color; }
  toast(EH_CONFIG.text.ok_profileUpdated); closeModal();
}

// ============ 事件绑定 ============
// 安全绑定: 元素不存在时静默跳过, 避免单个 null 中断整条绑定链(移动端密码管理器偶发改动DOM导致)
function on(id, ev, fn){ const el=document.getElementById(id); if(el) el.addEventListener(ev, fn); return el; }
// 防"未交互就被浏览器/密码管理器自动调起存储凭据"(MDN: autocomplete=off 对登录字段无效, 会被故意忽略)。
// 行业可靠解法 readonly-until-focus: 招引凭据的字段(登录账密/注册/邮箱, 标 [data-noauto])默认 readonly,
// 浏览器 autofill 扫描会跳过只读字段→首页未弹登录框/改邮箱页都不会被自动填充; 用户真正 pointerdown/focus 时
// 才摘 readonly 允许输入。委托到 document(捕获阶段)→ 动态创建的重置密码框也覆盖。
function _unlockNoAuto(el){ if(el && el.hasAttribute && el.hasAttribute('data-noauto') && el.readOnly){ el.readOnly=false; } }
document.addEventListener('pointerdown', e=>{ _unlockNoAuto(e.target); }, true);
document.addEventListener('focusin', e=>{ _unlockNoAuto(e.target); }, true);
on('rerollBtn','click',()=>rollIdentity());
on('loginToggle','click',()=>{
  const c=$('#loginCollapse'); if(!c) return; const open=c.classList.toggle('on');
  $('#loginToggle').querySelector('span').textContent = open?'已有账号？收起 ▴':'已有账号？点此登录 ▾';
  // autocomplete token 恒为 HTML 里的标准值(username/current-password), 浏览器才会记住+自动填充, 不再动态改。
  // 防误调起靠 readonly: 收着时账密框 readonly, 浏览器 autofill 扫描跳过→首页不弹凭据; 点开=用户手势才解锁。
  const la=$('#loginAccount'), lp=$('#loginPassword');
  if(open){
    if(la) la.readOnly=false; if(lp) lp.readOnly=false;
    setTimeout(()=>$('#loginAccount').focus(),200); triggerCredentialLogin();  // 点开=用户手势, 此时才弹系统凭据验证→拉取→自动登录
  } else {
    if(la) la.readOnly=true; if(lp) lp.readOnly=true;
  }
});
on('loginForm','submit',(e)=>{ e.preventDefault(); doLogin(); });   // form submit(而非裸按钮)→浏览器/密码管理器才认作登录, 触发保存+自动填充
on('loginPassword','keydown',e=>{ if(e.key==='Enter'){e.preventDefault();doLogin();} });
// 填完账密自动提交：账号+密码都有值时(尤其密码管理器一次性自填两框)防抖 350ms 后自动登录。
// 防重触发: 登录中/已登录/两框任一空 都不触发; 手动清空/编辑重新计时。
let _autoSubmitTimer=null;
function maybeAutoSubmit(){
  clearTimeout(_autoSubmitTimer);
  const la=$('#loginAccount'), lp=$('#loginPassword'), btn=$('#loginBtn');
  if(!la||!lp||myUid) return;
  const acc=la.value.trim(), pw=lp.value;
  if(acc.length>=2 && pw.length>=6 && !(btn&&btn.disabled)){
    _autoSubmitTimer=setTimeout(()=>{ if(!myUid && la.value.trim() && lp.value){ doLogin(); } }, 350);
  }
}
on('loginAccount','input',maybeAutoSubmit);
on('loginPassword','input',maybeAutoSubmit);
on('toReg','click',()=>openModal('mReg'));
on('toReset','click',(e)=>{ e.stopPropagation(); openModal('mReset'); });
on('doRegBtn','click',()=>doRegister());
on('doResetBtn','click',()=>doReset());
on('doEmailBtn','click',()=>changeEmail());
on('sendVerifyBtn','click',()=>sendVerifyEmail());
on('doProfBtn','click',()=>saveProfile());
on('enterBtn','click',async()=>{
  const btn=$('#enterBtn'); btn.disabled=true;
  clearLastRoom();   // ★ 匿名进入大厅: 清掉可能残留的旧 eh_last_room(同浏览器前一用户留的), 防刷新进错房
  // 先切大厅并立即铺骨架占位(秒显), 认证在背后跑 → 不再干等网络往返后才切场景
  goScene('lobby');
  { const ch=$('#channels'); if(ch && !ch.children.length) ch.innerHTML=chSkel(4);
    const pr=$('#publicRooms'); if(pr && !pr.children.length) pr.innerHTML=chSkel(2); }
  // ★不把官方/公开房列表卡在 ensureAuth 之后——它们只读公开 eh_rooms(anon key 即可), 无需 session。
  //   仅等 supabase 库就绪(awaitSb, 本地轮询几十ms), 立即渲染大厅(官方/公开秒出); 认证并行跑,
  //   完成后再补渲染一次(私密房 renderMyRooms 需 myUid)。
  // ★2026-07-26 修回归: awaitSb 超时(弱网库慢)时不能静默吞掉——否则骨架永久卡死且无重试入口。
  //   超时→显示"点击重试"给出口; 成功→渲染。ensureAuth 无论成败都放开按钮并补渲一次(拿到myUid补私密房;
  //   失败也补渲一次, 保证官方/公开至少出来, 不整页空)。
  awaitSb(8000).then(()=>renderLobby())
               .catch(()=>{ try{ lobbyShowRetry(); }catch(_){} });
  ensureAuth().then(()=>{ btn.disabled=false; renderLobby(myUid?true:false); })
              .catch(()=>{ btn.disabled=false; renderLobby(false); });
});
on('backBtn','click',()=>backToLobby());
// 房间头像 = 房间信息/设置入口(所有人看信息, 房主/管理另有编辑区), 替代原顶部齿轮
on('hallIcon','click',()=>openGear());
// 双击房间名 = 软刷新聊天记录(只刷数据不刷页面)+ 回到最新
// iOS Safari 的原生 dblclick 在触屏上极不可靠(双击=缩放手势, 常被吞), 改用 pointerup 手动判定双击:
// 两次抬手间隔 < 400ms 且位置相近 → 视为双击。同时保留桌面 dblclick 兜底。
(function(){
  const nm=$('#hallName'); if(!nm) return;
  let lastT=0, lastX=0, lastY=0;
  nm.addEventListener('pointerup', (e)=>{
    const t=e.timeStamp||Date.now();
    const dx=Math.abs((e.clientX||0)-lastX), dy=Math.abs((e.clientY||0)-lastY);
    if(t-lastT < 400 && dx < 30 && dy < 30){ e.preventDefault(); lastT=0; softRefreshRoom(); }
    else { lastT=t; lastX=e.clientX||0; lastY=e.clientY||0; }
  });
  nm.addEventListener('dblclick', softRefreshRoom);   // 桌面兜底
})();
on('wallBtn','click',()=>openWall());
on('wallX','click',()=>$('#wallMask').classList.remove('on'));
on('wallMask','click',e=>{ if(e.target===$('#wallMask')) $('#wallMask').classList.remove('on'); });
// 名场面(回声墙): 从当前房已加载消息里, 按回声(echo)总数排出高共鸣消息 top8
function openWall(){
  const mask=$('#wallMask'), box=$('#wallList'); if(!mask||!box) return;
  ehArm();
  const items=[];
  document.querySelectorAll('#stream .msg[data-mid]').forEach(el=>{
    const mid=el.dataset.mid; if(String(mid).startsWith('local_')) return;
    const map=echoState[mid]; if(!map) return;
    let total=0; const pills=[];
    Object.keys(map).forEach(e=>{ const c=map[e]&&map[e].count||0; if(c>0){ total+=c; pills.push(e+' '+c); } });
    if(total<=0) return;
    const nm=el.querySelector('.meta .nm'), txt=el.querySelector('.txt');
    items.push({ mid, total, pills, name:nm?nm.textContent:'', color:nm?nm.style.color:'', text:txt?txt.textContent.trim().slice(0,120):'' });
  });
  items.sort((a,b)=>b.total-a.total);
  const top=items.slice(0,8);
  box.innerHTML = top.length ? top.map((it,i)=>`
    <div class="wall-item" data-mid="${esc(String(it.mid))}" title="点击定位到这条消息">
      <div class="wi-top"><span class="wi-nm" style="--ec:${esc(it.color||'var(--ink)')}">${esc(it.name)}</span>
        <span class="wi-rank">#${i+1} · ${it.total} 共鸣</span></div>
      <div class="wi-txt">${esc(it.text)}</div>
      <div class="wi-echoes">${it.pills.map(p=>`<span class="wi-pill">${esc(p)}</span>`).join('')}</div>
    </div>`).join('')
    : '<div class="wall-empty">还没有高共鸣的消息～<br>长按消息贴表情，热门的会留在这里</div>';
  // 点名场面卡 → 关弹窗 + 定位到那条消息并高亮(复用 @提醒的定位方式)
  box.querySelectorAll('.wall-item[data-mid]').forEach(it=>it.onclick=()=>{
    const mid=it.dataset.mid;
    mask.classList.remove('on');
    const msg=document.querySelector(`.msg[data-mid="${mid}"]`);
    if(msg){ msg.scrollIntoView({behavior:'smooth',block:'center'}); msg.classList.add('mentioned-flash'); setTimeout(()=>msg.classList.remove('mentioned-flash'),2000); }
    else toast('那条消息不在当前列表里');
  });
  mask.classList.add('on');
}
on('meBtn','click',()=>openMe());
on('meBtnHall','click',()=>openMe());
if($('#lobbyName')) on('lobbyName','click',()=>openMe());
on('meDx','click',()=>closeMe()); on('meMask','click',()=>closeMe());
on('gearDx','click',()=>closeGear()); on('gearMask','click',()=>closeGear());
// 触屏: 点顶栏按钮(且非触发式设备)后短暂禁指针, 让粘住的 :hover 脱落。
// 用 click(在 onclick 之后, 不阻塞功能); 仅 coarse pointer(触屏)执行, 鼠标不受影响。
if(window.matchMedia && matchMedia('(hover:none)').matches){
  document.querySelectorAll('.tool-btn,.me-btn,.gear').forEach(b=>{
    b.addEventListener('click',()=>{ setTimeout(()=>{ b.classList.add('nohover'); setTimeout(()=>b.classList.remove('nohover'),260); },0); });
  });
}

// 全局交互反馈：按钮/卡片/菜单项轻涟漪；通用按钮给极轻点击音，关键动作在业务函数里播专属音效。
try{
  document.addEventListener('pointerdown',function(e){
    const el=e.target.closest('button,.btn-primary,.btn-line,.priv-btn,.dbtn,.tool-btn,.me-btn,.plus-btn,.emoji-btn,.skin-opt,.seg .opt,.emoji-pick b,.color-pick i,.st-chip,.slash-item,.at-item,.rm,.rm-code,.ec-pill,.ar-echo,.ar-actions button,.code-copy,.modal-x,.dx,.back');
    if(!el) return; ehRipple(el,e);
  },{capture:true,passive:true});
  document.addEventListener('click',function(e){
    const el=e.target.closest('.btn-primary,.btn-line,.priv-btn,.dbtn,.tool-btn,.me-btn,.plus-btn,.emoji-btn,.skin-opt,.seg .opt,.emoji-pick b,.color-pick i,.st-chip,.slash-item,.at-item,.code-copy');
    if(!el || el.closest('#goBtn,#confirmYes,#confirmNo')) return;
    try{ EhSfx.playClick(); }catch(_){ }
  },{capture:true,passive:true});
}catch(e){}

on('createRoomBtn','click',()=>openModal('mCreate'));
on('joinRoomBtn','click',()=>openModal('mJoin'));
on('modalX','click',()=>closeModal());
on('modalMask','click',e=>{ if(e.target===$('#modalMask')) closeModal(); });
$('#kindSeg').querySelectorAll('.opt').forEach(o=>o.onclick=()=>{ pickedKind=o.dataset.kind; $('#kindSeg').querySelectorAll('.opt').forEach(x=>x.classList.toggle('on',x===o)); renderEmojiPick(); });
on('doCreateBtn','click',()=>createRoom());
$('#codeCopy').onclick=()=>{ navigator.clipboard?.writeText($('#codeVal').textContent).then(()=>toast(EH_CONFIG.text.ok_codeCopied),()=>toast(EH_CONFIG.text.err_copyFail)); };
on('enterCreatedBtn','click',()=>{ closeModal(); if(createdRoom) enterRoom(createdRoom); });
on('doJoinBtn','click',()=>joinByCode());
on('codeIn','keydown',e=>{ if(e.key==='Enter'){e.preventDefault();joinByCode();} });
$('#rpX').onclick=()=>clearReply();

// 输入框
const cin=$('#cin');
let _inputRaf=0;
cin.addEventListener('input',()=>{
  // 高度/按钮/斜杠菜单用 rAF 合并, 避免每字符触发 layout thrash
  if(!_inputRaf) _inputRaf=requestAnimationFrame(()=>{
    _inputRaf=0;
    cin.style.height='auto'; cin.style.height=Math.min(Math.max(cin.scrollHeight,42),100)+'px';
    syncSendBtn();
    const v=cin.value;
    if(v.startsWith('/') && !v.includes(' ')){ _slashSel=0; renderSlashMenu(v); } else hideSlash();
    checkAtTrigger();   // @提及菜单
  });
  // typing_at 保持原节流 1.5s
  const v=cin.value;
  const now=Date.now();
  if(v.trim() && now-(cin._lastTyping||0)>1500 && curRoom){ cin._lastTyping=now; beat({typing_at:new Date().toISOString()}); }
  // ★自己头像的活跃态即时化: 不等 DB 往返(写库→下次 refreshPresence 拉回才亮, 有 1~2s 延迟, 打字慢半拍)。
  //   本地一打字就给自己光墙头像加 live, 3.5s 无续打自动撤(与他人 typing_at 窗口一致)。
  if(v.trim()){ markSelfTyping(); }
  // 打字流光: 内容变长时在输入框附近溅光点(节流 60ms, 只在字数增加时)
  // ★性能: 触屏设备(移动端)跳过——低端机连续打字时持续创建DOM+WAAPI会和键盘动画抢主线程
  if(!_coarsePointer && v.length>(cin._lastLen||0) && now-(cin._lastSpark||0)>60){
    cin._lastSpark=now;
    try{ const r=cin.getBoundingClientRect(); window.EhFx&&EhFx.typeSpark(r.right-18, r.top+r.height/2, 2); }catch(e){}
  }
  cin._lastLen=v.length;
});
cin.addEventListener('keydown',e=>{
  // @菜单激活时，方向键/回车/Tab 选中，Esc 关闭 —— 优先于发送
  if(_atActive){
    if(e.key==='ArrowDown'){ e.preventDefault(); _atSel=(_atSel+1)%_atList.length; renderAtMenu(); return; }
    if(e.key==='ArrowUp'){ e.preventDefault(); _atSel=(_atSel-1+_atList.length)%_atList.length; renderAtMenu(); return; }
    if(e.key==='Enter'||e.key==='Tab'){ e.preventDefault(); pickAt(_atSel); return; }
    if(e.key==='Escape'){ e.preventDefault(); hideAt(); return; }
  }
  // /命令菜单激活时，同一套键盘导航：上下选/回车Tab确认/Esc关
  if(_slashActive){
    if(e.key==='ArrowDown'){ e.preventDefault(); _slashSel=(_slashSel+1)%_slashList.length; renderSlashMenu($('#cin').value); return; }
    if(e.key==='ArrowUp'){ e.preventDefault(); _slashSel=(_slashSel-1+_slashList.length)%_slashList.length; renderSlashMenu($('#cin').value); return; }
    if(e.key==='Enter'||e.key==='Tab'){ e.preventDefault(); pickSlash(_slashSel); return; }
    if(e.key==='Escape'){ e.preventDefault(); hideSlash(); return; }
  }
  if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); }
});
// ★移动端发送键：抬手直接发送，不再把成败押在后续合成 click 上。
// iOS/PWA 中 touchstart.preventDefault()、键盘收起与 composer 位移都可能吞掉 click；旧版因此出现“按钮点了没反应”。
// pointerup/touchend 直接调用 send；click 保留给键盘/辅助技术/旧浏览器，500ms 锁去重，避免同一次手势双发。
(function(){
  var go=$('#goBtn'); if(!go) return;
  var lastSendAt=0;
  function fire(e){
    if(e && e.cancelable) e.preventDefault();
    var now=Date.now(); if(now-lastSendAt<500) return;
    lastSendAt=now; send();
  }
  function keepFocus(e){ if(e.cancelable) e.preventDefault(); }
  go.addEventListener('pointerdown',keepFocus);
  go.addEventListener('pointerup',fire);
  // Safari 旧版/部分 WebView 没有完整 Pointer Events：保留 touch 兜底；时间锁会吃掉重复事件。
  go.addEventListener('touchstart',keepFocus,{passive:false});
  go.addEventListener('touchend',fire,{passive:false});
  go.addEventListener('click',fire);
})();
syncSendBtn();  // 初始：空输入→显示麦克风
// ＋ 花样菜单：虚空 / 语音 / 神曲。有模式时 ＋变模式图标, 点它=退出; 无模式时=展开菜单
function closePlusMenu(){ $('#plusMenu').classList.remove('on'); if(curMode==='none') $('#plusBtn').classList.remove('on'); }
$('#plusBtn').onclick=e=>{ e.stopPropagation();
  if(curMode!=='none'){ setMode('none'); return; }   // 当前有模式 → 点＋退出
  const open=!$('#plusMenu').classList.contains('on');
  $('#emojiTray').classList.remove('on');
  $('#plusMenu').classList.toggle('on',open); $('#plusBtn').classList.toggle('on',open);
};
$('#plusMenu').addEventListener('click',e=>e.stopPropagation());
$('#pmVoid').onclick=()=>{ closePlusMenu(); setMode('void'); };
$('#pmVoice').onclick=()=>{ closePlusMenu(); setMode('voice'); };
$('#pmSong').onclick=()=>{ closePlusMenu(); songSel=(SONG_STYLES.find(s=>s.id==='acapella')||SONG_STYLES[0]).id; setMode('song'); };   // 神曲默认清唱, 换曲风用细色条
$('#pmBottle') && ($('#pmBottle').onclick=()=>{ closePlusMenu(); setMode('bottle'); });
document.addEventListener('click',closePlusMenu);

// emoji 面板
const TRAY=['😀','😂','🥹','😍','😎','🤔','😴','😭','🥳','😤','👍','👏','🙏','💪','🤝','❤️','🔥','✨️','🎉','💯','🚀','🌈','🌙','⭐️','🍺','☕️','👀','🤯','💥','🕳️','🦊','🐋','🦉','🪼','🐙','🦌','🦇','🎧️'];
$('#emojiTray').innerHTML=TRAY.map(e=>`<b>${e}</b>`).join('');
// 表情按钮/托盘用 mousedown+preventDefault: 不让焦点转移到它们, 也不主动 focus 输入框,
// 这样点表情不会顶起/唤起系统输入法(想打字再自己点输入框)
// _echoTarget: 非空时托盘处于"给某条消息贴反应"模式(反应环点➕进入); 空则默认"插入输入框"模式
let _echoTarget=null;
function openEchoTray(mid){ _echoTarget=mid; $('#emojiTray').classList.add('on'); }
$('#emojiBtn').addEventListener('mousedown',e=>e.preventDefault());
$('#emojiBtn').onclick=e=>{ e.stopPropagation(); _echoTarget=null; $('#emojiTray').classList.toggle('on'); };  // 从😊进=插入模式
$('#emojiTray').querySelectorAll('b').forEach(b=>{
  b.addEventListener('mousedown',e=>e.preventDefault());   // 阻止聚焦→不弹键盘
  b.onclick=e=>{ e.stopPropagation();
    const ins=b.textContent;
    if(_echoTarget!=null){ toggleEcho(_echoTarget, ins); _echoTarget=null; $('#emojiTray').classList.remove('on'); return; }  // 贴反应模式
    // 默认: 在光标处插入(无光标则追加), 不调用 focus, 避免唤起输入法
    const st=cin.selectionStart, en=cin.selectionEnd;
    if(typeof st==='number' && document.activeElement===cin){
      cin.value=cin.value.slice(0,st)+ins+cin.value.slice(en);
      cin.selectionStart=cin.selectionEnd=st+ins.length;
    } else { cin.value+=ins; }
    cin.dispatchEvent(new Event('input'));
  };
});
document.addEventListener('click',()=>{ $('#emojiTray').classList.remove('on'); _echoTarget=null; });

window.addEventListener('beforeunload',()=>{
  // 尽力删除自己的在线行(用 sendBeacon 式的同步兜底：直接 fire-and-forget)
  if(curRoom && myUid){ try{ sb.from('eh_presence').delete().eq('room_id',curRoom.id).eq('user_id',myUid); }catch(e){} }
});
