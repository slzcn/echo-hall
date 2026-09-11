#!/usr/bin/env node
'use strict';
/* 布局体检: (1)开局/打牌态里有无元素溢出 #hall 视口(超界面裁切); (2)斗地主出牌前后关键容器有无位移(跳版)。
 * 用法: node scripts/audit-layout.js → 打印溢出/跳版报告 + /tmp/eh-lobby/audit-*.png */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const SHOT='/tmp/eh-lobby'; fs.mkdirSync(SHOT,{recursive:true});
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const GAMES={
  ddz:{files:['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js'],
       open:`window.EHDdzGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0})`, room:'.ddz-room'},
  guandan:{files:['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','guandan-ui.js'],
       open:`window.EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0})`, room:'.gd-room'},
  poker:{files:['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'],
       open:`window.EHPokerGame.open({names:['我','AI甲','AI乙','AI丙','AI丁','AI戊'],avatars:['🙂','🤖','👾','🐱','🦊','🐼'],isAI:[false,true,true,true,true,true],mySeat:0,seed:20260909})`, room:'.pk-room'},
};
const W=390,H=844;

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
    // 去重(同类元素只留一条)
    return {bad:[...new Set(bad)].slice(0,14)};
  }, {room,W,H});
}
async function landmarks(page, room){
  return await page.evaluate(({room})=>{
    const host=document.querySelector(room); if(!host) return {};
    const out={};
    host.querySelectorAll('*').forEach(el=>{
      const key=(el.id?('#'+el.id):(el.className||'').toString().split(/\s+/)[0]);
      if(!key||out[key]) return;
      const r=el.getBoundingClientRect(); if(r.width<8||r.height<8) return;
      out[key]={x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};
    });
    return out;
  }, {room});
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
    await page.waitForTimeout(1200);
    const ov1=await overflow(page,cfg.room);
    console.log(`\n【${game}】开局溢出:`, ov1.bad&&ov1.bad.length?ov1.bad.join('  |  '):'无', errs.length?('  ⚠pageerr:'+errs.slice(0,1)):'');
    await page.screenshot({path:path.join(SHOT,'audit-'+game+'-deal.png')});

    if(game==='ddz'||game==='guandan'){
      const before=await landmarks(page,cfg.room);
      const btn=game==='ddz'?'.ddz-btn':'.gd-btn';
      try{ await page.locator(btn,{hasText:'提示'}).first().click({timeout:1500}); }catch(_){}
      await page.waitForTimeout(200);
      try{ await page.locator(btn,{hasText:'出牌'}).first().click({timeout:1500}); }catch(_){}
      await page.waitForTimeout(700);
      const after=await landmarks(page,cfg.room);
      const jumps=[];
      for(const k of Object.keys(before)){ const a=before[k],b=after[k]; if(!b) continue;
        const dx=Math.abs(a.x-b.x),dy=Math.abs(a.y-b.y),dw=Math.abs(a.w-b.w),dh=Math.abs(a.h-b.h);
        if(dx>2||dy>2||dw>2||dh>2) jumps.push(`${k}: Δx${a.x}->${b.x} Δy${a.y}->${b.y} Δw${a.w}->${b.w} Δh${a.h}->${b.h}`); }
      console.log(`【${game}】出牌前后位移(跳版):`, jumps.length?('\n   '+jumps.join('\n   ')):'无');
      const ov2=await overflow(page,cfg.room);
      console.log(`【${game}】出牌后溢出:`, ov2.bad&&ov2.bad.length?ov2.bad.join('  |  '):'无');
      await page.screenshot({path:path.join(SHOT,'audit-'+game+'-play.png')});
    }
    await ctx.close();
  }
  await browser.close();
  console.log('\n📸 /tmp/eh-lobby/audit-*.png');
})().catch(e=>{console.error(e);process.exit(1);});
