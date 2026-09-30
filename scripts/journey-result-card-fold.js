#!/usr/bin/env node
'use strict';
/* journey-result-card-fold.js — 战绩卡折叠契约(主人: 战绩卡刷屏盖住聊天)
 * 1) 历史战绩卡默认收成一行摘要, 点击展开
 * 2) 实时新开的那张仍展开(要看到刚打完的结果)
 * 3) userExpanded=1 幂等: 手动展开过不折回
 * 4) 「再来一局」按钮不触发折叠切换
 * 5) 三款(斗地主/掼蛋/德州)都走 foldResult
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ✓ '+m);} else {fail++; console.log('  ✗ '+m);} };

console.log('\n── 折叠实现 ──');
ok(/const foldResult = \(el, summaryHtml\)/.test(APP), 'foldResult 统一折叠助手');
ok(/el\.classList\.add\('gc-collapsible'\)/.test(APP), '打 gc-collapsible 标');
ok(/gc-collapsed-row/.test(APP) && /gc-collapsed-row/.test(HTML), '一行摘要结构与 CSS 都在');
ok(/isHistory && el\.dataset\.userExpanded !== '1'/.test(APP), '历史才折叠 + userExpanded 幂等');
ok(/e\.target\.closest\('button'\)/.test(APP), '点按钮不触发折叠切换');
ok(/el\.dataset\.userExpanded='1'/.test(APP), '点击展开写 userExpanded');

console.log('\n── 三款战绩卡都接 ──');
ok(/return foldResult\(el, `🃏 斗地主/.test(APP), '斗地主接 foldResult');
ok(/return foldResult\(el, `🎴 掼蛋/.test(APP), '掼蛋接 foldResult');
ok(/return foldResult\(el, `🎰 德州/.test(APP), '德州接 foldResult');
ok(/buildGameEl\(m, isHistory\)/.test(APP), 'isHistory 传入 buildGameEl');
ok(/function buildGameEl\(m, isHistory\)/.test(APP), 'buildGameEl 收 isHistory');

console.log('\n── CSS 规则 ──');
ok(/\.game-card\.collapsed/.test(HTML), 'collapsed 态样式');
ok(/\.game-card\.collapsed \.ddz-scoreline/.test(HTML), '折叠时藏比分行');
ok(/\.game-card\.collapsed \.ddz-again-row/.test(HTML), '折叠时藏再来一局');
ok(/\.game-card\.collapsed \.gc-collapsed-row\{display:flex/.test(HTML), '折叠时显一行摘要');
ok(/\.game-card \.gc-collapsed-row\{display:none\}/.test(HTML), '展开时隐摘要行');

console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
