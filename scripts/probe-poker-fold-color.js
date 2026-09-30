#!/usr/bin/env node
'use strict';
/* 验证: 德州弃牌后, 自己的底牌【保留花色】只压暗, 不再被整座位 grayscale 洗成灰(主人: 弃了同花也要看得出)。
 *   F1 弃牌后座位本身无 filter(不再对整个子树做 grayscale 编组) → 底牌红黑不被washed。
 *   F2 底牌仍在 DOM、正面朝上、带 red/blk 花色类, card 自身 filter:none, opacity 略压暗(<1)。
 *   F3 "人"(头像/名/筹码)仍灰显, 传达"已弃出局"。
 *   顺带截图 /tmp/pk-fold-color.png 供肉眼核对花色。 */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const NIGHT='--bg:#070a12;--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--line:rgba(0,229,212,0.24);--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--accent:#00E5D4;--amber:#FFC24D;';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const FILES=['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'];

(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.addStyleTag({content:G('table-shared.css')});
  let ok=true; const fail=m=>{ok=false;console.log('❌ '+m);};

  await page.evaluate(()=>{
    const seats=[{seat:0,kind:'human',name:'你',uid:'me'},{seat:1,kind:'soul',name:'狐狸'},{seat:2,kind:'soul',name:'铁头'},{seat:3,kind:'soul',name:'冷面'}];
    window.__pk=window.EHPokerGame.open({
      names:seats.map(s=>s.name), avatars:['🙂','🦊','🤖','😐'], isAI:seats.map(s=>s.kind!=='human'),
      mySeat:0, sb:5, bb:10, startStack:1000, seed:20260915, seats,
    });
  });
  await page.waitForTimeout(150);
  await page.evaluate(()=>window.__pk._foldMe());
  await page.waitForTimeout(120);

  const r=await page.evaluate(()=>{
    const seat=document.querySelector('.pk-seat.pk-me-seat') || document.querySelector('.pk-seat[data-seat="0"]');
    const cards=[...(seat?seat.querySelectorAll('.pk-my-hole .card'):[])];
    const avr=seat&&seat.querySelector('.pk-avr');
    const cs=window.getComputedStyle.bind(window);
    return {
      folded: seat?seat.classList.contains('folded'):false,
      seatFilter: seat?cs(seat).filter:'(无座位)',
      nCards: cards.length,
      cardInfo: cards.map(c=>({ cls:c.className, filter:cs(c).filter, opacity:cs(c).opacity, color:cs(c).color })),
      avrFilter: avr?cs(avr).filter:'(无)',
      avrOpacity: avr?cs(avr).opacity:'(无)',
    };
  });
  console.log('  弃牌后:', JSON.stringify(r,null,1));

  if(!r.folded) fail('座位未标记 folded');
  // F1: 座位本身不再 grayscale 整个子树
  if(/grayscale/.test(r.seatFilter)) fail('F1 座位仍带 grayscale, 会把底牌一起洗灰: '+r.seatFilter);
  else console.log('✅ F1 座位无 grayscale 编组(filter='+r.seatFilter+'), 不再整体洗灰');
  // F2: 底牌在、有花色类、自身 filter none、略压暗
  if(r.nCards!==2) fail('F2 弃牌后底牌数不为2(应保留朝上): '+r.nCards);
  else {
    const bad=r.cardInfo.find(c=>/grayscale/.test(c.filter));
    const noSuit=r.cardInfo.find(c=>!/\b(red|blk)\b/.test(c.cls));
    const notDim=r.cardInfo.find(c=>!(parseFloat(c.opacity)<1));
    if(bad) fail('F2 底牌自身仍带 grayscale: '+JSON.stringify(bad));
    else if(noSuit) fail('F2 底牌缺花色类 red/blk: '+JSON.stringify(noSuit));
    else if(notDim) fail('F2 底牌未压暗(opacity 应<1): '+JSON.stringify(notDim));
    else console.log('✅ F2 底牌保留花色(带 red/blk, filter='+r.cardInfo[0].filter+'), 仅压暗 opacity='+r.cardInfo[0].opacity);
  }
  // F3: 人(头像)仍灰显
  if(/grayscale/.test(r.avrFilter) && parseFloat(r.avrOpacity)<1) console.log('✅ F3 头像仍灰显(filter='+r.avrFilter+', opacity='+r.avrOpacity+'), 传达已弃出局');
  else fail('F3 头像未灰显, "已弃"信号丢失: filter='+r.avrFilter+' opacity='+r.avrOpacity);

  const seatBox=await page.$('.pk-me-seat, .pk-seat[data-seat="0"]');
  if(seatBox) await seatBox.screenshot({path:'/tmp/pk-fold-color.png'});
  console.log('  截图: /tmp/pk-fold-color.png');
  if(errs.length) fail('pageerror: '+errs.join(' | '));
  await browser.close();
  console.log(ok?'\n🎉 全部通过':'\n💥 有失败');
  process.exit(ok?0:1);
})();
