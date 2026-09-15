#!/usr/bin/env node
'use strict';
/* 斗地主选牌"点=单选 / 拖=连选"分界体检(修主人报的"大王对子选不了一张"):
 *   T1 想点一张牌时的几像素抖动(<DRAG_SLOP) 不该连选到相邻牌 —— 点一张就是一张。
 *   T2 尤其手牌最右两张(大小王挨着、露出窄): 点最右那张 + 抖 3px 向左, 仍只选 1 张(且就是点中的那张)。
 *   T3 真·拖动(移过阈值, 横扫 3 张)仍能连选 —— 阈值不该误伤划选。
 * 用真 Chrome 载入 game-ui.js + 派发真实 PointerEvent。用法: node scripts/probe-ddz-select-drag.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
let pass=0, fail=0; const ok=(c,m)=>{ if(c){pass++;console.log('  ✓ '+m);} else{fail++; console.log('  ✗ '+m);} };

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
  // 抢地主(每轮点最高可选叫分)进入出牌
  for(let i=0;i<10;i++){
    const done=await page.evaluate(()=>{
      if(document.querySelector('.ddz-acts')) return true;
      const btns=[...document.querySelectorAll('.ddz-bidbtns .ddz-btn')].filter(b=>!b.disabled);
      if(btns.length) btns[btns.length-1].click();
      return false;
    });
    if(done) break; await page.waitForTimeout(450);
  }
  await page.waitForTimeout(600);

  const inPlay = await page.evaluate(()=>!!document.querySelector('.ddz-acts'));
  ok(inPlay, '进入出牌阶段(可选牌)');

  const mk='(t,x,y,tg)=>{const e=new PointerEvent(t,{bubbles:true,cancelable:true,composed:true,pointerId:1,pointerType:"touch",clientX:x,clientY:y,buttons:t==="pointerup"?0:1});(tg||document).dispatchEvent(e);}';

  // ── T1+T2: 点最右那张牌(靠其左沿) + 抖 3px 向左, 只选 1 张且就是点中的那张 ──
  const r1 = await page.evaluate((mkSrc)=>{
    const mk=eval(mkSrc);
    const hand=document.querySelector('.ddz-hand'); const kids=[...hand.children];
    if(kids.length<2) return {err:'手牌<2'};
    const last=kids[kids.length-1], prev=kids[kids.length-2];
    const lb=last.getBoundingClientRect(), pb=prev.getBoundingClientRect();
    hand.querySelectorAll('.card.sel').forEach(c=>c.classList.remove('sel'));
    // 落点紧贴最右牌左沿(边界=lb.left); 抖 3px 向左会真正越界落到前一张(小王)身上 —— 正是老 bug 复现姿势。
    //   校验前一张确实盖在落点左侧(重叠), 否则这台布局的抖动落不到邻牌, 测试无意义。
    if(!(pb.left < lb.left && pb.right > lb.left-3)) return {err:'相邻牌未重叠, 无法复现越界'};
    const x0=lb.left+1, y0=lb.top+lb.height/2;
    mk('pointerdown', x0, y0, hand);
    mk('pointermove', x0-3, y0, hand);   // 3px 抖动(< DRAG_SLOP=8), 越过边界落到前一张上
    mk('pointermove', x0-3, y0+2, hand);
    mk('pointerup',   x0-3, y0+2, hand);
    const sel=[...hand.querySelectorAll('.card.sel')];
    return { n:sel.length, hitLast: sel.length===1 && sel[0]===last, lastId:last.dataset.id, prevId:prev.dataset.id };
  }, mk);
  if(r1.err){ ok(false,'T1/T2 前置: '+r1.err); }
  else {
    ok(r1.n===1, 'T2 点最右牌+3px 抖动 → 只选中 1 张(实得 '+r1.n+')');
    ok(r1.hitLast, 'T2 选中的正是点中那张(不是被抖动带到相邻牌)');
  }

  // 复位选中
  await page.evaluate(()=>document.querySelectorAll('.ddz-hand .card.sel').forEach(c=>c.classList.remove('sel')));

  // ── T3: 真拖动(移过阈值, 横扫 3 张)仍连选 ──
  const r3 = await page.evaluate((mkSrc)=>{
    const mk=eval(mkSrc);
    const hand=document.querySelector('.ddz-hand'); const kids=[...hand.children];
    hand.querySelectorAll('.card.sel').forEach(c=>c.classList.remove('sel'));
    const a=kids[0].getBoundingClientRect(), c=kids[2].getBoundingClientRect();
    const y=a.top+a.height/2;
    const ax=a.left+a.width/2, cx=c.left+c.width/2;
    mk('pointerdown', ax, y, hand);
    // 分步移动越过阈值并扫过前 3 张
    for(let s=1;s<=6;s++){ const x=ax+(cx-ax)*(s/6); mk('pointermove', x, y, hand); }
    mk('pointerup', cx, y, hand);
    return { n: hand.querySelectorAll('.card.sel').length };
  }, mk);
  ok(r3.n>=3, 'T3 真·拖动横扫仍连选(≥3 张, 实得 '+r3.n+')');

  ok(errs.length===0, '无页面报错'+(errs.length?': '+errs.slice(0,2).join(' | '):''));
  await browser.close();
  console.log('\n'+(fail? '💥 有失败 ('+pass+'✓ '+fail+'✗)' : '🎉 全部通过 ('+pass+'✓)'));
  process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
