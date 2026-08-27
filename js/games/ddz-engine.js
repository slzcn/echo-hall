// ============================================================
// ddz-engine.js — 斗地主局状态机（纯函数「权威裁判」）
// ------------------------------------------------------------
// 职责:
//   · 从 seed 建局(发牌确定性,可复核/回看)
//   · 叫地主/抢地主流程 → 定地主 + 底牌归属 + 初始倍数
//   · 出牌轮转:合法性由 ddz-rules 判定;pass 逻辑;一圈过则清桌重开
//   · 胜负结算:地主/农民、底分×倍数(炸弹翻倍、春天翻倍)
//   · 每一步 append 一条 transition 到 log → 记分复核 + 回看重放共用
// 无 DOM/网络/随机(除 deck 洗牌用可复现 seed)。同一份跑客户端与 Edge。
//
// 状态对象 state:
//   { phase:'bid'|'play'|'over', seed, players:[{id,seat,hand:[card],isAI,name}],
//     landlord:seat|null, bottom:[card], bid:{turn,calls:[],max},
//     table:{ bySeat, lastPlay:{seat,cards,parse}|null, passesInRow },
//     turn:seat, multiplier, bombs, log:[transition], result:null|{...} }
// transition(log 元素):
//   {t:'deal',seed} | {t:'call',seat,val} | {t:'landlord',seat,bottom}
//   {t:'play',seat,cards,ptype} | {t:'pass',seat} | {t:'over',...result}
// ============================================================
(function(root, factory){
  const mod = factory(
    (typeof require==='function') ? require('./deck.js') : (root.EHDeck),
    (typeof require==='function') ? require('./ddz-rules.js') : (root.EHDdzRules)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.EHDdzEngine = mod;
})(this, function(Deck, Rules){
  'use strict';

  // 建局:发牌,进入叫地主阶段。firstBidSeat 默认 0(可传入用于复现)。
  function createGame(opts){
    opts = opts || {};
    const deal = Deck.dealDoudizhu(opts.seed);
    const names = opts.names || ['玩家','下家','上家'];
    const isAI = opts.isAI || [false, true, true];
    const players = [0,1,2].map(seat => ({
      id: (opts.ids && opts.ids[seat]) || ('p'+seat),
      seat, name: names[seat] || ('席'+seat),
      isAI: !!isAI[seat],
      hand: Deck.sortHand(deal.hands[seat]),
    }));
    const firstBid = (typeof opts.firstBidSeat === 'number') ? opts.firstBidSeat : 0;
    return {
      phase: 'bid',
      seed: deal.seed,
      players,
      bottom: deal.bottom,
      landlord: null,
      bid: { turn: firstBid, calls: [], max: 0, firstBid },
      table: { lastPlay: null, passesInRow: 0 },
      turn: firstBid,
      multiplier: 1,
      bombs: 0,
      base: opts.base || 1,       // 底分
      // 加倍系统: 仅本地单机(对标欢乐斗地主)开启。默认关 → 联机/引擎测试/回看旅程全走经典流程不受影响。
      doubling: !!opts.doubling,
      dbl: null,                  // {turn, order:[seat...], choices:{seat:factor}} —— 仅 doubling 局在 double 阶段有值
      log: [{ t:'deal', seed: deal.seed, firstBid, doubling: !!opts.doubling }],
      result: null,
    };
  }

  function handOf(state, seat){ return state.players[seat].hand; }
  function nextSeat(seat){ return (seat + 1) % 3; }

  // 从手牌移除指定 cards(按 id)。返回是否成功(全部命中)。
  function removeCards(hand, cards){
    const ids = new Set(cards.map(c=>c.id));
    if (ids.size !== cards.length) return false;   // 重复 id
    let hit = 0;
    for (const c of hand) if (ids.has(c.id)) hit++;
    if (hit !== cards.length) return false;        // 有牌不在手上
    for (const c of cards){
      const idx = hand.findIndex(h => h.id === c.id);
      if (idx < 0) return false;
      hand.splice(idx, 1);
    }
    return true;
  }

  // ── 叫地主 ─────────────────────────────────────────────────
  // 简化「叫分」为:call ∈ {0(不叫),1,2,3}。谁叫 3 立即定;否则一圈后最高分者当地主。
  // 全不叫 → 重发(返回 {redeal:true})。这里由上层决定重开;引擎给出信号。
  function applyCall(state, seat, val){
    if (state.phase !== 'bid') throw new Error('not_bid_phase');
    if (seat !== state.bid.turn) throw new Error('not_your_bid_turn');
    if (![0,1,2,3].includes(val)) throw new Error('bad_call');
    if (val !== 0 && val <= state.bid.max) throw new Error('call_must_raise');
    state.bid.calls.push({ seat, val });
    if (val > state.bid.max) { state.bid.max = val; state.bid.maxSeat = seat; }
    state.log.push({ t:'call', seat, val });

    // 叫 3 → 立即定地主
    if (val === 3){ return _setLandlord(state, seat); }

    // 轮转到下一家;若已问满 3 家
    const called = state.bid.calls.length;
    if (called >= 3){
      if (state.bid.max === 0){
        state.log.push({ t:'redeal' });
        return { redeal: true };
      }
      return _setLandlord(state, state.bid.maxSeat);
    }
    state.bid.turn = nextSeat(state.bid.turn);
    state.turn = state.bid.turn;
    return { ok:true };
  }

  function _setLandlord(state, seat){
    state.landlord = seat;
    // 地主拿底牌
    const lord = state.players[seat];
    lord.hand = Deck.sortHand(lord.hand.concat(state.bottom));
    state.multiplier = Math.max(1, state.bid.max) ; // 叫分即初始倍数
    state.table.lastPlay = null;
    state.table.passesInRow = 0;
    state.log.push({ t:'landlord', seat, bottom: state.bottom.map(c=>c.id), multiplier: state.multiplier });
    if (state.doubling){
      // 加倍轮(对标欢乐斗地主定地主后那一屏): 地主先决定, 再两农民按座位轮转; 全选完才进 play。
      state.phase = 'double';
      state.dbl = { turn: seat, order: [seat, nextSeat(seat), nextSeat(nextSeat(seat))], choices: {} };
      state.turn = seat;
    } else {
      state.phase = 'play';
      state.turn = seat;                 // 地主先出
    }
    return { ok:true, landlord: seat };
  }

  // ── 加倍(仅 doubling 局有此阶段, 定地主后出牌前) ─────────────
  // factor ∈ {1(不加倍),2(加倍),4(超级加倍)}。各家独立决定, 按 dbl.order 轮转; 全选完进 play。
  // 结算时每个农民与地主这一对的赌注各自乘上双方系数(见 _settle), 零和不破。
  function applyDouble(state, seat, factor){
    if (state.phase !== 'double') throw new Error('not_double_phase');
    if (!state.dbl) throw new Error('no_double_state');
    if (seat !== state.dbl.turn) throw new Error('not_your_double_turn');
    if (![1,2,4].includes(factor)) throw new Error('bad_double');
    if (state.dbl.choices[seat] != null) throw new Error('already_doubled');
    state.dbl.choices[seat] = factor;
    state.log.push({ t:'double', seat, factor });
    const order = state.dbl.order;
    const idx = order.indexOf(seat);
    if (idx < order.length - 1){
      state.dbl.turn = order[idx + 1];
      state.turn = state.dbl.turn;
      return { ok:true };
    }
    // 三家都定了 → 进入出牌, 地主先出
    state.phase = 'play';
    state.turn = state.landlord;
    state.dbl.turn = null;
    return { ok:true, doubleDone:true };
  }

  // ── 出牌 / 过 ──────────────────────────────────────────────
  // cards:card 数组(须来自该玩家手牌)。返回 {ok} 或抛错。
  function applyPlay(state, seat, cards){
    if (state.phase !== 'play') throw new Error('not_play_phase');
    if (seat !== state.turn) throw new Error('not_your_turn');
    if (!cards || !cards.length) throw new Error('empty_play');
    const p = Rules.parse(cards);
    if (!p) throw new Error('illegal_type');

    const table = state.table;
    // 需要压过谁:若桌面有 lastPlay 且不是自己(说明上家在压),必须 beats
    const mustBeat = table.lastPlay && table.lastPlay.seat !== seat;
    const tableParse = mustBeat ? table.lastPlay.parse : null;
    if (mustBeat && !Rules.beats(p, tableParse)) throw new Error('cannot_beat');

    const hand = handOf(state, seat);
    // 校验持有(复制一份 cards 的规范引用:用手牌里实际对象)
    const picked = _resolveFromHand(hand, cards);
    if (!picked) throw new Error('not_in_hand');
    if (!removeCards(hand, picked)) throw new Error('remove_failed');

    // 炸弹/王炸翻倍
    if (Rules.isBomb(p)){ state.multiplier *= 2; state.bombs++; }

    table.lastPlay = { seat, cards: picked.map(c=>c.id), parse: p };
    table.passesInRow = 0;
    state.log.push({ t:'play', seat, cards: picked.map(c=>c.id), ptype: p.type });

    // 出完 → 结算
    if (hand.length === 0) return _settle(state, seat);

    state.turn = nextSeat(seat);
    return { ok:true, played: p };
  }

  function applyPass(state, seat){
    if (state.phase !== 'play') throw new Error('not_play_phase');
    if (seat !== state.turn) throw new Error('not_your_turn');
    // 桌面为空(自己是新一轮首出)不能 pass
    const table = state.table;
    const isLeader = !table.lastPlay || table.lastPlay.seat === seat;
    if (isLeader) throw new Error('leader_cannot_pass');
    table.passesInRow++;
    state.log.push({ t:'pass', seat });
    // 两家连续 pass → 回到 lastPlay 的人,清桌新一轮
    if (table.passesInRow >= 2){
      state.turn = table.lastPlay.seat;
      table.lastPlay = null;
      table.passesInRow = 0;
    } else {
      state.turn = nextSeat(seat);
    }
    return { ok:true };
  }

  // 把外部传入的 cards(可能是 {id} 轻对象)解析成手牌里的真实 card 对象
  function _resolveFromHand(hand, cards){
    const out = [];
    const used = new Set();
    for (const c of cards){
      const id = c.id || c;
      const found = hand.find(h => h.id === id && !used.has(h));
      if (!found) return null;
      used.add(found); out.push(found);
    }
    return out;
  }

  // ── 结算 ───────────────────────────────────────────────────
  // 春天:地主出完时农民一张未出 → 翻倍;反春天:农民赢且地主只出过一手 → 翻倍。
  function _settle(state, winnerSeat){
    const lord = state.landlord;
    const landlordWon = (winnerSeat === lord);
    // 春天判定:统计每方出牌次数(从 log 数 play)
    let lordPlays = 0, peasantPlays = 0;
    for (const e of state.log){
      if (e.t !== 'play') continue;
      if (e.seat === lord) lordPlays++; else peasantPlays++;
    }
    let springMult = 1;
    if (landlordWon && peasantPlays === 0) springMult = 2;         // 春天
    else if (!landlordWon && lordPlays <= 1) springMult = 2;        // 反春天
    const finalMult = state.multiplier * springMult;
    const score = state.base * finalMult;

    // 加倍系数(仅本地 doubling 局有值; 无加倍时各家=1, 退化为经典 ±2s/∓s):
    //   每个农民与地主【这一对】的赌注 = score × 地主系数 × 该农民系数 (双方各自加倍独立相乘)。
    //   地主账变 = 各农民对的输赢之和; 每农民账变 = 自己那一对。 → 恒零和, 与无加倍不变式兼容。
    const dbl = (state.dbl && state.dbl.choices) ? state.dbl.choices : {};
    const dL = dbl[lord] || 1;
    const delta = {}; // seat → 分
    let lordDelta = 0;
    for (const pl of state.players){
      if (pl.seat === lord) continue;
      const amt = score * dL * (dbl[pl.seat] || 1);   // 该农民与地主这一对的赌注
      delta[pl.seat] = landlordWon ? -amt : +amt;
      lordDelta += landlordWon ? +amt : -amt;
    }
    delta[lord] = lordDelta;
    const winners = state.players.filter(p => landlordWon ? p.seat===lord : p.seat!==lord).map(p=>p.seat);
    const losers  = state.players.filter(p => landlordWon ? p.seat!==lord : p.seat===lord).map(p=>p.seat);
    // 残局:终局时各家剩牌(赢家为空)。对标腾讯斗地主"亮残牌"。只在 result 里出现(局中永不下发) →
    //   不破坏脱敏命门:下一局是全新 seed, 终局亮牌对后续零影响。以 id 数组存, UI 按整副牌还原牌面。
    const reveal = {};
    for (const pl of state.players) reveal[pl.seat] = (pl.hand||[]).map(c=>c.id);
    state.phase = 'over';
    state.result = {
      landlord: lord, landlordWon, winnerSeat,
      base: state.base, multiplier: state.multiplier, spring: springMult>1,
      finalMultiplier: finalMult, score, delta, winners, losers, bombs: state.bombs, reveal,
      doubles: Object.assign({}, dbl),   // 各家加倍系数(展示用; 无加倍局为空对象)
    };
    state.log.push({ t:'over', ...state.result });
    return { ok:true, over:true, result: state.result };
  }

  // ── 回看重放:从 seed + log 重建终局(校验一致性用) ──────────
  // 只重放 call/play/pass,返回重建出的 result。用于服务端复核与回看。
  function replay(log, opts){
    const dealE = log.find(e=>e.t==='deal');
    if (!dealE) throw new Error('no_deal');
    const st = createGame(Object.assign({ seed: dealE.seed, firstBidSeat: dealE.firstBid, doubling: !!dealE.doubling }, opts||{}));
    // 重放时不再走随机,严格按 log
    for (const e of log){
      if (e.t === 'call') applyCall(st, e.seat, e.val);
      else if (e.t === 'landlord') { /* 由 applyCall 内部触发,无需重放 */ }
      else if (e.t === 'double') applyDouble(st, e.seat, e.factor);
      else if (e.t === 'play') {
        const hand = handOf(st, e.seat);
        const cards = e.cards.map(id => hand.find(h=>h.id===id)).filter(Boolean);
        applyPlay(st, e.seat, cards);
      }
      else if (e.t === 'pass') applyPass(st, e.seat);
    }
    return st;
  }

  return {
    createGame, applyCall, applyDouble, applyPlay, applyPass, replay,
    // 工具
    nextSeat, handOf,
  };
});
