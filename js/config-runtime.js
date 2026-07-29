// 运行时配置(默认值的深拷贝,loadRemoteConfig 会用 DB 值覆盖)
const EH_CONFIG = JSON.parse(JSON.stringify(EH_CONFIG_DEFAULT));

// ---- 主题 CSS 注入引擎:把 themePalettes 生成 <style> 注入 <head> ----
function buildThemeCSS(palettes){
  const kv = o => Object.entries(o).map(([k,v])=>k+':'+v+';').join('');
  let css = '';
  for(const [id,pal] of Object.entries(palettes||{})){
    css += (id==='cyber' ? ':root{' : 'html[data-theme="'+id+'"]{') + kv(pal) + '}\n';
  }
  return css;
}
function injectThemeCSS(){
  let el = document.getElementById('eh-theme-vars');
  if(!el){ el=document.createElement('style'); el.id='eh-theme-vars'; document.head.appendChild(el); }
  // 主题变量 + 荷尔蒙特效可调值(fx→注入 :root, 供 CSS 结构/keyframes 引用; 后台可覆盖)
  const fxCss = EH_CONFIG.fx ? (':root{'+Object.entries(EH_CONFIG.fx).map(([k,v])=>k+':'+v+';').join('')+'}\n') : '';
  el.textContent = fxCss + buildThemeCSS(EH_CONFIG.themePalettes);
  // 主题变量注入后, 立即同步 theme-color/html/body 底色, 让状态栏带+安全区无黑边(启动路径也覆盖)
  try{ if(typeof syncThemeColor==='function') syncThemeColor(); }catch(_){}
}
// ---- 把 EH_CONFIG.text 应用到所有 data-txt / data-txt-ph 标记的元素 ----
function applyTextConfig(){
  try{
    const T=EH_CONFIG.text||{};
    document.querySelectorAll('[data-txt]').forEach(el=>{
      const k=el.getAttribute('data-txt'); if(T[k]!=null) el.textContent=T[k];
    });
    document.querySelectorAll('[data-txt-ph]').forEach(el=>{
      const k=el.getAttribute('data-txt-ph'); if(T[k]!=null) el.placeholder=T[k];
    });
    document.querySelectorAll('[data-txt-title]').forEach(el=>{
      const k=el.getAttribute('data-txt-title'); if(T[k]!=null) el.title=T[k];
    });
  }catch(_){}
}
// ---- 从 Supabase eh_config 表拉取覆盖配置(存在则 merge) ----
async function loadRemoteConfig(){
  try{
    // TOP10 #8: 客户端缓存 5 分钟，减少启动请求
    const CACHE_KEY='eh_cfg_cache'; const CACHE_TTL=300000;
    try{
      const raw=localStorage.getItem(CACHE_KEY);
      if(raw){
        const {ts,map}=JSON.parse(raw);
        if(Date.now()-ts<CACHE_TTL && map && typeof map==='object'){
          applyConfigMap(map);
          // 后台异步刷新一次（不阻塞）
          sb.from('eh_config').select('key,value').then(({data})=>{ if(data&&data.length){ const m={}; data.forEach(r=>{m[r.key]=r.value;}); applyConfigMap(m); try{localStorage.setItem(CACHE_KEY,JSON.stringify({ts:Date.now(),map:m}));}catch(_){} } });
          return;
        }
      }
    }catch(_){}
    const { data } = await sb.from('eh_config').select('key,value');
    if(data && data.length){
      const map={}; data.forEach(r=>{ map[r.key]=r.value; });
      applyConfigMap(map);
      try{ localStorage.setItem(CACHE_KEY, JSON.stringify({ts:Date.now(), map})); }catch(_){}
    }
    try{ _ehDbg('[cfg] loadRemoteConfig done keys=', data?data.length:0); }catch(_){}
  }catch(e){ /* 表不存在或读取失败 → 用默认配置,不影响运行 */
    try{ console.warn('[EH cfg] loadRemoteConfig failed, using default', e&&e.message||e); }catch(_){}
    try{ _ehDbg('[cfg] loadRemoteConfig fail', e&&e.message||String(e)); }catch(_){}
  }
}
// OPTD 批D: 远程配置 schema/类型校验(防后台写坏前端白屏)
// 规则: 数组字段非数组=忽略; 对象字段非对象(null/字符串/数组)=忽略; 保留 EH_CONFIG_DEFAULT 默认值。
// 返回校验后的 map 副本(不改输入)。
function _validateConfigMap(map){
  if(!map || typeof map!=='object' || Array.isArray(map)) return {};
  var CFG_SCHEMA = {
    themePalettes:'object', themes:'object', roomTheme:'object',
    officialFallbackC:'object', roomThemeOverride:'object', soulColors:'object',
    roomKindC:'object', identityDefaultC:'string', voidC:'string',
    resonanceDefaultC:'string', roomBgm:'object', lobbyDisplay:'object', text:'object',
    identityPool:'object', tuning:'object', songStyles:'object',
    fx:'object', entranceFx:'object',
    publicThemePool:'array', privateThemePool:'array', vipUids:'array', vipTreatment:'string', tierNames:'object', customTiers:'array'
  };
  var out = {};
  for(var k in map){
    if(!Object.prototype.hasOwnProperty.call(map, k)) continue;
    var v = map[k]; var expect = CFG_SCHEMA[k];
    if(!expect){ out[k]=v; continue; }
    try{
      if(expect==='object'){
        if(v && typeof v==='object' && !Array.isArray(v)) out[k]=v;
        else { try{ console.warn('[EH cfg] skip bad field', k, 'expect object got', Array.isArray(v)?'array':typeof v); }catch(_){}
               try{ _ehDbg('[cfg] skip bad', k, Array.isArray(v)?'array':typeof v); }catch(_){} }
      } else if(expect==='array'){
        if(Array.isArray(v)) out[k]=v;
        else { try{ console.warn('[EH cfg] skip bad field', k, 'expect array got', typeof v); }catch(_){}
               try{ _ehDbg('[cfg] skip bad', k, typeof v); }catch(_){} }
      } else if(expect==='string'){
        if(typeof v==='string' && v) out[k]=v;
        else { try{ console.warn('[EH cfg] skip bad field', k, 'expect string got', typeof v); }catch(_){}
               try{ _ehDbg('[cfg] skip bad', k, typeof v); }catch(_){} }
      }
    }catch(err){ try{ console.warn('[EH cfg] validate err', k, err&&err.message); }catch(_){} }
  }
  return out;
}
function applyConfigMap(rawMap){
  // OPTD 批D: schema 校验 + 全局 try/catch,任何脏配置回退默认,前端永不因脏配置白屏
  var map;
  try{ map = _validateConfigMap(rawMap); }
  catch(e){ try{ console.warn('[EH cfg] validate throw, keep defaults', e&&e.message); }catch(_){} return; }
  if(!map || typeof map!=='object') return;
  try{
  // 保留引用——ROOM_BGM/ROOM_THEME/THEMES 都指向 EH_CONFIG 子对象，
  // 不能重新赋对象(旧引用会失效),用「清空+拷贝」原地更新
  ['themePalettes','themes','lobbyDisplay','roomTheme','officialFallbackC','publicThemePool','privateThemePool','roomThemeOverride','soulColors','roomKindC','roomNameC','identityDefaultC','voidC','resonanceDefaultC','roomBgm','fx','entranceFx','vipUids','vipTreatment','tierNames','customTiers','text','identityPool','tuning','songStyles'].forEach(k=>{
    if(!map[k]) return;
    const dst=EH_CONFIG[k];
    if(Array.isArray(dst)){
      dst.length=0;
      if(Array.isArray(map[k])) map[k].forEach(v=>dst.push(v));
    } else if(dst && typeof dst==='object'){
      Object.keys(dst).forEach(ok=>delete dst[ok]);
      Object.assign(dst, map[k]);
    } else {
      EH_CONFIG[k]=map[k];
    }
  });
  injectThemeCSS();
  applyTextConfig();
  try{ if(typeof applyTheme==='function' && document.documentElement.dataset.theme){ applyTheme(document.documentElement.dataset.theme); } }catch(_){}
  try{ checkCachePurge(); }catch(_){}
  // OPTD 修偶发: 远程配置(含 songStyles 曲风池)到达后, 若正在神曲模式, 补一次曲风条重渲染+重绑拖动。
  // 根治「首次进神曲模式时曲风池尚未从后台加载完 → 曲风条内容/拖动绑定时机错位 → 偶发拖不动」。
  try{ if(typeof songMode!=='undefined' && songMode && typeof renderSongStrip==='function'){ renderSongStrip(); } }catch(_){}
  }catch(e){ try{ console.warn('[EH cfg] applyConfigMap threw, some fields kept default', e&&e.message); }catch(_){} try{ _ehDbg('[cfg] applyConfigMap throw', e&&e.message||String(e)); }catch(_){} }
}
// 启动立即注入一次完整主题变量(此时 document.head 已就绪,script 在 body 末尾)
try{ injectThemeCSS(); applyTextConfig(); }catch(e){}

// ============================================================
//  回声厅 Echo Hall 2.0 — 全站 Supabase(匿名登录 + RLS + Realtime + Presence)
// ============================================================
