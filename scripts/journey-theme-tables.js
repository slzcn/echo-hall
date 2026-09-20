#!/usr/bin/env node
'use strict';
/* journey-theme-tables.js — 三游戏台面/按钮跟随主站主题变量 */
const fs=require('fs'), path=require('path');
const sh=fs.readFileSync(path.join(__dirname,'..','js/games/table-shared.css'),'utf8');
const cfg=fs.readFileSync(path.join(__dirname,'..','js/config.js'),'utf8');
const idx=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/data-theme="vapor"/.test(idx) && /data-theme="mono"/.test(idx), '主站含多套主题日/夜变量');
assert(/var\(--accent/.test(sh), '台面染色使用 --accent');
assert(/color-mix\(in srgb, var\(--accent/.test(sh), '夜间 felt accent 混色');
assert(/html\[data-mode="day"\][\s\S]{0,400}var\(--accent/.test(sh), '日间 felt 跟随 --accent');
assert(!/#2ba07f/.test(sh) && !/#8fe6cd/.test(sh), '去掉写死翡翠/薄荷台面色');
assert(/\.ddz-btn\.primary[\s\S]{0,200}var\(--accent/.test(sh), '主操作钮用 --accent');
assert(/data-mode="day"[\s\S]{0,120}color:\s*#fff/.test(sh) || /html\[data-mode="day"\] \.ddz-btn\.primary/.test(sh), '日间主按钮对比字色');
assert(/lobby-empty[\s\S]{0,300}var\(--accent/.test(sh), '空位圈跟随主题');
assert(/lobacts[\s\S]{0,250}var\(--panel-solid/.test(sh), '招募底栏玻璃 panel');
assert(/cyber/.test(cfg) && /klein/.test(cfg), 'config 仍保留 10 套主题色板');

console.log('\n'+(failed?'❌ 有失败':'✅ 台面主题化契约通过'));
process.exit(failed?1:0);
