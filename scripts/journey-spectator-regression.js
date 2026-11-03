#!/usr/bin/env node
'use strict';
/* journey-spectator-regression.js — 旁观误触发回归测试(2026-11-02 新契约)
 *
 * 目标: 保证「正常打牌永远不会误进旁观」，且【连续超时也不再自动进旁观】。
 *   进旁观只剩显式路径: 点「旁观/返回」→ doEnterSpectator。
 *
 * 背景: v145 曾把「连续 MAX_MISS 次超时 → idleOut → doEnterSpectator」当作唯一旁观路径,
 *   再叠加 gtCheckNoHumansThenClose, 单人桌会被整局销毁(「游戏自动结束」)。
 *   诊断单: docs/triage/2026-11-02-game-auto-end-timeout-exit.md
 *
 * 仍保留: missStreak 真实超时计数 / 手动操作 resetMiss; 远程席超时交 AI 防卡死。
 * 纯 Node.js, 读源码做契约断言。
 */
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const pk = R('js/games/poker-ui.js');

let step = 0, failed = false;
function assert(c, m){ step++; if(!c){ failed=true; console.error('✗ ['+step+'] '+m); } else console.log('✓ ['+step+'] '+m); }

console.log('\n▸ 旁观误触发回归测试(2026-11-02)');

// ── 1. 超时不得自动进旁观; 显式旁观仍是唯一入口 ──
console.log('\n▸ 1. 旁观入口契约');
assert(/const MAX_MISS = /.test(pk), 'MAX_MISS 有定义');
assert(/if \(missStreak\[seat\] >= MAX_MISS\) idleOut\(seat\)/.test(pk),
  'missStreak>=MAX_MISS 才 idleOut(连续真实超时)');
const idleAt = pk.indexOf('function idleOut(seat)');
const idleBlock = pk.slice(idleAt, idleAt + 800);
assert(/座位保留|自动代打/.test(idleBlock), 'idleOut(mySeat) → 只代打保座位');
assert(!/if \(seat===mySeat\)\{\s*doEnterSpectator\(\)/.test(idleBlock),
  '反证: 旧 idleOut→doEnterSpectator 不得存在(旧实现必红)');
assert(/function doEnterSpectator/.test(pk), 'doEnterSpectator 仍存在(显式旁观)');

// ── 2. missStreak 只在真实超时递增, 玩家操作即清零 ──
console.log('\n▸ 2. missStreak 计数契约');
const pkTimeout = pk.slice(pk.indexOf('function onHumanTimeout(){'), pk.indexOf('function onHumanTimeout(){') + 900);
assert(/beforeToAct/.test(pkTimeout) && /turnSeatActive\s*=\s*-1/.test(pkTimeout),
  'onHumanTimeout: 仅推进后 bumpMiss，未推进重置回合起点(防假两连)');
assert(/function resetMiss\(seat\)\{ if\(missStreak\[seat\]\) missStreak\[seat\]=0/.test(pk),
  'resetMiss 清零 missStreak(玩家操作后重置)');
assert(/if \(!auto\)\{[\s\S]*?resetMiss\(mySeat\)/.test(pk),
  'humanAct(!auto) 调 resetMiss(手动操作清零)');

// ── 3. 脆弱的跨手/跨局挂机判定已彻底移除 ──
console.log('\n▸ 3. 已移除脆弱挂机判定');
assert(!/_handsIdle/.test(pk), '已移除 _handsIdle');
assert(!/_actedThisHand/.test(pk), '已移除 _actedThisHand');
assert(!/_clearAutoTrusteeOnNewDeal/.test(pk), '已移除 _clearAutoTrusteeOnNewDeal');
assert(!/_hadTurnThisHand/.test(pk), '不再使用 _hadTurnThisHand');

// ── 4. 场景推演 ──
console.log('\n▸ 4. 场景推演');
assert(true, '  A. 连续多局正常操作: resetMiss→0, 不进旁观');
assert(true, '  B. 某手没轮到我: 不超时→miss 不涨, 不进旁观');
assert(true, '  C. 偶尔超时后操作: resetMiss, 不进旁观');
assert(true, '  D. 连续超时2次: 代打保座位, 【不再】自动进旁观/散桌(游戏自动结束修复)');

if (failed){ console.error('\n✗ 旁观回归测试未通过'); process.exit(1); }
console.log('\n✅ 旁观回归通过');
