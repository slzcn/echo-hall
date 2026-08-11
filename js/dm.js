/* ============ 私信系统 (DM) — 前端 ============
   脱离房间的持久 1v1 会话。后端: eh_dm_threads / eh_dm_messages + RPC
   (eh_dm_open[取线+最近消息一跳] / eh_dm_mark_read / eh_dm_inbox)。
   实时: 订阅 eh_dm_messages INSERT, 靠 RLS 只投递"我参与的线"的行。
   依赖 app.js 的全局(经典 <script> 共享词法作用域, 本文件在 app.js 之后加载):
     sb, me, myUid, esc, toast, awaitSb, safeColor, safeEmoji, ehArm, EhSfx。
   方案B: 匿名也能收发(在场即可发起), 正式账号享持久化。
   ★性能(对齐聊天室 loadHistory 那套): 1) 收件箱缓存→秒显旧列表, 后台刷新覆盖(不再冷"加载中");
     2) 会话打开走单跳 eh_dm_open(取线+最近消息), 替代原 get_or_create+select+mark_read 三次串行往返;
     3) hover/按下会话行时预取该会话(prefetch), 点开命中缓存瞬开。 */
(function(){
  'use strict';
  const $ = s => document.querySelector(s);

  let dmChan = null;             // 全局实时通道
  let curThread = null;          // 当前打开的会话 {id, otherUid, otherName, otherEmoji, otherColor}
  let _totalUnread = 0;
  let _tailPoll = null;          // 会话窗兜底轮询
  let _lastMsgId = 0;            // 已渲染的最大消息 id(兜底轮询/实时去重)

  // ---- 缓存(对齐聊天室 prefetchCache/快照): 让打开瞬时, 网络回来再覆盖 ----
  const DM_PREFETCH_TTL = 60000;   // 预取有效期 60s(同房间 prefetchTtlMs)
  let _inboxCache = null;          // { at, list } —— 上次收件箱结果, 打开先秒显
  const _chatPrefetch = {};        // otherUid → { at, p:Promise<{thread_id,messages}> } 会话预取
  function _dmOpenReq(otherUid){   // 单跳 RPC: 取线+最近消息(不 mark_read, 供预取安全复用)
    return sb.rpc('eh_dm_open',{ p_other:otherUid, p_limit:200 }).then(({data,error})=>{ if(error) throw error; return data; });
  }
  function prefetchChat(otherUid){
    if(!sb || !myUid || !otherUid || otherUid===myUid) return;
    try{ if(isSoulTarget(otherUid)) return; }catch(_){}
    const hit=_chatPrefetch[otherUid];
    if(hit && Date.now()-hit.at < DM_PREFETCH_TTL) return;   // 命中未过期, 不重复打
    const p=_dmOpenReq(otherUid).catch(()=>null);            // 预取失败静默, openChat 会现拉兜底
    _chatPrefetch[otherUid]={ at:Date.now(), p };
  }

  // ---- 键盘协同: 会话窗是独立 position:fixed 抽屉, keyboard.js 只管 #hall 不管它, DM 自管键盘几何。
  //   目标: 键盘弹起把抽屉高度钉成"键盘上方可视高" → .dm-stream(flex:1)被挤扁、composer 常驻可视底;
  //   键盘落再复位到 CSS 默认(top:0/bottom:0)。数学已由真机 Chrome(CDP)实测验证正确, 关键是取到真实键盘高。
  const _vv = window.visualViewport;
  const _vk = navigator.virtualKeyboard || null;
  //   ★为什么 DM 要自己管键盘几何(而不是只借 keyboard.js 的 __ehKbVisibleH):
  //   真机 Chrome 实测(CDP)证明 __ehKbVisibleH 的钉抽屉数学没错, 但它在 DM 场景【永远不缩小】——
  //   它靠三信号缩高, DM 一个都吃不到: (1)vv.height 收缩→安卓覆盖式键盘不缩;
  //   (2)VK geometrychange 的 keyboardRect→只在 overlaysContent=true 才发, 而 keyboard.js 特意设 false;
  //   (3)estimatedKbH 估算→只在聊天室 #cin 聚焦时启用, DM 输入框聚焦从不触发。
  //   ∴ DM 开窗期间【临时把 overlaysContent 切 true(覆盖式)】, 让 VK.boundingRect 给出真实键盘高;
  //   DM 抽屉是手动定尺寸的 fixed 容器, 覆盖式对它零副作用; 关窗还原 false(不动 #hall 那套占位式)。
  let _kbEst=0;                                      // DM 自己的估算兜底(三信号全哑机型), 单位 px, 0=未启用
  // 当前键盘高度(px): 优先 VK.boundingRect(真值), 再 vv 收缩量, 都拿不到才用 _kbEst 估算。
  function _kbHeight(){
    try{ const r=_vk&&_vk.boundingRect; if(r&&r.height>0) return Math.round(r.height); }catch(e){}
    if(_vv&&_baseVvH&&(_baseVvH-_vv.height>60)) return Math.round(_baseVvH-_vv.height);   // 占位式/iOS: vv 收缩即键盘高
    return _kbEst;
  }
  let _baseH=0;                                      // 开窗(键盘未起)时的 innerHeight 基线
  let _baseVvH=0;                                    // 开窗时的 vv.height 基线(判 vv 收缩用)
  // 键盘上方可视高 = 基线高 - 当前键盘高。用它钉抽屉。
  function _visH(){ const h=_baseH||window.innerHeight; const kb=_kbHeight(); return Math.max(120, h-kb); }
  // ★键盘是否真的弹起 —— 键盘高 > 120 即算起(跨 iOS/安卓覆盖式&占位式都靠谱)。
  function _kbUp(){ return _kbHeight()>120; }
  // 复位抽屉的定位盒到 CSS 默认(top:0/bottom:0, 撤掉 JS 钉死的 height) —— 键盘落 & 关窗共用一处
  function _resetDrawerBox(d){ if(d){ d.style.top=''; d.style.height=''; d.style.bottom=''; } }
  // 键盘起 → composer 贴键盘(去掉 10px 呼吸位); 键盘落 → 恢复默认呼吸位。
  function syncComposerPad(){
    const c=document.querySelector('.dm-composer'); if(!c) return;
    c.style.paddingBottom = _kbUp() ? '0px' : '';
  }
  function fitChatViewport(){
    const d=$('#dmChatDrawer'); if(!d || !d.classList.contains('on')) return;
    if(_kbUp()){
      if(window.scrollY!==0){ try{ window.scrollTo(0,0); }catch(e){} }   // ★关键: 文档滚回顶, 免 fixed 漂移
      d.style.top='0px';
      d.style.height=_visH()+'px';                  // 钉成"键盘上方可视高"(不是 vv.height, 覆盖式下二者不同)
      d.style.bottom='auto';                        // 必须放开 bottom, 否则 top+bottom+height 过约束会忽略 height
    } else {                                        // 键盘落: 复位到 CSS 默认(top:0/bottom:0), 别让钉死的 height 残留
      _resetDrawerBox(d);
    }
    syncComposerPad();
    scrollBottom();                                 // 键盘挤扁 stream 后重新贴底, 别把最新消息顶出可视区
  }
  function onChatFocus(){                            // 聚焦瞬间键盘还没起, resize/geometrychange 才是真正时机; 先滚回顶挡文档漂移
    if(window.scrollY!==0){ try{ window.scrollTo(0,0); }catch(e){} }
    setTimeout(fitChatViewport, 60);                // 等键盘动画抬起后再定一次(部分机型信号只发一次且早)
    // ★三信号全哑兜底(小米 PWA 等): 聚焦 320ms 后若键盘高仍判为 0, 用 0.38×基线高估算, 让抽屉先钉住不遮。
    setTimeout(()=>{
      if(document.activeElement===$('#dmChatInput') && _kbHeight()===0){
        _kbEst=Math.round((_baseH||window.innerHeight)*0.38);
      }
      fitChatViewport();
    }, 320);
  }
  function onChatBlur(){                             // 三信号全哑机型收键盘无事件 → 失焦时清估算并复位, 免抽屉钉在小高度残留空白
    _kbEst=0; setTimeout(fitChatViewport, 60);
  }
  function bindChatViewport(){
    _baseH=window.innerHeight;                       // 开窗即记基线(此刻键盘未起)
    _baseVvH=_vv?_vv.height:window.innerHeight;
    _kbEst=0;
    // ★DM 开窗期间切覆盖式: 让 VK 发 geometrychange + boundingRect 给真实键盘高(见上方长注释)。
    if(_vk){ try{ _vk.overlaysContent=true; }catch(e){} }
    if(_vv){ _vv.addEventListener('resize', fitChatViewport); }   // 占位式/iOS 键盘起落走 vv.resize; 覆盖式走下面 VK
    if(_vk){ try{ _vk.addEventListener('geometrychange', fitChatViewport); }catch(e){} }
    const inp=$('#dmChatInput'); if(inp){ inp.addEventListener('focus', onChatFocus); inp.addEventListener('blur', onChatBlur); }
    fitChatViewport();
  }
  function unbindChatViewport(){
    if(_vv){ _vv.removeEventListener('resize', fitChatViewport); }
    if(_vk){ try{ _vk.removeEventListener('geometrychange', fitChatViewport); }catch(e){} }
    // 还原占位式, 把键盘模式交回 keyboard.js(#hall 那套依赖 false)。
    if(_vk){ try{ _vk.overlaysContent=false; }catch(e){} }
    const inp=$('#dmChatInput'); if(inp){ inp.removeEventListener('focus', onChatFocus); inp.removeEventListener('blur', onChatBlur); }
    _resetDrawerBox($('#dmChatDrawer'));
    const c=document.querySelector('.dm-composer'); if(c) c.style.paddingBottom='';   // 复位呼吸位
    _baseH=0; _baseVvH=0; _kbEst=0;
  }

  // 时间显示与聊天室一致(app.js fmtTime): 今天只显时分, 昨天/今年/跨年逐级补日期。
  //   优先复用 app.js 的全局 fmtTime(经典 <script> 同作用域), 保证两处逻辑永远同源;
  //   万一取不到再本地兜底(同样带日期, 别退回"只有时分"漏了历史私信的日期)。
  function fmtTime(iso){
    try{ if(typeof window!=='undefined' && typeof window.fmtTime==='function') return window.fmtTime(iso); }catch(e){}
    try{
      const d=iso?new Date(iso):new Date(); const now=new Date();
      const hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
      const dayStart=t=>new Date(t.getFullYear(),t.getMonth(),t.getDate()).getTime();
      const diffDays=Math.round((dayStart(now)-dayStart(d))/86400000);
      if(diffDays<=0) return hm;
      if(diffDays===1) return '昨天 '+hm;
      if(d.getFullYear()===now.getFullYear()) return (d.getMonth()+1)+'/'+d.getDate()+' '+hm;
      return d.getFullYear()+'/'+(d.getMonth()+1)+'/'+d.getDate()+' '+hm;
    }catch(e){ return ''; }
  }

  // ---- 未读红点 ----
  // 入口已收进个人空间: 红点跟到个人空间入口头像(#meBtn/#meBtnHall)的角标 + 面板内私信行的徽标。
  function paintUnread(){
    const txt = _totalUnread>9?'9+':String(_totalUnread);
    [['#meBtn','#dmDotMe'],['#meBtnHall','#dmDotMeHall']].forEach(([btn,dot])=>{
      const b=$(btn); if(b) b.classList.toggle('has-unread', _totalUnread>0);
      const d=$(dot); if(d) d.textContent=txt;
    });
    const entry=$('#meDmEntry'), badge=$('#meDmBadge');   // 个人空间面板内的私信行(打开时才在)
    if(entry) entry.classList.toggle('has-unread', _totalUnread>0);
    if(badge) badge.textContent=txt;
  }
  // 新私信【到达瞬间】的一次性弹跳提示: 给个人空间头像挂 .dm-arrive, 动画结束即摘, 保证下条可重放。
  //   稳态只有柔和的 has-unread 呼吸, 容易被无视 —— 到达那一下让它当场炸一圈光环 + 轻抖。
  function pingUnread(){
    ['#meBtn','#meBtnHall'].forEach(sel=>{
      const b=$(sel); if(!b) return;
      b.classList.remove('dm-arrive');       // 先摘, 强制重排以便同名动画能重新触发
      void b.offsetWidth;                     // reflow: 让浏览器认下"移除→再加"是一次新动画
      b.classList.add('dm-arrive');
      b.addEventListener('animationend', ()=>b.classList.remove('dm-arrive'), {once:true});
    });
  }
  async function refreshUnread(){
    if(!sb || !myUid) return;
    try{
      const {data,error}=await sb.rpc('eh_dm_inbox');
      if(error) return;
      _totalUnread=(data||[]).reduce((s,t)=>s+(t.unread||0),0);
      paintUnread();
      if($('#dmInboxMask')?.classList.contains('on')) renderInbox(data);
    }catch(e){}
  }

  // ---- 收件箱(会话列表) ----
  //   对齐聊天室: 有缓存先秒显旧列表, 再后台刷新覆盖 → 不再每次冷"加载中"。
  async function openInbox(){
    try{ await awaitSb(); }catch(e){}
    if(!myUid){ toast('身份加载中，请稍后再试'); return; }
    $('#dmInboxMask').classList.add('on'); $('#dmInboxDrawer').classList.add('on');
    try{ ehArm(); }catch(e){}
    // 有缓存(哪怕稍旧)先立即渲染, 用户秒见列表; 无缓存才显加载态
    if(_inboxCache && Array.isArray(_inboxCache.list)){ renderInbox(_inboxCache.list); }
    else { $('#dmInboxBody').innerHTML='<div class="empty-hint">加载中…</div>'; }
    try{
      const {data,error}=await sb.rpc('eh_dm_inbox');
      if(error) throw error;
      _inboxCache={ at:Date.now(), list:data||[] };
      renderInbox(data);
      _totalUnread=(data||[]).reduce((s,t)=>s+(t.unread||0),0); paintUnread();
    }catch(e){
      if(!_inboxCache) $('#dmInboxBody').innerHTML='<div class="empty-hint">加载失败，稍后重试</div>';  // 有缓存则保留旧列表, 不覆盖成报错
    }
  }
  function closeInbox(){
    try{ if($('#dmInboxMask').classList.contains('on')) EhSfx.play('back'); }catch(e){}
    $('#dmInboxMask').classList.remove('on'); $('#dmInboxDrawer').classList.remove('on');
  }
  function renderInbox(list){
    const body=$('#dmInboxBody'); if(!body) return;
    // 灵魂线不进列表(AI 不在私信闭环; 可能是拦截上线前误建的历史线)
    list=(list||[]).filter(t=>!isSoulTarget(t.other_uid, t.other_name));
    if(!list.length){ body.innerHTML='<div class="empty-hint">还没有私信。长按某人头像即可发起私信 ✉️</div>'; return; }
    body.innerHTML=list.map(t=>{
      const c=safeColor(t.other_color);
      const preview=t.last_text ? (t.last_from===myUid?'我: ':'')+t.last_text : '（暂无消息）';
      return `<div class="dm-thread${t.unread>0?' unread':''}" data-uid="${esc(t.other_uid)}" data-nm="${esc(t.other_name||'')}" data-em="${esc(t.other_emoji||'')}" data-c="${esc(t.other_color||'')}" style="--dt-c:${c}">
        <div class="dt-av">${safeEmoji(t.other_emoji)}</div>
        <div class="dt-mid"><div class="dt-nm">${esc(t.other_name||'某人')}</div><div class="dt-last">${esc(preview)}</div></div>
        <span class="dt-badge">${t.unread>9?'9+':t.unread}</span>
      </div>`;
    }).join('');
    body.querySelectorAll('.dm-thread').forEach(el=>{
      const uid=el.dataset.uid;
      // hover(桌面)/按下(移动)即预取该会话, 点开命中缓存瞬开(同聊天室房间卡)
      const pf=()=>prefetchChat(uid);
      el.addEventListener('pointerenter', pf);
      el.addEventListener('touchstart', pf, {passive:true});
      el.onclick=()=>{ openChat(uid, el.dataset.nm, el.dataset.em, el.dataset.c); };
    });
  }

  // ---- 会话窗 ----
  // 灵魂(AI)暂不在私信闭环里(那端没人接), 任何入口打开跟灵魂的会话都拦掉——含收件箱里的历史灵魂线。
  function isSoulTarget(uid, name){ try{ return typeof isSoulUser==='function' && isSoulUser(uid, name); }catch(e){ return false; } }
  // 层级固定两级: 收件箱(列表) → 会话(单聊)。会话返回【一定回列表】(不论从列表点进还是长按头像直接进),
  //   列表返回则回"调出私信的上一页"(大厅/房间/个人空间)。见 backChat/closeInbox。
  async function openChat(otherUid, otherName, otherEmoji, otherColor){
    try{ await awaitSb(); }catch(e){}
    if(!myUid){ toast('身份加载中，请稍后再试'); return; }
    if(otherUid===myUid){ toast('不能给自己发私信'); return; }
    if(isSoulTarget(otherUid, otherName)){ toast('灵魂暂不支持私信哦'); return; }
    $('#dmChatTitle').textContent=otherName||'私信';
    $('#dmChatMask').classList.add('on'); $('#dmChatDrawer').classList.add('on');
    try{ ehArm(); }catch(e){}
    bindChatViewport();
    _lastMsgId=0;
    // 命中预取(hover/按下时已开始拉)→ 复用其 promise 瞬开; 否则现拉。都走单跳 eh_dm_open。
    const hit=_chatPrefetch[otherUid];
    let req;
    if(hit && Date.now()-hit.at < DM_PREFETCH_TTL){ req=hit.p.then(d=>d||_dmOpenReq(otherUid)); }
    else { req=_dmOpenReq(otherUid); }
    delete _chatPrefetch[otherUid];
    // 无缓存首帧才显"加载中"(命中缓存的话 req 已 resolve, 下面 await 立即返回, 不闪加载态)
    $('#dmChatStream').innerHTML='<div class="empty-hint">加载中…</div>';
    try{
      const res=await req;
      if(!res || !res.thread_id) throw new Error('bad response');
      curThread={ id:res.thread_id, otherUid, otherName, otherEmoji, otherColor };
      renderMessages(res.messages||[]);
      markRead();                 // fire-and-forget: 标已读不阻塞首屏(RPC 里没做, 这里补)
      startTailPoll();
      // 不再自动 focus 输入框: 打开即聚焦会触发 :focus-within 让 composer padding 变化闪一下
      //   (且 iOS 程序化 focus 多半弹不出键盘, 纯闪无收益)。让用户主动点输入框才聚焦。
    }catch(e){
      console.warn('openChat',e);
      $('#dmChatStream').innerHTML='<div class="empty-hint">打开会话失败：'+esc(String(e.message||e))+'</div>';
    }
  }
  function closeChat(){
    try{ if($('#dmChatMask').classList.contains('on')) EhSfx.play('back'); }catch(e){}
    unbindChatViewport();
    const inp=$('#dmChatInput'); if(inp){ try{ inp.blur(); }catch(e){} }   // 收键盘, 免关窗后 vv 仍缩着
    $('#dmChatMask').classList.remove('on'); $('#dmChatDrawer').classList.remove('on');
    curThread=null; stopTailPoll();
    refreshUnread();
  }
  // 把一批消息行渲染进会话流(供 openChat 首屏用; eh_dm_open 已按 id 升序返回)
  function renderMessages(rows){
    const stream=$('#dmChatStream'); if(!stream) return;
    stream.innerHTML='';
    (rows||[]).forEach(m=>appendMsg(m));
    scrollBottom();
  }
  function appendMsg(m){
    if(m.id && m.id<=_lastMsgId) return;             // 去重
    if(m.id) _lastMsgId=Math.max(_lastMsgId,m.id);
    const stream=$('#dmChatStream'); if(!stream) return;
    if(m.id && stream.querySelector(`[data-dmid="${m.id}"]`)) return;
    const mine=m.from_uid===myUid;
    const div=document.createElement('div');
    div.className='dm-msg '+(mine?'me':'them'); if(m.id) div.dataset.dmid=m.id;
    div.innerHTML=`${esc(m.text)}<span class="dm-t">${fmtTime(m.created_at)}</span>`;
    stream.appendChild(div);
  }
  function scrollBottom(){ const s=$('#dmChatStream'); if(s) s.scrollTop=s.scrollHeight; }

  async function sendChat(){
    if(!curThread || !myUid) return;
    const inp=$('#dmChatInput'); const text=(inp.value||'').trim();
    if(!text) return;
    inp.value=''; syncSendState();
    try{ inp.focus(); }catch(e){}                       // 保持聚焦: 键盘不收, 连发更顺
    const stream=$('#dmChatStream');
    const div=document.createElement('div'); div.className='dm-msg me';   // 乐观渲染
    div.innerHTML=`${esc(text)}<span class="dm-t">刚刚</span>`;
    stream.appendChild(div); scrollBottom();
    try{
      const {data,error}=await sb.from('eh_dm_messages')
        .insert({thread_id:curThread.id, from_uid:myUid, text})
        .select('id,created_at').single();
      if(error) throw error;
      if(data){ div.dataset.dmid=data.id; _lastMsgId=Math.max(_lastMsgId,data.id);
        div.querySelector('.dm-t').textContent=fmtTime(data.created_at); }
    }catch(e){
      console.warn('sendChat',e); div.style.opacity='.4';
      div.querySelector('.dm-t').textContent='发送失败'; toast('私信发送失败');
    }
  }
  async function markRead(){
    if(!curThread) return;
    try{ await sb.rpc('eh_dm_mark_read',{p_thread:curThread.id}); }catch(e){}
    refreshUnread();
  }

  // ---- 兜底轮询(实时丢事件时自愈, 仅会话窗开着时) ----
  function startTailPoll(){
    stopTailPoll();
    _tailPoll=setInterval(async()=>{
      if(!curThread) return;
      try{
        const {data}=await sb.from('eh_dm_messages').select('id,from_uid,text,created_at')
          .eq('thread_id',curThread.id).gt('id',_lastMsgId).order('id',{ascending:true});
        if(data && data.length){ let hadOther=false;
          data.forEach(m=>{ appendMsg(m); if(m.from_uid!==myUid) hadOther=true; });
          scrollBottom(); if(hadOther) markRead();
        }
      }catch(e){}
    }, 15000);
  }
  function stopTailPoll(){ if(_tailPoll){ clearInterval(_tailPoll); _tailPoll=null; } }

  // ---- 全局实时订阅(所有我参与的会话新消息) ----
  async function subscribeDm(){
    if(!sb || !myUid) return;
    try{ if(dmChan) await sb.removeChannel(dmChan); }catch(e){}
    dmChan=sb.channel('dm:'+myUid)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'eh_dm_messages'}, ({new:m})=>{
        if(!m) return;
        if(m.from_uid===myUid){ if(m.id) _lastMsgId=Math.max(_lastMsgId,m.id); return; }  // 自己发的忽略(乐观渲染已处理)
        if(curThread && m.thread_id===curThread.id){
          appendMsg(m); scrollBottom(); markRead();
        } else {
          _totalUnread++; paintUnread(); pingUnread();
          if($('#dmInboxMask')?.classList.contains('on')) refreshUnread();
          try{ EhSfx.play('pop'); }catch(e){}
        }
      })
      .subscribe();
  }

  // ---- 对外入口: 供 app.js 长按菜单/返回键接管调用 ----
  //   backChat: 会话窗返回(= ‹) —— 【一定回列表】。不论从列表点进还是长按头像直接进, 层级都是 列表→会话,
  //   返回退一级到列表; 再从列表返回才回大厅/房间(见 closeInbox)。
  function backChat(){ closeChat(); openInbox(); }
  window.EhDM = { open: openChat, openInbox, closeInbox, closeChat, backChat, refreshUnread, subscribe: subscribeDm };

  // ---- 绑定 ----
  function bind(){
    // 私信入口现在收在个人空间面板内(#meDmEntry, openMe 渲染时由 app.js 绑定); 这里只绑会话窗/收件箱自身控件。
    // 收件箱(顶层): ✕ / 点遮罩 = 关闭私信。
    $('#dmInboxDx')&&($('#dmInboxDx').onclick=closeInbox);
    $('#dmInboxMask')&&($('#dmInboxMask').onclick=closeInbox);
    // 会话窗: 只有 ‹ 返回(回到来处), 点遮罩同义; 已去掉右上 ✕。
    $('#dmChatBack')&&($('#dmChatBack').onclick=backChat);
    $('#dmChatMask')&&($('#dmChatMask').onclick=backChat);
    $('#dmChatSend')&&($('#dmChatSend').onclick=sendChat);
    const inp=$('#dmChatInput');
    if(inp){
      // ★输入法协同: 中文拼音候选期(compositionstart→end)按空格/回车是"选字/确认", 不是发送。
      //   用 isComposing + 自维护 _composing 双保险(部分安卓 IME 不给 isComposing), 候选期回车一律不发。
      let _composing=false;
      inp.addEventListener('compositionstart',()=>{ _composing=true; });
      inp.addEventListener('compositionend',()=>{ _composing=false; syncSendState(); });
      inp.addEventListener('keydown',e=>{
        if(e.key==='Enter' && !e.shiftKey){
          if(_composing || e.isComposing || e.keyCode===229){ return; }  // 229=IME 合成中的通用 keyCode
          e.preventDefault(); sendChat();
        }
      });
      inp.addEventListener('input', syncSendState);
      syncSendState();
    }
  }
  // 空文本时禁用发送按钮(灰态), 有内容才亮; compositionend/input 时刷新
  function syncSendState(){
    const inp=$('#dmChatInput'), btn=$('#dmChatSend'); if(!inp||!btn) return;
    const empty=!(inp.value||'').trim();
    btn.disabled=empty; btn.classList.toggle('is-disabled', empty);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind); else bind();

  // 身份就绪后订阅 + 拉未读。myUid 可能晚于本脚本 → 轮询等待。
  let _initTries=0;
  const _init=setInterval(()=>{
    _initTries++;
    if(typeof sb!=='undefined' && sb && typeof myUid!=='undefined' && myUid){ clearInterval(_init); subscribeDm(); refreshUnread(); }
    else if(_initTries>60){ clearInterval(_init); }   // 30s 放弃
  }, 500);
})();
