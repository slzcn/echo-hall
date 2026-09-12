#!/usr/bin/env node
'use strict';
/* 一次性: 驱动斗地主单机进入出牌阶段, 截全屏, 看真实结构/操作区. 用法: node scripts/shot-ddz-play.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
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
  // 叫分阶段: 帮我抢地主, 推进到 play
  await page.waitForTimeout(800);
  // 自动点叫分按钮(抢地主), 直到进入出牌
  for(let i=0;i<8;i++){
    const done=await page.evaluate(()=>{
      const room=document.querySelector('.ddz-room'); const phase=room&&room.getAttribute('data-phase');
      if(phase==='play') return true;
      // 叫分条: 点最大分(抢/3分)
      const btns=[...document.querySelectorAll('.ddz-bidbtns .ddz-btn')].filter(b=>!b.disabled);
      if(btns.length){ btns[btns.length-1].click(); }
      return false;
    });
    if(done) break;
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(1000);
  const info=await page.evaluate(()=>{ const r=document.querySelector('.ddz-room'); return { phase:r&&r.getAttribute('data-phase'), acts:document.querySelector('.ddz-acts')?document.querySelector('.ddz-acts').innerText.replace(/\n/g,' | '):null }; });
  fs.mkdirSync('/tmp/eh-lobby',{recursive:true});
  await page.screenshot({path:'/tmp/eh-lobby/ddz-play.png'});
  console.log('phase='+info.phase+'  acts='+info.acts);
  if(errs.length) console.log('ERRS: '+errs.slice(0,3).join(' | '));
  console.log('截图 /tmp/eh-lobby/ddz-play.png');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
