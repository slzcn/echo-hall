#!/usr/bin/env node
'use strict';
/* 引擎空缺席(机器人输光离场/待邀请空位)单测: 验证空席不发牌/不下盲/不轮到行动,
 * 盲位与首个行动位在【在座席】上正确轮转, 单挑规则按在座两人触发, 摊牌/边池不含空席。
 * 用法: node scripts/probe-poker-sitout.js  */
const path = require('path');
const E = require(path.join(__dirname, '..', 'js/games/poker-engine.js'));

let pass = 0, fail = 0;
const ok  = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const eq  = (a, b, m) => ok(a === b, `${m} (期望 ${b}, 实得 ${a})`);

function mkStacks(n, zeros){ const s = new Array(n).fill(1000); (zeros||[]).forEach(i => s[i] = 0); return s; }
function names(n){ return Array.from({length:n}, (_,i)=>'席'+i); }

// —— 用例1: 6 席, 席3/席5 空缺(stack=0), 庄家=0 ——
(function(){
  console.log('用例1: 6席 空缺[3,5] 庄家0');
  const st = E.createGame({ names: names(6), stacks: mkStacks(6,[3,5]), button:0, sb:5, bb:10, seed:42 });
  eq(st.players[3].sitOut, true, '席3 sitOut');
  eq(st.players[5].sitOut, true, '席5 sitOut');
  eq(st.players[3].hole.length, 0, '席3 不发牌');
  eq(st.players[5].hole.length, 0, '席5 不发牌');
  eq(st.players[0].hole.length, 2, '席0 发2张');
  ok(st.players[3].folded && st.players[5].folded, '空席预置 folded');
  // 在座席: 0,1,2,4 → 6人普通局: sb=庄+1(在座第一)=1, bb=2, 首行动=bb后在座=4
  eq(st.players[1].street, 5, '席1 小盲5');
  eq(st.players[2].street, 10, '席2 大盲10');
  eq(st.toAct, 4, '首行动=席4(跳过空席3)');
  eq(st.players[3].committed, 0, '席3 无投入');
})();

// —— 用例2: 在座恰好两人 → 单挑规则(庄家=小盲) ——
(function(){
  console.log('用例2: 6席 仅席0/席2在座 → 单挑');
  const st = E.createGame({ names: names(6), stacks: mkStacks(6,[1,3,4,5]), button:0, sb:5, bb:10, seed:7 });
  eq([0,1,2,3,4,5].filter(i=>!st.players[i].sitOut).length, 2, '在座2人');
  eq(st.players[0].street, 5, '单挑: 庄家(席0)下小盲');
  eq(st.players[2].street, 10, '单挑: 席2下大盲');
  eq(st.toAct, 0, '单挑翻前庄家先动');
})();

// —— 用例3: 庄家落在空席 → 自动挪到在座席 ——
(function(){
  console.log('用例3: 庄家=空席1 → 兜底归位');
  const st = E.createGame({ names: names(4), stacks: mkStacks(4,[1]), button:1, sb:5, bb:10, seed:9 });
  eq(st.button, 2, '庄家从空席1挪到席2');
})();

// —— 用例4: 全员在座(回归, 不应改变旧行为) ——
(function(){
  console.log('用例4: 6席全在座 回归');
  const st = E.createGame({ names: names(6), stacks: mkStacks(6,[]), button:0, sb:5, bb:10, seed:1 });
  eq(st.players[1].street, 5, 'sb=席1');
  eq(st.players[2].street, 10, 'bb=席2');
  eq(st.toAct, 3, '首行动=席3');
  eq(st.players.every(p=>p.hole.length===2), true, '全员各2张');
})();

// —— 用例5: 打到摊牌, 空席不进摊牌/不参与边池 ——
(function(){
  console.log('用例5: 空席[2] 全跟到摊牌');
  let st = E.createGame({ names: names(4), stacks: mkStacks(4,[2]), button:0, sb:5, bb:10, seed:123 });
  let guard = 0;
  while (st.toAct !== -1 && !st.result && guard++ < 200){
    const seat = st.toAct;
    const la = E.legalActions(st, seat);
    // 简单策略: 能过牌就过, 否则跟注
    if (la.canCheck) E.applyAction(st, seat, 'check');
    else E.applyAction(st, seat, 'call');
  }
  ok(!!st.result, '手牌打完出结果');
  eq(st.players[2].hole.length, 0, '空席2 全程无牌');
  const pots = E.buildSidePots(st);
  const involved = new Set();
  pots.forEach(p => p.eligible.forEach(s => involved.add(s)));
  ok(!involved.has(2), '边池合格者不含空席2');
})();

console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
