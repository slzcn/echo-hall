#!/usr/bin/env node
'use strict';
/* 掼蛋手动重组×提示×组间留缝探针(主人 msg1/msg2):
 * 1) 按牌型态手动拖一张牌 → 触发 rows(手动排); 验证手牌就地识别出成型段并显组间留缝(grp-start);
 * 2) 每个 grp-start 边界都是合法牌型分界(用 Rules.parse 复核);
 * 3) 提示按玩家手动码出的组来推荐(首个提示命中 runGroups 识别出的某个组);
 * 4) 组间留缝更聚拢: 组边界外边距 > 组内外边距。用真 Chrome。
 * 用法: node scripts/probe-guandan-manual-recombine.js */
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
    window._G=window.EHGuandanGame.open({mount:document.getElementById('hall'),seed:7,
      names:['你','机器人1','机器人2','机器人3'],avatars:['🙂','🤖','🤖','🤖'],isAI:[false,true,true,true],mySeat:0,onResult(){}}); });
  await page.waitForTimeout(900);
  await page.evaluate(()=>{ const st=window._G.state(); st.phase='play'; st.turn=0; st.table.lastPlay=null; window._G.state(); });
  // 进入按牌型
  for(let i=0;i<2;i++){ const t=await page.evaluate(()=>document.querySelector('#gdSort')?.textContent||''); if(/按牌型/.test(t)) break; await page.click('#gdSort').catch(()=>{}); await page.waitForTimeout(150); }
  ok(/按牌型/.test(await page.evaluate(()=>document.querySelector('#gdSort')?.textContent||'')), '进入「按牌型」');

  // 真实长按拖动一张牌(下排第 2 张往右挪两格) → 触发手动排 rows
  const drag = await page.evaluate(async ()=>{
    const rows=[...document.querySelectorAll('#hall .gd-hand .gd-hand-row')];
    const bot=rows[rows.length-1]; const cards=[...bot.children];
    if(cards.length<4) return {ok:false};
    const a=cards[1].getBoundingClientRect(), b=cards[3].getBoundingClientRect();
    const hand=document.querySelector('#hall .gd-hand');
    const pe=(t,x,y)=>hand.dispatchEvent(new PointerEvent(t,{pointerId:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));
    pe('pointerdown', a.left+a.width/2, a.top+a.height/2);
    await new Promise(r=>setTimeout(r,360));                       // 过长按阈值 → 拿起拖动
    pe('pointermove', a.left+a.width/2+20, a.top+a.height/2);
    pe('pointermove', b.left+b.width/2, b.top+b.height/2);
    pe('pointerup',   b.left+b.width/2, b.top+b.height/2);
    return {ok:true};
  });
  ok(drag.ok, '模拟长按拖动成功');
  await page.waitForTimeout(250);

  // 读手牌 DOM: 每排的牌 id + grp-start 标记
  const layout = await page.evaluate(()=>{
    const R=window.EHGuandanRules; const st=window._G.state();
    const ALL={}; window.EHDeck.doubleDeck().forEach(c=>ALL[c.id]=c);
    const out=[];
    [...document.querySelectorAll('#hall .gd-hand .gd-hand-row')].forEach(row=>{
      const cards=[...row.children].map(el=>({id:el.dataset.id, grp:el.classList.contains('grp-start'),
        ml:parseFloat(getComputedStyle(el).marginLeft)||0}));
      // 复核: 每个 grp-start 前的连续段(到上一个 grp-start)应是合法牌型 或 单张散牌
      out.push(cards.map(c=>({...c, card:ALL[c.id]})));
    });
    // runGroups 复刻(与 UI 内一致): 贪心最长合法段
    const seg=(cards)=>{ const segs=[]; let i=0; while(i<cards.length){ let best=1;
      for(let len=Math.min(cards.length-i,12); len>=2; len--){ if(R.parse(cards.slice(i,i+len).map(c=>c.card), st.level)){ best=len; break; } }
      segs.push(cards.slice(i,i+best)); i+=best; } return segs; };
    return { rows: out.map(r=>({ ids:r.map(c=>c.id), grpIdx:r.map((c,i)=>c.grp?i:-1).filter(i=>i>=0),
      segStarts: (function(){ const s=seg(r); const starts=[]; let idx=0; s.forEach((g,k)=>{ if(k>0) starts.push(idx); idx+=g.length; }); return starts; })(),
      mls:r.map(c=>c.ml), grp:r.map(c=>c.grp) })) };
  });

  // 手动排后应有 rows(判据: 存在 grp-start, 说明识别出多组)
  const anyGrp = layout.rows.some(r=>r.grpIdx.length>0);
  ok(anyGrp, '手动排(按牌型)后手牌显出组间留缝(grp-start)');
  // grp-start 位置 == runGroups 段边界
  let boundaryMatch=true;
  layout.rows.forEach(r=>{ if(JSON.stringify(r.grpIdx)!==JSON.stringify(r.segStarts)) boundaryMatch=false; });
  ok(boundaryMatch, 'grp-start 边界 == 就地识别的合法牌型分界(每组都是合法牌型)');
  // 组边界外边距 > 组内外边距(更聚拢: 组间撑开、组内叠紧)
  let clustered=true, sawBoth=false;
  layout.rows.forEach(r=>{
    const inMls=[], grpMls=[];
    for(let i=1;i<r.mls.length;i++){ (r.grp[i]?grpMls:inMls).push(r.mls[i]); }
    if(inMls.length && grpMls.length){ sawBoth=true;
      const avgIn=inMls.reduce((a,b)=>a+b,0)/inMls.length, minGrp=Math.min(...grpMls);
      if(!(minGrp>avgIn)) clustered=false; }
  });
  ok(!sawBoth || clustered, '组间外边距 > 组内外边距(成组的牌更聚拢)'+(sawBoth?'':' (本局无可比排, 跳过)'));

  // 提示应按手动码出的组来推荐: 首个提示命中某排的一个 runGroups 段(≥2张且合法)
  await page.click('#gdHint').catch(()=>{});
  await page.waitForTimeout(150);
  const hint = await page.evaluate(()=>{
    const R=window.EHGuandanRules; const st=window._G.state();
    const ALL={}; window.EHDeck.doubleDeck().forEach(c=>ALL[c.id]=c);
    const sel=[...document.querySelectorAll('#hall .gd-hand .card.sel')].map(el=>el.dataset.id);
    const segsByRow=[...document.querySelectorAll('#hall .gd-hand .gd-hand-row')].map(row=>{
      const cards=[...row.children].map(el=>ALL[el.dataset.id]);
      const segs=[]; let i=0; while(i<cards.length){ let best=1;
        for(let len=Math.min(cards.length-i,12); len>=2; len--){ if(R.parse(cards.slice(i,i+len), st.level)){ best=len; break; } }
        segs.push(cards.slice(i,i+best).map(c=>c.id)); i+=best; } return segs;
    });
    const allSegs=[].concat(...segsByRow).filter(s=>s.length>=2);
    const k=a=>a.slice().sort().join(',');
    return { sel, hitSeg: allSegs.some(s=>k(s)===k(sel)), n: sel.length };
  });
  ok(hint.n>=2 && hint.hitSeg, '首个提示命中玩家手动码出的成型组(实:'+hint.n+'张, 命中='+hint.hitSeg+')');

  ok(errs.length===0, '无页面报错'+(errs.length?': '+errs[0]:''));
  console.log('\n'+(fail?('❌ '+fail+' 失败 / '+pass+' 通过'):('🎉 全部通过 ('+pass+'✓)')));
  await browser.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
