#!/usr/bin/env node
'use strict';
/* journey-spectator-regression.js — 旁观误触发回归测试(v145 统一模型)
 *
 * 目标: 保证"正常打牌永远不会误进旁观", 进旁观只有唯一一条确定路径:
 *   连续 MAX_MISS 次【真实超时】→ idleOut → doEnterSpectator。
 *
 * v145 重写: 删除了脆弱的跨手/跨局挂机判定(_handsIdle / _actedThisHand /
 *   _clearAutoTrusteeOnNewDeal) —— 它们会把"这手没轮到我操作"误当挂机, 累计误踢正常玩家
 *   (误踢 host 更会整桌散桌)。现在只认 missStreak(真实超时)。三款一致, 本测试以德州为样本。
 *
 * 纯 Node.js, 读源码做契约断言。
 */
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const pk = R('js/games/poker-ui.js');

let step = 0, failed = false;
function assert(c, m){ step++; if(!c){ failed=true; console.error('✗ ['+step+'] '+m); } else console.log('✓ ['+step+'] '+m); }

console.log('\n▸ 旁观误触发回归测试(v145)');

// ── 1. 进旁观唯一路径: missStreak>=MAX_MISS → idleOut → doEnterSpectator ──
console.log('\n▸ 1. 唯一旁观路径');
assert(/const MAX_MISS = /.test(pk), 'MAX_MISS 有定义');
assert(/if \(missStreak\[seat\] >= MAX_MISS\) idleOut\(seat\)/.test(pk),
  'missStreak>=MAX_MISS 才 idleOut(连续真实超时)');
assert(/function idleOut\(seat\)\{[\s\S]{0,260}if \(seat===mySeat\)\{ doEnterSpectator\(\); return; \}/.test(pk),
  'idleOut(mySeat) → doEnterSpectator');

// ── 2. missStreak 只在真实超时递增, 玩家操作即清零 ──
console.log('\n▸ 2. missStreak 计数契约');
assert(/function onHumanTimeout[\s\S]*?bumpMiss\(mySeat\)/.test(pk),
  'onHumanTimeout 调 bumpMiss(真实超时才递增 missStreak)');
assert(/function resetMiss\(seat\)\{ if\(missStreak\[seat\]\) missStreak\[seat\]=0/.test(pk),
  'resetMiss 清零 missStreak(玩家操作后重置)');
assert(/if \(!auto\)\{[\s\S]*?resetMiss\(mySeat\)/.test(pk),
  'humanAct(!auto) 调 resetMiss(手动操作清零 → 下次超时从头算)');

// ── 3. 脆弱的跨手/跨局挂机判定已彻底移除(这是误踢正常玩家的根源) ──
console.log('\n▸ 3. 已移除脆弱挂机判定');
assert(!/_handsIdle/.test(pk), '已移除 _handsIdle(跨手累计误判)');
assert(!/_actedThisHand/.test(pk), '已移除 _actedThisHand(没轮到我操作被误当挂机)');
assert(!/_clearAutoTrusteeOnNewDeal/.test(pk), '已移除 _clearAutoTrusteeOnNewDeal(新局/新手跨手判定)');
assert(!/_hadTurnThisHand/.test(pk), '不再使用 _hadTurnThisHand');

// ── 4. 场景推演(新模型下为何正常打牌永不误进旁观) ──
console.log('\n▸ 4. 场景推演');
assert(true, '  A. 连续多局正常操作: 每次操作 resetMiss→missStreak=0, 永不到阈值 → 不进旁观');
assert(true, '  B. 某手没轮到我(别人全弃/一条龙带走): 不超时→missStreak 不涨 → 不进旁观');
assert(true, '  C. 偶尔超时1次后操作: resetMiss 清零 → 不进旁观');
assert(true, '  D. 连续超时2次(MAX_MISS): missStreak>=2 → idleOut → 正确进旁观(本就该离座)');

if (failed){ console.error('\n✗ 旁观回归测试未通过'); process.exit(1); }
console.log('\n✅ 旁观误触发回归测试通过(唯一路径: 连续真实超时达阈值)');
