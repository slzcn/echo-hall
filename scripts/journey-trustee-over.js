#!/usr/bin/env node
'use strict';
/* journey-trustee-over.js — 托管钮第二位 + 过牌自动仅本局 + 结算页升级 */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const ddz=R('js/games/game-ui.js'), gd=R('js/games/guandan-ui.js'), pk=R('js/games/poker-ui.js');
const sh=R('js/games/table-shared.css');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

// 顶栏: 音乐之后第二位是托管
assert(/ddz-mus[\s\S]{0,200}ddz-auto[\s\S]{0,200}ddz-rot/.test(ddz.replace(/\s+/g,' ')) || /id="ddzMus"[\s\S]{0,180}id="ddzAuto"[\s\S]{0,180}id="ddzRot"/.test(ddz), '斗地主顶栏: 音乐→托管→旋转');
assert(/id="gdMus"[\s\S]{0,180}id="gdAuto"[\s\S]{0,180}id="gdRot"/.test(gd), '掼蛋顶栏第二位托管钮');
assert(/id="pkMus"[\s\S]{0,180}id="pkAuto"[\s\S]{0,180}id="pkRot"/.test(pk), '德州顶栏第二位托管钮');
assert(/gd-auto/.test(sh) && /pk-auto/.test(sh), '托管钮样式进 table-shared');

// 过牌/超时 → 自动托管仅本局
assert(/trusteeAuto/.test(ddz) && /_clearAutoTrusteeOnNewDeal/.test(ddz), '斗地主: 自动托管 trusteeAuto + 新局清除');
assert(/trusteeAuto/.test(gd) && /_clearAutoTrusteeOnNewDeal/.test(gd), '掼蛋: 自动托管仅本局');
assert(/trusteeAuto/.test(pk) && /_clearAutoTrusteeOnNewDeal/.test(pk), '德州: 自动托管仅本局');
assert(/本局已自动托管/.test(ddz) && /本局已自动托管/.test(gd) && /本局已自动托管/.test(pk), '文案: 本局已自动托管');
assert(/isTrustee:/.test(ddz) && /isTrustee:/.test(gd) && /isTrustee:/.test(pk), '导出 isTrustee');

// 结算页
assert(/eh-rank-row/.test(gd), '掼蛋结算名次徽章行');
assert(/eh-lvl-chip/.test(gd), '掼蛋升级 chip');
assert(/eh-over-kicker/.test(gd) && /eh-over-kicker/.test(pk), '结算页 kicker 标签');
assert(/rgba\(255,255,255,\.07\)/.test(sh), '结算按钮深色语境(去日间灰条)');
assert(/gd-over \.gd-btn\.primary|pk-over \.pk-b\.call/.test(sh), '主按钮 accent 渐变');

console.log('\n'+(failed?'❌ 有失败':'✅ 托管钮 + 结算页升级契约通过'));
process.exit(failed?1:0);
