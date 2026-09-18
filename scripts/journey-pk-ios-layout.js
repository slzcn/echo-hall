#!/usr/bin/env node
'use strict';
/* journey-pk-ios-layout.js — 德州 iOS 竖屏铺满底部 + 横屏不乱版 */
const fs = require('fs');
const path = require('path');
const pk = fs.readFileSync(path.join(__dirname,'..','js/games/poker-ui.js'),'utf8');
const sh = fs.readFileSync(path.join(__dirname,'..','js/games/table-shared.css'),'utf8');
const orient = fs.readFileSync(path.join(__dirname,'..','js/games/table-orient.js'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/bottom:\s*0\s*!important/.test(pk), '竖屏桌面贴 felt 底');
assert(/height:\s*min\(calc\(100% - 6px\),\s*620px\)/.test(pk), '竖屏桌面高度吃满');
assert(/\.pk-seat\{\s*min-height:\s*0/.test(sh), '德州对手席不锁高');
assert(/is-land \.pk-seat\{\s*min-height:\s*0\s*!important/.test(sh) || /is-land \.pk-seat\{ min-height: 0 !important/.test(sh), '横屏席位清零 min-height');
assert(/\.pk-room\.eh-rot\{/.test(pk), '⟳ 旋转态有紧凑变量');
assert(/try\{\s*reflect\(room\);\s*\}catch/.test(orient) || /apply\(room\)[\s\S]{0,120}reflect\(room\)/.test(orient), '旋转后 reflect 挂 is-land');
assert(/orientationchange/.test(pk) && /onOrient/.test(pk), 'poker 监听物理转屏');

console.log('\n'+(failed?'❌ 有失败':'✅ 德州 iOS 布局旅程通过'));
process.exit(failed?1:0);
