#!/usr/bin/env node
'use strict';
/* 2 人局一路过牌/跟注推到翻牌→转牌→河牌→摊牌, 每态截图, 眼检公共牌/亮牌卡面风格是否与手牌一致。 */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const SHOT='/tmp/eh-lobby'; fs.mkdirSync(SHOT,{recursive:true});
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const FILES=['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'];
(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"PingFang SC",sans-serif}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.evaluate(`window.EHPokerGame.open({names:['我','AI甲'],avatars:['🙂','🤖'],isAI:[false,true],mySeat:0,seed:20260909})`);
  await page.addStyleTag({content:SHARED});
  await page.waitForTimeout(1000);
  let shots={};
  for(let i=0;i<80;i++){
    const nb=await page.evaluate(()=>document.querySelectorAll('.pk-board .card:not(.back)').length);
    if(nb>=3&&!shots.flop){shots.flop=1; await page.screenshot({path:path.join(SHOT,'sd-flop.png')});}
    if(nb>=4&&!shots.turn){shots.turn=1; await page.screenshot({path:path.join(SHOT,'sd-turn.png')});}
    if(nb>=5&&!shots.river){shots.river=1; await page.screenshot({path:path.join(SHOT,'sd-river.png')});}
    const over=await page.evaluate(()=>{
      const win=document.querySelector('.pk-win-card, .pk-showdown, .pk-over');
      const btn=document.querySelector('.pk-again,[id=pkAgain],button.pk-b');
      return !!document.querySelector('.pk-win-card');
    });
    if(over&&!shots.show){shots.show=1; await page.screenshot({path:path.join(SHOT,'sd-showdown.png')});}
    // 点我能点的: 优先过牌, 否则跟注
    await page.evaluate(()=>{
      const chk=document.querySelector('#pkCheck'), call=document.querySelector('#pkCall');
      const b=(chk&&!chk.hasAttribute('disabled'))?chk:((call&&!call.hasAttribute('disabled'))?call:null);
      if(b) b.click();
    });
    await page.waitForTimeout(600);
  }
  if(!shots.show) await page.screenshot({path:path.join(SHOT,'sd-final.png')});
  console.log('抓到:', Object.keys(shots).join(',')||'(仅final)', errs.length?('⚠ '+errs.slice(0,2).join(' | ')):'');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
