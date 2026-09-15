#!/usr/bin/env node
'use strict';
/* 掼蛋智能组牌(横排组盒)体检:
 *   T1 点一个成型组盒中央 → 选中【整组】(盒内全部牌), 不多不少。
 *   T2 点散牌盒里某一张 → 只选中那一张(散牌逐张点)。
 *   T3 再点同一成型组盒 → 取消整组(toggle)。
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
  // 切到智能组牌(短按一次: rank→combo)
  await page.evaluate(()=>{ const b=document.querySelector('#gdSort'); b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1})); b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1})); });
  await page.waitForTimeout(500);
  const isCombo=await page.evaluate(()=>document.querySelector('.gd-hand.combo')!==null);
  ok(isCombo,'进入智能组牌(横排组盒)');

  const mk='(t,x,y,tg)=>{const e=new PointerEvent(t,{bubbles:true,cancelable:true,composed:true,pointerId:1,pointerType:"touch",clientX:x,clientY:y,buttons:t==="pointerup"?0:1});(tg||document).dispatchEvent(e);}';
  // 全走真交互路径: 点击靠 selected 集(非 DOM class), 故清选也必须走"再点一次 toggle off", 不手改 .sel。
  const selN=async()=>page.evaluate(()=>document.querySelectorAll('.gd-hand .card.sel').length);

  // T1: 点第一个成型组盒中央 → 整组选中
  const t1=await page.evaluate((mkSrc)=>{
    const mk=eval(mkSrc);
    const box=document.querySelector('.gd-grp:not(.loose)'); if(!box) return {err:'无成型组盒'};
    const cards=[...box.querySelectorAll('.card')]; const n=cards.length;
    const r=box.querySelector('.gd-grp-cards').getBoundingClientRect();
    mk('pointerdown',r.left+r.width/2,r.top+r.height/2,document.querySelector('.gd-hand'));
    const sel=[...document.querySelectorAll('.gd-hand .card.sel')];
    return { n, selN:sel.length, allInBox: sel.length===n && [...box.querySelectorAll('.card')].every(c=>c.classList.contains('sel')) };
  }, mk);
  if(t1.err) ok(false,'T1 前置: '+t1.err);
  else { ok(t1.selN===t1.n && t1.allInBox, 'T1 点成型盒 → 整组选中('+t1.n+'张全中, 实选'+t1.selN+')'); }

  // T3(接 T1): 再点同一成型盒 → 整组取消(toggle off), 顺带把选择清空供 T2 独立起测
  const t3=await page.evaluate((mkSrc)=>{
    const mk=eval(mkSrc);
    const box=document.querySelector('.gd-grp:not(.loose)');
    const r=box.querySelector('.gd-grp-cards').getBoundingClientRect();
    mk('pointerdown',r.left+r.width/2,r.top+r.height/2,document.querySelector('.gd-hand'));
    return document.querySelectorAll('.gd-hand .card.sel').length;
  }, mk);
  ok(t3===0, 'T3 再点同盒 → 整组取消(实选'+t3+')');

  // T2(此刻 selected 已空): 点散牌盒里某一张 → 只选那一张
  const t2=await page.evaluate((mkSrc)=>{
    const mk=eval(mkSrc);
    const loose=document.querySelector('.gd-grp.loose'); if(!loose) return {err:'无散牌盒'};
    const cards=[...loose.querySelectorAll('.card')]; if(cards.length<2) return {err:'散牌<2 不足以验单选'};
    const tgt=cards[cards.length-1];   // 最右一张(整张露出, 不被右邻叠)
    const r=tgt.getBoundingClientRect();
    mk('pointerdown',r.right-6,r.top+r.height/2,document.querySelector('.gd-hand'));
    const sel=[...document.querySelectorAll('.gd-hand .card.sel')];
    return { selN:sel.length, hit: sel.length===1 && sel[0]===tgt, id:tgt.dataset.id };
  }, mk);
  if(t2.err) ok(false,'T2 前置: '+t2.err);
  else { ok(t2.selN===1, 'T2 点散牌一张 → 只选 1 张(实选'+t2.selN+')'); ok(t2.hit,'T2 选中的正是点的那张'); }

  ok(errs.length===0,'无页面报错'+(errs.length?': '+errs.slice(0,2).join(' | '):''));
  await browser.close();
  console.log('\n'+(fail?'💥 有失败 ('+pass+'✓ '+fail+'✗)':'🎉 全部通过 ('+pass+'✓)'));
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
