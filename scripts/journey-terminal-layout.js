#!/usr/bin/env node
'use strict';
/* journey-terminal-layout.js — 三游戏按终端重排结构 */
const fs=require('fs'), path=require('path');
const sh=fs.readFileSync(path.join(__dirname,'..','js/games/table-shared.css'),'utf8');
const ddz=fs.readFileSync(path.join(__dirname,'..','js/games/game-ui.js'),'utf8');
const pk=fs.readFileSync(path.join(__dirname,'..','js/games/poker-ui.js'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/max-width:\s*599px/.test(sh) && /is-lobby/.test(sh), '竖屏招募媒体查询');
assert(/is-lobby \.ddz-center[\s\S]{0,120}min-height:\s*150px/.test(sh), '招募桌心紧凑');
assert(/is-lobby \.ddz-hand-wrap[\s\S]{0,200}height:\s*0/.test(sh), '招募手牌带高度归零');
assert(/#ddzCtrl[\s\S]{0,80}margin-top:\s*auto/.test(sh), '招募操作区钉底');
assert(/min-height:\s*500px[\s\S]{0,200}is-lobby/.test(sh) || /max-height:\s*500px/.test(sh), '横屏矮盒降级');
assert(/min-width:\s*900px/.test(sh) && /max-width:\s*900px/.test(sh), '桌面限宽居中');
assert(/lob \? 42 : 40/.test(pk) && /lob \? 24 : 32/.test(pk), '德州招募椭圆压扁(RX/RY)');
assert(/lob \? \(land \? 48 : 40\)/.test(pk), '德州招募中心上移');
assert(/flex: 1 1 auto/.test(sh), '对局态中央弹性');
assert(/pwa-standalone/.test(sh) && /is-lobby/.test(sh), 'PWA 招募顶部收敛');

console.log('\n'+(failed?'❌ 有失败':'✅ 终端结构重排契约通过'));
process.exit(failed?1:0);
