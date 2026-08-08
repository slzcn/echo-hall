/* ============ 私信系统 (DM) — 前端 ============
   脱离房间的持久 1v1 会话。后端: eh_dm_threads / eh_dm_messages + RPC
   (eh_dm_get_or_create / eh_dm_mark_read / eh_dm_inbox)。
   实时: 订阅 eh_dm_messages INSERT, 靠 RLS 只投递"我参与的线"的行。
   依赖 app.js 的全局(经典 <script> 共享词法作用域, 本文件在 app.js 之后加载):
     sb, me, myUid, esc, toast, awaitSb, safeColor, safeEmoji, ehArm, EhSfx。
   方案B: 匿名也能收发(在场即可发起), 正式账号享持久化。 */
(function(){
  'use strict';
  const $ = s => document.querySelector(s);

  let dmChan = null;             // 全局实时通道
  let curThread = null;          // 当前打开的会话 {id, otherUid, otherName, otherEmoji, otherColor}
  let _totalUnread = 0;
  let _tailPoll = null;          // 会话窗兜底轮询
  let _lastMsgId = 0;            // 已渲染的最大消息 id(兜底轮询/实时去重)

  // ---- 键盘协同: 会话窗是独立 position:fixed 抽屉, keyboard.js 只管 #hall 不管它。
  //   iOS Safari 无 VirtualKeyboard API、走 visualViewport, fixed 锚 layout viewport(不随键盘缩)
  //   → bottom:0 落键盘背后, 输入框被盖住。按验证过的方案把抽屉钉到 visualViewport:
  //   top=vv.offsetTop + height=vv.height(去掉 bottom:0), 让 .dm-stream(flex:1)被挤扁而 composer 常驻可视底。
  //   Android 占位式键盘(overlaysContent=false)本就顶起 viewport, 此时 top≈0/height≈innerHeight → 本绑定近似空操作, 不回归。
  const _vv = window.visualViewport;
  const _softKb = () => { try{ return window.matchMedia('(hover:none) and (pointer:coarse)').matches; }catch(e){ return false; } };
  function fitChatViewport(){
    const d=$('#dmChatDrawer'); if(!d || !d.classList.contains('on')) return;
    if(!_vv || !_softKb()) return;                 // 桌面/无 vv: 留默认 top:0/bottom:0 全高
    d.style.top=_vv.offsetTop+'px';
    d.style.height=_vv.height+'px';
    d.style.bottom='auto';                          // 必须放开 bottom, 否则 top+bottom+height 过约束会忽略 height
    scrollBottom();                                 // 键盘挤扁 stream 后重新贴底, 别把最新消息顶出可视区
  }
  function bindChatViewport(){
    if(!_vv) return;
    _vv.addEventListener('resize', fitChatViewport);
    _vv.addEventListener('scroll', fitChatViewport);
    fitChatViewport();
  }
  function unbindChatViewport(){
    if(_vv){ _vv.removeEventListener('resize', fitChatViewport); _vv.removeEventListener('scroll', fitChatViewport); }
    const d=$('#dmChatDrawer'); if(d){ d.style.top=''; d.style.height=''; d.style.bottom=''; }
  }

  function fmtTime(iso){
    try{ const d=new Date(iso); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }catch(e){ return ''; }
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
  async function openInbox(){
    try{ await awaitSb(); }catch(e){}
    if(!myUid){ toast('身份加载中，请稍后再试'); return; }
    $('#dmInboxMask').classList.add('on'); $('#dmInboxDrawer').classList.add('on');
    try{ ehArm(); }catch(e){}
    $('#dmInboxBody').innerHTML='<div class="empty-hint">加载中…</div>';
    try{
      const {data,error}=await sb.rpc('eh_dm_inbox');
      if(error) throw error;
      renderInbox(data);
      _totalUnread=(data||[]).reduce((s,t)=>s+(t.unread||0),0); paintUnread();
    }catch(e){ $('#dmInboxBody').innerHTML='<div class="empty-hint">加载失败，稍后重试</div>'; }
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
    body.querySelectorAll('.dm-thread').forEach(el=>el.onclick=()=>{
      openChat(el.dataset.uid, el.dataset.nm, el.dataset.em, el.dataset.c);
    });
  }

  // ---- 会话窗 ----
  // 灵魂(AI)暂不在私信闭环里(那端没人接), 任何入口打开跟灵魂的会话都拦掉——含收件箱里的历史灵魂线。
  function isSoulTarget(uid, name){ try{ return typeof isSoulUser==='function' && isSoulUser(uid, name); }catch(e){ return false; } }
  async function openChat(otherUid, otherName, otherEmoji, otherColor){
    try{ await awaitSb(); }catch(e){}
    if(!myUid){ toast('身份加载中，请稍后再试'); return; }
    if(otherUid===myUid){ toast('不能给自己发私信'); return; }
    if(isSoulTarget(otherUid, otherName)){ toast('灵魂暂不支持私信哦'); return; }
    $('#dmChatTitle').textContent=otherName||'私信';
    $('#dmChatStream').innerHTML='<div class="empty-hint">加载中…</div>';
    $('#dmChatMask').classList.add('on'); $('#dmChatDrawer').classList.add('on');
    try{ ehArm(); }catch(e){}
    bindChatViewport();
    _lastMsgId=0;
    try{
      const {data:thread,error}=await sb.rpc('eh_dm_get_or_create',{p_other:otherUid});
      if(error) throw error;
      curThread={ id:thread.id, otherUid, otherName, otherEmoji, otherColor };
      await loadMessages();
      await markRead();
      startTailPoll();
      const inp=$('#dmChatInput'); if(inp){ try{ inp.focus(); }catch(e){} }
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
  async function loadMessages(){
    if(!curThread) return;
    const {data,error}=await sb.from('eh_dm_messages').select('id,from_uid,text,created_at')
      .eq('thread_id',curThread.id).order('id',{ascending:true}).limit(200);
    if(error){ $('#dmChatStream').innerHTML='<div class="empty-hint">消息加载失败</div>'; return; }
    const stream=$('#dmChatStream'); stream.innerHTML='';
    (data||[]).forEach(m=>appendMsg(m));
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
          _totalUnread++; paintUnread();
          if($('#dmInboxMask')?.classList.contains('on')) refreshUnread();
          try{ EhSfx.play('pop'); }catch(e){}
        }
      })
      .subscribe();
  }

  // ---- 对外入口: 供 app.js 长按菜单/返回键接管调用 ----
  //   backChat: 会话窗返回(= ‹, 回收件箱); closeInbox/closeChat: 供 navConsume 关层。
  function backChat(){ closeChat(); openInbox(); }
  window.EhDM = { open: openChat, openInbox, closeInbox, closeChat, backChat, refreshUnread, subscribe: subscribeDm };

  // ---- 绑定 ----
  function bind(){
    // 私信入口现在收在个人空间面板内(#meDmEntry, openMe 渲染时由 app.js 绑定); 这里只绑会话窗/收件箱自身控件。
    $('#dmInboxDx')&&($('#dmInboxDx').onclick=closeInbox);
    $('#dmInboxMask')&&($('#dmInboxMask').onclick=closeInbox);
    $('#dmChatDx')&&($('#dmChatDx').onclick=closeChat);
    $('#dmChatBack')&&($('#dmChatBack').onclick=()=>{ closeChat(); openInbox(); });
    $('#dmChatMask')&&($('#dmChatMask').onclick=closeChat);
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
