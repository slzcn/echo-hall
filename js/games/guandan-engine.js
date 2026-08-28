// ============================================================
// guandan-engine.js — 掼蛋局状态机（纯函数「权威裁判」）
// ------------------------------------------------------------
// 职责:
//   · 从 seed 建局(4 家各 27 张, 确定性可复核/回看)
//   · 进贡/还贡/抗贡(依上一局名次) → 定首出
//   · 出牌轮转: 合法性由 guandan-rules 判(带 level 级牌/百搭); 一圈过清桌;
//     出完接风(走完的人由对家接出); 空手玩家跳过
//   · 名次结算: 头游/二游/三游/末游 → 升级(队友名次定 +3/+2/+1) + 过 A 胜负
//   · 每步 append transition → 记分复核 + 回看重放共用
// 无 DOM/网络/随机(除 deck 洗牌用可复现 seed)。同一份跑客户端与 Edge。
//
// 座位队伍: 0&2 为 A 队(team0), 1&3 为 B 队(team1)。对家 = (seat+2)%4。
// state:
//   { phase:'play'|'over', seed, level(本局台面级/trump), teamLevels:[a,b], dealerTeam,
//     players:[{id,seat,team,name,isAI,hand}], table:{lastPlay,passesInRow},
//     turn, finished:[seat...], tribute:{...}|null, bombs, log:[], result:null|{...} }
// ============================================================
(function(root, factory){
  const mod = factory(
    (typeof require==='function') ? require('./deck.js') : (root.EHDeck),
    (typeof require==='function') ? require('./guandan-rules.js') : (root.EHGuandanRules)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.EHGuandanEngine = mod;
})(this, function(Deck, Rules){
  'use strict';

  const teamOf = (seat)=> seat % 2;          // 0,2→0 ; 1,3→1
  const partnerOf = (seat)=> (seat + 2) % 4;

  function createGame(opts){
    opts = opts || {};
    const deal = Deck.dealGuandan(opts.seed);
    const names = opts.names || ['你','下家','对家','上家'];
    const isAI = opts.isAI || [false, true, true, true];
    const teamLevels = opts.teamLevels ? opts.teamLevels.slice() : [2,2];
    const dealerTeam = (typeof opts.dealerTeam === 'number') ? opts.dealerTeam : 0;
    const level = (typeof opts.level === 'number') ? opts.level : teamLevels[dealerTeam];

    const players = [0,1,2,3].map(seat => ({
      id: (opts.ids && opts.ids[seat]) || ('p'+seat),
      seat, team: teamOf(seat), name: names[seat] || ('席'+seat),
      isAI: !!isAI[seat],
      hand: Rules.sortHand(deal.hands[seat], level),
    }));

    const state = {
      phase: 'play',
      seed: deal.seed,
      level, teamLevels, dealerTeam,
      players,
      table: { lastPlay: null, passesInRow: 0 },
      turn: 0,
      finished: [],
      tribute: null,
      bombs: 0,
      log: [{ t:'deal', seed: deal.seed, level, teamLevels: teamLevels.slice(), dealerTeam }],
      result: null,
    };

    // 首出席: 首局默认 0(人先手); 有上局结果则走进贡流程定首出
    let leadSeat = (typeof opts.firstLead === 'number') ? opts.firstLead : 0;
    if (opts.prevResult && !opts.skipTribute){
      // manualTribute(仅单机陪玩开): 进入 tribute 阶段逐张选牌; 否则(联机/测试)一次性自动结算
      leadSeat = opts.manualTribute
        ? _setupManualTribute(state, opts.prevResult)
        : _resolveTribute(state, opts.prevResult);
    }
    state.turn = leadSeat;
    return state;
  }

  // ── 进贡 / 还贡 / 抗贡 ──────────────────────────────────────
  // 依上一局名次: 双下(赢家占1&2)→ 4th进1st、3rd进2nd; 单下→ 末位输家进头游。
  //   贡牌 = 最大牌(排除红桃级牌百搭); 抗贡 = 输方合计握 2 大王则免贡。
  //   还贡 = 收贡者回一张最小牌。返回本局首出席。
  function _resolveTribute(state, prev){
    const order = prev.finishOrder;            // [1st,2nd,3rd,4th]
    const first = order[0], second = order[1];
    const winnerTeam = teamOf(first);
    const doubleDown = teamOf(second) === winnerTeam;   // 赢家占 1&2 → 双下
    const losers = order.filter(s => teamOf(s) !== winnerTeam);
    // 输方最后走的(名次最靠后)为 loserLow
    const loserLow = order.filter(s => teamOf(s) !== winnerTeam).slice(-1)[0];

    // 抗贡: 输方合计 2 张大王
    const bigJokersInLosers = losers.reduce((n, s)=>
      n + state.players[s].hand.filter(c=>c.joker==='big').length, 0);
    if (bigJokersInLosers >= 2){
      state.tribute = { refused:true, doubleDown, pairs:[] };
      state.log.push({ t:'antigong', losers });
      return first;   // 抗贡成功: 头游首出
    }

    const pairs = [];  // {from,to}
    if (doubleDown){
      const third = order[2], fourth = order[3];
      pairs.push({ from: fourth, to: first });
      pairs.push({ from: third,  to: second });
    } else {
      pairs.push({ from: loserLow, to: first });
    }

    const transfers = [];
    for (const pr of pairs){
      const giveCard = _biggestCard(state.players[pr.from].hand, state.level);
      if (!giveCard) continue;
      _move(state, pr.from, pr.to, giveCard.id);
      // 还贡: 收贡者回一张最小牌(尽量 ≤10)
      const back = _returnCard(state.players[pr.to].hand, state.level);
      let backId = null;
      if (back){ _move(state, pr.to, pr.from, back.id); backId = back.id; }
      transfers.push({ from:pr.from, to:pr.to, give:giveCard.id, back:backId });
      state.log.push({ t:'tribute', from:pr.from, to:pr.to, give:giveCard.id });
      if (backId) state.log.push({ t:'return', from:pr.to, to:pr.from, card:backId });
    }
    state.tribute = { refused:false, doubleDown, transfers };
    // 首出: 双下时贡给头游那家(4th)先出; 单下时 loserLow 先出
    return doubleDown ? order[3] : loserLow;
  }

  // ── 手动进贡/还贡(仅单机陪玩): 建待办任务, 逐张由 applyTribute 推进(人/AI 共用) ──
  //   任务顺序: 先所有【进贡】(输家→赢家, 必为最大牌), 再所有【还贡】(赢家→输家, ≤10 点)。
  //   抗贡(输方双大王)与自动路径同判, 直接开打不进 tribute 阶段。
  function _setupManualTribute(state, prev){
    const order = prev.finishOrder;
    const first = order[0], second = order[1];
    const winnerTeam = teamOf(first);
    const doubleDown = teamOf(second) === winnerTeam;
    const losers = order.filter(s => teamOf(s) !== winnerTeam);
    const loserLow = losers.slice(-1)[0];
    const bigJokersInLosers = losers.reduce((n,s)=> n + state.players[s].hand.filter(c=>c.joker==='big').length, 0);
    if (bigJokersInLosers >= 2){
      state.tribute = { refused:true, doubleDown, pairs:[] };
      state.log.push({ t:'antigong', losers });
      state.phase = 'play';
      return first;
    }
    const pairs = doubleDown
      ? [{ from: order[3], to: first }, { from: order[2], to: second }]
      : [{ from: loserLow, to: first }];
    const tasks = [];
    for (const pr of pairs) tasks.push({ kind:'give',   from: pr.from, to: pr.to });
    for (const pr of pairs) tasks.push({ kind:'return', from: pr.to,   to: pr.from });
    const lead = doubleDown ? order[3] : loserLow;
    state.tributePending = { tasks, idx:0, lead, doubleDown, transfers:[] };
    state.phase = 'tribute';
    return tasks[0].from;
  }
  // 当前进贡任务的合法候选牌 id: 进贡=powerOf 最大的非百搭牌(常 1 张, 顶点成对则多张任选);
  //   还贡=自然点 ≤10 的非百搭牌(无则退化为任意非百搭)。
  function tributeCandidates(state, seat){
    if (state.phase !== 'tribute' || !state.tributePending) return [];
    const tp = state.tributePending;
    const task = tp.tasks[tp.idx];
    if (!task || task.from !== seat) return [];
    const hand = state.players[seat].hand;
    if (task.kind === 'give'){
      let maxp = -1;
      for (const c of hand){ if (Rules.isWild(c, state.level)) continue; const p = Rules.powerOf(c, state.level); if (p > maxp) maxp = p; }
      const out = hand.filter(c => !Rules.isWild(c, state.level) && Rules.powerOf(c, state.level) === maxp).map(c=>c.id);
      return out.length ? out : hand.map(c=>c.id);
    }
    const legal = hand.filter(c => !c.joker && !Rules.isWild(c, state.level) && Rules.naturalRank(c) <= 10);
    const pool = legal.length ? legal : hand.filter(c => !Rules.isWild(c, state.level));
    return (pool.length ? pool : hand).map(c=>c.id);
  }
  // 执行一步进贡/还贡。校验座位与候选合法性; 全部完成 → 落 state.tribute + 转 play + 定首出。
  function applyTribute(state, seat, cardId){
    if (state.phase !== 'tribute') throw new Error('not_tribute_phase');
    const tp = state.tributePending;
    if (!tp) throw new Error('no_tribute_state');
    const task = tp.tasks[tp.idx];
    if (!task) throw new Error('tribute_done');
    if (seat !== task.from) throw new Error('not_your_tribute_turn');
    const cands = tributeCandidates(state, seat);
    if (!cands.includes(cardId)) throw new Error('illegal_tribute_card');
    _move(state, task.from, task.to, cardId);
    if (task.kind === 'give'){
      tp.transfers.push({ from: task.from, to: task.to, give: cardId, back: null });
      state.log.push({ t:'tribute', from: task.from, to: task.to, give: cardId });
    } else {
      const tr = tp.transfers.find(t => t.from === task.to && t.to === task.from);
      if (tr) tr.back = cardId;
      state.log.push({ t:'return', from: task.from, to: task.to, card: cardId });
    }
    tp.idx++;
    if (tp.idx >= tp.tasks.length){
      state.tribute = { refused:false, doubleDown: tp.doubleDown, transfers: tp.transfers };
      state.phase = 'play';
      state.turn = tp.lead;
      state.tributePending = null;
      return { ok:true, tributeDone:true, lead: tp.lead };
    }
    state.turn = tp.tasks[tp.idx].from;
    return { ok:true, turn: state.turn, next: tp.tasks[tp.idx] };
  }
  function _biggestCard(hand, level){
    let best = null, bp = -1;
    for (const c of hand){
      if (Rules.isWild(c, level)) continue;         // 百搭不上贡
      const p = Rules.powerOf(c, level);
      if (p > bp){ bp = p; best = c; }
    }
    return best || hand[0] || null;
  }
  function _returnCard(hand, level){
    // 最小牌; 优先自然点 ≤10 的(不回贡大牌/级牌)
    let pick = null, pp = 999;
    for (const c of hand){
      if (Rules.isWild(c, level)) continue;
      const p = Rules.powerOf(c, level);
      if (p < pp){ pp = p; pick = c; }
    }
    return pick || hand[0] || null;
  }
  function _move(state, fromSeat, toSeat, cardId){
    const fh = state.players[fromSeat].hand;
    const idx = fh.findIndex(c=>c.id===cardId);
    if (idx < 0) return false;
    const card = fh.splice(idx,1)[0];
    state.players[toSeat].hand.push(card);
    state.players[toSeat].hand = Rules.sortHand(state.players[toSeat].hand, state.level);
    return true;
  }

  // 下一个「还有牌」的座位
  function nextActive(state, seat){
    let s = (seat+1)%4;
    for (let i=0;i<4;i++){ if (state.players[s].hand.length>0) return s; s=(s+1)%4; }
    return -1;
  }
  function activeCount(state){ return state.players.filter(p=>p.hand.length>0).length; }

  function removeCards(hand, cards){
    const ids = new Set(cards.map(c=>c.id));
    if (ids.size !== cards.length) return false;
    let hit = 0; for (const c of hand) if (ids.has(c.id)) hit++;
    if (hit !== cards.length) return false;
    for (const c of cards){ const i = hand.findIndex(h=>h.id===c.id); if (i<0) return false; hand.splice(i,1); }
    return true;
  }
  function _resolveFromHand(hand, cards){
    const out=[], used=new Set();
    for (const c of cards){ const id=c.id||c; const f=hand.find(h=>h.id===id && !used.has(h)); if(!f) return null; used.add(f); out.push(f); }
    return out;
  }

  // ── 出牌 / 过 ──────────────────────────────────────────────
  function applyPlay(state, seat, cards){
    if (state.phase !== 'play') throw new Error('not_play_phase');
    if (seat !== state.turn) throw new Error('not_your_turn');
    if (!cards || !cards.length) throw new Error('empty_play');
    const p = Rules.parse(cards, state.level);
    if (!p) throw new Error('illegal_type');
    const table = state.table;
    const mustBeat = table.lastPlay && table.lastPlay.seat !== seat;
    const tableParse = mustBeat ? table.lastPlay.parse : null;
    if (mustBeat && !Rules.beats(p, tableParse, state.level)) throw new Error('cannot_beat');

    const hand = state.players[seat].hand;
    const picked = _resolveFromHand(hand, cards);
    if (!picked) throw new Error('not_in_hand');
    if (!removeCards(hand, picked)) throw new Error('remove_failed');

    if (Rules.isBomb(p)) state.bombs++;
    table.lastPlay = { seat, cards: picked.map(c=>c.id), parse: p };
    table.passesInRow = 0;
    state.log.push({ t:'play', seat, cards: picked.map(c=>c.id), ptype: p.type });

    // 出完 → 记名次
    let justFinished = false;
    if (hand.length === 0){
      state.finished.push(seat);
      justFinished = true;
      if (state.finished.length >= 3) return _settle(state);
    }
    state.turn = nextActive(state, seat);
    return { ok:true, played:p, justFinished };
  }

  function applyPass(state, seat){
    if (state.phase !== 'play') throw new Error('not_play_phase');
    if (seat !== state.turn) throw new Error('not_your_turn');
    const table = state.table;
    const isLeader = !table.lastPlay || table.lastPlay.seat === seat;
    if (isLeader) throw new Error('leader_cannot_pass');
    table.passesInRow++;
    state.log.push({ t:'pass', seat });

    // 一圈: 控制者之外的活跃家都过了 → 本圈结束
    const controller = table.lastPlay.seat;
    const respondents = state.players.filter(pl=>pl.hand.length>0 && pl.seat!==controller).length;
    if (table.passesInRow >= respondents){
      // 控制者赢圈; 若已走完 → 接风(对家接出)
      let leader = controller, jiefeng = false;
      if (state.players[controller].hand.length === 0){
        const mate = partnerOf(controller);
        if (state.players[mate].hand.length>0){ leader = mate; jiefeng = true; }  // 队友接风
        else leader = nextActive(state, controller);                              // 队友也走完 → 顺延
      }
      table.lastPlay = null; table.passesInRow = 0;
      state.turn = leader;
      // controller/jiefeng 供 UI 播报"XX 接风"(controller 已走完时 lastPlay 被清, UI 拿不到, 故随返回带出)
      return { ok:true, trickEnd:true, leader, controller, jiefeng };
    }
    state.turn = nextActive(state, seat);
    return { ok:true };
  }

  // ── 结算: 名次 → 升级 ──────────────────────────────────────
  function _settle(state){
    const finishOrder = state.finished.slice();
    // 补末游(唯一还有牌的)
    const last = state.players.find(p=>p.hand.length>0);
    if (last) finishOrder.push(last.seat);
    const first = finishOrder[0];
    const winnerTeam = teamOf(first);
    const mate = partnerOf(first);
    const matePos = finishOrder.indexOf(mate);   // 0..3
    // 队友名次 → 升级: 2nd(+3) 3rd(+2) 4th(+1)
    const advance = matePos===1 ? 3 : (matePos===2 ? 2 : 1);

    const before = state.teamLevels.slice();
    const after = before.slice();
    let matchWon = false;
    if (before[winnerTeam] >= 14){
      matchWon = true;              // 已在 A, 再赢 → 通关
      after[winnerTeam] = 14;
    } else {
      after[winnerTeam] = Math.min(14, before[winnerTeam] + advance);  // 封顶 A, 过 A 需再赢
    }

    const delta = {};
    for (const pl of state.players) delta[pl.seat] = (pl.team===winnerTeam) ? +advance : -advance;

    // 残局(对标腾讯亮残牌): 各家终局剩牌 id。掼蛋终局只有末游还捏着牌, 其余已出完为空数组。
    // 只在 result 里出现 → 局中快照 result=null 不外泄; 下一副全新 seed, 亮末游残牌无害。
    const reveal = {};
    for (const pl of state.players) reveal[pl.seat] = (pl.hand||[]).map(c=>c.id);

    state.phase = 'over';
    state.result = {
      finishOrder, winnerTeam, loserTeam: 1-winnerTeam, advance, reveal,
      teamLevelsBefore: before, teamLevelsAfter: after,
      activeLevel: state.level, dealerTeam: state.dealerTeam,
      nextDealerTeam: winnerTeam, nextLevel: after[winnerTeam],
      matchWon, matchWinnerTeam: matchWon ? winnerTeam : null,
      doubleDown: matePos===1, bombs: state.bombs, delta,
      tribute: state.tribute,
    };
    state.log.push({ t:'over', finishOrder, winnerTeam, advance, matchWon });
    return { ok:true, over:true, result: state.result };
  }

  // ── 回看重放: seed + log 重建终局(校验一致) ────────────────
  function replay(log){
    const dealE = log.find(e=>e.t==='deal');
    if (!dealE) throw new Error('no_deal');
    const st = createGame({ seed: dealE.seed, level: dealE.level,
      teamLevels: dealE.teamLevels, dealerTeam: dealE.dealerTeam, skipTribute:true });
    // 重放进贡转移(若有)
    for (const e of log){
      if (e.t==='tribute') _move(st, e.from, e.to, e.give);
      else if (e.t==='return') _move(st, e.from, e.to, e.card);
    }
    // 定首出: 用第一条 play 的 seat 作为首出席
    const firstPlay = log.find(e=>e.t==='play');
    if (firstPlay) st.turn = firstPlay.seat;
    for (const e of log){
      if (e.t==='play'){
        const hand = st.players[e.seat].hand;
        const cards = e.cards.map(id=>hand.find(h=>h.id===id)).filter(Boolean);
        applyPlay(st, e.seat, cards);
      } else if (e.t==='pass') applyPass(st, e.seat);
    }
    return st;
  }

  return {
    createGame, applyPlay, applyPass, replay,
    applyTribute, tributeCandidates,
    teamOf, partnerOf, nextActive, activeCount,
    _resolveTribute, _setupManualTribute, _move,   // 供单测
  };
});
