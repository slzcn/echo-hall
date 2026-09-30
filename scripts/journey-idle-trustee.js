#!/usr/bin/env node
'use strict';
/* journey-idle-trustee.js — 两轮没响应→托管, 两局没响应→离座(三款一致) */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

for (const [fn,tag] of [['js/games/game-ui.js','斗地主'],['js/games/guandan-ui.js','掼蛋'],['js/games/poker-ui.js','德州']]){
  const s=R(fn);
  assert(/MAX_MISS[^;]*:\s*2/.test(s) || /opts\.maxMiss[^)]*\)\s*:\s*2/.test(s), tag+': 两轮没响应→自动托管(MAX_MISS=2)');
  assert(/_handsIdle/.test(s) && /_actedThisHand/.test(s), tag+': 两局无响应计数');
  assert(/_handsIdle\s*>=\s*2[\s\S]{0,120}doEnterSpectator/.test(s) || /_handsIdle>=2[\s\S]{0,120}doEnterSpectator/.test(s),
    tag+': 两局无响应→自动离座(doEnterSpectator)');
  assert(/function doEnterSpectator/.test(s), tag+': 离座抽成命名函数');
  assert(/function resetMiss[\s\S]{0,160}_actedThisHand\s*=\s*true/.test(s), tag+': 本人有效操作清计数');
}
console.log('\n'+(failed?'❌ 有失败':'✅ 托管/离座契约通过'));
process.exit(failed?1:0);
