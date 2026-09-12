#!/usr/bin/env node
'use strict';
/* 两处改动体检:
 *   1) 我方弃牌: 底牌不撤、继续朝上显示, 座位整体灰掉(.folded → opacity+grayscale);
 *   2) 台面 5 张公共牌背面 = 发给玩家那种白纸青花背(非虚线空槽): 有 ::after 青花面板、边框非 dashed。
 * 用法: node scripts/probe-poker-fold-boardback.js  */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SFX=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const FILES=['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'];
let pass=0, fail=0; const ok=(c,m)=>{ if(c)pass++; else{fail++; console.log('  ✗ '+m);} };

(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html data-mode="night"><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  await page.addStyleTag({content:SHARED});
  await page.addScriptTag({content:SFX});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.evaluate(()=>{
    window._G = window.EHPokerGame.open({
      names:['我','阿岩','小凶'], avatars:['🦊','🗿','🔥'],
      isAI:[false,true,true], mySeat:0, mount:document.getElementById('hall'),
      startStack:1000, sb:5, bb:10
    });
  });
  await page.waitForTimeout(800);

  // —— 2) 公共牌背面(翻前 board 为空 → 5 张占位背) ——
  let bb=await page.evaluate(()=>{
    const backs=[...document.querySelectorAll('#pkBoard .card.back')];
    const el=backs[0]; if(!el) return {count:0};
    const cs=getComputedStyle(el); const aft=getComputedStyle(el,'::after');
    return { count:backs.length,
      borderStyle:cs.borderTopStyle,
      hasPanel:(aft.display!=='none' && aft.content!=='none'),
      bg:cs.backgroundImage.slice(0,24) };
  });
  ok(bb.count===5, '翻前台面 5 张公共牌占位背 (实得 '+bb.count+')');
  ok(bb.borderStyle!=='dashed', '公共牌背非虚线空槽 (border '+bb.borderStyle+')');
  ok(bb.hasPanel===true, '公共牌背有青花 ::after 面板(与玩家牌背同)');
  await page.screenshot({path:path.join(ROOT,'scripts','_poker-boardback.png')});

  // —— 1) 我方弃牌: 底牌继续显示 + 座位灰掉 ——
  let before=await page.evaluate(()=> document.querySelectorAll('.pk-me-seat .pk-my-hole .card').length);
  ok(before===2, '弃牌前我的底牌 2 张朝上 (实得 '+before+')');
  await page.evaluate(()=>{ window._G._foldMe(); });
  await page.waitForTimeout(300);
  let after=await page.evaluate(()=>{
    const seat=document.querySelector('.pk-me-seat');
    const cards=seat?seat.querySelectorAll('.pk-my-hole .card').length:0;
    const folded=seat?seat.classList.contains('folded'):false;
    const op=seat?parseFloat(getComputedStyle(seat).opacity):1;
    const gray=seat?getComputedStyle(seat).filter:'';
    return { cards, folded, op, gray };
  });
  ok(after.cards===2, '弃牌后我的底牌仍显示 2 张(不撤) (实得 '+after.cards+')');
  ok(after.folded===true, '我的座位带 .folded 类');
  ok(after.op<1, '座位整体降透明(灰掉) opacity='+after.op);
  ok(/grayscale/.test(after.gray), '座位带 grayscale 滤镜 ('+after.gray+')');
  await page.screenshot({path:path.join(ROOT,'scripts','_poker-fold-me.png')});

  console.log('截图: scripts/_poker-boardback.png, scripts/_poker-fold-me.png');
  console.log(errs.length?('⚠ pageerror: '+errs.slice(0,4).join(' | ')):'(无 pageerror)');
  console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
  await browser.close();
  process.exit(fail||errs.length?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
