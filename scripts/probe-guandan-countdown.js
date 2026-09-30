#!/usr/bin/env node
'use strict';
// 探针: 验证对手(本机 AI)座位头像倒计时【往下数且不卡在 1】。
// 单机开桌 → 高频采样"当前行动席"的 .gd-sec 文本, 收集每席出现过的秒数序列,
// 断言至少出现过 >1 的值(证明不再恒为 1)且序列非递增(倒数, 非正计时)。
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SFX=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';
const FILES=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','card-counter.js','guandan-ui.js'];
(async()=>{
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  await page.evaluate(()=>{const S=window.EhSfx||{};S.say=()=>{};S.play=()=>{};window.EhSfx=S;window.EhGameBgm={enter:()=>{},exit:()=>{}};});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  const data=await page.evaluate(async()=>{
    const old=document.querySelector('.gd-room'); if(old) old.remove();
    // mySeat=1 且 0/2/3 席为 AI: 保证有 AI 先手/在我之前行动, 才能采到"对手"倒计时
    window.__g=window.EHGuandanGame.open({names:['AI甲','我','AI乙','AI丙'],avatars:['🤖','🙂','👾','🐱'],isAI:[true,false,true,true],mySeat:1});
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    await sleep(700);
    // 采样 6 秒: 记录每个"行动席"的秒数徽标文本轨迹(去连续重复)
    const seq={}; // seat -> [nums]
    for(let i=0;i<120;i++){
      const seatEl=document.querySelector('.gd-seat.turn');
      if(seatEl){
        const seat=seatEl.dataset.seat;
        const t=(seatEl.querySelector('.gd-sec')||{}).textContent||'';
        const n=parseInt(t,10);
        if(!isNaN(n)){ (seq[seat]=seq[seat]||[]); const a=seq[seat]; if(a[a.length-1]!==n) a.push(n); }
      }
      await sleep(50);
    }
    return seq;
  });
  await ctx.close(); await browser.close();
  console.log('各席倒计时轨迹(去连续重复):');
  let sawOpp=false, oppMax=0, monotonic=true;
  Object.keys(data).forEach(seat=>{
    const a=data[seat]; console.log(`  席${seat}: ${a.join(' → ')}`);
    if(seat!=='1' && a.length){ sawOpp=true; oppMax=Math.max(oppMax,...a);   // mySeat=1, 其余席=对手 AI
      for(let i=1;i<a.length;i++){ if(a[i]>a[i-1]) monotonic=false; } }
  });
  const ok = sawOpp && oppMax>=2 && monotonic && errs.length===0;
  console.log(`\n对手(非0席)采到=${sawOpp} 峰值秒=${oppMax}(需≥2, 证明不卡在1) 全程非递增(倒数)=${monotonic} err=${errs.length}`);
  if(errs.length) console.log('  pageerror:', errs.slice(0,3));
  console.log(ok ? '✅ 对手倒计时正常往下数(不再恒为1/正计时)' : '❌ 未通过');
  process.exit(ok?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
