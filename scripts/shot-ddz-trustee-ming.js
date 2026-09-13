#!/usr/bin/env node
'use strict';
/* 一次性: 斗地主本地加倍局, 截「明牌」加倍条 + 「托管」操作条 + 托管收起态 + 明牌亮牌盒。
 * 用法: node scripts/shot-ddz-trustee-ming.js  → /tmp/eh-ddz-tm/*.png */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
const SHOT='/tmp/eh-ddz-tm'; fs.mkdirSync(SHOT,{recursive:true});
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>{try{return fs.existsSync(p)}catch(_){return false}});

(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html data-mode="night"><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  await page.addStyleTag({content:SHARED});
  for(const f of ['deck.js','card-counter.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js']) await page.addScriptTag({content:G(f)});
  await page.evaluate(()=>{ window.EhSfx={say:()=>{},play:()=>{}}; window.EhGameBgm={enter:()=>{},exit:()=>{}};
    window._G=window.EHDdzGame.open({mode:'local',names:['我','机器人甲','机器人乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0,mount:document.getElementById('hall')}); });
  await page.waitForTimeout(700);
  // 抢地主: 只点叫分按钮([data-bid] 取最高分), 直到出现明牌按钮(进 double 阶段, 我=地主)。
  // 注意: 加倍条与叫分条共用 .ddz-bidbtns, 但加倍按钮是 [data-dbl] —— 只点 [data-bid] 才不会误触加倍冲过 double。
  for(let i=0;i<10;i++){
    const st=await page.evaluate(()=>{
      if(document.getElementById('ddzMing')) return 'double';
      if(document.getElementById('ddzTrustee')) return 'play';
      const bids=[...document.querySelectorAll('[data-bid]')].filter(b=>!b.disabled);
      if(bids.length) bids[bids.length-1].click();
      return 'bid';
    });
    if(st==='double'||st==='play') break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(300);
  // ① 加倍条(含明牌按钮)
  await page.screenshot({path:SHOT+'/1-double-ming.png'});
  const hasMing=await page.evaluate(()=>!!document.getElementById('ddzMing'));
  console.log('明牌按钮存在(应 true)='+hasMing);

  if(hasMing){
    // ② 点明牌 → ×2, 截倍数变化 + 文案
    await page.evaluate(()=>document.getElementById('ddzMing').click());
    await page.waitForTimeout(300);
    await page.screenshot({path:SHOT+'/2-after-ming.png'});
    const info=await page.evaluate(()=>{
      const mult=document.querySelector('.ddz-mult'); const q=document.querySelector('.ddz-bidbar .q');
      return { mult:mult?mult.innerText.replace(/\n/g,' '):null, q:q?q.innerText:null, stillMing:!!document.getElementById('ddzMing') };
    });
    console.log('明牌后: 倍数区='+info.mult+' | 文案='+info.q+' | 明牌钮还在(应false)='+info.stillMing);
    // 地主选加倍(×2) → 农民 AI 自动加倍 → 进 play
    await page.evaluate(()=>{
      const b=[...document.querySelectorAll('[data-dbl]')].find(x=>x.dataset.dbl==='2'); if(b) b.click();
    });
  }
  // 等进入 play(出现托管按钮)
  let ph='?';
  for(let i=0;i<12;i++){
    ph=await page.evaluate(()=>document.getElementById('ddzTrustee')?'play':(document.getElementById('ddzMing')?'double':'?'));
    if(ph==='play') break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(900);
  // ③ 出牌操作条(含托管按钮)
  await page.screenshot({path:SHOT+'/3-play-trustee-btn.png'});
  const hasTru=await page.evaluate(()=>!!document.getElementById('ddzTrustee'));
  console.log('phase='+ph+'  托管按钮存在='+hasTru);
  if(hasTru){
    // ④ 点托管 → 收起态
    await page.evaluate(()=>document.getElementById('ddzTrustee').click());
    await page.waitForTimeout(300);
    await page.screenshot({path:SHOT+'/4-trustee-on.png'});
    const bar=await page.evaluate(()=>{const el=document.querySelector('.ddz-acts');return el?el.innerText.replace(/\n/g,' | '):null;});
    console.log('托管后操作条='+bar);
  }
  if(errs.length) console.log('ERRS: '+errs.slice(0,4).join(' | '));
  console.log('截图目录 '+SHOT);
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
