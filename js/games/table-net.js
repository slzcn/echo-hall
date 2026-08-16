/* table-net.js — 真人联机牌桌·聊天室牌桌卡 (phase-1 轻联机)
 * 只负责【牌桌卡 UI + 座位渲染 + 动作按钮接线】; 后端座位状态由 eh_game_tables + eh_gt_* RPC 提供,
 * app.js 负责 realtime 订阅与调 RPC, 通过 ctx.actions 回调进来。
 * 本文件放 js/games/(非 js/*.js) → 不计入危险 API 密度门, 卡内按钮统一用 .onclick=(不叠 addEventListener)。
 *
 * 牌桌卡消息编码: kind:'game', text = 'game|gt|<table_id>|<game>'
 *   —— 复用 buildGameEl 的 game 分支; 真正座位以【实时 table 行】为准, 不塞进消息文本。
 */
(function(root){
  'use strict';
  var CSS_ID='eh-table-net-css';
  function injectCSS(){
    if(document.getElementById(CSS_ID)) return;
    var s=document.createElement('style'); s.id=CSS_ID;
    s.textContent=[
      '.gt-card{border:1px solid var(--line,rgba(0,229,212,.24));border-radius:14px;padding:12px 13px;',
        'background:linear-gradient(160deg,rgba(0,229,212,.06),rgba(13,21,36,.5))}',
      '.gt-head{display:flex;align-items:center;gap:7px;margin-bottom:10px}',
      '.gt-head .ge{font-size:17px}',
      '.gt-head .gk{font-weight:800;color:var(--accent,#00e5d4);letter-spacing:.02em}',
      '.gt-head .gh{margin-left:auto;font-size:11px;color:var(--sub,#86cbc6)}',
      '.gt-badge{font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:999px;border:1px solid currentColor}',
      '.gt-badge.lobby{color:var(--amber,#ffc24d)}',
      '.gt-badge.playing{color:var(--accent,#00e5d4);animation:gtPulse 1.4s ease-in-out infinite}',
      '.gt-badge.closed,.gt-badge.done{color:var(--dim,#498d88)}',
      '@keyframes gtPulse{0%,100%{opacity:1}50%{opacity:.45}}',
      /* 单列纵向: 每席吃满卡宽, 灵魂下拉/长名不再被两列挤爆截断 */
      '.gt-teams{display:flex;flex-direction:column;gap:8px}',
      '.gt-team{display:flex;flex-direction:column;gap:6px}',
      '.gt-team-l{font-size:10px;font-weight:700;letter-spacing:.06em;text-align:left;opacity:.7;padding-left:2px;display:flex;align-items:center;gap:5px}',
      '.gt-team-l::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}',
      '.gt-team.us .gt-team-l{color:var(--accent,#00e5d4)}',
      '.gt-team.them .gt-team-l{color:var(--magenta,#ff2d8e)}',
      '.gt-seat{display:flex;align-items:center;gap:7px;padding:6px 8px;border-radius:10px;',
        'border:1px dashed var(--line,rgba(0,229,212,.24));min-height:34px}',
      '.gt-seat.filled{border-style:solid;background:rgba(0,229,212,.05)}',
      '.gt-seat.us.filled{border-color:rgba(0,229,212,.5)}',
      '.gt-seat.them.filled{border-color:rgba(255,45,142,.45)}',
      '.gt-seat.me{box-shadow:0 0 0 1px var(--accent,#00e5d4) inset}',
      '.gt-av{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:14px;',
        'background:rgba(255,255,255,.06);flex:none}',
      '.gt-nm{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}',
      '.gt-role{font-size:9.5px;padding:1px 5px;border-radius:6px;background:rgba(255,255,255,.08);color:var(--sub,#86cbc6);flex:none}',
      '.gt-role.soul{color:var(--magenta,#ff2d8e)}',
      '.gt-role.ai{color:var(--dim,#498d88)}',
      '.gt-empty .gt-nm{color:var(--dim,#498d88);font-weight:500}',
      '.gt-mini{font-size:11px;font-weight:700;border:1px solid var(--line2,rgba(0,229,212,.4));',
        'background:transparent;color:var(--accent,#00e5d4);border-radius:8px;padding:3px 8px;cursor:pointer;flex:none}',
      '.gt-mini.warn{color:var(--magenta,#ff2d8e);border-color:var(--magenta,#ff2d8e)}',
      '.gt-mini.kick{color:var(--dim,#498d88);border-color:transparent;padding:3px 5px}',
      '.gt-soulsel{font-size:11px;background:var(--panel-solid,#132a29);color:var(--ink,#eaf6ff);',
        'border:1px solid var(--line2,rgba(0,229,212,.4));border-radius:8px;padding:3px 4px;max-width:98px}',
      '.gt-foot{display:flex;gap:8px;align-items:center;margin-top:11px}',
      '.gt-foot .gt-tip{font-size:11px;color:var(--sub,#86cbc6);flex:1}',
      '.gt-btn{font-size:12.5px;font-weight:800;border-radius:9px;padding:6px 14px;cursor:pointer;border:1px solid}',
      '.gt-btn.go{background:var(--accent,#00e5d4);border-color:var(--accent,#00e5d4);color:#04060c;box-shadow:var(--glow-cyan,0 0 12px rgba(0,229,212,.5))}',
      '.gt-btn.ghost{background:transparent;border-color:var(--line2,rgba(0,229,212,.4));color:var(--sub,#86cbc6)}',
      '.gt-btn[disabled]{opacity:.4;cursor:default;box-shadow:none}'
    ].join('');
    document.head.appendChild(s);
  }

  var GAME_META={ guandan:{emoji:'🎴',label:'掼蛋',teams:true}, doudizhu:{emoji:'🃏',label:'斗地主',teams:false}, ddz:{emoji:'🃏',label:'斗地主',teams:false}, nlhe:{emoji:'🎰',label:'德州',teams:false} };
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

  function encode(tableId, game){ return ['game','gt',tableId,game||'guandan'].join('|'); }
  function decode(text){ var p=String(text||'').split('|'); return { ev:p[1], tableId:p[2], game:p[3]||'guandan' }; }

  // 一个座位 chip
  function seatChip(seat, ctx, meta){
    var kind=seat.kind, isMe=(kind==='human' && seat.uid===ctx.myUid);
    var teamCls = meta.teams ? (seat.seat%2===0?'us':'them') : 'us';
    var div=document.createElement('div');
    div.className='gt-seat '+teamCls+(kind==='empty'?' gt-empty':' filled')+(isMe?' me':'');
    if(kind==='empty'){
      div.innerHTML='<span class="gt-av">＋</span><span class="gt-nm">空位</span>';
      // 加入(招募中 && 我没被占座 && 我不是这桌的人时可加入; 若我已在别的座也允许换座)
      if(ctx.status==='lobby' && !ctx.iAmPlaying){
        var b=document.createElement('button'); b.className='gt-mini'; b.textContent='加入';
        b.onclick=function(){ ctx.actions.join(seat.seat); }; div.appendChild(b);
      }
      // host 招募灵魂
      if(ctx.status==='lobby' && ctx.isHost && ctx.souls && ctx.souls.length){
        var sel=document.createElement('select'); sel.className='gt-soulsel';
        var opt=document.createElement('option'); opt.value=''; opt.textContent='🤝灵魂'; sel.appendChild(opt);
        ctx.souls.forEach(function(s){ if(!s||!s.auth_uid) return;
          var o=document.createElement('option'); o.value=s.auth_uid; o.textContent=(s.emoji||'👤')+s.name; sel.appendChild(o); });
        sel.onchange=function(){ if(sel.value) ctx.actions.seatSoul(seat.seat, sel.value); };
        div.appendChild(sel);
      }
    } else {
      var roleCls = kind==='soul'?' soul':(kind==='ai'?' ai':'');
      var roleTxt = kind==='soul'?'灵魂':(kind==='ai'?'AI':(isMe?'你':'玩家'));
      div.innerHTML='<span class="gt-av">'+esc(seat.emoji||'🙂')+'</span>'
        +'<span class="gt-nm">'+esc(seat.name||'—')+'</span>'
        +'<span class="gt-role'+roleCls+'">'+roleTxt+'</span>';
      // 我自己(非 host)可离座
      if(ctx.status==='lobby' && isMe && !ctx.isHost){
        var lb=document.createElement('button'); lb.className='gt-mini warn'; lb.textContent='离座';
        lb.onclick=function(){ ctx.actions.leave(); }; div.appendChild(lb);
      }
      // host 可请离非 0 席的其他占用者
      if(ctx.status==='lobby' && ctx.isHost && seat.seat!==0){
        var kb=document.createElement('button'); kb.className='gt-mini kick'; kb.textContent='✕'; kb.title='请离';
        kb.onclick=function(){ ctx.actions.kick(seat.seat); }; div.appendChild(kb);
      }
    }
    return div;
  }

  // 渲染整张牌桌卡进 el(复用同一 el, 不新增监听)
  function renderLobby(el, row, ctx){
    injectCSS();
    var meta=GAME_META[row.game]||GAME_META.guandan;
    var seats=Array.isArray(row.seats)?row.seats.slice().sort(function(a,b){return a.seat-b.seat;}):[];
    // Realtime 可能重复投递同一行；状态未变化时跳过整卡重绘，避免无意义的布局/绘制抖动。
    var sig=String(row.status||'')+'|'+String(row.host_uid||'')+'|'+JSON.stringify(seats);
    if(el.dataset.gtSig===sig) return el;
    el.dataset.gtSig=sig;
    ctx.status=row.status; ctx.isHost=(row.host_uid===ctx.myUid);
    ctx.iAmPlaying=seats.some(function(s){ return s.kind==='human' && s.uid===ctx.myUid; });
    var humans=seats.filter(function(s){return s.kind==='human';}).length;

    el.className='game-card gt-card';
    el.dataset.gtId=row.id;
    el.innerHTML='';
    // 头
    var head=document.createElement('div'); head.className='gt-head';
    var st=row.status;
    var stLabel={lobby:'招募中',playing:'进行中',done:'已结束',closed:'已散桌'}[st]||st;
    head.innerHTML='<span class="ge">'+meta.emoji+'</span><span class="gk">'+meta.label+'牌桌</span>'
      +'<span class="gh">'+esc(ctx.hostName||'')+' 开桌</span>';
    var badge=document.createElement('span'); badge.className='gt-badge '+st; badge.textContent=stLabel;
    head.querySelector('.gh').appendChild(document.createTextNode(' '));
    head.appendChild(badge);
    el.appendChild(head);

    // 座位区
    if(meta.teams){
      var teams=document.createElement('div'); teams.className='gt-teams';
      var us=document.createElement('div'); us.className='gt-team us'; us.innerHTML='<div class="gt-team-l">我方</div>';
      var them=document.createElement('div'); them.className='gt-team them'; them.innerHTML='<div class="gt-team-l">对方</div>';
      seats.forEach(function(s){ (s.seat%2===0?us:them).appendChild(seatChip(s, ctx, meta)); });
      teams.appendChild(us); teams.appendChild(them); el.appendChild(teams);
    } else {
      var col=document.createElement('div'); col.className='gt-team us';
      seats.forEach(function(s){ col.appendChild(seatChip(s, ctx, meta)); });
      el.appendChild(col);
    }

    // 脚
    var foot=document.createElement('div'); foot.className='gt-foot';
    if(st==='lobby'){
      if(ctx.isHost){
        var tip=document.createElement('span'); tip.className='gt-tip';
        tip.textContent = humans>1 ? (humans+' 位真人在座 · 空位将由 AI 补齐') : '邀好友加入或拉灵魂 · 空位 AI 补齐';
        foot.appendChild(tip);
        var close=document.createElement('button'); close.className='gt-btn ghost'; close.textContent='散桌';
        close.onclick=function(){ ctx.actions.close(); }; foot.appendChild(close);
        var go=document.createElement('button'); go.className='gt-btn go'; go.textContent='开始 ▶';
        go.onclick=function(){ ctx.actions.start(); }; foot.appendChild(go);
      } else if(ctx.iAmPlaying){
        var t2=document.createElement('span'); t2.className='gt-tip'; t2.textContent='已入座 · 等房主开始…';
        foot.appendChild(t2);
      } else {
        var t3=document.createElement('span'); t3.className='gt-tip'; t3.textContent='点空位「加入」上桌';
        foot.appendChild(t3);
      }
    } else if(st==='playing'){
      var tp=document.createElement('span'); tp.className='gt-tip';
      tp.textContent = ctx.iAmPlaying ? '你在这局里' : '对局进行中';
      foot.appendChild(tp);
      if(ctx.iAmPlaying){
        var enter=document.createElement('button'); enter.className='gt-btn go'; enter.textContent='进入牌桌 ▶';
        enter.onclick=function(){ ctx.actions.enter(); }; foot.appendChild(enter);
      }
    } else {
      var td=document.createElement('span'); td.className='gt-tip'; td.textContent = st==='closed'?'牌桌已散':'本局已结束';
      foot.appendChild(td);
    }
    el.appendChild(foot);
    return el;
  }

  root.EHTable={ encode:encode, decode:decode, renderLobby:renderLobby };
})(typeof window!=='undefined'?window:this);
