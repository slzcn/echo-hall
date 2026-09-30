#!/usr/bin/env node
'use strict';
/* 掼蛋"按牌型"理牌(简化后)体检 —— 对标欢乐掼蛋: 就地重排同一手牌, 不改选牌方式。
 *   T0 短按理牌 → 进"按牌型", 手牌仍是普通叠牌排(.gd-hand-row 里一堆 .card), 绝不出现"组盒"(.gd-grp)。
 *   T1 按牌型下点某一张牌 → 只选中那一张(单张 toggle), 不会连选一整组。
 *   T2 按牌型至少有一处组间留缝(.grp-start), 成组的牌看得出分堆。
 *   T3 再短按 → 切回"按大小"; 钮文案在 📚按牌型 / 🔢按大小 间来回。
 * 用真 Chrome 派发 PointerEvent。用法: node scripts/probe-gd-combo-select.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium }=require('playwright');
const CSSVARS=':root{--accent:#00e5d4;--magenta:#ff2d8e;--amber:#ffc24d;--sub:#86cbc6;--dim:#498d88;--ink:#eaf6ff;--cw:38px;--ch:54px;'
  +'--bg:#070a12;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel:rgba(0,0,0,.2);--panel-solid:#132a29}'
  +'html,body{margin:0;background:#0a0e18;color:#eaf6ff;font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}';
const MODS=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','table-orient.js','guandan-ui.js'];
let pass=0,fail=0; const ok=(c,m)=>{ if(c){pass++;console.log('  ✓ '+m);}else{fail++;console.log('  ✗ '+m);} };

(async()=>{
  const browser=await chromium.launch({executablePath:CHROME});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><style>'+CSSVARS+'</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of MODS) await page.addScriptTag({content:G(f)});
  await page.evaluate(()=>{ window.EhSfx={say:()=>{},play:()=>{}}; window.EhGameBgm={enter:()=>{},exit:()=>{}};
    window.EHGuandanGame.open({mount:document.getElementById('hall'),seed:1,names:['深海狐狸','灵魂下','狼姐','灵魂上'],avatars:['🦊','🔥','🐺','⚡'],onResult(){}}); });
  await page.waitForTimeout(1800);

  const btnTxt=async()=>page.evaluate(()=>{ const b=document.querySelector('#gdSort'); return b?b.textContent.trim():'?'; });
  const tapBtn=async()=>{ await page.evaluate(()=>{ const b=document.querySelector('#gdSort'); b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1})); b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1})); }); await page.waitForTimeout(450); };
  const selN=async()=>page.evaluate(()=>document.querySelectorAll('.gd-hand .card.sel').length);

  const t0=await btnTxt();
  ok(/按大小/.test(t0),'初始钮=按大小(实:'+t0+')');
  await tapBtn();   // → 按牌型
  const t1=await btnTxt();
  ok(/按牌型/.test(t1),'短按一次 → 钮=按牌型(实:'+t1+')');

  // T0: 按牌型态下仍是普通叠牌排, 无"组盒"
  const shape=await page.evaluate(()=>({
    grp: document.querySelectorAll('.gd-hand .gd-grp').length,
    rows: document.querySelectorAll('.gd-hand .gd-hand-row').length,
    cards: document.querySelectorAll('.gd-hand .card').length,
    grpStart: document.querySelectorAll('.gd-hand .card.grp-start').length,
    combo: document.querySelector('.gd-hand.combo')!==null,
  }));
  ok(shape.grp===0 && !shape.combo,'按牌型无"组盒".gd-grp/.combo(实 grp='+shape.grp+')');
  ok(shape.rows>=1 && shape.cards>0,'仍是普通叠牌排 .gd-hand-row('+shape.rows+'排/'+shape.cards+'张)');
  ok(shape.grpStart>=1,'组间有留缝 .grp-start(实'+shape.grpStart+'处)');

  // T1: 点中间某一张牌 → 只选那一张(单张 toggle, 不连选整组)
  const mk='(t,x,y,tg)=>{const e=new PointerEvent(t,{bubbles:true,cancelable:true,composed:true,pointerId:1,pointerType:"touch",clientX:x,clientY:y,buttons:t==="pointerup"?0:1});(tg||document).dispatchEvent(e);}';
  const t1sel=await page.evaluate((mkSrc)=>{
    const mk=eval(mkSrc);
    const cards=[...document.querySelectorAll('.gd-hand .card')];
    const tgt=cards[Math.floor(cards.length/2)];   // 取中间一张(左右都被叠, 但露出的可点条在左沿附近)
    const r=tgt.getBoundingClientRect();
    const hand=document.querySelector('.gd-hand');
    mk('pointerdown', r.left+2, r.top+r.height/2, hand);   // 点这张露出的左条
    mk('pointerup',   r.left+2, r.top+r.height/2, hand);
    const sel=[...document.querySelectorAll('.gd-hand .card.sel')];
    return { selN:sel.length, hitTgt: sel.length>=1 && sel.includes(tgt) };
  }, mk);
  ok(t1sel.selN===1,'点一张 → 只选 1 张(单张 toggle, 实选'+t1sel.selN+')');
  ok(t1sel.hitTgt,'选中的正是点的那张');

  await tapBtn();   // → 按大小
  const t3=await btnTxt();
  ok(/按大小/.test(t3),'再短按 → 切回按大小(实:'+t3+')');

  ok(errs.length===0,'无页面报错'+(errs.length?': '+errs.slice(0,2).join(' | '):''));
  await browser.close();
  console.log('\n'+(fail?'💥 有失败 ('+pass+'✓ '+fail+'✗)':'🎉 全部通过 ('+pass+'✓)'));
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
