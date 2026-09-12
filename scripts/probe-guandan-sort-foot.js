#!/usr/bin/env node
'use strict';
/* #2 理牌钮移入底部操作区体检: #gdSort 在 .gd-foot 内、与 .gd-acts 按钮无重叠、招募态隐藏。
 * 用法: node scripts/probe-guandan-sort-foot.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SFX=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--accent:#00E5D4;--amber:#FFC24D;--magenta:#FF2D8E;--glow-cyan:0 0 8px rgba(0,229,212,.6);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const FILES=['deck.js','card-counter.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','guandan-ui.js'];
let pass=0, fail=0; const ok=(c,m)=>{ if(c)pass++; else{fail++; console.log('  ✗ '+m);} };

(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html data-mode="night"><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  await page.addStyleTag({content:SHARED});
  await page.addScriptTag({content:SFX});
  await page.evaluate(()=>{const S=window.EhSfx||{};S.say=()=>{};S.play=()=>{};window.EhSfx=S;window.EhGameBgm={enter:()=>{},exit:()=>{}};});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.evaluate(()=>{ window._G=window.EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0,mount:document.getElementById('hall')}); });
  await page.waitForTimeout(1200);

  const r=await page.evaluate(()=>{
    const sort=document.querySelector('#gdSort');
    const foot=document.querySelector('.gd-foot');
    const acts=document.querySelector('.gd-foot .gd-acts');
    const btns=[...document.querySelectorAll('.gd-foot .gd-acts .gd-btn')];
    const rc=el=>{ if(!el) return null; const b=el.getBoundingClientRect(); return {l:+b.left.toFixed(1),r:+b.right.toFixed(1),t:+b.top.toFixed(1),b:+b.bottom.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1),vis:b.width>0&&b.height>0}; };
    const sr=rc(sort);
    const inFoot = !!(sort && foot && foot.contains(sort));
    const overlaps = btns.map(rc).filter(Boolean).some(br=> sr && !(sr.r<=br.l || sr.l>=br.r || sr.b<=br.t || sr.t>=br.b));
    return { inFoot, sr, sortVis:sr&&sr.vis, phase:document.querySelector('.gd-room').getAttribute('data-phase'), nBtns:btns.length, overlaps };
  });
  ok(r.inFoot, '理牌钮在 .gd-foot 底部操作区内');
  ok(r.sortVis, '对局中理牌钮可见 (rect '+(r.sr?r.sr.w+'x'+r.sr.h+' @'+r.sr.l+','+r.sr.t:'缺')+')');
  ok(!r.overlaps, `理牌钮与 ${r.nBtns} 个操作按钮无重叠`);
  await page.screenshot({path:path.join(ROOT,'scripts','_gd-sort-foot.png'), clip:{x:0,y:640,width:390,height:204}});

  // 招募态隐藏验证: 重开一局停在 lobby 前不易, 改测 CSS 规则命中——直接切 phase
  const hid=await page.evaluate(()=>{ const room=document.querySelector('.gd-room'); const prev=room.getAttribute('data-phase'); room.setAttribute('data-phase','lobby'); const cs=getComputedStyle(document.querySelector('#gdSort')); const disp=cs.display; room.setAttribute('data-phase',prev||''); return disp; });
  ok(hid==='none', '招募态(lobby)理牌钮隐藏 (display='+hid+')');

  if(errs.length) ok(false,'pageerror: '+errs.slice(0,3).join(' | '));
  console.log('截图: scripts/_gd-sort-foot.png  (phase='+r.phase+')');
  console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
  await browser.close();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
