#!/usr/bin/env node
'use strict';
/* 横屏(.is-land)体检: 三游戏在横屏尺寸下开局, 挂 .is-land, 查元素是否溢出视口(超界面/裁切)+截图看乱版。
 * 用法: node scripts/audit-landscape.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const SHOT='/tmp/eh-lobby'; fs.mkdirSync(SHOT,{recursive:true});
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const GAMES={
  ddz:{files:['deck.js','table-orient.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js'],
       open:`window.EHDdzGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0})`, room:'.ddz-room'},
  guandan:{files:['deck.js','table-orient.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','guandan-ui.js'],
       open:`window.EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0})`, room:'.gd-room'},
  poker:{files:['deck.js','table-orient.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'],
       open:`window.EHPokerGame.open({names:['我','AI甲','AI乙','AI丙','AI丁','AI戊'],avatars:['🙂','🤖','👾','🐱','🦊','🐼'],isAI:[false,true,true,true,true,true],mySeat:0,seed:20260909})`, room:'.pk-room'},
};
const W=844,H=390;  // 横屏手机
async function overflow(page, room){
  return await page.evaluate(({room,W,H})=>{
    const host=document.querySelector(room); if(!host) return {err:'no room'};
    const bad=[];
    host.querySelectorAll('*').forEach(el=>{
      const r=el.getBoundingClientRect(); if(r.width<2||r.height<2) return;
      const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0) return;
      const ov=[];
      if(r.right>W+1) ov.push('右+'+Math.round(r.right-W));
      if(r.bottom>H+1) ov.push('下+'+Math.round(r.bottom-H));
      if(r.left<-1) ov.push('左'+Math.round(r.left));
      if(r.top<-1) ov.push('上'+Math.round(r.top));
      if(ov.length){ const id=el.id?('#'+el.id):''; const cls=(el.className&&el.className.baseVal!==undefined?el.className.baseVal:el.className||'').toString().split(/\s+/).slice(0,2).join('.'); bad.push((el.tagName.toLowerCase()+id+(cls?'.'+cls:''))+' ['+ov.join(' ')+']'); }
    });
    return {bad:[...new Set(bad)].slice(0,16)};
  }, {room,W,H});
}
(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  for(const [game,cfg] of Object.entries(GAMES)){
    const ctx=await browser.newContext({viewport:{width:W,height:H},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
    await page.setContent('<!doctype html><html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"PingFang SC",sans-serif}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
    for(const f of cfg.files) await page.addScriptTag({content:G(f)});
    await page.evaluate(cfg.open);
    await page.addStyleTag({content:SHARED});
    // 触发 resize → 各游戏调 EHTableOrient.reflect(横屏尺寸下自动挂 .is-land)+ 扑克 positionSeats(land=true)
    await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(1000);
    const ov=await overflow(page,cfg.room);
    console.log(`\n【${game} 横屏】溢出:`, ov.bad&&ov.bad.length?('\n   '+ov.bad.join('\n   ')):'无', errs.length?('  ⚠'+errs.slice(0,1)):'');
    await page.screenshot({path:path.join(SHOT,'land-'+game+'.png')});
    await ctx.close();
  }
  await browser.close();
  console.log('\n📸 /tmp/eh-lobby/land-*.png');
})().catch(e=>{console.error(e);process.exit(1);});
