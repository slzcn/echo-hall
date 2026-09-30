#!/usr/bin/env node
'use strict';
/* 德州盲位席修复体检: SB/BB 角标必须与引擎实际下盲的席位一致, 且跳过 sitOut(筹码≤0)/空席。
 *   旧 blindSeats 纯取模 (button+1)%n / (button+2)%n 不跳空席 → 有人 sitOut 时角标错位。
 *   修复: 引擎把权威盲位 sbSeat/bbSeat 落进 state, 快照携带, UI 直接读; 兜底也按在座数判单挑。
 * 用法: node scripts/probe-poker-blind-seats.js */
const path = require('path');
const E = require(path.join(__dirname, '..', 'js/games/poker-engine.js'));
const NET = require(path.join(__dirname, '..', 'js/games/poker-net.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };

// 6 席, 席1 与 席4 筹码为 0 = sitOut。庄家席0 → 3+ 人局: SB=庄后首个在座=2, BB=再下一个=3。
const stacks = [100, 0, 100, 100, 0, 100];
const st = E.createGame({ seed: 'blindtest', names: stacks.map((_, i) => 'P' + i),
  isAI: stacks.map(() => true), stacks, button: 0, sb: 1, bb: 2 });
const blinds = st.log.filter(e => e.t === 'blind');
const sbLog = blinds.find(e => e.kind === 'sb').seat, bbLog = blinds.find(e => e.kind === 'bb').seat;
ok(st.sbSeat === 2, 'sbSeat 应=2(跳过 sitOut 席1), 实得 ' + st.sbSeat);
ok(st.bbSeat === 3, 'bbSeat 应=3, 实得 ' + st.bbSeat);
ok(st.sbSeat === sbLog && st.bbSeat === bbLog, 'state 盲位与 log 实下盲位一致 sb=' + sbLog + ' bb=' + bbLog);
ok(st.sbSeat !== 1, '未落到 sitOut 席1(旧取模 bug)');

// 快照: 携带 sbSeat/bbSeat 供客人角标, 且不泄漏底牌/牌堆/种子。
const snap = NET.snapshot(st, 1);
ok(snap.sbSeat === 2 && snap.bbSeat === 3, '快照携带 sbSeat/bbSeat, 实得 sb=' + snap.sbSeat + ' bb=' + snap.bbSeat);
ok(NET.assertNoLeak(snap).ok, '快照防泄漏自检通过');

// 在座 2 人 = 单挑规则(庄=小盲), 即便座位号不连续也按【在座数】而非 n 判。
const st2 = E.createGame({ seed: 'hu', names: ['a', 'b', 'c', 'd'], isAI: [1, 1, 1, 1],
  stacks: [100, 0, 0, 100], button: 0, sb: 1, bb: 2 });
ok(st2.sbSeat === 0 && st2.bbSeat === 3, '在座2人单挑: SB=庄0 BB=3, 实得 sb=' + st2.sbSeat + ' bb=' + st2.bbSeat);

console.log('\n德州盲位席修复: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
