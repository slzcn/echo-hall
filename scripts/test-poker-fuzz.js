#!/usr/bin/env node
'use strict';
// test-poker-fuzz.js — 德州扑克模糊压测(重点砸边池/全下/守恒不变量)
// 每局强行制造多路全下 → 最易出错的多层边池分配。断言:
//   · 筹码守恒: 任何终局 ∑stack == ∑起始
//   · 底池账实相符: 各池金额之和 == 各家总投入之和
//   · 赢家资格: 每个池的赢家必是该池 eligible(未弃 + 投入达该层)
//   · 摊牌牌力最高者拿池: 赢家成手牌 == 该池合格者中的最优
//   · 无崩溃 / 全部走到终局
const G = require('../js/games/poker-engine.js');
const E = require('../js/games/poker-eval.js');
const AI = require('../js/games/poker-ai.js');

let checks = 0, fails = 0;
function bad(msg){ fails++; if (fails <= 8) console.error('✗ ' + msg); }

const HANDS = 1200;
let notOver = 0;

for (let s = 0; s < HANDS; s++){
  const n = 2 + (s % 5);                     // 2~6 人
  const names = Array.from({length:n}, (_, i) => 'P'+i);
  // 参差起始筹码 → 逼出多层边池
  const stacks = Array.from({length:n}, (_, i) => 40 + ((s * 7 + i * 53) % 260));
  const startTotal = stacks.reduce((a, b) => a + b, 0);
  let st;
  try { st = G.createGame({ seed: 20000 + s, names, sb:5, bb:10, button: s % n, stacks }); }
  catch(e){ bad(`建局崩溃 s=${s}: ${e.message}`); continue; }

  let guard = 0;
  try {
    while (st.phase !== 'over' && guard++ < 600){
      const seat = st.toAct;
      const la = G.legalActions(st, seat);
      if (!la.toAct) break;
      // 偏好制造全下: 高概率推入, 否则跟/看
      const r = ((s * 131 + seat * 17 + guard * 7) % 100);
      if (r < 45 && la.canAllin && (la.canBet || la.canRaise)) G.applyAction(st, seat, 'allin', la.maxRaiseTo);
      else if (la.canCheck) G.applyAction(st, seat, 'check');
      else if (r < 80 && la.canCall) G.applyAction(st, seat, 'call');
      else G.applyAction(st, seat, 'fold');
    }
  } catch(e){ bad(`对局崩溃 s=${s}: ${e.message}`); continue; }

  if (st.phase !== 'over'){ notOver++; continue; }
  const R = st.result;

  // 守恒
  checks++;
  const endTotal = st.players.reduce((a, p) => a + p.stack, 0);
  if (endTotal !== startTotal) bad(`筹码不守恒 s=${s}: ${endTotal} != ${startTotal}`);

  // 账实相符: 池金额和 == 总投入
  checks++;
  const committedTotal = st.players.reduce((a, p) => a + p.committed, 0);
  const potSum = (R.pots || []).reduce((a, p) => a + p.amount, 0);
  if (potSum !== committedTotal) bad(`池金额和≠总投入 s=${s}: ${potSum} != ${committedTotal}`);

  // 仅摊牌局校验赢家资格 + 牌力最优
  if (R.wentToShowdown && R.pots){
    const board = R.board.map(id => idToCard(id));
    for (const pot of R.pots){
      if (!pot.winners || !pot.winners.length) continue;
      checks++;
      // 赢家须属于该池 eligible(未弃)
      const okElig = pot.winners.every(w => (pot.eligible || []).includes(w) && !st.players[w].folded);
      if (!okElig) bad(`赢家非该池合格者 s=${s}`);
      // 赢家成手牌 == 合格者中最优
      const evalsBySeat = {};
      for (const seat of (pot.eligible || [])){
        if (st.players[seat].folded) continue;
        const hole = R.reveal[seat].hole.map(id => idToCard(id));
        evalsBySeat[seat] = E.evaluate(hole.concat(board));
      }
      let best = null;
      for (const seat in evalsBySeat){ if (best === null || E.compare(evalsBySeat[seat], evalsBySeat[best]) > 0) best = seat; }
      checks++;
      const winnersReallyBest = pot.winners.every(w => E.compare(evalsBySeat[w], evalsBySeat[best]) === 0);
      if (!winnersReallyBest) bad(`池赢家非牌力最优 s=${s}`);
    }
  }
}

// id → {rank,suit}: id 形如 's14' 'h2'
function idToCard(id){
  const KEY = { s:'♠', h:'♥', c:'♣', d:'♦' };
  return { suit: KEY[id[0]], rank: parseInt(id.slice(1), 10) };
}

if (notOver) bad(`${notOver} 局未走到终局`);
console.log(`\n德州扑克模糊压测: ${HANDS} 局, ${checks} 项不变量, ${fails} 失败`);
process.exit(fails ? 1 : 0);
