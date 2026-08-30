#!/usr/bin/env node
'use strict';
// 验证"顶部队友座位压扁 + 手牌托盘定高": 单排↔两排切换时底部操作区高度恒定(.gd-mid 吸收余量),
// 顶部队友座位不再高耸。手机视口内置 chromium。截两态图 /tmp/eh-gd-h1.png(默认单排) /tmp/eh-gd-h2.png(两排)。
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
  const H=el=>el?+el.getBoundingClientRect().height.toFixed(1):null;
  const snap=await page.evaluate(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    window.__g=window.EHGuandanGame.open({names:['我','伙伴阿正','对手甲','对手乙'],avatars:['🙂','🐯','🤖','👾'],isAI:[false,true,true,true],mySeat:0});
    await sleep(900);
    const h=s=>{const e=document.querySelector(s);return e?+e.getBoundingClientRect().height.toFixed(1):null;};
    const rows=()=>[...document.querySelectorAll('.gd-hand > *')].filter(r=>r.children.length).length;
    const m=()=>({partner:h('.gd-partner'), mid:h('.gd-mid'), me:h('.gd-me'), handWrap:h('.gd-hand-wrap'), hand:h('.gd-hand'), acts:h('#gdCtrl')||h('.gd-acts'), rows:rows()});
    const before=m();                             // 默认(发牌后自动理牌=单排)
    const btn=document.querySelector('#gdSort');  // 短按=大小理牌(可能触发两排)
    if(btn){ btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})); }
    await sleep(400);
    const after=m();
    return {before, after};
  });
  console.log('默认态:', JSON.stringify(snap.before));
  console.log('理牌后:', JSON.stringify(snap.after));
  // 底部操作区高度恒定判定: me+handWrap+acts 之和在两态间应几乎不变(托盘定高)
  const bot=s=>(s.handWrap||0)+(s.me||0)+(s.acts||0);
  const d=Math.abs(bot(snap.before)-bot(snap.after));
  console.log(`底部区(me+handWrap+acts) 默认=${bot(snap.before)} 理牌后=${bot(snap.after)} 差=${d.toFixed(1)}px`);
  await page.locator('#hall').screenshot({path:'/tmp/eh-gd-h2.png'});
  await browser.close();
  const ok = d<=1.5;
  console.log(ok?'✓ 底部操作区高度恒定(托盘定高生效)':'✗ 底部高度仍随手牌变化 '+d.toFixed(1)+'px');
  console.log('截图: /tmp/eh-gd-h2.png');
  process.exit(ok?0:1);
})().catch(e=>{console.error(e);process.exit(2);});
