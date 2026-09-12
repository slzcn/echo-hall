#!/usr/bin/env node
'use strict';
/* 三游戏顶栏统一体检: 记牌器已移除(ddz 无 🃏) + 🎵/⟳/✕ 三钮尺寸样式一致。
 * 用法: node scripts/probe-topbar-unify.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SFX=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--accent:#00E5D4;--amber:#FFC24D;--glow-cyan:0 0 8px rgba(0,229,212,.6);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
let pass=0, fail=0; const ok=(c,m)=>{ if(c)pass++; else{fail++; console.log('  ✗ '+m);} };

const GAMES=[
  {key:'ddz',  files:['deck.js','card-counter.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js'], open:'EHDdzGame', bar:'.ddz-bar', mus:'#ddzMus', rot:'#ddzRot', x:'#ddzX', cnt:'#ddzCnt'},
  {key:'guandan', files:['deck.js','card-counter.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','guandan-ui.js'], open:'EHGuandanGame', bar:'.gd-bar', mus:'#gdMus', rot:'#gdRot', x:'#gdX', cnt:'#gdCnt'},
  {key:'poker', files:['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'], open:'EHPokerGame', bar:'.pk-bar', mus:'#pkMus', rot:'#pkRot', x:'#pkX', cnt:null},
];

(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const metrics={};
  for(const g of GAMES){
    const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
    await page.setContent('<!doctype html><html data-mode="night"><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
    await page.addStyleTag({content:SHARED});
    await page.addScriptTag({content:SFX});
    await page.evaluate(()=>{const S=window.EhSfx||{};S.say=()=>{};S.play=()=>{};window.EhSfx=S;window.EhGameBgm={enter:()=>{},exit:()=>{}};});
    for(const f of g.files) await page.addScriptTag({content:G(f)});
    await page.evaluate((g)=>{
      window._G = window[g.open].open({ names:['我','阿甲','小乙','阿丙'].slice(0,g.key==='poker'?3:4), avatars:['🦊','🗿','🔥','🐱'].slice(0,g.key==='poker'?3:4), isAI:[false,true,true,true].slice(0,g.key==='poker'?3:4), mySeat:0, mount:document.getElementById('hall'), startStack:1000, sb:5, bb:10 });
    }, g);
    await page.waitForTimeout(800);
    const m=await page.evaluate((g)=>{
      const rect=sel=>{const el=document.querySelector(sel); if(!el) return null; const b=el.getBoundingClientRect(); const cs=getComputedStyle(el); return {w:+b.width.toFixed(1),h:+b.height.toFixed(1),radius:cs.borderTopLeftRadius,borderStyle:cs.borderTopStyle,exists:true};};
      return { cnt: g.cnt? !!document.querySelector(g.cnt):false, mus:rect(g.mus), rot:rect(g.rot), x:rect(g.x) };
    }, g);
    metrics[g.key]=m;
    await page.screenshot({path:path.join(ROOT,'scripts',`_topbar-${g.key}.png`), clip:{x:0,y:0,width:390,height:60}});
    ok(!m.cnt, `${g.key}: 记牌器 🃏 已移除`);
    ok(m.mus && m.mus.w>=34 && m.mus.h>=34, `${g.key}: 🎵 圆钮 ~36px (${m.mus?m.mus.w+'x'+m.mus.h:'缺'})`);
    ok(m.rot && m.rot.w>=34 && m.rot.h>=34 && m.rot.borderStyle==='solid', `${g.key}: ⟳ 已套统一圆钮样式 (${m.rot?m.rot.w+'x'+m.rot.h+' border='+m.rot.borderStyle:'缺'})`);
    ok(m.x && m.x.h>=34, `${g.key}: ✕返回 高度对齐圆钮 36px (${m.x?m.x.h:'缺'})`);
    if(errs.length) ok(false, `${g.key}: pageerror ${errs.slice(0,2).join(' | ')}`);
    await ctx.close();
  }
  // 跨游戏一致性: 三钮尺寸互等
  const hs=['ddz','guandan','poker'].map(k=>metrics[k].mus&&metrics[k].mus.h).filter(Boolean);
  ok(new Set(hs).size===1, `三游戏 🎵 高度一致 (${hs.join(',')})`);
  const xs=['ddz','guandan','poker'].map(k=>metrics[k].x&&metrics[k].x.h).filter(Boolean);
  ok(new Set(xs).size===1, `三游戏 ✕ 高度一致 (${xs.join(',')})`);
  console.log('截图: scripts/_topbar-{ddz,guandan,poker}.png');
  console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
  await browser.close();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
