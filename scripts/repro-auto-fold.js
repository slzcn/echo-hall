#!/usr/bin/env node
'use strict';
/* repro-auto-fold.js — v145 统一规则真实复现:连续两次超时→自动离座 + 通知腾座(散桌由 app 判)
 *
 * 用 jsdom 真加载 game-ui.js, 开一局斗地主桌(我=0席, host), 思考时长压到 30ms, 全程不操作,
 * 让真实计时器与游戏循环自己跑: armTurn→onHumanTimeout→bumpMiss, 连续 MAX_MISS=2 次真实超时
 * → idleOut(mySeat)→doEnterSpectator 真离座, 并 onSeatIdle({vacate:true}) 通知 app 腾 DB 座。
 *
 * 判定(新规则):
 *   - 全程挂机应当在连续两次超时后【进入旁观】(spec=true) 且【触发腾座 vacate】(vacate=true)。
 *   - 这是期望行为(两次超时自动离座), 不是 bug。配合 app 侧 gtCheckNoHumansThenClose 即"无真人自动解散"。
 *   - 反面保证(见 journey-spectator-regression): 只要有操作 resetMiss, 就永不误进旁观。
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const { JSDOM } = require('jsdom');
const ROOT=path.join(__dirname,'..');
const R=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

const dom=new JSDOM('<!doctype html><body><div id="hall"></div></body>',{pretendToBeVisual:true, runScripts:'outside-only'});
const win=dom.window;
win.requestAnimationFrame = cb=>setTimeout(()=>cb(Date.now()),0);
win.cancelAnimationFrame = id=>clearTimeout(id);
win.scrollTo = ()=>{};

const ctx=dom.getInternalVMContext();
for (const f of ['js/games/deck.js','js/games/ddz-rules.js','js/games/ddz-engine.js','js/games/ddz-ai.js','js/games/game-ui.js']) {
  try { vm.runInContext(R(f)+'\n//# sourceURL='+f, ctx, {filename:f}); }
  catch(e){ console.error('加载失败 '+f+': '+e.message); process.exit(2); }
}
if (!win.EHDdzGame || typeof win.EHDdzGame.open!=='function'){ console.error('EHDdzGame.open 不可用'); process.exit(2); }

const RUN_MS = Number(process.env.REPRO_MS) || 20000;
let vacate=false, spec=false, idleSeats=[];
// mode:'online' 避开 isLocalSolo 豁免(单机桌不离座); host 席全程挂机
const game=win.EHDdzGame.open({
  mount: win.document.getElementById('hall'),
  mode:'online', mySeat:0, seed:42, isHost:true, actMs:30, maxMiss:2,
  onSeatIdle:(seat,info)=>{ idleSeats.push(seat); if(info&&info.vacate) vacate=true; },
  onSync:()=>{},
});

let firstSpecAt=0; const t0=Date.now();
const poll=setInterval(()=>{
  if (game.isSpectating() && !spec){ spec=true; firstSpecAt=Date.now()-t0; }
}, 15);

console.log('真实异步复现(v145): 斗地主 host 席全程挂机, actMs=30ms, 期望连续两次超时后自动离座 …');
setTimeout(()=>{
  clearInterval(poll);
  console.log('  spectating(已离座旁观)='+spec+(spec?(' @~'+firstSpecAt+'ms'):'')+' · vacate(通知腾座)='+vacate);
  // 期望: 挂机两次超时后进入旁观 + 腾座
  const ok = spec && vacate;
  if (ok) console.log('✅ 通过: 连续两次超时 → 自动离座旁观 + 通知 app 腾座(无真人则由 app 解散)');
  else console.error('❌ 未达期望: 全程挂机应在两次超时后自动离座(spec='+spec+' vacate='+vacate+')');
  try{ game.close(); }catch(_){}
  process.exit(ok?0:1);
}, RUN_MS);
