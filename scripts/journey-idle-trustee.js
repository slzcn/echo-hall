#!/usr/bin/env node
'use strict';
/* journey-idle-trustee.js — 两轮没响应→托管, 两局没响应→离座(三款一致) */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

// 斗地主/掼蛋: 两轮超时→AI 自动托管代打, 但【不再】自动把本人踢成旁观(v144 修"无故弃牌/散桌")。
//   德州有真正的 away/host 轮转, 其离座逻辑与牌类不同, 这里只约束斗地主/掼蛋两款的"不自动让座"契约。
for (const [fn,tag] of [['js/games/game-ui.js','斗地主'],['js/games/guandan-ui.js','掼蛋']]){
  const s=R(fn);
  assert(/MAX_MISS[^;]*:\s*2/.test(s) || /opts\.maxMiss[^)]*\)\s*:\s*2/.test(s), tag+': 两轮没响应→自动托管(MAX_MISS=2)');
  // ★v144: 自动托管仍在(trusteeAuto), 但自动让座逻辑已拆除 —— 挂机判定会误伤正常玩家, 误伤 host 更会整桌散桌。
  assert(/trusteeAuto/.test(s), tag+': 连续超时→本局自动托管(trusteeAuto)');
  assert(!/_handsIdle\s*>=\s*2[\s\S]{0,120}doEnterSpectator/.test(s),
    tag+': 【已移除】两局无响应→自动强制让座(不再误踢正常玩家/房主)');
  assert(/function doEnterSpectator/.test(s), tag+': 主动旁观仍保留(用户手动「🔭 旁观」)');
  assert(/function resetMiss[\s\S]{0,160}_actedThisHand\s*=\s*true/.test(s), tag+': 本人有效操作清计数');
}
console.log('\n'+(failed?'❌ 有失败':'✅ 托管/不自动让座契约通过'));
process.exit(failed?1:0);
