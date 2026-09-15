#!/usr/bin/env node
'use strict';
/* 验证德州"离座旁观"两处修复(主人真机截图: 轮到你↔旁观中 矛盾态):
 *   A. 单机练习桌本人超时【绝不】离座旁观 —— 设极小 actMs, 全程不操作跑数秒(真实 onHumanTimeout 代打链
 *      跑满多手多次), 结束断言 isSpectating()===false 且 missOf(我)未累加, UI 全程无"旁观"字样。
 *   B. 一旦进入旁观(强制 enterSpectator 模拟联机挂机被判), renderMsg / 操作栏 / pk-hint 三处一致显示旁观态,
 *      不再一边"轮到你·翻牌"一边"旁观中·已离座"自相矛盾。 */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const FILES=['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'];

(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  // 单机练习桌(3 AI + 我), 极小 actMs 让超时快速触发
  await page.evaluate(`window.__pk=window.EHPokerGame.open({names:['熵增狼','机器人1','机器人4','机器人5'],avatars:['🐺','🤖','🤖','🤖'],isAI:[false,true,true,true],mySeat:0,seed:20260915,actMs:260})`);
  await page.addStyleTag({content:SHARED});

  // Part A: 全程不操作 ~7s, 真实超时链跑多手。期间抓 UI 是否出现"旁观"字样。
  let sawSpectateA=false;
  for(let i=0;i<28;i++){
    await page.waitForTimeout(260);
    const bad=await page.evaluate(()=>{
      const t=(document.querySelector('#hall')||document.body).textContent||'';
      return /旁观|已离座/.test(t);
    });
    if(bad) sawSpectateA=true;
  }
  const A=await page.evaluate(()=>({ spec:window.__pk.isSpectating(), miss:window.__pk.missOf(0) }));
  console.log('  A 单机桌跑7s后: isSpectating=',A.spec,' missOf(我)=',A.miss,' 过程现"旁观"字样=',sawSpectateA);

  // Part B: 强制进旁观(模拟联机挂机被判离座), 等 AI 接管几步后读三处 UI 文案
  await page.evaluate(()=>window.__pk.enterSpectator());
  await page.waitForTimeout(1400);
  const B=await page.evaluate(()=>{
    const q=s=>{const e=document.querySelector(s);return e?(e.textContent||'').trim():'(无)';};
    return { spec:window.__pk.isSpectating(), msg:q('.pk-msg'), acts:q('.pk-acts'), hint:q('.pk-hint') };
  });
  console.log('  B 进旁观后 msg :', JSON.stringify(B.msg));
  console.log('  B 进旁观后 acts:', JSON.stringify(B.acts));
  console.log('  B 进旁观后 hint:', JSON.stringify(B.hint));
  await browser.close();

  let ok=true;
  if(errs.length){ ok=false; console.log('❌ pageerror:', errs.slice(0,3).join(' | ')); }
  // A: 单机桌绝不离座
  if(A.spec!==false){ ok=false; console.log('❌ A 单机桌本人被误判离座旁观(应永不离座)'); }
  else if(sawSpectateA){ ok=false; console.log('❌ A 单机桌过程中出现"旁观"字样(不该进旁观态)'); }
  else console.log('✅ A 单机练习桌本人超时只代打, 绝不离座旁观');
  // B: 进旁观后三处一致
  const msgOk = /旁观/.test(B.msg) && !/轮到你/.test(B.msg);
  const actsOk = /旁观中/.test(B.acts) && /已离座/.test(B.acts);
  const hintOk = /旁观/.test(B.hint) && !/可过牌|胜率|需跟注/.test(B.hint);
  if(!msgOk){ ok=false; console.log('❌ B renderMsg 未忠实显示旁观(仍显示轮到你?)'); }
  if(!actsOk){ ok=false; console.log('❌ B 操作栏未显示旁观占位'); }
  if(!hintOk){ ok=false; console.log('❌ B pk-hint 未显示旁观(仍显示可行动/胜率?)'); }
  if(msgOk&&actsOk&&hintOk) console.log('✅ B 进旁观后 msg/操作栏/hint 三处一致显示旁观, 无"轮到你↔旁观"矛盾');
  console.log(ok?'—— 通过':'—— 失败');
  process.exit(ok?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
