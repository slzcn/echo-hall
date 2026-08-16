// ============================================================
// poker-engine.js — 无限注德州扑克局状态机（纯函数「权威裁判」）
// ------------------------------------------------------------
// 职责:
//   · 从 seed 洗牌发牌(确定性, 可复核/回看); 下盲注; 逐街下注轮转
//   · 行动: fold/check/call/bet/raise/allin —— 合法性+最小加注+全下短加注不重开
//   · 自动发翻牌/转牌/河牌; 全员 all-in 自动跑完到摊牌
//   · 边池(side pot)分配: 按各家投入分层, 每层给合格者中最佳成手牌, 平分带余数
//   · 每步 append transition 到 log → 记分复核 + 回看重放共用
// 无 DOM/网络; 随机仅洗牌用可复现 seed。同一份跑客户端(host)与 Edge。
//
// 关键约定:
//   · amount 语义: bet/raise 传「本街累计到的总额(raise-to)」; call/check/fold/allin 不传。
//   · 未盖牌(含 all-in)玩家进摊牌; committed=本手总投入; street=本街投入。
//   · state._deck 是 host 专属(含未来公共牌), 快照层必须剥离, 绝不下发客户端。
// ============================================================
(function(root, factory){
  const mod = factory(
    (typeof require==='function') ? require('./deck.js') : (root.EHDeck),
    (typeof require==='function') ? require('./poker-eval.js') : (root.EHPokerEval)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.EHPokerEngine = mod;
})(this, function(Deck, Eval){
  'use strict';

  const SUITS = ['♠','♥','♣','♦'];
  const SUIT_KEY = { '♠':'s','♥':'h','♣':'c','♦':'d' };
  const LABEL = { 11:'J', 12:'Q', 13:'K', 14:'A' };
  function pokerCard(rank, suit){
    return { rank, suit, label: LABEL[rank] || String(rank), id: SUIT_KEY[suit] + rank };
  }
  function pokerDeck(){
    const cs = [];
    for (let r = 2; r <= 14; r++) for (const s of SUITS) cs.push(pokerCard(r, s));
    return cs;
  }

  const PHASES = ['preflop', 'flop', 'turn', 'river', 'showdown', 'over'];
  const NEXT_STREET = { preflop:'flop', flop:'turn', turn:'river', river:'showdown' };
  const STREET_DEAL = { flop:3, turn:1, river:1 };

  // ── 建局 ──────────────────────────────────────────────────
  // opts: { seed, names[], isAI[], stacks[]|startStack, sb, bb, button }
  function createGame(opts){
    opts = opts || {};
    const names = opts.names || ['你','对手'];
    const n = names.length;
    if (n < 2) throw new Error('need_2_players');
    const isAI = opts.isAI || names.map((_, i) => i !== 0);
    const sb = opts.sb || 5, bb = opts.bb || 10;
    const startStack = opts.startStack || 1000;
    const stacks = opts.stacks || names.map(() => startStack);
    const button = (typeof opts.button === 'number') ? (opts.button % n) : 0;

    const { seed, cards } = Deck.shuffle(pokerDeck(), opts.seed);

    const players = names.map((nm, seat) => ({
      id: (opts.ids && opts.ids[seat]) || ('p' + seat),
      seat, name: nm || ('席' + seat), isAI: !!isAI[seat],
      stack: stacks[seat], start: stacks[seat],
      hole: [], folded: false, allin: false, committed: 0, street: 0, acted: false,
    }));

    const state = {
      variant: 'nlhe', phase: 'preflop', seed, n, button, sb, bb,
      players, board: [],
      _deck: { cards, cursor: 0 },
      street: 'preflop', currentBet: 0, minRaise: bb, aggressor: null,
      toAct: -1, pot: 0, result: null,
      log: [{ t:'deal', seed, button, sb, bb, n, stacks: stacks.slice(), names: names.slice() }],
    };

    // 发底牌: 从庄家左手第一位起, 每人两张(轮发, 与真实一致)
    const order = seatOrderFrom(state, (button + 1) % n);
    for (let round = 0; round < 2; round++)
      for (const s of order) state.players[s].hole.push(drawCard(state));

    // 下盲注
    let sbSeat, bbSeat, firstToAct;
    if (n === 2){ sbSeat = button; bbSeat = (button + 1) % n; firstToAct = button; }
    else { sbSeat = (button + 1) % n; bbSeat = (button + 2) % n; firstToAct = (button + 3) % n % n; }
    postBlind(state, sbSeat, sb, 'sb');
    postBlind(state, bbSeat, bb, 'bb');
    state.currentBet = Math.max(state.players[sbSeat].street, state.players[bbSeat].street);
    state.minRaise = bb;
    // 首个行动位: 从 firstToAct 起找到第一个能行动的
    state.toAct = needsActionFrom(state, firstToAct);
    syncPot(state);
    // 若发完盲注已无人可行动(极端: 都 all-in), 直接跑完
    if (state.toAct === -1) runout(state);
    return state;
  }

  function seatOrderFrom(state, start){
    const out = [];
    for (let i = 0; i < state.n; i++) out.push((start + i) % state.n);
    return out;
  }
  function drawCard(state){ return state._deck.cards[state._deck.cursor++]; }

  function postBlind(state, seat, amount, kind){
    const p = state.players[seat];
    const put = Math.min(amount, p.stack);
    p.stack -= put; p.street += put; p.committed += put;
    if (p.stack === 0) p.allin = true;
    state.log.push({ t:'blind', seat, kind, amount: put });
  }

  function syncPot(state){ state.pot = state.players.reduce((s, p) => s + p.committed, 0); }
  function contenders(state){ return state.players.filter(p => !p.folded); }

  // 从 from 起(含), 找第一个「还需行动」的座位; 无则 -1。
  //   需行动 = 未盖牌 && 未全下 && 有筹码 && 不(已行动且已跟平当前注)。
  function needsActionFrom(state, from){
    for (let i = 0; i < state.n; i++){
      const s = (from + i) % state.n, p = state.players[s];
      if (p.folded || p.allin || p.stack === 0) continue;
      if (p.acted && p.street === state.currentBet) continue;
      return s;
    }
    return -1;
  }

  // ── 合法行动(供 AI / UI) ─────────────────────────────────
  function legalActions(state, seat){
    const p = state.players[seat];
    if (state.phase === 'over' || state.phase === 'showdown' || seat !== state.toAct || p.folded || p.allin)
      return { toAct:false };
    const toCall = state.currentBet - p.street;
    const canCheck = toCall === 0;
    const canCall = toCall > 0;
    const callAmount = Math.min(toCall, p.stack);
    const maxTo = p.street + p.stack;                 // 全下到达的总额
    let canBet = false, canRaise = false, minTo = 0;
    if (state.currentBet === 0){
      canBet = p.stack > 0;
      minTo = Math.min(state.bb, maxTo);              // 最小开注=大盲(不足则全下)
    } else if (p.stack > toCall){                     // 有跟注之外的筹码才能加注
      canRaise = true;
      minTo = Math.min(state.currentBet + state.minRaise, maxTo);   // 不足全额加注→只能全下
    }
    return {
      toAct:true, toCall, canCheck, canCall, callAmount,
      canBet, canRaise, minRaiseTo: minTo, maxRaiseTo: maxTo,
      canFold: true, canAllin: p.stack > 0,
    };
  }

  // ── 行动 ──────────────────────────────────────────────────
  function applyAction(state, seat, action, amount){
    if (state.phase !== 'preflop' && state.phase !== 'flop' && state.phase !== 'turn' && state.phase !== 'river')
      throw new Error('not_betting_phase');
    if (seat !== state.toAct) throw new Error('not_your_turn');
    const p = state.players[seat];
    if (p.folded || p.allin) throw new Error('cannot_act');
    const toCall = state.currentBet - p.street;

    if (action === 'fold'){
      p.folded = true; p.acted = true;
      state.log.push({ t:'action', seat, action:'fold', street: state.street });
    } else if (action === 'check'){
      if (toCall !== 0) throw new Error('cannot_check');
      p.acted = true;
      state.log.push({ t:'action', seat, action:'check', street: state.street });
    } else if (action === 'call'){
      if (toCall <= 0) throw new Error('nothing_to_call');
      putChips(state, p, Math.min(toCall, p.stack));
      p.acted = true;
      state.log.push({ t:'action', seat, action:'call', amount: p.street, street: state.street });
    } else if (action === 'bet' || action === 'raise' || action === 'allin'){
      let to;
      if (action === 'allin') to = p.street + p.stack;
      else { to = amount; if (typeof to !== 'number') throw new Error('need_amount'); }
      if (to <= state.currentBet && !(action === 'allin')) throw new Error('raise_too_small');
      if (to > p.street + p.stack) throw new Error('over_stack');
      const isOpen = state.currentBet === 0;
      const raiseSize = to - state.currentBet;
      const isAllin = (to === p.street + p.stack);
      if (isOpen){
        // 开注: 需≥大盲(不足只能全下)
        if (!isAllin && to < state.bb) throw new Error('bet_below_min');
      } else {
        // 加注: 需全额(≥当前注+最小加注), 除非全下短加
        if (!isAllin && raiseSize < state.minRaise) throw new Error('raise_below_min');
      }
      const put = to - p.street;
      if (put <= 0) throw new Error('bad_amount');
      putChips(state, p, put);
      p.acted = true;
      // 是否重开叫注: 全额加注(或开注)才重置他人 acted; 全下短加不重开
      const fullRaise = isOpen ? true : (raiseSize >= state.minRaise);
      if (to > state.currentBet){
        if (fullRaise){
          state.minRaise = to - state.currentBet;
          for (const q of state.players)
            if (!q.folded && !q.allin && q.seat !== seat) q.acted = false;
        }
        state.currentBet = to;
        state.aggressor = seat;
      }
      state.log.push({ t:'action', seat, action: (action==='allin'?'allin':action), amount: to, put, street: state.street });
    } else {
      throw new Error('bad_action');
    }

    syncPot(state);

    // 只剩一名未盖牌者 → 直接结束(无摊牌)
    if (contenders(state).length === 1) return winByFold(state);

    // 本街是否还有人需行动
    const next = needsActionFrom(state, (seat + 1) % state.n);
    if (next !== -1){ state.toAct = next; return { ok:true }; }

    // 本街下注结束 → 进下一街(或全下跑完)
    return advanceStreet(state);
  }

  function putChips(state, p, amt){
    const put = Math.min(amt, p.stack);
    p.stack -= put; p.street += put; p.committed += put;
    if (p.stack === 0) p.allin = true;
  }

  // 只剩一人 → 收池
  function winByFold(state){
    const w = contenders(state)[0];
    w.stack += state.pot;
    return settle(state, {
      wentToShowdown: false, board: state.board.map(c => c.id),
      pots: [{ amount: state.pot, winners: [w.seat] }], winnersBySeat: [w.seat],
    });
  }

  // 进入下一街: 收街注、发公共牌; 若无人能再行动则继续跑完到摊牌
  function advanceStreet(state){
    for (const p of state.players){ p.street = 0; p.acted = false; }
    state.currentBet = 0; state.minRaise = state.bb; state.aggressor = null;

    const ns = NEXT_STREET[state.street];
    if (ns === 'showdown') return showdown(state);
    dealStreet(state, ns);
    state.street = ns; state.phase = ns;

    // 首行动位: 从庄家左手第一位起
    const first = (state.n === 2) ? ((state.button + 1) % state.n) : ((state.button + 1) % state.n);
    const next = needsActionFrom(state, first);
    if (next === -1){
      // 无人能行动(全员 all-in / 仅一人有筹码且已跟平) → 继续发完到摊牌
      return runout(state);
    }
    state.toAct = next;
    return { ok:true, street: ns };
  }

  function dealStreet(state, street){
    drawCard(state); // 烧牌
    const k = STREET_DEAL[street];
    const dealt = [];
    for (let i = 0; i < k; i++){ const c = drawCard(state); state.board.push(c); dealt.push(c.id); }
    state.log.push({ t:'board', street, cards: dealt });
  }

  // 全下跑完: 一路发到河牌再摊牌
  function runout(state){
    while (state.street !== 'river'){
      const ns = NEXT_STREET[state.street];
      dealStreet(state, ns);
      state.street = ns; state.phase = ns;
    }
    return showdown(state);
  }

  // ── 摊牌 + 边池分配 ───────────────────────────────────────
  function showdown(state){
    state.phase = 'showdown'; state.street = 'showdown';
    const live = contenders(state);
    // 各未盖牌者的最佳成手牌
    const evals = {};
    for (const p of live) evals[p.seat] = Eval.evaluate(p.hole.concat(state.board));

    const pots = buildSidePots(state);
    const winnersBySeat = new Set();
    for (const pot of pots){
      const eligible = pot.eligible.filter(s => !state.players[s].folded);
      if (!eligible.length) continue;
      // 该池最佳
      let best = null;
      for (const s of eligible){ if (best === null || Eval.compare(evals[s], evals[best]) > 0) best = s; }
      const winners = eligible.filter(s => Eval.compare(evals[s], evals[best]) === 0);
      distributePot(state, pot.amount, winners);
      pot.winners = winners.slice();
      pot.handName = evals[best].name;
      winners.forEach(s => winnersBySeat.add(s));
    }

    const reveal = {};
    for (const p of live) reveal[p.seat] = { hole: p.hole.map(c => c.id), hand: evals[p.seat].name, cat: evals[p.seat].cat };
    return settle(state, {
      wentToShowdown: true, board: state.board.map(c => c.id),
      pots: pots.map(p => ({ amount: p.amount, eligible: p.eligible.slice(), winners: p.winners || [], handName: p.handName })),
      winnersBySeat: [...winnersBySeat], reveal,
    });
  }

  // 按各家 committed 分层构造边池: 每层金额=(层差×投入≥该层的人数), 合格者=投入≥该层者。
  function buildSidePots(state){
    const commits = state.players.map(p => p.committed).filter(v => v > 0);
    const levels = [...new Set(commits)].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const lv of levels){
      let amount = 0; const eligible = [];
      for (const p of state.players){
        if (p.committed >= lv) amount += (lv - prev);
        if (p.committed >= lv && !p.folded) eligible.push(p.seat);
      }
      if (amount > 0) pots.push({ amount, eligible });
      prev = lv;
    }
    return pots;
  }

  // 平分底池: 整数均分, 余数按座位序(庄家左手起)分给最靠前赢家。
  function distributePot(state, amount, winners){
    const each = Math.floor(amount / winners.length);
    let rem = amount - each * winners.length;
    for (const s of winners) state.players[s].stack += each;
    if (rem > 0){
      const order = seatOrderFrom(state, (state.button + 1) % state.n).filter(s => winners.includes(s));
      for (let i = 0; i < rem; i++) state.players[order[i % order.length]].stack += 1;
    }
  }

  function settle(state, extra){
    state.phase = 'over';
    const delta = {};
    for (const p of state.players) delta[p.seat] = p.stack - p.start;
    state.result = Object.assign({
      button: state.button, delta,
      stacks: state.players.reduce((o, p) => (o[p.seat] = p.stack, o), {}),
    }, extra);
    state.log.push(Object.assign({ t:'over' }, state.result));
    return { ok:true, over:true, result: state.result };
  }

  // ── 回看重放: 从 seed + log 的 action 序列重建终局 ──────────
  function replay(log, opts){
    const dealE = log.find(e => e.t === 'deal');
    if (!dealE) throw new Error('no_deal');
    const st = createGame(Object.assign({
      seed: dealE.seed, button: dealE.button, sb: dealE.sb, bb: dealE.bb,
      names: dealE.names, stacks: dealE.stacks,
    }, opts || {}));
    for (const e of log){
      if (e.t !== 'action') continue;
      if (st.phase === 'over') break;
      applyAction(st, e.seat, e.action, e.amount);
    }
    return st;
  }

  return {
    PHASES, pokerDeck, pokerCard,
    createGame, applyAction, legalActions, replay,
    // 工具(供 AI / 测试)
    contenders, buildSidePots, needsActionFrom, seatOrderFrom, syncPot,
  };
});
