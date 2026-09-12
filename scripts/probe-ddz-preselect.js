#!/usr/bin/env node
'use strict';
/* #3c 斗地主操作补齐体检:
 *   ① 别家回合也能预选牌(对齐掼蛋), 且 出牌 钮仍禁用(不会误出)
 *   ② 点牌桌绒面空白 → 清空选中(对齐掼蛋)
 * 用法: node scripts/probe-ddz-preselect.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
let pass=0, fail=0; const ok=(c,m)=>{ if(c)pass++; else{fail++; console.log('  ✗ '+m);} };

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
  // 抢地主进入出牌
  for(let i=0;i<8;i++){
    const done=await page.evaluate(()=>{
      const acts=document.querySelector('.ddz-acts'); if(acts) return true;   // 出牌操作区出现=已进 play
      const btns=[...document.querySelectorAll('.ddz-bidbtns .ddz-btn')].filter(b=>!b.disabled);
      if(btns.length) btns[btns.length-1].click();
      return false;
    });
    if(done) break; await page.waitForTimeout(500);
  }
  await page.waitForTimeout(700);

  // ── 测 ②: 点绒面空白清空选中(先确保轮到我: 我是地主先手) ──
  const clr=await page.evaluate(()=>{
    const hand=document.querySelector('.ddz-hand'); const card=hand&&hand.querySelector('.card');
    const felt=document.querySelector('#ddzFelt')||document.querySelector('.ddz-felt');
    if(!card||!felt) return {no:true};
    const b=card.getBoundingClientRect();
    const mk=(t,x,y,tg)=>{const e=new PointerEvent(t,{bubbles:true,cancelable:true,composed:true,pointerId:1,pointerType:'touch',clientX:x,clientY:y,buttons:t==='pointerup'?0:1});(tg||document).dispatchEvent(e);};
    // 选一张
    mk('pointerdown', b.left+b.width/2, b.top+b.height/2, hand);
    mk('pointerup', b.left+b.width/2, b.top+b.height/2, hand);
    const selAfter=hand.querySelectorAll('.card.sel').length;
    // 扫出一个"绒面空白点": 在 felt 内、elementFromPoint 命中的既非卡牌也非座位/按钮/操作条
    const fb=felt.getBoundingClientRect();
    const bad=el=>!el || !felt.contains(el) || el.closest('.card, button, #ddzCtrl, .ddz-acts, .ddz-say, .ddz-seat');
    let cx=0, cy=0, topEl=null;
    for(let fy=0.15; fy<0.95 && !topEl; fy+=0.05){
      for(const fx of [0.5,0.2,0.8,0.35,0.65]){
        const x=fb.left+fb.width*fx, y=fb.top+fb.height*fy, el=document.elementFromPoint(x,y);
        if(!bad(el)){ cx=x; cy=y; topEl=el; break; }
      }
    }
    if(!topEl) return { selAfter, selCleared:selAfter, topTag:'(找不到空白点)' };
    mk('pointerdown', cx, cy, topEl);
    const selCleared=hand.querySelectorAll('.card.sel').length;
    return { selAfter, selCleared, topTag:(topEl.className||topEl.id||topEl.tagName) };
  });
  if(clr.no){ ok(false,'未进入出牌阶段/无手牌'); }
  else {
    ok(clr.selAfter>=1, '点手牌可选中 (选中 '+clr.selAfter+' 张)');
    ok(clr.selCleared===0, '点绒面空白→清空选中 (清后 '+clr.selCleared+' 张, 点中='+clr.topTag+')');
  }

  // ── 测 ①: 出一手把牌权交给别家, 别家回合仍能预选, 且出牌钮禁用 ──
  const pre=await page.evaluate(async()=>{
    const room=document.querySelector('.ddz-room');
    // 用提示自动选一手合法领出, 再点出牌
    const hintBtn=document.querySelector('#ddzHint'); if(hintBtn && !hintBtn.disabled) hintBtn.click();
    const playBtn=document.querySelector('#ddzPlay');
    if(!playBtn || playBtn.disabled) return {skip:'出牌钮未就绪(可能提示只有一手且已自动选/无牌)', playDisabled:playBtn?playBtn.disabled:null};
    playBtn.click();   // 出牌 → 牌权交下家(此刻同步, AI 定时器尚未触发)
    // 同步立刻在别家回合选牌
    const hand=document.querySelector('.ddz-hand'); const card=hand&&hand.querySelector('.card');
    if(!card) return {skip:'出牌后无手牌'};
    const b=card.getBoundingClientRect();
    const mk=(t,x,y)=>hand.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,composed:true,pointerId:2,pointerType:'touch',clientX:x,clientY:y,buttons:t==='pointerup'?0:1}));
    mk('pointerdown', b.left+b.width/2, b.top+b.height/2);
    mk('pointerup', b.left+b.width/2, b.top+b.height/2);
    const sel=hand.querySelectorAll('.card.sel').length;
    const pb=document.querySelector('#ddzPlay');
    return { sel, playDisabled: pb?pb.disabled:null };
  });
  if(pre.skip){ console.log('  · 预选测试跳过: '+pre.skip); }
  else {
    ok(pre.sel>=1, '别家回合仍能预选牌 (选中 '+pre.sel+' 张)');
    ok(pre.playDisabled===true, '别家回合出牌钮禁用(预选不误出)');
  }

  if(errs.length) ok(false,'pageerror: '+errs.slice(0,3).join(' | '));
  console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
  await browser.close();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
