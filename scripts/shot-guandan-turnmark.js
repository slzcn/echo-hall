#!/usr/bin/env node
'use strict';
// 验证牌桌"行动席脉冲 + 刚出/压桌标识": DOM 断言 .turn/.last 与 st 一致, 并出图 /tmp/eh-gd-turnmark.png
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SFX=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const FILES=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','card-counter.js','guandan-ui.js'];
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';
(async()=>{
  if(!chromium){ console.log('no playwright'); process.exit(0); }
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage();
  await page.setContent('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  await page.evaluate(()=>{const S=window.EhSfx||{};S.say=()=>{};S.play=()=>{};window.EhSfx=S;window.EhGameBgm={enter:()=>{},exit:()=>{}};});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  const res=await page.evaluate(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const api=window.EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0});
    await sleep(1200);
    // 驱动到"有人刚出过, 且轮到别家"的双标识态
    for(let i=0;i<50;i++){
      const s=api.state();
      if(s.phase==='play' && s.table.lastPlay && s.turn!==s.table.lastPlay.seat) break;
      if(s.phase==='play' && s.turn===0 && !s.table.lastPlay){
        const h=s.players[0].hand.slice().filter(c=>!c.joker);
        const c=h.sort((a,b)=>(a.rank||0)-(b.rank||0))[0] || s.players[0].hand[0];
        api.applyMove(0,{cards:[c.id]});
      }
      await sleep(140);
    }
    const s=api.state();
    // DOM 实况: 每席的 class
    const seats=[...document.querySelectorAll('.gd-seat[data-seat]')].map(el=>({
      seat:+el.dataset.seat, turn:el.classList.contains('turn'), last:el.classList.contains('last'),
      tags:[...el.querySelectorAll('.gd-tag')].map(t=>t.textContent.trim())
    }));
    return { stTurn:s.turn, stLastSeat: s.table.lastPlay?s.table.lastPlay.seat:null, phase:s.phase, seats };
  });
  await page.locator('#hall').screenshot({path:'/tmp/eh-gd-turnmark.png'});
  await browser.close();
  // 断言
  const domTurn=res.seats.filter(x=>x.turn).map(x=>x.seat);
  const domLast=res.seats.filter(x=>x.last).map(x=>x.seat);
  console.log('phase',res.phase,'| st.turn',res.stTurn,'st.lastSeat',res.stLastSeat);
  console.log('DOM .turn 席',domTurn,'| DOM .last 席',domLast);
  res.seats.forEach(x=>console.log(`  席${x.seat}: turn=${x.turn} last=${x.last} tags=[${x.tags}]`));
  const okTurn = res.phase!=='play' || (domTurn.length===1 && domTurn[0]===res.stTurn);
  const okLast = res.stLastSeat==null ? domLast.length===0 : (domLast.length===1 && domLast[0]===res.stLastSeat);
  console.log(okTurn?'✓ 行动席标识与状态一致':'✗ 行动席标识错位', '|', okLast?'✓ 刚出席标识与状态一致':'✗ 刚出席标识错位');
  console.log('saved /tmp/eh-gd-turnmark.png');
  process.exit(okTurn&&okLast?0:3);
})().catch(e=>{console.error(e);process.exit(2);});
