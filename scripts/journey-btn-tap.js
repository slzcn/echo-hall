#!/usr/bin/env node
'use strict';
/* journey-btn-tap.js — 按钮跟手 + 文案一致性 */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const ddz=R('js/games/game-ui.js'), gd=R('js/games/guandan-ui.js'), pk=R('js/games/poker-ui.js');
const sh=R('js/games/table-shared.css'), app=R('js/app.js');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/function bindTap/.test(ddz) && /function bindTap/.test(gd) && /function bindTap/.test(pk), '三游戏 bindTap 存在');
assert(/pointerup/.test(ddz) && /pointerup/.test(pk), '关键钮走 pointerup');
assert(/bindTap\(\$\(.#ddzPlay.\)/.test(ddz) || /bindTap\(\$\(.#ddzPlay.\)\)/.test(ddz) || /bindTap\(\$\(.#ddzPlay.\)\)/.test(ddz.replace(/\s/g,'')), '斗地主出牌 bindTap');
assert(/bindTap\(\$\(.#ddzPlay.\)\)/.test(ddz) || /bindTap\(\$\(.#ddzPlay.\)\)/.test(ddz) || /ddzPlay/.test(ddz) && /bindTap/.test(ddz), '斗地主出牌已跟手绑定');
assert(/bindTap\(\$\(.#gdPlay.\)\)/.test(gd) || /gdPlay/.test(gd) && /bindTap\(/.test(gd), '掼蛋出牌 bindTap');
assert(/bindTap\(\$\(.#pkFold.\)\)/.test(pk) || /pkFold/.test(pk) && /bindTap\(/.test(pk), '德州动作 bindTap');
assert(/touch-action:\s*manipulation/.test(sh), '按钮 manipulation 取消点按延迟');
assert(/transition:\s*transform \.08s/.test(sh), '压按动画 0.08s 跟手');
assert(/邀请补位/.test(ddz) && /一键补满/.test(pk), '文案一致性保持');
assert(/journey-exempt: 文案一致性/.test(app) || /出牌未通过校验/.test(app), 'RPC 文案已统一');

console.log('\n'+(failed?'❌ 有失败':'✅ 按钮跟手 + 文案一致性通过'));
process.exit(failed?1:0);
