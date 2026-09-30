#!/usr/bin/env node
'use strict';
/* 验证"对手思考环倒计时"三游戏一致: 斗地主/掼蛋 的对手(AI)席在其回合内 --p 是否随时间递减
 * (与德州、与我方一致)。此前 ddz/guandan 对手环恒满格(静止), 本次改为随真实出手时刻消减。
 * 用法: node scripts/probe-ring-consistency.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>{try{return fs.existsSync(p)}catch(_){return false}});

async function newPage(browser){
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  await page.addStyleTag({content:SHARED});
  return {page,errs};
}
// 在某游戏内轮询: 找到 .turn 的对手(非0)席, 采样其 --p 随时间变化
async function sampleRing(page, seatSel){
  // 锁定【单个对手席】的一段连续采样, 避免跨座位换手(A 近 0 → B 满格)污染判定
  let lockSeat=null, samples=[];
  for(let i=0;i<100;i++){
    const s=await page.evaluate((sel)=>{
      const el=document.querySelector(sel+'.turn');
      if(!el) return null;
      const seat=el.dataset.seat;
      const p=parseFloat(el.style.getPropertyValue('--p'));
      return {seat, p, mine:seat==='0'};
    }, seatSel);
    if(s && !s.mine && !isNaN(s.p)){
      if(lockSeat===null) lockSeat=s.seat;
      if(s.seat===lockSeat){ samples.push(s.p); if(samples.length>=6) break; }
      else if(samples.length>=3) break;         // 换手了但已采够
      else { lockSeat=s.seat; samples=[s.p]; }   // 采样太少就改锁新席
    }
    await page.waitForTimeout(80);
  }
  return samples;
}
function verdict(name, samples){
  const dec = samples.length>=2 && samples[samples.length-1] < samples[0];
  console.log(name+':', samples.length?`--p=${samples.map(x=>Math.round(x)).join('→')} ${dec?'✓递减(有倒计时动画)':'✗未递减(仍静止)'}`:'✗ 未逮到对手回合');
  return dec;
}

(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});

  // ---- 斗地主 ----
  {
    const {page,errs}=await newPage(browser);
    for(const f of ['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js']) await page.addScriptTag({content:G(f)});
    await page.evaluate(`window.EHDdzGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0})`);
    await page.waitForTimeout(700);
    try{ await page.locator('.ddz-btn',{hasText:'3分'}).first().click({timeout:1500}); }catch(_){ try{await page.locator('.ddz-btn',{hasText:'抢'}).first().click({timeout:1000});}catch(__){}}
    await page.waitForTimeout(1200);
    try{ await page.locator('.ddz-btn',{hasText:'不加倍'}).first().click({timeout:1200}); }catch(_){}
    await page.waitForTimeout(400);
    // 若轮到我先出, 出一手让位给 AI
    try{ await page.locator('.ddz-btn',{hasText:'提示'}).first().click({timeout:800}); await page.waitForTimeout(120); await page.locator('.ddz-btn',{hasText:'出牌'}).first().click({timeout:800}); }catch(_){}
    verdict('斗地主对手环', await sampleRing(page,'.ddz-seat'));
    if(errs.length) console.log('  ⚠ ddz '+errs.slice(0,1).join(''));
    await page.context().close();
  }

  // ---- 掼蛋 ----
  {
    const {page,errs}=await newPage(browser);
    for(const f of ['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','card-counter.js','guandan-ui.js']) await page.addScriptTag({content:G(f)});
    await page.evaluate(`window.EHGuandanGame.open({names:['我','下家','对家','上家'],avatars:['🙂','🤖','🤝','👾'],isAI:[false,true,true,true],mySeat:0})`);
    await page.waitForTimeout(900);
    // 掼蛋首局无进贡直接进出牌; 若轮到我先出, 出一手让位
    try{ await page.locator('.gd-btn',{hasText:'提示'}).first().click({timeout:800}); await page.waitForTimeout(120); await page.locator('.gd-btn',{hasText:'出牌'}).first().click({timeout:800}); }catch(_){}
    verdict('掼蛋对手环', await sampleRing(page,'.gd-seat'));
    if(errs.length) console.log('  ⚠ gd '+errs.slice(0,1).join(''));
    await page.context().close();
  }

  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
