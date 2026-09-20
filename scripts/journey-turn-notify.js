#!/usr/bin/env node
'use strict';
/* journey-turn-notify.js — 后台轮到自己时桌面弹窗 */
const fs=require('fs'), path=require('path');
const APP=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
const UI=fs.readFileSync(path.join(__dirname,'..','js/games/game-ui.js'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/function _notifyMyTurnPopup/.test(APP), '存在桌面弹窗助手');
assert(/requireInteraction:\s*true/.test(APP), '通知 requireInteraction 桌面常驻');
assert(/Notification\.requestPermission/.test(APP), '开桌时请求通知权限');
assert(/document\.hidden \|\| pip/.test(APP) || /document\.hidden \|\| pip/.test(APP.replace(/\s+/g,' ')), '后台或 PiP 折叠都提醒');
assert(/isMinimized/.test(APP), '识别牌桌折叠态');
assert(/tag:\s*'eh-turn'/.test(APP), '通知 tag 去重');
assert(/n\.onclick/.test(APP) && /window\.focus/.test(APP), '点通知回前台');
assert(/yourturn/.test(APP), '弹窗同时响 yourturn 音效');
assert(/setInterval[\s\S]{0,80}1800/.test(APP) || /,\s*1800\)/.test(APP), '轮询 1.8s');
assert(/isMinimized:\(\)=>minimized/.test(UI), '游戏导出 isMinimized');

console.log('\n'+(failed?'❌ 有失败':'✅ 后台轮到自己弹窗提醒契约通过'));
process.exit(failed?1:0);
