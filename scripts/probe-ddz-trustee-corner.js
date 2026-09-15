#!/usr/bin/env node
'use strict';
// probe-ddz-trustee-corner.js — 验证 #4「托管挪到控制角, 图形小按钮」:
//   A. 顶栏存在 #ddzAuto 圆形图标钮(与 mus/rot/x 同款), 内含 svg;
//   B. 出牌条只剩 3 钮(不出/提示/出牌), 不再有 .trustee-tog 文字钮;
//   C. 点 #ddzAuto → trustee 开: 钮体加 .on 高亮, 出牌条收成 .trustee-on "托管中·点此收回";
//   D. 再点收回入口(.trustee-on) → trustee 关: #ddzAuto 去 .on, 出牌条恢复 3 钮。
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
(async()=>{
  if(!chromium){ console.log('⚠ 无 playwright, 跳过'); process.exit(0); }
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}</style><div id="hall"></div>');
  await page.addStyleTag({content:SHARED});
  await page.evaluate(()=>{ window.EhSfx={say:()=>{},play:()=>{}}; window.EhGameBgm={enter:()=>{},exit:()=>{}}; });
  for(const f of ['deck.js','card-counter.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js']) await page.addScriptTag({content:G(f)});
  await page.evaluate(()=>{ window._G=window.EHDdzGame.open({mode:'local',names:['我','机器人甲','机器人乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0,mount:document.getElementById('hall')}); });
  await page.waitForTimeout(700);
  for(let i=0;i<8;i++){
    const done=await page.evaluate(()=>{
      const r=document.querySelector('.ddz-room'); if(r&&r.getAttribute('data-phase')==='play') return true;
      const btns=[...document.querySelectorAll('.ddz-bidbtns .ddz-btn')].filter(b=>!b.disabled);
      if(btns.length) btns[btns.length-1].click();
      return false;
    });
    if(done) break; await page.waitForTimeout(500);
  }
  await page.waitForTimeout(800);

  const A=await page.evaluate(()=>{
    const auto=document.querySelector('#ddzAuto');
    const acts=document.querySelector('.ddz-acts');
    const btns=acts?[...acts.querySelectorAll('.ddz-btn')]:[];
    return {
      autoExists: !!auto,
      autoHasSvg: !!(auto && auto.querySelector('svg')),
      autoRound: auto ? Math.abs(auto.getBoundingClientRect().width-36)<3 : false,
      hasTrusteeTog: btns.some(b=>b.classList.contains('trustee-tog')),
      actCount: btns.length,
      actTexts: btns.map(b=>b.textContent.trim().replace(/\s+/g,'')),
    };
  });

  // C. 点托管
  await page.evaluate(()=>document.querySelector('#ddzAuto').click());
  await page.waitForTimeout(200);
  const C=await page.evaluate(()=>{
    const auto=document.querySelector('#ddzAuto');
    const on=document.querySelector('.ddz-acts .trustee-on');
    return { autoOn: !!(auto&&auto.classList.contains('on')), collapsed: !!on, collapsedText: on?on.textContent.trim():null };
  });

  // D. 收回
  await page.evaluate(()=>{ const b=document.querySelector('.ddz-acts .trustee-on'); if(b) b.click(); });
  await page.waitForTimeout(200);
  const D=await page.evaluate(()=>{
    const auto=document.querySelector('#ddzAuto');
    const btns=[...document.querySelectorAll('.ddz-acts .ddz-btn')];
    return { autoOff: !(auto&&auto.classList.contains('on')), backTo3: btns.length, hasTog: btns.some(b=>b.classList.contains('trustee-tog')) };
  });

  await browser.close();
  const checks=[
    ['A 顶栏有托管图标圆钮', A.autoExists && A.autoHasSvg && A.autoRound, A],
    ['B 出牌条3钮无文字托管', A.actCount===3 && !A.hasTrusteeTog, {actCount:A.actCount,actTexts:A.actTexts,hasTrusteeTog:A.hasTrusteeTog}],
    ['C 点托管→高亮+收成托管中', C.autoOn && C.collapsed, C],
    ['D 收回→去高亮+回3钮', D.autoOff && D.backTo3===3 && !D.hasTog, D],
  ];
  let allPass=true;
  for(const [name,ok,dbg] of checks){ if(!ok) allPass=false; console.log(`  ${ok?'✅':'❌'} ${name}  ${JSON.stringify(dbg)}`); }
  if(errs.length) console.log('  ⚠ pageerror: '+errs.slice(0,3).join(' | '));
  console.log(allPass && !errs.length ? '—— 全部通过' : '—— 有失败');
  process.exit(allPass && !errs.length ? 0 : 1);
})().catch(e=>{console.error(e);process.exit(1);});
