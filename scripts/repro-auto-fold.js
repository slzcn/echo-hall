#!/usr/bin/env node
'use strict';
/* repro-auto-fold.js — 真实复现并回归验证"无故弃牌/自动退出"(v144)
 *
 * 用 jsdom 真加载 game-ui.js, 开一局斗地主桌(我=0席, host), 思考时长压到 30ms, 全程不操作,
 * 让真实计时器与游戏循环自己跑(armTurn→onHumanTimeout→bumpMiss→idleOut→trusteeAuto;
 * over 后 host 续局 → _clearAutoTrusteeOnNewDeal 累计 _handsIdle)。跑若干局后检查:
 *
 *   修复前(HEAD): 连续数局挂机 → doEnterSpectator 把本人踢成旁观(spec=true),
 *     host 席更触发 vacate(散桌) → 表现为"玩着玩着无故弃牌/游戏自动结束"。
 *   修复后(v144): AI 托管(trusteeAuto)照常兜底代打, 但本人【永不】被自动踢旁观、【不】散桌。
 *
 * 判定: spec=false 且 vacate=false 为通过。用时约 45s(需跑够多局才暴露跨局累计)。
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

const RUN_MS = Number(process.env.REPRO_MS) || 45000;
let vacate=false, spec=false, over=0;
const game=win.EHDdzGame.open({
  mount: win.document.getElementById('hall'),
  mode:'online', mySeat:0, seed:42, isHost:true, actMs:30, maxMiss:2,
  onSeatIdle:(seat,info)=>{ if(info&&info.vacate) vacate=true; },
  onSync:()=>{},
});

const poll=setInterval(()=>{
  const st=game.state();
  if (st.phase==='over'){ over++; try{ game.startDeal(); }catch(_){} }
  if (game.isSpectating()) spec=true;
}, 25);

console.log('真实异步复现: 斗地主 host 席全程挂机, actMs=30ms, 运行 '+(RUN_MS/1000)+'s …');
setTimeout(()=>{
  clearInterval(poll);
  console.log('  跑完约 '+over+' 局 · spectating(被踢旁观)='+spec+' · vacate(散桌)='+vacate+' · isTrustee(AI托管)='+game.isTrustee());
  const failed = spec || vacate;
  if (!failed) console.log('✅ 通过: 全程挂机 '+over+' 局, 玩家未被自动踢旁观、未散桌(AI 托管兜底代打)');
  else console.error('❌ bug 仍在: 玩家被自动弃牌/让座(spec='+spec+' vacate='+vacate+')');
  try{ game.close(); }catch(_){}
  process.exit(failed?1:0);
}, RUN_MS);
