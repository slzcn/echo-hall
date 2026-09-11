#!/usr/bin/env node
'use strict';
/* 验证德州两项: (1)新一手发牌动画——底牌挂 .pk-dealing + 错峰 animation-delay; 抓一帧中途动画截图。
 *            (2)对手思考环消减——AI 回合内座位 --p 从满(360)随时间递减(与我的环一致)。
 * 用法: node scripts/probe-poker-deal-ring.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const SHOT='/tmp/eh-lobby'; fs.mkdirSync(SHOT,{recursive:true});
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const FILES=['deck.js','table-orient.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'];
(async()=>{
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  await page.addStyleTag({content:SHARED});           // 先挂 shared(模拟生产 <link> 在前)
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.evaluate(`window.EHPokerGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0,seed:20260909})`);
  // 尽快抓发牌动画: 轮询到底牌出现, 立刻取一帧
  let dealt=false, dealInfo=null;
  for(let i=0;i<40;i++){
    dealInfo=await page.evaluate(()=>{
      const cards=[...document.querySelectorAll('.pk-seat .pk-mini-hole .card')];
      if(!cards.length) return null;
      const dealing=cards.filter(c=>c.classList.contains('pk-dealing'));
      const delays=[...new Set(dealing.map(c=>c.style.animationDelay))];
      return {total:cards.length, dealing:dealing.length, delays};
    });
    if(dealInfo && dealInfo.dealing>0){ dealt=true; break; }
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(160);   // 让动画走到中途
  await page.screenshot({path:path.join(SHOT,'deal-midflight.png')});
  console.log('发牌动画:', dealt?`✓ ${dealInfo.dealing}/${dealInfo.total} 张挂 .pk-dealing, delays=${JSON.stringify(dealInfo.delays)}`:'✗ 未捕获');

  // 对手环: 采样某 AI 回合内 turn 座位 --p 随时间变化
  let samples=[];
  for(let i=0;i<60;i++){
    const s=await page.evaluate(()=>{
      const el=document.querySelector('.pk-seat.turn');
      if(!el) return null;
      const seat=el.dataset.seat;
      const p=el.style.getPropertyValue('--p').trim();
      const mine=seat==='0';
      const think=!!el.querySelector('.pk-sec.think');
      return {seat, p:parseFloat(p), mine, think};
    });
    if(s && !s.mine){ samples.push(s.p); if(samples.length>=6) break; }
    await page.waitForTimeout(120);
  }
  const dec = samples.length>=2 && samples[samples.length-1] < samples[0];
  console.log('对手思考环:', samples.length?`--p 采样=${samples.map(x=>Math.round(x)).join('→')} ${dec?'✓递减(有倒计时动画)':'✗未递减'}`:'✗ 未逮到对手回合');
  console.log(errs.length?('⚠ '+errs.slice(0,2).join(' | ')):'(无 pageerror)');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
