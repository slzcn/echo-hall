#!/usr/bin/env node
'use strict';
/* journey-ddz-pwa-size.js — PWA/手机竖屏斗地主牌桌放大 */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const ui=R('js/games/game-ui.js');
const sh=R('js/games/table-shared.css');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/max-width:599px/.test(ui) && /--cw:50px/.test(ui), '手机竖屏斗地主牌面提到 50×70');
assert(/pwa-standalone \.ddz-room:not\(\.is-land\)/.test(ui) && /--cw:54px/.test(ui), 'PWA 竖屏斗地主再放大到 54×76');
assert(/min-height:150px/.test(ui), '手机中央区 min-height 提到 150');
assert(/min-height:180px !important/.test(ui), 'PWA 中央区 min-height 180');
assert(/border-radius:42%\/48%/.test(ui) || /left:0;right:0;top:2%/.test(ui), '绒面椭圆吃满中央区');
assert(/pwa-standalone \.gd-room:not\(\.is-land\)/.test(sh) && /pwa-standalone \.pk-room:not\(\.is-land\)/.test(sh), '掼蛋/德州 PWA 竖屏同步放大');
assert(/--cw:44px/.test(sh) && /--cw:40px/.test(sh), 'GD/PK PWA 牌面档位');

console.log('\n'+(failed?'❌ 有失败':'✅ PWA 斗地主牌桌放大通过'));
process.exit(failed?1:0);
