#!/usr/bin/env node
'use strict';
/* test-pk-layout-contract.js — 德州 iOS 竖屏铺满底部 + 横屏不再乱版 */
const fs = require('fs');
const path = require('path');
const pk = fs.readFileSync(path.join(__dirname,'..','js/games/poker-ui.js'),'utf8');
const sh = fs.readFileSync(path.join(__dirname,'..','js/games/table-shared.css'),'utf8');
const orient = fs.readFileSync(path.join(__dirname,'..','js/games/table-orient.js'),'utf8');

let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log('  ✓ '+m);} else {fail++;console.log('  ✗ '+m);} };

console.log('\n── 竖屏底部铺满 ──');
ok(/bottom:\s*0\s*!important/.test(pk) && /height:\s*min\(calc\(100% - 6px\),\s*620px\)/.test(pk),
  '竖屏 pk-table 贴底且高度吃满 felt');
ok(/justify-content:\s*flex-end/.test(pk), '竖屏 felt 内容贴底');
ok(/padding-bottom:\s*calc\(10px \+ env\(safe-area-inset-bottom/.test(sh) || /safe-area-inset-bottom/.test(sh),
  '操作区含 safe-area 底');

console.log('\n── 横屏乱版修复 ──');
ok(/\.pk-seat\{\s*min-height:\s*0/.test(sh), '德州对手席不再锁 88px');
ok(/\.pk-room\.is-land \.pk-seat\{\s*min-height:\s*0\s*!important/.test(sh)
  || /\.pk-room\.is-land \.pk-seat\{ min-height: 0 !important; \}/.test(sh),
  '横屏 pk-seat min-height 清零');
ok(/\.pk-room\.is-land \.pk-acts\{[\s\S]{0,80}min-height:\s*0/.test(sh), '横屏操作区 min-height 清零');
ok(/\.pk-room\.eh-rot\{/.test(pk) && /--av:36px/.test(pk), '⟳ 旋转态紧凑牌面变量');
ok(/bottom:\s*6px\s*!important/.test(pk) && /height:\s*auto\s*!important/.test(pk),
  '横屏 pk-table 填满 felt 高度(非 58vh 居中)');

console.log('\n── 横竖屏切换 ──');
ok(/reflect\(room\)/.test(orient) && /apply\(room\)[\s\S]{0,80}reflect/.test(orient) || /try\{\s*reflect\(room\);\s*\}catch/.test(orient),
  'table-orient apply 后立刻 reflect 挂 is-land');
ok(/orientationchange/.test(orient) && /orientationchange/.test(pk), 'orient + poker 均监听物理转屏');

console.log('\n'+(fail?'💥 有失败 ('+pass+'✓ '+fail+'✗)':'🎉 全部通过 ('+pass+'✓)'));
process.exit(fail?1:0);
