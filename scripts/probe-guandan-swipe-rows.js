#!/usr/bin/env node
'use strict';
/* #4 滑动选牌行内约束体检: 手指从【下排】划到【上排】只精确选中掠过的牌, 不再回填两排间整段 idx。
 * 对比旧逻辑(全局 idx 区间回填)会把两排之间阅读序上所有牌一股脑选上。
 * 用法: node scripts/probe-guandan-swipe-rows.js */
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
  await page.waitForTimeout(1400);

  // 强制进入出牌阶段的两排非组牌视图: 关组牌(sortMode!=combo)确保走 top/bot 两排布局
  const setup=await page.evaluate(()=>{
    // 找到 gd-hand-row(两排布局)。若当前是组牌列视图, 点理牌钮切非组牌。
    const hand=document.querySelector('.gd-hand');
    return { rows:document.querySelectorAll('.gd-hand-row').length, combo: hand?hand.classList.contains('combo'):null, phase:document.querySelector('.gd-room').getAttribute('data-phase') };
  });

  // 采两排各自的卡: 下排(bot)取靠右一张, 上排(top)取靠左一张, 模拟从下排划到上排
  const geo=await page.evaluate(()=>{
    const top=document.querySelector('.gd-hand-row.top');
    const bot=document.querySelector('.gd-hand-row.bot');
    if(!top||!bot) return {two:false};
    const topCards=[...top.querySelectorAll('.card')];
    const botCards=[...bot.querySelectorAll('.card')];
    if(topCards.length<2||botCards.length<2) return {two:false, tN:topCards.length, bN:botCards.length};
    const ctr=el=>{const b=el.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2,idx:+el.dataset.idx,id:el.dataset.id};};
    // 下排起点(靠右), 上排终点(靠左) → 全局 idx 跨度大, 旧逻辑会误选一整段
    const start=ctr(botCards[botCards.length-1]);
    const end=ctr(topCards[0]);
    return {two:true, start, end, tN:topCards.length, bN:botCards.length, totalCards:document.querySelectorAll('.gd-hand .card').length};
  });
  ok(geo.two, '手牌为两排布局(top/bot)且各≥2张 ('+(geo.tN||0)+'上/'+(geo.bN||0)+'下)');

  if(geo.two){
    // 模拟一次跨排划选: down 在下排右, move 到上排左, up
    await page.evaluate(({start,end})=>{
      const hand=document.querySelector('.gd-hand');
      const mk=(type,x,y)=>new PointerEvent(type,{bubbles:true,cancelable:true,composed:true,pointerId:1,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerup'?0:1});
      hand.dispatchEvent(mk('pointerdown',start.x,start.y));
      // 沿直线插几帧, 中途会扫过两排之间的空档
      for(let t=1;t<=6;t++){ const x=start.x+(end.x-start.x)*t/6, y=start.y+(end.y-start.y)*t/6; hand.dispatchEvent(mk('pointermove',x,y)); }
      hand.dispatchEvent(mk('pointerup',end.x,end.y));
    }, geo);
    await page.waitForTimeout(200);

    const sel=await page.evaluate(()=>{
      const cards=[...document.querySelectorAll('.gd-hand .card')];
      const selEls=cards.filter(c=>c.classList.contains('sel'));
      return { n:selEls.length, idxs:selEls.map(c=>+c.dataset.idx).sort((a,b)=>a-b), total:cards.length };
    });
    // 跨排划选应只精确选中掠过的少数牌(起点+终点+沿途同排掠过的), 远小于"两排间整段 idx"
    const spanIfBuggy = Math.abs(geo.start.idx - geo.end.idx) + 1;   // 旧逻辑会选这么多
    ok(sel.n < spanIfBuggy, `跨排划选未回填整段 (选中 ${sel.n} 张 < 旧逻辑整段 ${spanIfBuggy} 张)`);
    // 关键证据: 选中 idx 里存在【空档】(手指没掠过的中间段未被回填) → 证明两排边界没被跨过回填。
    //   旧逻辑会把 start..end 连成一整段实心区间, 没有任何空档。
    let hasGap=false; for(let i=1;i<sel.idxs.length;i++){ if(sel.idxs[i]-sel.idxs[i-1] > 1){ hasGap=true; break; } }
    ok(hasGap, `选中 idx 存在空档=未跨排回填 (idx=[${sel.idxs.join(',')}])`);
    ok(sel.idxs.includes(geo.start.idx) && sel.idxs.includes(geo.end.idx), '起点(下排)与终点(上排)两张均被选中');
    console.log(`  · 起点 idx=${geo.start.idx} 终点 idx=${geo.end.idx}, 总牌 ${sel.total} 张, 实选 ${sel.n} 张`);
  }

  if(errs.length) ok(false,'pageerror: '+errs.slice(0,3).join(' | '));
  console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
  await browser.close();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
