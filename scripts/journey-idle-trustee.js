#!/usr/bin/env node
'use strict';
/* journey-idle-trustee.js — 2026-11-02 新契约: 连续两次超时【不】自动离座(本席只代打、座位保留)。
 *   背景: v145「两次超时→doEnterSpectator→vacate→gtCheckNoHumansThenClose」会在
 *   单人桌/最后一人把整局销毁 = 「游戏自动结束」bug。
 *   诊断单: docs/triage/2026-11-02-game-auto-end-timeout-exit.md
 *   远程席超时仍离座交 AI(防联机卡死); 显式「旁观/返回」仍真离座。
 *   手动托管(🤖)保留; 空桌回收走 eh_gt_reap / 显式离场后的 gtCheckNoHumansThenClose。 */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

for (const [fn,tag] of [['js/games/game-ui.js','斗地主'],['js/games/guandan-ui.js','掼蛋'],['js/games/poker-ui.js','德州']]){
  const s=R(fn);
  assert(/MAX_MISS[^;]*:\s*2/.test(s) || /opts\.maxMiss[^)]*\)\s*:\s*2/.test(s), tag+': 两次超时阈值(MAX_MISS=2)');
  assert(/if \(missStreak\[seat\] >= MAX_MISS\) idleOut\(seat\)/.test(s), tag+': missStreak>=MAX_MISS → idleOut');
  // ★新契约: idleOut(本席) 不得再 doEnterSpectator(旧实现必红)
  const idleAt=s.indexOf('function idleOut(seat)');
  const idleBlock=s.slice(idleAt, idleAt+1100);
  assert(/seat===mySeat/.test(idleBlock) && /座位保留|自动代打/.test(idleBlock),
    tag+': idleOut(mySeat) → 只代打保座位(不离座)');
  assert(!/if \(seat===mySeat\)\{\s*doEnterSpectator\(\)/.test(idleBlock),
    tag+': 反证 — 旧实现 idleOut→doEnterSpectator 必须不存在');
  // 显式旁观入口仍在
  assert(/function doEnterSpectator/.test(s), tag+': doEnterSpectator 仍供显式旁观');
  assert(/function doEnterSpectator[\s\S]{0,1400}onSeatIdle\(mySeat, \{[^}]*vacate:true/.test(s),
    tag+': 显式旁观仍 onSeatIdle({vacate:true}) 腾座');
  // 远程席超时仍腾座/交 AI
  assert(/onSeatIdle\(seat,\s*\{[^}]*mine:\s*false/.test(idleBlock) || /mine:false/.test(idleBlock),
    tag+': 远程席 idleOut → onSeatIdle(mine:false) 交 AI');
  assert(!/_handsIdle/.test(s) && !/_actedThisHand/.test(s) && !/_clearAutoTrusteeOnNewDeal/.test(s),
    tag+': 【已移除】_handsIdle/_actedThisHand/_clearAutoTrusteeOnNewDeal 跨局挂机计数');
  assert(!/trusteeAuto/.test(s), tag+': 【已移除】trusteeAuto 自动托管');
  assert(!/function checkNoHumansThenDissolve/.test(s), tag+': 【已移除】game-ui 层散桌空壳');
}
console.log('\n'+(failed?'❌ 有失败':'✅ 契约通过: 本席连续超时不离座/不散桌；远程席仍交 AI；显式旁观保留'));
process.exit(failed?1:0);
