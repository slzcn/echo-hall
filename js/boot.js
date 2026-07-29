// ============ 启动 ============
loadOrRollIdentity();
paintIdentity();
// 同步预绘: 上次在房间 + 本地已有正式账号session → 直接落 hall 骨架, 不闪 enter/lobby(真实数据随后异步补)
try{ preRestoreScene(); }catch(e){}
typeSub();
// 邮箱验证回跳: URL 带 ?ehverify=<token> → 调 /verify-email 标记已验证
(function handleEmailVerify(){
  const m=/[?&]ehverify=([a-f0-9]+)/i.exec(location.search||'');
  if(!m) return;
  const token=m[1];
  // 清掉 URL 上的 token(避免重复/泄露), 不刷新页面
  const clean=location.pathname+location.search.replace(/([?&])ehverify=[a-f0-9]+/i,'$1').replace(/[?&]$/,'').replace(/\?&/,'?');
  history.replaceState(null,'',clean);
  fetch(EH_AUTH_FN+'/verify-email',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token}) })
    .then(r=>r.json()).then(j=>{
      if(j&&j.ok){ if(me){ me.emailVerified=true; saveIdentity(); } toast(EH_CONFIG.text.ok_emailVerified); }
      else toast(friendlyErr(j&&j.error,'验证失败'));
    }).catch(()=>toast(EH_CONFIG.text.err_verifyFail));
})();
// 找回密码回跳: URL 带 ?ehreset=<token> → 弹"设新密码"框(见 handleResetLink)
try{ handleResetLink(); }catch(e){}
// 检测 magic link 回跳：邮箱登录/绑定成功后 URL 带 token，SIGNED_IN 事件触发
let authHandled=false;
const cameFromLink = /access_token|type=magiclink|type=recovery/.test(location.hash||'');
// ⚠️ onAuthStateChange 回调里绝不能直接 await sb.* 请求(GoTrue 会死锁, 表现为登录后所有请求卡住)。
// 故这里只做同步赋值, 异步部分用 setTimeout defer 到回调外执行。
// supabase 库改 defer 后主脚本解析期它还没执行 → 客户端创建+auth 引导全收进 bootSupabase(),
// 库就绪(DOMContentLoaded 前 defer 脚本必已跑完)后调用。
function bootSupabase(){
  if(sb) return;
  if(!(window.supabase && window.supabase.createClient)){ console.warn('supabase 库未就绪'); return; }
  sb = window.supabase.createClient(SB_URL, SB_ANON, { auth:{ persistSession:true, autoRefreshToken:true } });
  try{ subscribeWorld(); }catch(e){ console.warn('world channel', e); }
  sb.auth.onAuthStateChange((ev,session)=>{
    if((ev==='SIGNED_IN'||ev==='INITIAL_SESSION') && session?.user){
      const isReg = !!session.user.email;   // 有邮箱=正式账号; 匿名临时身份没有
      myUid=session.user.id; resyncMsgOwnership();
      if(me) { me.id=myUid; if(isReg) me.registered=true; }
      // ★ 正式账号同步立即修正 UI: 不等异步 prof/acc 查询, 避免“已登录但显示临时身份”的中间态
      // (旧版本 localStorage 里 me.registered 可能缺失/为 false, 后台拉 prof 卡住时 UI 会一直错乱)
      if(isReg && me){ try{saveIdentity();}catch(e){} try{paintIdentity();}catch(e){} }
      setTimeout(async ()=>{
        // 先恢复现场(进房只需 myUid[已就绪] + 本地缓存 me), 不等 DB 查询, 避免 hall 骨架空等数秒
        if(location.hash) history.replaceState(null,'',location.pathname+location.search);
        if(!authHandled && ($('#enter').classList.contains('on')||$('#hall').classList.contains('on'))){
          authHandled=true; resumeAfterAuth();
        }
        // 正式账号补齐身份档案 + 账号信息; 临时账号只需保底档案(不查 eh_accounts)
        if(isReg){
          const [{ data:prof }, { data:acc }] = await Promise.all([
            sb.from('eh_users').select('name,emoji,color').eq('id',myUid).maybeSingle(),
            sb.from('eh_accounts').select('username,email,role,email_verified').eq('auth_uid',myUid).maybeSingle(),
          ]);
          if(prof && prof.name){ me={ id:myUid, name:prof.name, emoji:prof.emoji||'🦊', color:prof.color||EH_CONFIG.identityDefaultC, registered:true }; }
          else { me = me||{}; me.registered=true; }
          if(acc){ me.username=acc.username||''; me.email=acc.email||''; me.role=acc.role||'user'; me.emailVerified=!!acc.email_verified; }
          saveIdentity(); paintIdentity();
        }
      },0);
    }
  });
  // 兜底: onAuthStateChange 的 INITIAL_SESSION 在部分环境(webview/旧版)不稳定,
  // 启动时主动查一次 session, 有则手动触发恢复(与上面同逻辑), 防刷新后登录态"丢失"。
  (async()=>{
    try{
      const session = await resolveSession();   // 统一解析(带兜底重读), 与 ensureAuth 同源, 防刷新后误判"没登录"
      if(session?.user && !myUid){
        const isReg = !!session.user.email;
        myUid=session.user.id; resyncMsgOwnership(); if(me){ me.id=myUid; if(isReg) me.registered=true; }
        // ★ 同主路径: 同步立即修正 UI, 不等异步 prof/acc 查询
        if(isReg && me){ try{saveIdentity();}catch(e){} try{paintIdentity();}catch(e){} }
        // 先恢复现场再补 DB 资料(同 onAuthStateChange 路径, 避免 hall 骨架空等)
        if(!authHandled && ($('#enter').classList.contains('on')||$('#hall').classList.contains('on'))){
          authHandled=true; resumeAfterAuth();
        }
        if(isReg){
          const [{ data:prof }, { data:acc }] = await Promise.all([
            sb.from('eh_users').select('name,emoji,color').eq('id',myUid).maybeSingle(),
            sb.from('eh_accounts').select('username,email,role,email_verified').eq('auth_uid',myUid).maybeSingle(),
          ]);
          if(prof && prof.name){ me={ id:myUid, name:prof.name, emoji:prof.emoji||'🦊', color:prof.color||EH_CONFIG.identityDefaultC, registered:true }; }
          else { me=me||{}; me.registered=true; }
          if(acc){ me.username=acc.username||''; me.email=acc.email||''; me.role=acc.role||'user'; me.emailVerified=!!acc.email_verified; }
          saveIdentity(); paintIdentity();
        }
      }
    }catch(e){ console.warn('session restore', e); }
    // 兜底: 预绘了 hall 但迟迟没进恢复流程(session 真失效/过期) → 回落入场页, 不卡空骨架。
    // 必须延时: onAuthStateChange 把 resumeAfterAuth 塞进 setTimeout(0), 若此处同步回落会把预绘的 hall
    // 立刻打回 enter, 等 setTimeout 跑完又跳回 hall(实测刷新后 enter→10s→hall 的严重抖动)。给 auth 就绪留足时间。
    setTimeout(()=>{ if(!authHandled && !curRoom && $('#hall').classList.contains('on')) goScene('enter'); }, 4000);
  })();
}
// defer 脚本在 DOMContentLoaded 前按序执行完 → 那时 window.supabase 必就绪。已就绪则立即引导。
if(window.supabase && window.supabase.createClient) bootSupabase();
else document.addEventListener('DOMContentLoaded', bootSupabase);
let _autoLoginFired=false;
// 主人点击"点此登录"展开登录区时才触发: 用 Credential Management API 弹出系统凭据选择器
// (需 Face ID/指纹/系统验证), 主人确认后拉取账密回填并自动登录。不再在页面加载时默认填入。
async function triggerCredentialLogin(){
  try{
    if(_autoLoginFired || authHandled || myUid) return;
    if(!(navigator.credentials && window.PasswordCredential)) return;
    // mediation:'optional' → 有已存凭据时弹选择器/系统验证; 无则静默返回 null(不打扰)
    const cred = await navigator.credentials.get({ password:true, mediation:'optional' });
    if(!cred || !cred.id || !cred.password) return;
    fillAndLogin(cred.id, cred.password);
  }catch(e){ /* 主人取消或不支持, 照常手动输入 */ }
}
function fillAndLogin(id, pwv){
  if(_autoLoginFired || authHandled || myUid) return;
  if(!$('#enter').classList.contains('on')) return;
  _autoLoginFired=true;
  const c=$('#loginCollapse'); if(c && !c.classList.contains('on')){ c.classList.add('on'); const sp=$('#loginToggle')?.querySelector('span'); if(sp) sp.textContent='已有账号？收起 ▴'; }
  const la=$('#loginAccount'), lp=$('#loginPassword');
  if(la){ la.readOnly=false; la.value=id; } if(lp){ lp.readOnly=false; lp.value=pwv; }  // 解锁再填(readonly 只挡用户手输, 不挡赋值, 但解锁保持状态一致)
  doLogin();
}
