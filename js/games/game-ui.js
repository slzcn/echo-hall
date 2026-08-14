// ============================================================
// game-ui.js — 斗地主牌桌 UI（半屏浮层 + 霓虹牌面 + AI 陪玩驱动）
// ------------------------------------------------------------
// 依赖(浏览器全局): EHDeck / EHDdzRules / EHDdzEngine / EHDdzAI
// 对外: window.EHDdzGame.open({ mount, seat, names, avatars, onResult })
//   · 纯前端单人 vs AI:引擎跑在浏览器,AI 两家自动决策(定时器驱动)。
//   · 视觉走 Echo Hall 主题变量(--accent/--ink/--panel...),自适应任意皮肤。
//   · onResult(result, log) 回调:交给聊天室去写 eh_game_results + 播报。
// 无网络;真人房版本另接 Edge,复用同一引擎与本 UI。
// ============================================================
(function(root){
  'use strict';
  const Deck = root.EHDeck, Rules = root.EHDdzRules, Engine = root.EHDdzEngine, AI = root.EHDdzAI;

  // ── 一次性注入样式 ─────────────────────────────────────────
  const CSS_ID = 'ddz-ui-css';
  function injectCSS(){
    if (document.getElementById(CSS_ID)) return;
    const s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = `
.ddz-mask{position:fixed;inset:0;z-index:9200;display:flex;align-items:flex-end;justify-content:center;
  background:var(--mask,rgba(4,6,12,.7));backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  animation:ddzFade .18s ease}
@keyframes ddzFade{from{opacity:0}to{opacity:1}}
.ddz-sheet{position:relative;width:100%;max-width:560px;height:86vh;max-height:820px;
  background:linear-gradient(180deg,var(--bg2,#0d1524),var(--bg,#070a12));
  border:1px solid var(--line2,rgba(0,229,212,.38));border-bottom:none;
  border-radius:20px 20px 0 0;box-shadow:0 -8px 40px rgba(0,0,0,.55),var(--glow-cyan,0 0 22px rgba(0,229,212,.4));
  display:flex;flex-direction:column;overflow:hidden;animation:ddzUp .24s cubic-bezier(.2,.9,.3,1)}
@keyframes ddzUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
.ddz-top{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line,rgba(0,229,212,.24))}
.ddz-title{font-weight:800;letter-spacing:.06em;color:var(--ink,#eaf6ff);font-size:15px;display:flex;align-items:center;gap:8px}
.ddz-title .dot{width:8px;height:8px;border-radius:50%;background:var(--accent,#00e5d4);box-shadow:var(--glow-cyan)}
.ddz-x{margin-left:auto;width:30px;height:30px;border-radius:50%;border:1px solid var(--line);background:transparent;
  color:var(--sub,#86cbc6);font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.ddz-x:hover{color:var(--ink);border-color:var(--line2)}
.ddz-mult{font-size:12px;color:var(--amber,#ffc24d);font-weight:700;padding:2px 8px;border:1px solid var(--line);border-radius:999px}
/* 牌桌区 */
.ddz-table{flex:1;position:relative;display:flex;flex-direction:column;min-height:0}
.ddz-opps{display:flex;justify-content:space-between;padding:14px 18px 6px}
.ddz-opp{display:flex;flex-direction:column;align-items:center;gap:4px;width:96px}
.ddz-opp .av{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:24px;background:var(--panel,rgba(21,50,48,.8));border:1.5px solid var(--line2);position:relative}
.ddz-opp.turn .av{box-shadow:0 0 0 2px var(--accent),var(--glow-cyan);animation:ddzPulse 1.1s ease-in-out infinite}
.ddz-opp.landlord .av::after{content:'👑';position:absolute;top:-12px;left:50%;transform:translateX(-50%);font-size:15px}
@keyframes ddzPulse{0%,100%{box-shadow:0 0 0 2px var(--accent),0 0 6px rgba(0,229,212,.4)}50%{box-shadow:0 0 0 2px var(--accent),0 0 20px rgba(0,229,212,.75)}}
.ddz-opp .nm{font-size:11px;color:var(--sub);max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddz-opp .cnt{font-size:11px;color:var(--dim,#498d88);font-variant-numeric:tabular-nums}
.ddz-opp .cnt b{color:var(--ink)}
.ddz-say{position:absolute;top:52px;font-size:11px;color:var(--ink);background:var(--panel-solid,#132a29);
  border:1px solid var(--line);border-radius:10px;padding:3px 8px;max-width:130px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:3}
.ddz-say.show{opacity:1}
/* 中央出牌区 */
.ddz-center{flex:1;display:flex;align-items:center;justify-content:center;gap:20px;padding:4px 16px;min-height:120px;position:relative}
.ddz-lastplay{display:flex;flex-direction:column;align-items:center;gap:6px}
.ddz-lastplay .who{font-size:11px;color:var(--sub)}
.ddz-played{display:flex;min-height:74px;align-items:center;justify-content:center}
.ddz-passtag{color:var(--dim);font-size:15px;letter-spacing:.1em;border:1px dashed var(--line);border-radius:10px;padding:8px 16px}
.ddz-bottom-cards{position:absolute;top:8px;right:16px;display:flex;gap:3px;transform:scale(.62);transform-origin:top right;opacity:.9}
/* 卡牌 */
.card{width:46px;height:64px;border-radius:7px;background:#fff;position:relative;flex:none;
  box-shadow:0 2px 5px rgba(0,0,0,.35);border:1px solid rgba(0,0,0,.08);user-select:none;font-family:'Arial Narrow',Arial,sans-serif}
.card.red{color:#e0263e}.card.blk{color:#1a1e28}
.card .cn{position:absolute;top:3px;left:4px;font-size:15px;font-weight:800;line-height:1;text-align:center}
.card .cs{position:absolute;top:18px;left:5px;font-size:12px;line-height:1}
.card .cc{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:26px;opacity:.92}
.card.joker .cc{font-size:20px}
.card.joker.big{background:linear-gradient(150deg,#fff,#ffe9b8)}
.card.joker.small{background:linear-gradient(150deg,#fff,#e8ecff)}
.card.back{background:repeating-linear-gradient(45deg,#243056,#243056 5px,#1a2440 5px,#1a2440 10px);
  border:1px solid #3a4a80}
.card.mini{width:30px;height:42px}.card.mini .cn{font-size:11px}.card.mini .cs{font-size:8px;top:13px}.card.mini .cc{font-size:16px}
/* 手牌扇形 */
.ddz-hand-wrap{padding:6px 10px 4px;border-top:1px solid var(--line);background:linear-gradient(180deg,transparent,rgba(0,0,0,.18))}
.ddz-hand{display:flex;justify-content:center;padding:26px 0 8px;min-height:96px;flex-wrap:nowrap}
.ddz-hand .card{margin-left:-20px;transition:transform .14s ease,box-shadow .14s;cursor:pointer;transform-origin:bottom center}
.ddz-hand .card:first-child{margin-left:0}
.ddz-hand .card.sel{transform:translateY(-18px);box-shadow:0 6px 14px rgba(0,0,0,.4),0 0 0 2px var(--accent)}
.ddz-hand .card:hover{transform:translateY(-8px)}
.ddz-hand .card.sel:hover{transform:translateY(-18px)}
/* 操作条 */
.ddz-acts{display:flex;gap:10px;justify-content:center;padding:8px 16px calc(14px + env(safe-area-inset-bottom,0px))}
.ddz-btn{flex:1;max-width:130px;padding:11px 0;border-radius:12px;font-weight:800;font-size:15px;cursor:pointer;
  border:1px solid var(--line2);background:var(--panel);color:var(--ink);letter-spacing:.05em;transition:.14s}
.ddz-btn:active{transform:scale(.96)}
.ddz-btn.primary{background:var(--accent);color:var(--btn-ink,#04060c);border-color:var(--accent);box-shadow:var(--glow-cyan)}
.ddz-btn:disabled{opacity:.4;cursor:not-allowed;box-shadow:none}
.ddz-btn.ghost{background:transparent;color:var(--sub)}
/* 叫地主浮条 */
.ddz-bidbar{display:flex;flex-direction:column;align-items:center;gap:10px;padding:8px 16px calc(14px + env(safe-area-inset-bottom,0px))}
.ddz-bidbar .q{font-size:13px;color:var(--sub)}
.ddz-bidbtns{display:flex;gap:8px}
.ddz-bidbtns .ddz-btn{min-width:64px;max-width:none;flex:none;padding:9px 4px;font-size:14px}
/* 结算 */
.ddz-over{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
  background:rgba(4,6,12,.82);backdrop-filter:blur(3px);animation:ddzFade .2s}
.ddz-over h2{font-size:30px;margin:0;letter-spacing:.1em;font-weight:900}
.ddz-over.win h2{color:var(--accent);text-shadow:var(--glow-cyan)}
.ddz-over.lose h2{color:var(--magenta,#ff2d8e);text-shadow:var(--glow-mag)}
.ddz-over .sub{color:var(--sub);font-size:13px;text-align:center;line-height:1.6}
.ddz-over .score{font-size:22px;font-weight:800;color:var(--amber)}
.ddz-toast{position:absolute;top:44%;left:50%;transform:translate(-50%,-50%);background:var(--panel-solid);
  border:1px solid var(--line2);color:var(--ink);padding:8px 16px;border-radius:12px;font-size:13px;
  opacity:0;transition:opacity .2s;z-index:6;pointer-events:none}
.ddz-toast.show{opacity:1}
`;
    document.head.appendChild(s);
  }

  // ── 卡牌渲染 ───────────────────────────────────────────────
  function cardEl(card, opts){
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'card' + (opts.mini?' mini':'');
    if (card.joker){
      el.classList.add('joker', card.joker === 'big' ? 'big' : 'small');
      el.classList.add(card.joker === 'big' ? 'red' : 'blk');
      el.innerHTML = `<div class="cn">${card.joker==='big'?'大':'小'}</div><div class="cc">🃏</div>`;
    } else {
      const red = (card.suit === '♥' || card.suit === '♦');
      el.classList.add(red ? 'red' : 'blk');
      el.innerHTML = `<div class="cn">${card.label}</div><div class="cs">${card.suit}</div><div class="cc">${card.suit}</div>`;
    }
    el.dataset.id = card.id;
    return el;
  }
  function cardBack(mini){ const el=document.createElement('div'); el.className='card back'+(mini?' mini':''); return el; }

  // ── 主控 ───────────────────────────────────────────────────
  function open(opts){
    opts = opts || {};
    if (!Deck || !Rules || !Engine || !AI){ console.warn('[ddz] engine not loaded'); return null; }
    injectCSS();

    const mySeat = 0;
    const names = opts.names || ['你', '灵魂·左', '灵魂·右'];
    const avatars = opts.avatars || ['🙂','🤖','👾'];
    let st = Engine.createGame({ isAI:[false,true,true], names });
    let selected = new Set();     // 选中的 card id
    let aiTimer = null;

    // DOM 骨架
    const mask = document.createElement('div'); mask.className = 'ddz-mask';
    mask.innerHTML = `
      <div class="ddz-sheet" role="dialog" aria-label="斗地主">
        <div class="ddz-top">
          <div class="ddz-title"><span class="dot"></span>斗地主</div>
          <div class="ddz-mult" id="ddzMult">倍数 ×1</div>
          <button class="ddz-x" id="ddzX" aria-label="关闭">✕</button>
        </div>
        <div class="ddz-table">
          <div class="ddz-opps" id="ddzOpps"></div>
          <div class="ddz-center">
            <div class="ddz-bottom-cards" id="ddzBottom"></div>
            <div class="ddz-lastplay"><div class="who" id="ddzWho"></div><div class="ddz-played" id="ddzPlayed"></div></div>
          </div>
        </div>
        <div class="ddz-hand-wrap">
          <div class="ddz-hand" id="ddzHand"></div>
        </div>
        <div id="ddzCtrl"></div>
        <div class="ddz-toast" id="ddzToast"></div>
      </div>`;
    (opts.mount || document.body).appendChild(mask);

    const $ = sel => mask.querySelector(sel);
    const els = {
      opps:$('#ddzOpps'), center:$('.ddz-center'), who:$('#ddzWho'), played:$('#ddzPlayed'),
      hand:$('#ddzHand'), ctrl:$('#ddzCtrl'), mult:$('#ddzMult'), bottom:$('#ddzBottom'),
      toast:$('#ddzToast'), sheet:$('.ddz-sheet'),
    };

    function toast(msg){
      els.toast.textContent = msg; els.toast.classList.add('show');
      setTimeout(()=>els.toast.classList.remove('show'), 1100);
    }
    function say(seat, msg){
      const opp = els.opps.querySelector(`.ddz-opp[data-seat="${seat}"] .ddz-say`);
      if (!opp) return;
      opp.textContent = msg; opp.classList.add('show');
      setTimeout(()=>opp.classList.remove('show'), 1600);
    }

    function close(){ if (aiTimer) clearTimeout(aiTimer); mask.remove(); }
    $('#ddzX').addEventListener('click', close);
    mask.addEventListener('click', e=>{ if (e.target === mask) close(); });

    // ── 渲染:对手区(两个 AI) + 底牌 ──
    function renderOpps(){
      els.opps.innerHTML = '';
      [1,2].forEach(seat=>{
        const p = st.players[seat];
        const d = document.createElement('div');
        d.className = 'ddz-opp' + (st.turn===seat && st.phase!=='over' ? ' turn':'') + (st.landlord===seat?' landlord':'');
        d.dataset.seat = seat;
        d.innerHTML = `<div class="av">${avatars[seat]||'🤖'}</div>
          <div class="nm">${escapeHtml(p.name)}</div>
          <div class="cnt">剩 <b>${p.hand.length}</b> 张</div>
          <div class="ddz-say"></div>`;
        els.opps.appendChild(d);
      });
      // 底牌:未定地主时盖着,定了亮出来
      els.bottom.innerHTML = '';
      st.bottom.forEach(c=>{
        els.bottom.appendChild(st.phase==='bid' ? cardBack(true) : cardEl(c,{mini:true}));
      });
    }

    // ── 渲染:桌面最后一手 ──
    function renderTable(){
      els.mult.textContent = '倍数 ×' + st.multiplier;
      const lp = st.table.lastPlay;
      if (!lp){ els.who.textContent = ''; els.played.innerHTML = ''; return; }
      els.who.textContent = st.players[lp.seat].name + ' 出';
      els.played.innerHTML = '';
      // 从 log 拿实际 cards:lastPlay.cards 是 id 数组
      lp.cards.forEach(id=>{
        const card = findCardById(id);
        els.played.appendChild(cardEl(card));
      });
    }
    // lastPlay 只存 id,需要一张 id→card 表(用整副牌重建)
    const ALL = {}; Deck.standardDeck().forEach(c=>ALL[c.id]=c);
    function findCardById(id){ return ALL[id]; }

    // ── 渲染:我的手牌 ──
    function renderHand(){
      els.hand.innerHTML = '';
      const hand = st.players[mySeat].hand; // 已降序
      hand.forEach(card=>{
        const el = cardEl(card);
        if (selected.has(card.id)) el.classList.add('sel');
        el.addEventListener('click', ()=>{
          if (st.phase!=='play' || st.turn!==mySeat) return;
          if (selected.has(card.id)) selected.delete(card.id); else selected.add(card.id);
          el.classList.toggle('sel');
          updatePlayBtn();
        });
        els.hand.appendChild(el);
      });
    }

    // ── 控制区:叫地主 / 出牌 ──
    function renderCtrl(){
      if (st.phase === 'bid'){
        if (st.bid.turn === mySeat) renderBidBar();
        else els.ctrl.innerHTML = `<div class="ddz-bidbar"><div class="q">等待 ${escapeHtml(st.players[st.bid.turn].name)} 叫分…</div></div>`;
      } else if (st.phase === 'play'){
        renderActBar();
      } else {
        els.ctrl.innerHTML = '';
      }
    }
    function renderBidBar(){
      const max = st.bid.max;
      const opts2 = [0,1,2,3].map(v=>{
        const label = v===0?'不叫':(v+'分');
        const dis = (v!==0 && v<=max) ? 'disabled':'';
        return `<button class="ddz-btn ${v===3?'primary':''}" data-bid="${v}" ${dis}>${label}</button>`;
      }).join('');
      els.ctrl.innerHTML = `<div class="ddz-bidbar"><div class="q">${max>0?('当前最高 '+max+' 分，'):''}要不要抢地主？</div><div class="ddz-bidbtns">${opts2}</div></div>`;
      els.ctrl.querySelectorAll('[data-bid]').forEach(b=>{
        b.addEventListener('click', ()=>doCall(mySeat, +b.dataset.bid));
      });
    }
    function renderActBar(){
      const myTurn = st.turn === mySeat;
      const mustBeat = st.table.lastPlay && st.table.lastPlay.seat !== mySeat;
      els.ctrl.innerHTML = `<div class="ddz-acts">
        <button class="ddz-btn ghost" id="ddzPass" ${!myTurn||!mustBeat?'disabled':''}>不出</button>
        <button class="ddz-btn ghost" id="ddzHint" ${!myTurn?'disabled':''}>提示</button>
        <button class="ddz-btn primary" id="ddzPlay" disabled>出牌</button>
      </div>`;
      $('#ddzPass').addEventListener('click', ()=>doPass(mySeat));
      $('#ddzPlay').addEventListener('click', doPlay);
      $('#ddzHint').addEventListener('click', doHint);
      updatePlayBtn();
    }
    function updatePlayBtn(){
      const btn = $('#ddzPlay'); if (!btn) return;
      const cards = [...selected].map(findCardById);
      const p = cards.length ? Rules.parse(cards) : null;
      let okBtn = !!p && st.turn===mySeat;
      if (okBtn && st.table.lastPlay && st.table.lastPlay.seat!==mySeat)
        okBtn = Rules.beats(p, st.table.lastPlay.parse);
      btn.disabled = !okBtn;
    }

    // ── 动作 ──
    function doCall(seat, val){
      try { var r = Engine.applyCall(st, seat, val); }
      catch(e){ toast('不能这样叫'); return; }
      if (val>0) say(seat, val+'分！'); else say(seat,'不叫');
      if (r && r.redeal){ toast('都不叫，重新发牌'); st = Engine.createGame({isAI:[false,true,true],names}); selected.clear(); renderAll(); scheduleAI(); return; }
      renderAll();
      scheduleAI();
    }
    function doPlay(){
      const cards = [...selected].map(findCardById);
      try { var r = Engine.applyPlay(st, mySeat, cards); }
      catch(e){ toast(playErr(e.message)); return; }
      selected.clear();
      renderAll();
      if (r && r.over){ showOver(); return; }
      scheduleAI();
    }
    function doPass(seat){
      try { Engine.applyPass(st, seat); } catch(e){ toast('现在不能不出'); return; }
      say(seat,'不出');
      renderAll();
      scheduleAI();
    }
    function doHint(){
      const hand = st.players[mySeat].hand;
      const target = (st.table.lastPlay && st.table.lastPlay.seat!==mySeat) ? st.table.lastPlay.parse : null;
      const { plays, bombs, rocket } = AI.candidates(hand, target);
      let pick = plays[0] || bombs[0] || rocket;
      if (!pick){ toast('没有能压的牌，只能不出'); return; }
      const ids = (pick.cards||pick).map(c=>c.id);
      selected = new Set(ids);
      renderHand(); updatePlayBtn();
    }

    // ── AI 回合驱动 ──
    function scheduleAI(){
      if (aiTimer) clearTimeout(aiTimer);
      if (st.phase==='over') return;
      const seat = (st.phase==='bid') ? st.bid.turn : st.turn;
      if (seat === mySeat) return;      // 轮到玩家,等交互
      aiTimer = setTimeout(()=>aiStep(seat), 700 + Math.floor(Math.random()*500));
    }
    function aiStep(seat){
      if (st.phase === 'bid'){
        const val = AI.chooseBid(st.players[seat].hand, st.bid.max);
        doCall(seat, val);
        return;
      }
      if (st.phase !== 'play' || st.turn !== seat) return;
      const target = (st.table.lastPlay && st.table.lastPlay.seat!==seat) ? st.table.lastPlay.parse : null;
      const mv = AI.decide({ seat, hand: st.players[seat].hand, tableParse: target,
        handsLeft: st.players.map(p=>p.hand.length), landlord: st.landlord, iAmLandlord: seat===st.landlord });
      if (mv.action === 'pass'){ doPass(seat); }
      else {
        try { var r = Engine.applyPlay(st, seat, mv.cards); }
        catch(e){ doPass(seat); return; }   // AI 兜底:决策失误就过
        // 报单/剩牌少喊话
        maybeBanter(seat);
        renderAll();
        if (r && r.over){ showOver(); return; }
        scheduleAI();
      }
    }
    function maybeBanter(seat){
      const n = st.players[seat].hand.length;
      if (n === 1) say(seat, '只剩一张咯～');
      else if (n === 2) say(seat, '快没牌了！');
      else if (Math.random()<0.15) say(seat, rand(['接招','看我的','这手不错']));
    }

    // ── 结算浮层 ──
    function showOver(){
      const res = st.result;
      const iWon = res.winners.includes(mySeat);
      const over = document.createElement('div');
      over.className = 'ddz-over ' + (iWon?'win':'lose');
      const roleTxt = st.landlord===mySeat ? '地主' : '农民';
      over.innerHTML = `
        <h2>${iWon?'🎉 胜利':'😵 失败'}</h2>
        <div class="sub">你是${roleTxt} · ${res.landlordWon?'地主赢':'农民赢'}${res.spring?' · 春天翻倍':''}<br>底分 ${res.base} × 倍数 ${res.finalMultiplier}${res.bombs?(' · '+res.bombs+' 炸'):''}</div>
        <div class="score">${(res.delta[mySeat]>=0?'+':'')}${res.delta[mySeat]} 分</div>
        <div class="ddz-acts" style="margin-top:6px">
          <button class="ddz-btn" id="ddzAgain">再来一局</button>
          <button class="ddz-btn primary" id="ddzDone">收工</button>
        </div>`;
      els.sheet.querySelector('.ddz-table').appendChild(over);
      over.querySelector('#ddzAgain').addEventListener('click', ()=>{
        over.remove(); st = Engine.createGame({isAI:[false,true,true],names}); selected.clear(); renderAll(); scheduleAI();
      });
      over.querySelector('#ddzDone').addEventListener('click', close);
      if (typeof opts.onResult === 'function'){
        try { opts.onResult(res, st.log, { mySeat, roleTxt }); } catch(_){}
      }
    }

    function renderAll(){ renderOpps(); renderTable(); renderHand(); renderCtrl(); }

    // 开局
    renderAll();
    scheduleAI();
    return { close, state:()=>st };
  }

  // ── 小工具 ──
  function rand(a){ return a[Math.floor(Math.random()*a.length)]; }
  function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function playErr(code){
    return ({ cannot_beat:'压不过上家', illegal_type:'不是合法牌型', not_your_turn:'还没轮到你',
      not_in_hand:'牌不在手上', empty_play:'先选牌' })[code] || '出牌无效';
  }

  root.EHDdzGame = { open };
})(window);
