#!/usr/bin/env node
'use strict';
/* 掼蛋终局残牌揭示体检: 双下(头游+二游同队)时三游+末游两人都留牌 → 结算面板必须两人残牌都亮;
 *   单下时只末游一人留牌 → 只亮一行(不回退)。修复前 UI 只读 finishOrder 末位, 双下漏掉三游那摞牌。
 *   引擎 _settle 已给所有席 reveal[seat]=剩余牌id(出完者空数组), UI 按 finishOrder 过滤 ids.length 逐行渲染。
 * 用法: node scripts/probe-guandan-doubledown-reveal.js */
const path = require('path');
const Engine = require(path.join(__dirname, '..', 'js/games/guandan-engine.js'));
const AI = require(path.join(__dirname, '..', 'js/games/guandan-ai.js'));

function playFull(seed){
  let st = Engine.createGame({ seed, level: 2, teamLevels: [2, 2], isAI: [1, 1, 1, 1], names: ['A0', 'B1', 'A2', 'B3'] });
  let g = 0;
  while (st.phase === 'play'){
    if (g++ > 2000) throw new Error('play loop @' + seed);
    const s = st.turn;
    const t = (st.table.lastPlay && st.table.lastPlay.seat !== s) ? st.table.lastPlay.parse : null;
    const mv = AI.decide({ seat: s, hand: st.players[s].hand, tableParse: t,
      lastSeat: st.table.lastPlay ? st.table.lastPlay.seat : null,
      handsLeft: st.players.map(p => p.hand.length), level: st.level });
    if (mv.action === 'pass'){
      try { Engine.applyPass(st, s); } catch(e){ Engine.applyPlay(st, s, AI.chooseLead(st.players[s].hand, st.level)); }
    } else {
      try { Engine.applyPlay(st, s, mv.cards); }
      catch(e){ try { Engine.applyPass(st, s); } catch(_){ Engine.applyPlay(st, s, AI.chooseLead(st.players[s].hand, st.level)); } }
    }
  }
  return st.result;
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };
// UI 复刻: 揭示所有还留牌的败者(与 guandan-ui.js showOver 的 #gdRemains 同口径)
const losers = r => r.finishOrder.map((seat, i) => ({ seat, pos: i, ids: (r.reveal || {})[seat] || [] })).filter(x => x.ids.length);

let ddRes = null, sdRes = null;
for (let seed = 1; seed <= 200 && (!ddRes || !sdRes); seed++){
  const r = playFull(seed);
  if (r.doubleDown && !ddRes) ddRes = r;
  if (!r.doubleDown && !sdRes) sdRes = r;
}
ok(!!ddRes, '找到双下局');
ok(!!sdRes, '找到单下局');
if (ddRes){
  const L = losers(ddRes);
  ok(L.length === 2, '双下: 揭示 2 名败者(三游+末游都留牌), 实得 ' + L.length);
  ok(L.every(x => x.pos >= 2), '双下: 留牌者都在名次 3/4 位, 实得位 ' + L.map(x => x.pos));
  ok(L.every(x => x.ids.length > 0), '双下: 两败者都有残牌张数 ' + L.map(x => x.ids.length));
}
if (sdRes){
  const L = losers(sdRes);
  ok(L.length === 1 && L[0].pos === 3, '单下: 只揭示末游 1 人(不回退), 实得 ' + L.length + ' 位' + (L[0] && L[0].pos));
}
console.log('\n掼蛋双下残牌揭示: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
