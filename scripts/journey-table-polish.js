#!/usr/bin/env node
'use strict';
/* journey-table-polish.js — 牌桌观感与刷新还原契约
 * 1) 下注筹码不压公共牌: 落点按【实测 board/pot 矩形】避让, 不再硬编码 28~50 + 44.4 覆盖
 * 2) 刷新留在牌局: eh_last_game 记桌号, 进房后在座则自动接回
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PK = fs.readFileSync(path.join(ROOT, 'js/games/poker-ui.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ✓ '+m);} else {fail++; console.log('  ✗ '+m);} };

console.log('\n── 下注筹码落点 ──');
ok(/els\.board && els\.board\.getBoundingClientRect/.test(PK), '按 board 实测矩形定牌带');
ok(/els\.pot && els\.pot\.getBoundingClientRect/.test(PK), '底池矩形一并计入牌带');
ok(/bandT|bandB/.test(PK), '牌带上下沿动态计算');
ok(!/CY - RY \* 0\.05/.test(PK), '去掉顶部席硬推 44.4 的覆盖(会压公共牌)');
ok(/cy < CY\) \? \(bandT/.test(PK.replace(/\s+/g,' ')) || /\(cy < CY\)\s*\?\s*\(bandT/.test(PK), '上席退出牌带上沿 / 下席退出下沿');

console.log('\n── 刷新留在牌局 ──');
ok(/eh_last_game/.test(APP), '持久化键 eh_last_game');
ok(/function _gtRememberGame/.test(APP), '记住当前桌');
ok(/function _gtForgetGame/.test(APP), '散桌/离席遗忘');
ok(/_gtRememberGame\(id\)/.test(APP), 'gtEnter 记桌');
ok(/_gtRememberGame\(row\.id\)/.test(APP), 'gtLaunchLocal/Lobby 记桌');
ok(/_gtForgetGame\(\)/.test(APP), '自动接回失败/已散 → 清键');
ok(/刷新留在牌局/.test(APP), '接回逻辑有注释锚点');
ok(/const mine=\(row\.seats\|\|\[\]\)\.some\(s=>s&&s\.kind==='human'&&s\.uid===myUid\)/.test(APP.replace(/\s+/g,' ')),
   '只在「我在座」时才自动接回');

console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
