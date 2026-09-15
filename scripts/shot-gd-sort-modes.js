#!/usr/bin/env node
'use strict';
// 截掼蛋理牌三态(大小排 / 竖列组牌 / 手动拖排)看现状体验短板。用法: node scripts/shot-gd-sort-modes.js
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const OUT='/tmp/eh-diag'; fs.mkdirSync(OUT,{recursive:true});
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium }=require('playwright');
const CSSVARS=':root{--accent:#00e5d4;--magenta:#ff2d8e;--amber:#ffc24d;--sub:#86cbc6;--dim:#498d88;--ink:#eaf6ff;'
  +'--bg:#070a12;--bg2:#0d1524;--panel:rgba(0,0,0,.2);--panel-solid:#132a29;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);'
  +'--glow-cyan:0 0 12px rgba(0,229,212,.5);--glow-mag:0 0 12px rgba(255,45,142,.6)}'
  +'html,body{margin:0;background:#0a0e18;color:#eaf6ff;font-family:system-ui,"PingFang SC",sans-serif}'
  +'#hall{position:relative;width:100%;height:100vh;overflow:hidden}';
const MODS=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','table-orient.js','guandan-ui.js'];

(async()=>{
  const browser=await chromium.launch({executablePath:CHROME});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+CSSVARS+'</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of MODS) await page.addScriptTag({content:G(f)});
  await page.evaluate(()=>{ window.EhSfx={say:()=>{},play:()=>{}}; window.EhGameBgm={enter:()=>{},exit:()=>{}};
    window.EHGuandanGame.open({mount:document.getElementById('hall'),seed:1,names:['深海狐狸','灵魂下','狼姐','灵魂上'],avatars:['🦊','🔥','🐺','⚡'],onResult(){}}); });
  await page.waitForTimeout(1800);
  const hand=async()=>page.evaluate(()=>{ const h=document.querySelector('.gd-hand'); return h?h.textContent.length:0; });
  console.log('手牌字符量', await hand());
  const clickSort=async()=>{ await page.evaluate(()=>{ const b=document.querySelector('#gdSort'); if(b){ b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1})); b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1})); } }); await page.waitForTimeout(500); };
  const btnTxt=async()=>page.evaluate(()=>{ const b=document.querySelector('#gdSort'); return b?b.textContent.trim():'?'; });

  await page.screenshot({path:path.join(OUT,'gdsort-1-rank.png')});
  console.log('1 大小排  钮=',await btnTxt());
  await clickSort();
  await page.screenshot({path:path.join(OUT,'gdsort-2-combo.png')});
  console.log('2 竖列组牌 钮=',await btnTxt());
  // 组牌态: 点第一个成型组盒 → 看整组选中的上抬冒头效果
  await page.evaluate(()=>{ const box=document.querySelector('.gd-grp:not(.loose)'); const r=box.querySelector('.gd-grp-cards').getBoundingClientRect(); const e=new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'touch',clientX:r.left+r.width/2,clientY:r.top+r.height/2,buttons:1}); document.querySelector('.gd-hand').dispatchEvent(e); });
  await page.waitForTimeout(400);
  await page.screenshot({path:path.join(OUT,'gdsort-2b-combo-sel.png')});
  console.log('2b 组牌·选中整组');
  // 横屏组牌
  await page.evaluate(()=>{ const r=document.querySelector('.gd-room'); if(window.EHTableOrient) window.EHTableOrient.reflect(r); else r.classList.add('is-land'); });
  await ctx.pages()[0].setViewportSize({width:812,height:375});
  await page.waitForTimeout(500);
  await page.screenshot({path:path.join(OUT,'gdsort-2c-combo-land.png')});
  console.log('2c 组牌·横屏');
  await ctx.pages()[0].setViewportSize({width:390,height:844});
  await page.waitForTimeout(300);
  await clickSort();
  await page.screenshot({path:path.join(OUT,'gdsort-3-manual.png')});
  console.log('3 手动拖排 钮=',await btnTxt());

  if(errs.length) console.log('报错:',errs.slice(0,3).join(' | '));
  await browser.close();
  console.log('done →',OUT+'/gdsort-*.png');
})().catch(e=>{console.error(e);process.exit(1);});
