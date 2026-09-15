#!/usr/bin/env node
'use strict';
/* shot-gd-handcheck.js — 掼蛋选牌/理牌体检: 全屏截 静息/选一组/按大小理牌/竖列组牌 四态。
 * 用法: node scripts/shot-gd-handcheck.js  → /tmp/gd-hc-*.png */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SFX=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const FILES=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','card-counter.js','guandan-ui.js'];
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}#hall{position:relative;width:390px;height:844px;overflow:hidden}';
(async()=>{
  if(!chromium){ console.log('⚠ 无 playwright'); process.exit(0); }
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  await page.evaluate(()=>{const S=window.EhSfx||{};S.say=()=>{};S.play=()=>{};window.EhSfx=S;window.EhGameBgm={enter:()=>{},exit:()=>{}};window.EH_BGM={on(){},off(){},toggle(){},isOn(){return false}};});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.evaluate(async()=>{ const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    window.__g=window.EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0});
    await sleep(900); });
  const shot=async n=>{ await page.waitForTimeout(400); await page.screenshot({path:'/tmp/gd-hc-'+n+'.png'}); console.log('✓ /tmp/gd-hc-'+n+'.png'); };
  await shot('rest');
  // 选一组同点数(下排点一张 → autoExtend 连选同点)
  await page.evaluate(()=>{ const hand=document.querySelector('.gd-hand');
    const rows=[...hand.children].filter(r=>r.children.length); const bot=rows[rows.length-1]; const el=bot.children[2];
    const r=el.getBoundingClientRect(); const x=r.left+r.width/2,y=r.top+r.height*0.7;
    hand.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y,pointerId:1}));
    hand.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:x,clientY:y,pointerId:1})); });
  await shot('group-sel');
  // 点绒面清空
  await page.evaluate(()=>{ const felt=document.querySelector('.gd-felt')||document.querySelector('.gd-mid'); if(felt){ const r=felt.getBoundingClientRect(); document.querySelector('.gd-hand').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:5,clientY:5,pointerId:1})); document.querySelector('.gd-hand').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:5,clientY:5,pointerId:1})); } });
  // 短按理牌钮 → 按大小
  const tap=async()=>{ await page.evaluate(()=>{ const b=document.querySelector('#gdSort'); const r=b.getBoundingClientRect(); const x=r.left+r.width/2,y=r.top+r.height/2; b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y,pointerId:1})); b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:x,clientY:y,pointerId:1})); }); await page.waitForTimeout(300); };
  await tap(); await shot('tidy-rank');
  await tap(); await shot('tidy-combo');
  if(errs.length) console.log('ERR:',errs.slice(0,4).join(' | '));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
