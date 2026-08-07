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

  function fmtTime(iso){
    try{ const d=new Date(iso); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }catch(e){ return ''; }
  }

  // ---- 未读红点 ----
  function paintUnread(){
    ['#dmBtnLobby','#dmBtnHall'].forEach(sel=>{
      const b=$(sel); if(!b) return;
      b.classList.toggle('has-unread', _totalUnread>0);
      const dot=b.querySelector('.dm-dot'); if(dot) dot.textContent = _totalUnread>9?'9+':String(_totalUnread);
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
    if(!list || !list.length){ body.innerHTML='<div class="empty-hint">还没有私信。长按某人头像即可发起私信 ✉️</div>'; return; }
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
  async function openChat(otherUid, otherName, otherEmoji, otherColor){
    try{ await awaitSb(); }catch(e){}
    if(!myUid){ toast('身份加载中，请稍后再试'); return; }
    if(otherUid===myUid){ toast('不能给自己发私信'); return; }
    $('#dmChatTitle').textContent=otherName||'私信';
    $('#dmChatStream').innerHTML='<div class="empty-hint">加载中…</div>';
    $('#dmChatMask').classList.add('on'); $('#dmChatDrawer').classList.add('on');
    try{ ehArm(); }catch(e){}
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
    inp.value='';
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

  // ---- 对外入口: 供 app.js 长按菜单调用 ----
  window.EhDM = { open: openChat, openInbox, refreshUnread, subscribe: subscribeDm };

  // ---- 绑定 ----
  function bind(){
    $('#dmBtnLobby')&&($('#dmBtnLobby').onclick=openInbox);
    $('#dmBtnHall')&&($('#dmBtnHall').onclick=openInbox);
    $('#dmInboxDx')&&($('#dmInboxDx').onclick=closeInbox);
    $('#dmInboxMask')&&($('#dmInboxMask').onclick=closeInbox);
    $('#dmChatDx')&&($('#dmChatDx').onclick=closeChat);
    $('#dmChatBack')&&($('#dmChatBack').onclick=()=>{ closeChat(); openInbox(); });
    $('#dmChatMask')&&($('#dmChatMask').onclick=closeChat);
    $('#dmChatSend')&&($('#dmChatSend').onclick=sendChat);
    $('#dmChatInput')&&$('#dmChatInput').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChat(); } });
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
