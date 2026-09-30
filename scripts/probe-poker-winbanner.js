#!/usr/bin/env node
'use strict';
/* 测德州"赢家横幅"与顶部中央席(单挑/3人/5人时 deg=90 那席)是否重叠。
 * 驱动单挑局到 over, 量 .pk-winline 与顶席 .pk-avr/.nm/.pk-say 的矩形是否相交。
 * 用法: node scripts/probe-poker-winbanner.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const SHOT='/tmp/eh-lobby'; fs.mkdirSync(SHOT,{recursive:true});
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const FILES=['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'];
function overlap(a,b){ if(!a||!b) return null; const ix=Math.max(0,Math.min(a.r,b.r)-Math.max(a.x,b.x)); const iy=Math.max(0,Math.min(a.b,b.b)-Math.max(a.y,b.y)); return {ix:+ix.toFixed(1),iy:+iy.toFixed(1),hit:ix>1&&iy>1}; }
(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  await page.addStyleTag({content:SHARED});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.evaluate(`window.EHPokerGame.open({names:['我','AI甲'],avatars:['🙂','🤖'],isAI:[false,true],mySeat:0,seed:20260909})`);
  await page.waitForTimeout(700);
  // 一路过牌/跟注推到 over
  let over=false;
  for(let i=0;i<90;i++){
    over=await page.evaluate(()=>!!document.querySelector('.pk-winline'));
    if(over) break;
    await page.evaluate(()=>{ const chk=document.querySelector('#pkCheck'),call=document.querySelector('#pkCall');
      const b=(chk&&!chk.hasAttribute('disabled'))?chk:((call&&!call.hasAttribute('disabled'))?call:null); if(b)b.click(); });
    await page.waitForTimeout(300);
  }
  // 强塞一条顶席气泡, 一并量
  await page.evaluate(()=>{ const b=document.querySelector('.pk-seat:not(.pk-me-seat) .pk-say'); if(b){ b.textContent='赢麻了！'; b.classList.add('show'); } });
  await page.waitForTimeout(120);
  const rects=await page.evaluate(()=>{
    const R=el=>{ if(!el) return null; const r=el.getBoundingClientRect(); return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),r:+r.right.toFixed(1),b:+r.bottom.toFixed(1),w:+r.width.toFixed(1)}; };
    // 顶部中央席: cx 最接近桌心、cy 最小的对手席
    const opp=[...document.querySelectorAll('.pk-seat:not(.pk-me-seat)')];
    const tr=document.querySelector('.pk-table')?.getBoundingClientRect();
    let top=null,best=1e9; for(const s of opp){ const rr=s.getBoundingClientRect(); const cx=rr.x+rr.width/2; const score=Math.abs(cx-(tr?tr.x+tr.width/2:195))+rr.y*0.3; if(score<best){best=score;top=s;} }
    return { banner:R(document.querySelector('.pk-winline')),
             avr:R(top&&top.querySelector('.pk-avr')), nm:R(top&&top.querySelector('.nm')),
             say:R(top&&top.querySelector('.pk-say.show')||top&&top.querySelector('.pk-say')) };
  });
  await page.screenshot({path:path.join(SHOT,'winbanner.png')});
  console.log('over:',over);
  console.log('banner:',JSON.stringify(rects.banner));
  console.log('顶席avr:',JSON.stringify(rects.avr),'重叠',JSON.stringify(overlap(rects.banner,rects.avr)));
  console.log('顶席nm :',JSON.stringify(rects.nm),'重叠',JSON.stringify(overlap(rects.banner,rects.nm)));
  console.log('顶席say:',JSON.stringify(rects.say),'重叠',JSON.stringify(overlap(rects.banner,rects.say)));
  console.log(errs.length?('⚠ '+errs.slice(0,2).join(' | ')):'(无 pageerror)');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
