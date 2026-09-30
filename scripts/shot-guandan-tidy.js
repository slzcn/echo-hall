#!/usr/bin/env node
'use strict';
// 临时: 截图掼蛋「理牌后竖列分组」现状 + 打印每列 bounds(排查溢出/看美化基线)。
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SFX=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';
const FILES=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','card-counter.js','guandan-ui.js'];
const land = process.argv.includes('--land');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const vp = land ? {width:844,height:390} : {width:390,height:844};
  const ctx=await browser.newContext({viewport:vp,deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage();
  await page.setContent('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>'+CSS.replace('width:390px;height:844px', `width:${vp.width}px;height:${vp.height}px`)+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  await page.evaluate(()=>{const S=window.EhSfx||{};S.say=()=>{};S.play=()=>{};window.EhSfx=S;window.EhGameBgm={enter:()=>{},exit:()=>{}};});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  const info=await page.evaluate(async(land)=>{
    const old=document.querySelector('.gd-room'); if(old) old.remove();
    window.__g=window.EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0});
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    await sleep(700);
    if(land){ const rot=document.querySelector('#gdRot'); if(rot){rot.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));rot.click&&rot.click();} }
    const btn=document.querySelector('#gdSort');
    btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
    await sleep(200);
    const hand=document.querySelector('#gdHand').getBoundingClientRect();
    const cols=[...document.querySelectorAll('#gdHand .gd-col')].map(c=>{const r=c.getBoundingClientRect();return{n:c.querySelectorAll('.card').length,lab:(c.querySelector('.gd-col-label')||{}).textContent||'',left:+r.left.toFixed(1),right:+r.right.toFixed(1),w:+r.width.toFixed(1)};});
    return {hand:{left:+hand.left.toFixed(1),right:+hand.right.toFixed(1),w:+hand.width.toFixed(1)},cols};
  }, land);
  console.log('hand', JSON.stringify(info.hand));
  info.cols.forEach((c,i)=>console.log(`col${i} n=${c.n} lab=${c.lab||'-'} L=${c.left} R=${c.right} w=${c.w}${c.left<info.hand.left-0.5?' <<OVER-L':''}${c.right>info.hand.right+0.5?' >>OVER-R':''}`));
  await page.screenshot({path:path.join(ROOT, land?'shot-tidy-land.png':'shot-tidy.png')});
  await ctx.close(); await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
