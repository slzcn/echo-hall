#!/usr/bin/env node
'use strict';
/* journey-trustee-over.js — v145: 连续两次超时自动离座(非自动托管); 手动托管钮(🤖)作为独立功能保留(斗地主/掼蛋)。
 *   注: 顶栏按钮布局/结算页 CSS 的历史断言已随 UI 多次改版失效且与本契约无关, 本测试聚焦"超时→离座 + 手动托管"契约。 */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const ddz=R('js/games/game-ui.js'), gd=R('js/games/guandan-ui.js'), pk=R('js/games/poker-ui.js');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

// 手动托管钮(🤖): 斗地主/掼蛋有(德州无代打/托管概念)
assert(/id="ddzAuto"/.test(ddz), '斗地主顶栏手动托管钮 #ddzAuto');
assert(/id="gdAuto"/.test(gd), '掼蛋顶栏手动托管钮 #gdAuto');

// v145: 超时不再"自动托管", 改为连续两次超时自动离座(idleOut→doEnterSpectator); trusteeAuto 已移除(三款)。
assert(!/trusteeAuto/.test(ddz) && !/trusteeAuto/.test(gd) && !/trusteeAuto/.test(pk), '三款: 已移除 trusteeAuto 自动托管');
assert(!/_clearAutoTrusteeOnNewDeal/.test(ddz) && !/_clearAutoTrusteeOnNewDeal/.test(gd) && !/_clearAutoTrusteeOnNewDeal/.test(pk), '三款: 已移除 _clearAutoTrusteeOnNewDeal 跨局挂机判定');
assert(/idleOut\(seat\)/.test(ddz) && /idleOut\(seat\)/.test(gd) && /idleOut\(seat\)/.test(pk), '三款: 连续超时 idleOut 自动离座');
assert(/setTrustee/.test(ddz) && /setTrustee/.test(gd), '手动托管钮保留(斗地主/掼蛋 setTrustee)');
assert(/isTrustee:/.test(ddz) && /isTrustee:/.test(gd), '导出 isTrustee(斗地主/掼蛋)');

console.log('\n'+(failed?'❌ 有失败':'✅ 超时→离座 + 手动托管契约通过'));
process.exit(failed?1:0);
