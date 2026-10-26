#!/usr/bin/env node
'use strict';
/* journey-idle-trustee.js — v145 统一规则: 连续两次超时→自动离座(doEnterSpectator), 三款一致。
 *   不再有"连续两局无操作→自动让座"的脆弱跨局/跨手挂机判定(_handsIdle/_actedThisHand), 也不再自动开托管。
 *   手动托管(🤖 钮)作为独立功能保留; 无真人在座自动解散由 app 侧 gtCheckNoHumansThenClose 统一处理。 */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

for (const [fn,tag] of [['js/games/game-ui.js','斗地主'],['js/games/guandan-ui.js','掼蛋'],['js/games/poker-ui.js','德州']]){
  const s=R(fn);
  assert(/MAX_MISS[^;]*:\s*2/.test(s) || /opts\.maxMiss[^)]*\)\s*:\s*2/.test(s), tag+': 两次超时阈值(MAX_MISS=2)');
  // 达阈值 → idleOut
  assert(/if \(missStreak\[seat\] >= MAX_MISS\) idleOut\(seat\)/.test(s), tag+': missStreak>=MAX_MISS → idleOut');
  // idleOut(我) → 真离座(doEnterSpectator), 不是开托管
  assert(/function idleOut\(seat\)\{[\s\S]{0,260}if \(seat===mySeat\)\{ doEnterSpectator\(\); return; \}/.test(s),
    tag+': idleOut(mySeat) → doEnterSpectator 真离座(非托管)');
  assert(/function doEnterSpectator/.test(s), tag+': doEnterSpectator 起身让座');
  // doEnterSpectator 通知 app 腾 DB 座(vacate)
  assert(/function doEnterSpectator[\s\S]{0,1400}onSeatIdle\(mySeat, \{[^}]*vacate:true/.test(s),
    tag+': 离座 onSeatIdle({vacate:true}) 通知 app 腾座→无真人则解散');
  // 旧的脆弱跨局/跨手挂机计数已彻底移除
  assert(!/_handsIdle/.test(s) && !/_actedThisHand/.test(s) && !/_clearAutoTrusteeOnNewDeal/.test(s),
    tag+': 【已移除】_handsIdle/_actedThisHand/_clearAutoTrusteeOnNewDeal 跨局挂机计数');
  assert(!/trusteeAuto/.test(s), tag+': 【已移除】trusteeAuto 自动托管(超时改为离座)');
  assert(!/function checkNoHumansThenDissolve/.test(s), tag+': 【已移除】game-ui 层禁用的散桌空壳(改由 app 层统一判)');
}
console.log('\n'+(failed?'❌ 有失败':'✅ 统一"两次超时自动离座"契约通过(三款一致)'));
process.exit(failed?1:0);
