#!/usr/bin/env node
'use strict';
/* 掼蛋"直接长按牌拿起拖动"手动理牌探针(对标主流: 无需先进模式, 长按手牌里的牌即可拖排)。
 *   A 长按一张牌≈350ms → 该牌进入 .dragging(拿起), 且不误选(long-press≠点选)。
 *   B 拖到本排最左松手 → 手牌重排, 被拖的牌落到该排头部, 27 张一张不丢。
 *   C 快按快抬(无长按/无移动) → 仍是点选一张(回归)。
 *   D 选中一组(3 张)后长按其一拖动 → 整组一起 .dragging, 落位后 3 张连排在一起。
 * 用真 Chrome 派发 PointerEvent。用法: node scripts/probe-guandan-longpress-drag.js */
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
const mk='(t,x,y,tg)=>{const e=new PointerEvent(t,{bubbles:true,cancelable:true,composed:true,pointerId:1,pointerType:"touch",clientX:x,clientY:y,buttons:t==="pointerup"?0:1});(tg||document).dispatchEvent(e);}';

(async()=>{
  const browser=await chromium.launch({executablePath:CHROME});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><style>'+CSSVARS+'</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of MODS) await page.addScriptTag({content:G(f)});
  await page.evaluate(()=>{ window.EhSfx={say:()=>{},play:()=>{}}; window.EhGameBgm={enter:()=>{},exit:()=>{}};
    window.EHGuandanGame.open({mount:document.getElementById('hall'),seed:1,names:['深海狐狸','灵魂下','狼姐','灵魂上'],avatars:['🦊','🔥','🐺','⚡'],onResult(){}}); });
  await page.waitForTimeout(1800);

  const order=()=>page.evaluate(()=>[...document.querySelectorAll('.gd-hand .card')].map(c=>c.dataset.id));
  const selN=()=>page.evaluate(()=>document.querySelectorAll('.gd-hand .card.sel').length);

  // ── A/B: 长按最后一张(下排最右, 整张露出)拿起 → 拖到本排最左松手 ──
  const before=await order();
  const draggedId=await page.evaluate((mkSrc)=>{
    const mk=eval(mkSrc);
    const cards=[...document.querySelectorAll('.gd-hand .card')];
    const T=cards[cards.length-1]; const r=T.getBoundingClientRect();
    const hand=document.querySelector('.gd-hand');
    mk('pointerdown', r.left+2, r.top+r.height/2, hand);
    return T.dataset.id;
  }, mk);
  await page.waitForTimeout(360);   // 等长按≈300ms 触发拿起
  const draggingN=await page.evaluate(()=>document.querySelectorAll('.gd-hand .card.dragging').length);
  ok(draggingN===1, 'A 长按一张≈350ms → 该牌拿起 .dragging(实 '+draggingN+' 张)');
  ok(await selN()===0, 'A 长按不误选(sel=0)');

  await page.evaluate((mkSrc)=>{
    const mk=eval(mkSrc);
    const rows=[...document.querySelectorAll('.gd-hand .gd-hand-row')];
    const botRow=rows[rows.length-1]; const first=botRow.children[0];
    const fr=first.getBoundingClientRect(); const hand=document.querySelector('.gd-hand');
    mk('pointermove', fr.left-6, fr.top+fr.height/2, hand);
    mk('pointerup',   fr.left-6, fr.top+fr.height/2, hand);
  }, mk);
  await page.waitForTimeout(300);
  const after=await order();
  const botIds=await page.evaluate(()=>{ const rows=[...document.querySelectorAll('.gd-hand .gd-hand-row')]; const b=rows[rows.length-1]; return [...b.children].map(c=>c.dataset.id); });
  ok(after.length===27, 'B 拖后手牌仍 27 张(实 '+after.length+')');
  ok(after.slice().sort().join()===before.slice().sort().join(), 'B 拖后牌集合不变(无增减)');
  ok(botIds.indexOf(draggedId)>=0 && botIds.indexOf(draggedId)<=1, 'B 被拖的牌落到该排头部(实 idx '+botIds.indexOf(draggedId)+')');
  ok(JSON.stringify(after)!==JSON.stringify(before), 'B 顺序确实变了(拖动生效)');

  // ── C: 快按快抬(无长按/无移动) → 点选一张(回归) ──
  await page.evaluate(()=>{ /* 清掉可能的选中 */ const f=document.querySelector('.gd-felt'); });
  const cSel=await page.evaluate((mkSrc)=>{
    const mk=eval(mkSrc);
    const cards=[...document.querySelectorAll('.gd-hand .card')];
    const T=cards[Math.floor(cards.length/2)]; const r=T.getBoundingClientRect();
    const hand=document.querySelector('.gd-hand');
    mk('pointerdown', r.left+2, r.top+r.height/2, hand);
    mk('pointerup',   r.left+2, r.top+r.height/2, hand);   // 立即抬(<300ms, 无移动)
    return { sel:document.querySelectorAll('.gd-hand .card.sel').length, hit:T.classList.contains('sel') };
  }, mk);
  ok(cSel.sel===1 && cSel.hit, 'C 快按快抬 = 点选中那一张(实选 '+cSel.sel+')');

  // ── D: 选一组(3 连张)后长按其一拖动 → 整组 .dragging, 落位后连排 ──
  // 先清选, 再点选下排前 3 张
  const grpRes=await (async()=>{
    await page.evaluate((mkSrc)=>{
      const mk=eval(mkSrc);
      // 点绒面清空
      const felt=document.querySelector('.gd-felt'); if(felt) mk('pointerdown', 5, 5, felt);
    }, mk);
    await page.waitForTimeout(120);
    // 点选下排前 3 张(逐张快按快抬)
    const ids=await page.evaluate((mkSrc)=>{
      const mk=eval(mkSrc);
      const rows=[...document.querySelectorAll('.gd-hand .gd-hand-row')];
      const bot=rows[rows.length-1]; const hand=document.querySelector('.gd-hand');
      const picks=[bot.children[0],bot.children[1],bot.children[2]];
      const got=[];
      for(const c of picks){ const r=c.getBoundingClientRect(); mk('pointerdown', r.left+2, r.top+r.height/2, hand); mk('pointerup', r.left+2, r.top+r.height/2, hand); got.push(c.dataset.id); }
      return got;
    }, mk);
    await page.waitForTimeout(150);
    const selCnt=await selN();
    // 长按第 1 张(仍在选中集里)拿起
    await page.evaluate((mkSrc)=>{
      const mk=eval(mkSrc);
      const sel=[...document.querySelectorAll('.gd-hand .card.sel')][0]; const r=sel.getBoundingClientRect();
      const hand=document.querySelector('.gd-hand');
      mk('pointerdown', r.left+r.width/2, r.top+r.height/2, hand);   // 选中牌撑开空档, 点中心才稳命中
    }, mk);
    await page.waitForTimeout(360);
    const dN=await page.evaluate(()=>document.querySelectorAll('.gd-hand .card.dragging').length);
    // 拖到上排(建/并入上排头部)后松手
    await page.evaluate((mkSrc)=>{
      const mk=eval(mkSrc);
      const rows=[...document.querySelectorAll('.gd-hand .gd-hand-row')];
      const top=rows[0]; const r=top.getBoundingClientRect(); const hand=document.querySelector('.gd-hand');
      mk('pointermove', r.left+4, r.top+r.height/2, hand);
      mk('pointerup',   r.left+4, r.top+r.height/2, hand);
    }, mk);
    await page.waitForTimeout(300);
    const ord=await order();
    // 3 张是否连排(阅读序中位置连续)
    const pos=ids.map(id=>ord.indexOf(id)).sort((a,b)=>a-b);
    const contiguous = pos.every(p=>p>=0) && pos[2]-pos[0]===2;
    return { selCnt, dN, ids, pos, contiguous, total:ord.length };
  })();
  ok(grpRes.selCnt===3, 'D 点选 3 连张(实 '+grpRes.selCnt+')');
  ok(grpRes.dN===3, 'D 长按选中集之一 → 整组 3 张一起拿起(实 '+grpRes.dN+')');
  ok(grpRes.contiguous, 'D 整组落位后连排在一起(位置 '+JSON.stringify(grpRes.pos)+')');
  ok(grpRes.total===27, 'D 组拖后仍 27 张(实 '+grpRes.total+')');

  ok(errs.length===0, '无页面报错'+(errs.length?': '+errs[0]:''));
  console.log('\n'+(fail?('❌ '+fail+' 失败 / '+pass+' 通过'):('🎉 全部通过 ('+pass+'✓)')));
  await browser.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
