#!/usr/bin/env node
'use strict';
/**
 * journey-game-audio.js — 20260824-game-audio 旅程冒烟:
 *  单机 AI 模式开斗地主/掼蛋/德州, 让 AI 自动叫牌/出牌数秒, 专压本次新增的语音路径
 *  (sayPlay 全牌型 + sayOp 操作语音 + 德州 afterAction + 掼蛋进贡) 与 EhGameBgm 进/出桌守卫,
 *  断言零 pageerror。EhGameBgm 用桩替身记录 enter/exit 是否被调用。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const SFX = fs.readFileSync(path.join(ROOT, 'js/sfx-engine.js'), 'utf8');

let step=0, failed=false;
function assert(ok, msg){ step++; if(!ok){ failed=true; console.error(`✗ [${step}] ${msg}`); } else console.log(`✓ [${step}] ${msg}`); }

function findChrome(){
  const cands=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean);
  return cands.find(p=>{ try{return fs.existsSync(p);}catch(_){return false;} });
}
let chromium;
try{ ({chromium}=require('playwright')); }catch(_){ try{({chromium}=require('playwright-core'));}catch(__){} }
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';

async function newHall(browser, files){
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  // EhGameBgm 桩: 记录进/出桌调用(app.js 不在本 harness, 用替身验证游戏侧确有挂钩)
  await page.evaluate(()=>{ window.__bgm={enter:[],exit:0}; window.EhGameBgm={ enter:k=>window.__bgm.enter.push(k), exit:()=>window.__bgm.exit++ }; });
  for(const f of files) await page.addScriptTag({content:G(f)});
  return {ctx,page,errs};
}

async function trip(browser, label, files, openExpr, kind){
  const {ctx,page,errs}=await newHall(browser, files);
  await page.evaluate(openExpr);
  await page.waitForTimeout(3500);   // 让 AI 叫牌/出牌自动跑几手, 触发 sayPlay/sayOp
  const bgm=await page.evaluate(()=>window.__bgm);
  assert(bgm.enter[0]===kind, `${label}: 进桌调用 EhGameBgm.enter('${kind}')`);
  await page.evaluate(()=>{ try{ window.__g && window.__g.close && window.__g.close(); }catch(_){} });
  await page.waitForTimeout(150);
  const bgm2=await page.evaluate(()=>window.__bgm);
  assert(bgm2.exit>=1, `${label}: 离桌调用 EhGameBgm.exit()`);
  assert(errs.length===0, `${label}: AI 自动对局零 pageerror` + (errs.length?(' → '+errs[0]):''));
  await ctx.close();
}

(async()=>{
  if(!chromium){ console.error('playwright 不可用'); process.exit(2); }
  const exe=findChrome();
  const browser=await chromium.launch({ headless:true, ...(exe?{executablePath:exe}:{}) });
  try{
    await trip(browser,'斗地主',['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js'],
      ()=>{ window.__g=EHDdzGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0}); }, 'ddz');
    await trip(browser,'掼蛋',['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','guandan-ui.js'],
      ()=>{ window.__g=EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0}); }, 'guandan');
    await trip(browser,'德州',['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'],
      ()=>{ window.__g=EHPokerGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0}); }, 'poker');
  }catch(e){ console.error('harness 异常', e); failed=true; }
  await browser.close();
  console.log(failed?'\n❌ 冒烟未通过':'\n✅ 冒烟通过: 三游戏语音路径 + BGM 进出桌钩子无异常');
  process.exit(failed?1:0);
})();
