#!/usr/bin/env node
'use strict';
/* 量化掼蛋理牌体验: 竖列(combo)态逐张点"可见条中心"测命中率(选不上/错配), 截图核对。
 * 用法: node scripts/probe-guandan-tidy.js  → 命中报告 + /tmp/eh-gd-tidy/*.png */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SFX=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');
const SHOT='/tmp/eh-gd-tidy'; fs.mkdirSync(SHOT,{recursive:true});
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const FILES=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','card-counter.js','guandan-ui.js'];
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';
(async()=>{
  if(!chromium){ console.log('⚠ 无 playwright'); process.exit(0); }
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  await page.evaluate(()=>{const S=window.EhSfx||{};S.say=()=>{};S.play=()=>{};window.EhSfx=S;window.EhGameBgm={enter:()=>{},exit:()=>{}};});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.evaluate(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    window.__g=window.EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0});
    await sleep(900);
  });
  // 切到竖列组牌态(短按 #gdSort 一次)
  await page.evaluate(()=>{
    const b=document.querySelector('#gdSort');
    b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:9}));
    b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:9}));
  });
  await page.waitForTimeout(600);
  const isCombo=await page.evaluate(()=>document.querySelector('.gd-hand').classList.contains('combo'));
  await page.screenshot({path:SHOT+'/1-combo.png',clip:{x:0,y:520,width:390,height:324}});
  console.log('切竖列组牌='+isCombo);

  // 新语义验证: 点一列(在该列露出条的 上/中/下 三个不同高度)都应精确选中【整组】(成型列)或【单张】(散牌列)。
  //   模拟胖手指点在列内任意高度 → 只要落在这列就选中这一手, 不必点中具体某张。
  const rep=await page.evaluate(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const hand=document.querySelector('.gd-hand');
    const selIds=()=>new Set([...hand.querySelectorAll('.card.sel')].map(c=>c.dataset.id));
    const tap=async(cx,cy)=>{
      hand.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:cx,clientY:cy,pointerId:1}));
      hand.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:cx,clientY:cy,pointerId:1}));
      await sleep(15);
    };
    // 走真 toggle 路径清空: 对每个仍有 .sel 的列点一下(整组 toggle off)
    const resetSel=async()=>{
      for(let guard=0; selIds().size && guard<20; guard++){
        const col=[...hand.querySelectorAll('.gd-col')].find(c=>c.querySelector('.card.sel'));
        if(!col) break; const cr=col.getBoundingClientRect();
        await tap(cr.left+cr.width/2, cr.top+8);
      }
    };
    const cols=[...hand.querySelectorAll('.gd-col')];
    const out={cols:cols.length, ok:0, bad:0, badList:[]};
    for(let ci=0; ci<cols.length; ci++){
      const col=[...hand.querySelectorAll('.gd-col')][ci];   // 每轮重取(renderHand 不重建结构, 但稳妥)
      const kids=[...col.querySelectorAll('.card')];
      const isGroup = !!col.querySelector('.gd-col-label:not(.ph)');
      const expect = new Set(kids.map(c=>c.dataset.id));
      const cr=col.getBoundingClientRect(); const cx=cr.left+cr.width/2;
      const first=kids[0].getBoundingClientRect(), last=kids[kids.length-1].getBoundingClientRect();
      const ys=[first.top+first.height*0.4, (first.top+last.bottom)/2, Math.max(first.top+2,last.bottom-6)];
      for(const cy of ys){
        await resetSel();
        await tap(cx,cy);                 // 选
        const got=selIds();
        const same = got.size===expect.size && [...expect].every(id=>got.has(id));
        if(same) out.ok++; else { out.bad++; out.badList.push({group:isGroup,want:[...expect],got:[...got]}); }
        await tap(cx,cy);                 // 再点同处应取消
      }
      await resetSel();
    }
    return out;
  });
  console.log('竖列点列选组: '+rep.cols+'列 ×3高度点击 → 正确'+rep.ok+' 错'+rep.bad);
  if(rep.badList.length) console.log('  错:', JSON.stringify(rep.badList).slice(0,500));
  if(errs.length) console.log('ERR:', errs.slice(0,3).join(' | '));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(2);});
