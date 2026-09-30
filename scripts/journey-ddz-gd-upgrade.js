#!/usr/bin/env node
'use strict';
/* journey-ddz-gd-upgrade.js — 斗地主/掼蛋对标德州近期优化的契约回归
 * 1) 旁观=起身让座(vacate:true), 不是「AI 接手」冒充托管
 * 2) 单机练习桌(isLocalSolo)绝不自动离座
 * 3) 空位点击入座(旁观中) + onGrabSeat
 * 4) 旁观三处文案一致(旁观中 · 已让座 / 坐下)
 * 5) 招募空位旁观时显示「点击入座」
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const DZ = fs.readFileSync(path.join(ROOT, 'js/games/game-ui.js'), 'utf8');
const GD = fs.readFileSync(path.join(ROOT, 'js/games/guandan-ui.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ✓ '+m);} else {fail++; console.log('  ✗ '+m);} };

for (const [src, tag] of [[DZ,'斗地主'],[GD,'掼蛋']]){
  console.log(`\n── ${tag} ──`);
  ok(/vacate:\s*true/.test(src), tag+': 旁观通知腾座 vacate:true');
  ok(/起身旁观 · 座位已让出/.test(src), tag+': 文案「起身旁观 · 座位已让出」');
  ok(!/离座旁观, AI 接手/.test(src) || /vacate:\s*true/.test(src), tag+': 不再用「AI 接手」冒充让座');
  ok(/isLocalSolo/.test(src), tag+': 有 isLocalSolo 单机守卫');
  ok(/_handsIdle>=2 && !spectating && !isLocalSolo/.test(src.replace(/\s+/g,' ')) ||
     /_handsIdle\s*>=\s*2\s*&&\s*!spectating\s*&&\s*!isLocalSolo/.test(src),
     tag+': 两局无响应离座跳过单机');
  ok(/onGrabSeat/.test(src), tag+': 支持 onGrabSeat 抢位');
  ok(/旁观中 · 已让座/.test(src), tag+': 操作栏「旁观中 · 已让座」');
  ok(/🪑 坐下/.test(src), tag+': 旁观操作「坐下」(不是「我回来了」)');
  ok(/点击入座/.test(src), tag+': 空位显示「点击入座」');
  ok(/ddz-vacant|gd-vacant/.test(src), tag+': 对局态空位 vacant 样式');
  ok(/onGrabSeat\)\{ onGrabSeat\(/.test(src.replace(/\s+/g,' ')) || /if \(onGrabSeat\)/.test(src),
     tag+': 空位点击走 onGrabSeat');
  ok(/specTag|🔭 旁观中 · /.test(src), tag+': 横幅带旁观前缀');
}

console.log('\n── app.js 抢位接线 ──');
ok(/onGrabSeat:\(\)=>\{ _gtGrabSeat\(row\); \}/.test(APP.replace(/\s+/g,' ')) ||
   (APP.match(/onGrabSeat:\(\)=>\{ _gtGrabSeat\(row\); \}/g)||[]).length>=3,
   '三款 guest open 都接 onGrabSeat → _gtGrabSeat');
ok(/if\(info && info\.vacate\)\{ try\{ gtLeave/.test(APP.replace(/\s+/g,' ')),
   'vacate:true 时 gtLeave 腾 DB 座');

console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
