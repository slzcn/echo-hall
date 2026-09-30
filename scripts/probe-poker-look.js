#!/usr/bin/env node
'use strict';
/* 德州牌桌观感体检: 截图 + 量牌背尺寸/底池 pill 行宽, 复现"太紧凑·牌背不搭"。
 * 用法: node scripts/probe-poker-look.js [after] */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SFX=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const FILES=['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'];
const tag=process.argv[2]||'before';
(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html data-mode="night"><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  await page.addStyleTag({content:SHARED});
  await page.addScriptTag({content:SFX});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.evaluate(()=>{
    window.EHPokerGame.open({
      names:['我','牌手2','牌手3','牌手4','牌手5','牌手6','深海狐狸'],
      avatars:['🦊','🤖','🤖','🤖','🤖','🤖','🦊'],
      isAI:[false,true,true,true,true,true,true], mySeat:0, mount:document.getElementById('hall'),
      startStack:1000, sb:5, bb:10
    });
  });
  await page.waitForTimeout(1200);
  // before: 手动灌入旧版多边池 pill 行(复现主人截图里那条横贯桌面的拥挤行); after: 走真实 renderPot(单枚总池)
  if(tag==='before'){
    await page.evaluate(()=>{
      const pot=document.getElementById('pkPot');
      if(pot) pot.innerHTML='<span class="pc"></span>'
        +'<span class="pk-potpart">主池 30</span><span class="pk-potpart side">边1 25</span>'
        +'<span class="pk-potpart side">边2 60</span><span class="pk-potpart side">边3 118</span>'
        +'<span class="pk-potpart side">边4 198</span>';
    });
  }
  await page.waitForTimeout(150);
  const m=await page.evaluate(()=>{
    const q=s=>document.querySelector(s);
    const backs=[...document.querySelectorAll('.pk-seat:not(.pk-me-seat) .pk-mini-hole .card.back')];
    const b0=backs[0]?backs[0].getBoundingClientRect():null;
    const my=q('.pk-my-hole .card'); const myr=my?my.getBoundingClientRect():null;
    const pot=q('#pkPot'); const pr=pot?pot.getBoundingClientRect():null;
    const center=q('.pk-center'); const cr=center?center.getBoundingClientRect():null;
    const cs=my?getComputedStyle(my):null; const bs=backs[0]?getComputedStyle(backs[0]):null;
    return {
      backCount:backs.length,
      backSize:b0?[Math.round(b0.width),Math.round(b0.height)]:null,
      backBg:bs?bs.backgroundColor:null,
      mySize:myr?[Math.round(myr.width),Math.round(myr.height)]:null,
      myBg:cs?cs.background.slice(0,40):null,
      potWidth:pr?Math.round(pr.width):null,
      potLeft:pr?Math.round(pr.left):null, potRight:pr?Math.round(pr.right):null,
      centerWidth:cr?Math.round(cr.width):null, vw:window.innerWidth
    };
  });
  console.log('量:', JSON.stringify(m,null,1));
  await page.screenshot({path:path.join(ROOT,'scripts','_poker-'+tag+'.png')});
  console.log('截图: scripts/_poker-'+tag+'.png');
  console.log(errs.length?('⚠ '+errs.slice(0,4).join(' | ')):'(无 pageerror)');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
