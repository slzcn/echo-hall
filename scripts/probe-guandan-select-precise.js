#!/usr/bin/env node
'use strict';
// probe-guandan-select-precise.js — 验证 #1「选牌区域更精准, 其余=取消区」:
//   A. 点某张牌的可见条中心 → 该牌被选中(正例, 精准命中不误伤);
//   B. 点首张左侧留白(x < 首张 left)→ 不选中任何牌(其余区);
//   C. 点末张右侧留白(x > 末张 right)→ 不选中;
//   D. 点牌行上方 padding(y < 行 top)→ 不选中;
//   E. 已选中若干牌后, 点两牌被撑开的空档(选中牌会 pop 起留缝)→ 清空选择(取消区)。
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SFX=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const FILES=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','card-counter.js','guandan-ui.js'];
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';

(async()=>{
  if(!chromium){ console.log('⚠ 无 playwright, 跳过'); process.exit(0); }
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage();
  await page.setContent('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  await page.evaluate(()=>{const S=window.EhSfx||{};S.say=()=>{};S.play=()=>{};window.EhSfx=S;window.EhGameBgm={enter:()=>{},exit:()=>{}};});
  for(const f of FILES) await page.addScriptTag({content:G(f)});

  const R=await page.evaluate(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    window.__g=window.EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0});
    await sleep(900);
    const hand=document.querySelector('.gd-hand');
    const felt=document.querySelector('.gd-felt');
    if(hand.classList.contains('combo')) return {skip:'combo'};
    const freshRows=()=>[...hand.children].filter(r=>r.children.length);
    const rc=el=>el.getBoundingClientRect();
    const selIds=()=>[...hand.querySelectorAll('.card.sel')].map(c=>c.dataset.id);
    function tap(x,y){
      hand.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y,pointerId:1}));
      hand.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:x,clientY:y,pointerId:1}));
    }
    function clearAll(){ if(felt) felt.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:195,clientY:300,pointerId:9})); }
    const out={ combo:false, tests:[] };
    const rows=freshRows(); const row=rows[rows.length-1];  // 用最后一排(通常牌多)
    const kids=[...row.children];
    const rowTop=rc(row).top, rowBot=rc(row).bottom;

    // A. 点末张(露全宽)中心 → 该牌选中
    clearAll(); await sleep(40);
    const last=kids[kids.length-1], lr=rc(last), lid=last.dataset.id;
    tap((lr.left+lr.right)/2, (lr.top+lr.bottom)/2); await sleep(60);
    out.tests.push({ name:'A 点末张中心→命中', pass: selIds().includes(lid), got:selIds().length });

    // B. 首张左侧留白 → 不选中
    clearAll(); await sleep(40);
    const first=freshRows().slice(-1)[0].children[0], fr=rc(first);
    tap(fr.left-8, (fr.top+fr.bottom)/2); await sleep(60);
    out.tests.push({ name:'B 首张左侧留白→空', pass: selIds().length===0, got:selIds().length });

    // C. 末张右侧留白 → 不选中
    clearAll(); await sleep(40);
    const lst2=(()=>{const k=freshRows().slice(-1)[0].children;return k[k.length-1];})(), lr2=rc(lst2);
    tap(lr2.right+8, (lr2.top+lr2.bottom)/2); await sleep(60);
    out.tests.push({ name:'C 末张右侧留白→空', pass: selIds().length===0, got:selIds().length });

    // D. 最下排下方 padding → 不选中(两排竖向重叠, 下排之下才是真空白; 上排之上同理但取一处即可)
    clearAll(); await sleep(40);
    const botRow=freshRows().slice(-1)[0]; const kMid=botRow.children[Math.floor(botRow.children.length/2)], kr=rc(kMid);
    tap((kr.left+kr.right)/2, rc(botRow).bottom+10); await sleep(60);
    out.tests.push({ name:'D 下排下方 padding→空', pass: selIds().length===0, got:selIds().length });

    // E. 选中两张相邻 → 撑开空档 → 点空档取消
    clearAll(); await sleep(40);
    let rw=freshRows().slice(-1)[0].children;
    const a=rw[2], b=rw[3];
    const ar=rc(a); tap((ar.left+ar.right)/2, (ar.top+ar.bottom)/2); await sleep(120);
    rw=freshRows().slice(-1)[0].children;
    const bEl=[...rw].find(c=>c.dataset.id===b.dataset.id)||rw[3];
    const br=rc(bEl); tap((br.left+br.right)/2, (br.top+br.bottom)/2); await sleep(140);
    const beforeGapSel=selIds().length;
    // 撑开后取相邻两张之间的空档 x: 前张 right 与后张 left 之间
    rw=[...freshRows().slice(-1)[0].children];
    let gapX=null, gy=null;
    for(let i=0;i<rw.length-1;i++){ const p=rc(rw[i]), q=rc(rw[i+1]); if(q.left - p.right > 3){ gapX=(p.right+q.left)/2; gy=(p.top+p.bottom)/2; break; } }
    let gapPass=null;
    if(gapX!=null){ tap(gapX, gy); await sleep(80); gapPass = selIds().length===0; }
    out.tests.push({ name:'E 撑开空档点击→取消', pass: gapX==null ? 'no-gap(跳过)' : gapPass, beforeGapSel, gapX:gapX!=null });
    return out;
  });

  await browser.close();
  if(R.skip){ console.log('跳过('+R.skip+')'); process.exit(0); }
  console.log('掼蛋选牌精准命中探针:');
  let allPass=true;
  for(const t of R.tests){
    const ok = t.pass===true || t.pass==='no-gap(跳过)';
    if(t.pass!==true && t.pass!=='no-gap(跳过)') allPass=false;
    console.log(`  ${ok?'✅':'❌'} ${t.name}  ${JSON.stringify(t)}`);
  }
  console.log(allPass?'—— 全部通过':'—— 有失败');
  process.exit(allPass?0:1);
})();
