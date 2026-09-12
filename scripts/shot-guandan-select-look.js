#!/usr/bin/env node
'use strict';
// 目测掼蛋选牌观感: 渲染手牌, 分别截 静息 / 选中2张 / 选中一组 三态。
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SFX=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const FILES=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','card-counter.js','guandan-ui.js'];
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';
(async()=>{
  if(!chromium){ console.log('⚠ 无 playwright'); process.exit(0); }
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage();
  await page.setContent('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  await page.evaluate(()=>{const S=window.EhSfx||{};S.say=()=>{};S.play=()=>{};window.EhSfx=S;window.EhGameBgm={enter:()=>{},exit:()=>{}};});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.evaluate(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    window.__g=window.EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0});
    await sleep(900);
  });
  const clip={x:0,y:560,width:390,height:284};
  await page.screenshot({path:path.join(ROOT,'scripts','_gd-sel-0rest.png'),clip});
  // 选下排两张相邻牌
  await page.evaluate(()=>{
    const hand=document.querySelector('.gd-hand');
    const rows=[...hand.children].filter(r=>r.children.length);
    const bot=rows[rows.length-1]; const ks=[...bot.children];
    [ks[2],ks[3]].forEach(el=>{ if(!el) return; const r=el.getBoundingClientRect(); const x=r.left+2,y=r.top+3;
      hand.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y,pointerId:1}));
      hand.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:x,clientY:y,pointerId:1})); });
  });
  await page.waitForTimeout(500);
  await page.screenshot({path:path.join(ROOT,'scripts','_gd-sel-1two.png'),clip});
  console.log('截图: _gd-sel-0rest.png, _gd-sel-1two.png');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
