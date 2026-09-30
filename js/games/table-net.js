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
      '.gt-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:11px}',
      /* 提示独占一行(flex基100%), 按钮另起一排铺开 —— 否则 tip 抢空间把多个按钮挤到极窄, 中文逐字竖排断行(主人反馈"不够美观") */
      '.gt-foot .gt-tip{font-size:11px;color:var(--sub,#86cbc6);flex:1 1 100%;line-height:1.45}',
      /* nowrap+不收缩: 每个按钮保持整词一行, 排不下就整体换行, 绝不再断成竖排单字 */
      '.gt-btn{font-size:12.5px;font-weight:800;border-radius:9px;padding:7px 13px;cursor:pointer;border:1px solid;white-space:nowrap;flex:0 0 auto}',
      /* 字色走 --btn-ink: 夜间(深)配青底、日间(白)配深金底都读得清 —— 硬编码 #04060c 深字在日间深金 accent 上糊成一坨(主人反馈) */
      '.gt-btn.go{background:var(--accent,#00e5d4);border-color:var(--accent,#00e5d4);color:var(--btn-ink,#04060c);box-shadow:var(--glow-cyan,0 0 12px rgba(0,229,212,.5))}',
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
      // 加入: 招募中随时可坐; 德州(桌注制真牌桌)进行中也放行 —— 路人点空位坐下, host 下一手换掉 AI 顶位。
      //   (掼蛋/斗地主固定阵型, 开局后空位已焊成 AI, 不再显示加入。)
      var canJoin = (ctx.status==='lobby' || (ctx.status==='playing' && ctx.game==='nlhe'));
      if(canJoin && !ctx.iAmPlaying){
        var b=document.createElement('button'); b.className='gt-mini'; b.textContent='加入';
        b.onclick=function(){ ctx.actions.join(seat.seat); }; div.appendChild(b);
      }
      // host 补位(灵魂/机器人同型, 有灵魂优先): 招募中可选; 德州局中空位也可选灵魂
      var soulFillOk = ctx.isHost && ctx.actions && ctx.actions.seatSoul
        && ctx.souls && ctx.souls.length
        && (ctx.status==='lobby' || (ctx.status==='playing' && ctx.game==='nlhe'));
      if(soulFillOk){
        var sel=document.createElement('select'); sel.className='gt-soulsel';
        var opt=document.createElement('option'); opt.value=''; opt.textContent='🤝补位'; sel.appendChild(opt);
        ctx.souls.forEach(function(s){ if(!s||!s.auth_uid) return;
          var o=document.createElement('option'); o.value=s.auth_uid; o.textContent=(s.emoji||'👤')+s.name; sel.appendChild(o); });
        sel.onchange=function(){ if(sel.value) ctx.actions.seatSoul(seat.seat, sel.value); };
        div.appendChild(sel);
      }
    } else {
      // clone = 灵魂分身(host 本机 AI 顶着灵魂身份代打的副本): 归灵魂色系(非真人), 但文字用「分身」
      //   与真灵魂/匿名 AI/真人玩家都区分开 —— 状态忠实: 别把 AI 副本冒充成真人玩家。
      var roleCls = (kind==='soul'||kind==='clone')?' soul':(kind==='ai'?' ai':'');
      var roleTxt = kind==='soul'?'灵魂':(kind==='clone'?'分身':(kind==='ai'?'灵魂':(isMe?'你':'玩家')));
      div.innerHTML='<span class="gt-av">'+esc(seat.emoji||'🙂')+'</span>'
        +'<span class="gt-nm">'+esc(seat.name||'—')+'</span>'
        +'<span class="gt-role'+roleCls+'">'+roleTxt+'</span>';
      // 我自己(非 host)可离座
      if(ctx.status==='lobby' && isMe && !ctx.isHost){
        var lb=document.createElement('button'); lb.className='gt-mini warn'; lb.textContent='离座';
        lb.onclick=function(){ ctx.actions.leave(); }; div.appendChild(lb);
      }
      // host 可请离非 0 席的其他占用者(仅德州: 斗地主/掼蛋已"满员自动开局", 无请离环节)
      if(ctx.status==='lobby' && ctx.isHost && seat.seat!==0 && ctx.game==='nlhe'){
        var kb=document.createElement('button'); kb.className='gt-mini kick'; kb.textContent='✕'; kb.title='请离';
        kb.onclick=function(){ ctx.actions.kick(seat.seat); }; div.appendChild(kb);
      }
      // 德州: 灵魂/分身/AI 席可被真人【顶替】—— 真人点一下换下 AI 顶位、自己坐进这席(招募中/进行中都放行)。
      //   我未在座 且 非本人席时才显示; 顶替走 eh_gt_join(nlhe 已放行非真人席), host 下一手把该席换成真人。
      if(ctx.game==='nlhe' && !isMe && !ctx.iAmPlaying
         && (kind==='soul'||kind==='clone'||kind==='ai')
         && (ctx.status==='lobby'||ctx.status==='playing')){
        var tk=document.createElement('button'); tk.className='gt-mini'; tk.textContent='顶替';
        tk.title='换下这个 AI/灵魂席，自己坐下'; tk.onclick=function(){ ctx.actions.join(seat.seat); };
        div.appendChild(tk);
      }
    }
    return div;
  }

  // 渲染整张牌桌卡进 el(复用同一 el, 不新增监听) —— 轻量入口卡(同德州风格)
  function renderLobby(el, row, ctx){
    injectCSS();
    var meta = GAME_META[row.game] || GAME_META.guandan;
    var seats = Array.isArray(row.seats) ? row.seats.slice() : [];
    var sig = String(row.status||'')+'|'+String(row.host_uid||'')+'|'+JSON.stringify(seats)+'|'+(ctx.seatPage?'sp':'cf');
    if(el.dataset.gtSig === sig) return el;
    el.dataset.gtSig = sig;

    ctx.status = row.status; ctx.game = row.game;
    // 无房主架构: 德州(nlhe)的"host"= 座位最小的真人; 其他玩法仍用 host_uid
    if(ctx.game === 'nlhe'){
      var humanSeats = seats.filter(function(s){ return s.kind === 'human' && s.uid; }).sort(function(a,b){ return a.seat - b.seat; });
      ctx.isHost = humanSeats.length > 0 && humanSeats[0].uid === ctx.myUid;
    } else {
      ctx.isHost = (row.host_uid === ctx.myUid);
    }
    ctx.iAmPlaying = seats.some(function(s){ return s.kind==='human' && s.uid===ctx.myUid; });

    var humans = seats.filter(function(s){ return s.kind==='human'; }).length;
    var empties = seats.filter(function(s){ return s.kind==='empty'; }).length;
    var total = seats.length;
    var st = row.status;
    var stLabel = {lobby:'招募中', playing:'进行中', done:'已结束', closed:'已散桌'}[st] || st;
    var hostName = (seats[0] && seats[0].name) || esc(ctx.hostName || '');

    // 座位页模式: 不加 gt-card-openable, 不设整卡 onclick(座位页外层遮罩管关闭)
    el.className = 'game-card gt-card' + (ctx.seatPage ? '' : ' gt-card-openable');
    el.dataset.gtId = row.id;
    el.innerHTML = '';

    // 头部
    var head = document.createElement('div'); head.className = 'gt-head';
    var badge = '<span class="gt-badge '+(st)+'">' + stLabel + '</span>';
    head.innerHTML = '<span class="ge">' + meta.emoji + '</span>'
      + '<span class="gk">' + meta.label + '牌桌</span>'
      + '<span class="gh">' + esc(hostName) + ' 开桌 ' + badge + '</span>';
    el.appendChild(head);

    // ── 座位页模式: 渲染座位列表 + 操作按钮(一键补位/开始/解散) ──
    if(ctx.seatPage && st === 'lobby'){
      // 座位列表
      if(meta.teams){
        // 掼蛋分组: 我方(seat 0,2) / 对方(seat 1,3)
        var teams=document.createElement('div'); teams.className='gt-teams';
        var usSeats=seats.filter(function(s){return s.seat%2===0;}).sort(function(a,b){return a.seat-b.seat;});
        var themSeats=seats.filter(function(s){return s.seat%2===1;}).sort(function(a,b){return a.seat-b.seat;});
        var usDiv=document.createElement('div'); usDiv.className='gt-team us';
        usDiv.innerHTML='<div class="gt-team-l">我方</div>';
        usSeats.forEach(function(s){ usDiv.appendChild(seatChip(s,ctx,meta)); });
        var themDiv=document.createElement('div'); themDiv.className='gt-team them';
        themDiv.innerHTML='<div class="gt-team-l">对方</div>';
        themSeats.forEach(function(s){ themDiv.appendChild(seatChip(s,ctx,meta)); });
        teams.appendChild(usDiv); teams.appendChild(themDiv);
        el.appendChild(teams);
      } else {
        // 斗地主等: 单列
        var list=document.createElement('div'); list.className='gt-teams';
        var team=document.createElement('div'); team.className='gt-team us';
        seats.sort(function(a,b){return a.seat-b.seat;}).forEach(function(s){ team.appendChild(seatChip(s,ctx,meta)); });
        list.appendChild(team);
        el.appendChild(list);
      }

      // 底部按钮
      var foot2=document.createElement('div'); foot2.className='gt-foot';
      var tip2=document.createElement('span'); tip2.className='gt-tip';
      // 无房主架构: 德州(nlhe)满2席(含灵魂/AI)自动开始, 不需要手动开始/解散按钮
      if(ctx.game === 'nlhe'){
        var occupiedN = seats.filter(function(s){ return s && s.kind && s.kind!=='empty'; }).length;
        var needNlhe = Math.max(0, 2 - occupiedN);
        tip2.textContent = needNlhe > 0 ? ('再来 ' + needNlhe + ' 人自动开始') : '即将自动开始...';
      } else {
        tip2.textContent = empties > 0 ? ('还有 ' + empties + ' 个空位') : '座位已满 · 可以开始了';
      }
      foot2.appendChild(tip2);

      // 一键补位(人人可点; 房间里权限一样)
      if(empties > 0){
        var fillBtn=document.createElement('button');
        fillBtn.className='gt-btn go';
        fillBtn.textContent='一键补位 ▶';
        fillBtn.onclick=function(e){ e.stopPropagation(); if(ctx.actions && ctx.actions.fillSouls) ctx.actions.fillSouls(); };
        foot2.appendChild(fillBtn);
      }
      // 开始 ▶: 仅非德州(nlhe)显示(德州满2人自动开始)。人人可点。
      if(ctx.game !== 'nlhe'){
        var startBtn=document.createElement('button');
        startBtn.className = empties === 0 ? 'gt-btn go' : 'gt-btn ghost';
        startBtn.textContent='开始 ▶';
        startBtn.onclick=function(e){ e.stopPropagation(); if(ctx.actions && ctx.actions.start) ctx.actions.start(); };
        foot2.appendChild(startBtn);
      }
      // 解散: 仅 lobby 且非德州(nlhe 无真人自动散)。人人可点。
      if(st === 'lobby' && ctx.game !== 'nlhe'){
        var closeBtn2=document.createElement('button');
        closeBtn2.className='gt-btn ghost';
        closeBtn2.textContent='解散';
        closeBtn2.onclick=function(e){ e.stopPropagation(); if(ctx.actions && ctx.actions.close) ctx.actions.close(); };
        foot2.appendChild(closeBtn2);
      }
      el.appendChild(foot2);
      return el;
    }

    // ── 聊天流轻量卡模式 ──
    // 状态/提示行 + 按钮
    var foot = document.createElement('div'); foot.className = 'gt-foot';

    if(st === 'lobby' || st === 'playing'){
      var tip = document.createElement('span'); tip.className = 'gt-tip';
      if(st === 'playing'){
        tip.textContent = ctx.iAmPlaying ? '你在这局里 · 点卡回到牌桌' : '对局进行中';
      } else {
        if(ctx.game === 'nlhe'){
          // 无房主架构: 德州满2席(含灵魂/AI)自动开始
          var occ = seats.filter(function(s){ return s && s.kind && s.kind!=='empty'; }).length;
          var need = Math.max(0, 2 - occ);
          if(ctx.iAmPlaying) tip.textContent = '已入座 · 点卡进牌桌';
          else if(need > 0) tip.textContent = '再来 ' + need + ' 人自动开始';
          else tip.textContent = '即将自动开始...';
        } else {
          if(ctx.iAmPlaying) tip.textContent = '已入座 · 点卡进牌桌';
          else tip.textContent = empties > 0 ? ('还有 ' + empties + ' 个空位 · 点卡入座') : '座位已满 · 即将开局';
        }
      }
      foot.appendChild(tip);

      // 人数信息
      var cnt = document.createElement('span');
      cnt.className = 'gt-tip';
      cnt.style.cssText = 'flex:0 0 auto;opacity:.7';
      cnt.textContent = humans + ' 真人 / ' + (total - humans) + ' 空位';
      foot.appendChild(cnt);

      // 进入按钮（所有人）
      var enterBtn = document.createElement('button');
      enterBtn.className = 'gt-btn go';
      enterBtn.textContent = st === 'playing' ? '进入牌桌 ▶' : (ctx.iAmPlaying ? '进入牌桌 ▶' : '加入 ▶');
      enterBtn.onclick = function(e){ e.stopPropagation(); if(ctx.actions && ctx.actions.enter) ctx.actions.enter(); else if(ctx.actions && ctx.actions.start) ctx.actions.start(); };
      foot.appendChild(enterBtn);

      // 解散: 仅 lobby 且非德州(nlhe 的 lobby 解散走 gtAppendDismiss, 免双钮)。
      //   playing 一律不给中途散桌入口(德州=离桌腾席/无真人自动散; 斗地主/掼蛋=房主收工)。
      if(ctx.game !== 'nlhe' && st === 'lobby'){
        var closeBtn = document.createElement('button');
        closeBtn.className = 'gt-btn ghost';
        closeBtn.textContent = '解散';
        closeBtn.onclick = function(e){ e.stopPropagation(); if(ctx.actions && ctx.actions.close) ctx.actions.close(); };
        foot.appendChild(closeBtn);
      }
    } else {
      var endTip = document.createElement('span'); endTip.className = 'gt-tip';
      endTip.textContent = st === 'closed' ? '牌桌已解散' : '本局已结束';
      foot.appendChild(endTip);
    }

    el.appendChild(foot);

    // 整卡可点（点非按钮区域进入牌桌）
    el.onclick = function(e){
      if(e.target.closest('button')) return;
      if(ctx.actions && ctx.actions.enter) ctx.actions.enter();
      else if(ctx.actions && ctx.actions.start) ctx.actions.start();
    };

    return el;
  }

  root.EHTable={ encode:encode, decode:decode, renderLobby:renderLobby, ensureCSS:injectCSS };
})(typeof window!=='undefined'?window:this);
