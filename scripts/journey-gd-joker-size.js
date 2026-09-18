#!/usr/bin/env node
'use strict';
/* journey-gd-joker-size.js — 掼蛋/三游戏 大小王与普通牌同盒尺寸 */
const fs=require('fs'), path=require('path');
const gd=fs.readFileSync(path.join(__dirname,'..','js/games/guandan-ui.js'),'utf8');
const ddz=fs.readFileSync(path.join(__dirname,'..','js/games/game-ui.js'),'utf8');
const sh=fs.readFileSync(path.join(__dirname,'..','js/games/table-shared.css'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(!/cc">\u{1F0CF}/u.test(gd) && /cc">王</.test(gd), '掼蛋大小王中心用「王」字不用 emoji');
assert(!/cc">\u{1F0CF}/u.test(ddz) && /cc">王</.test(ddz), '斗地主大小王同步改为「王」字');
assert(/card\.joker \.cc[\s\S]{0,120}\* \.8/.test(sh) || /joker \.cc\{font-size:calc\(var\(--cc[^\)]+\) \* \.8\)/.test(sh),
  '共享层 joker 中心字号与花色牌同比例');
assert(/card\.mini\.joker/.test(sh), 'mini 大小王单独字号, 不放大');
assert(/card\.joker \.cn/.test(sh), '大小王角标字号对齐普通牌 --cn');

console.log('\n'+(failed?'❌ 有失败':'✅ 大小王与普通牌同盒尺寸'));
process.exit(failed?1:0);
