#!/usr/bin/env node
'use strict';
/* 验证 issue 1c: 轮到我且可免费过牌时, 弃牌钮仍可点(非 disabled)。
 * 开局后等到我的回合, 读 #pkFold 的 disabled 态 + 截图动作栏。 */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const SHOT='/tmp/eh-lobby'; fs.mkdirSync(SHOT,{recursive:true});
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const FILES=['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'];

(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"PingFang SC",sans-serif}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  // 只有一个 AI 对手 + 深筹码, 我(SB/button)翻牌前先行动; 我跟注→翻牌后大概率过牌到我, 便于抓 canCheck 态
  await page.evaluate(`window.EHPokerGame.open({names:['我','AI甲'],avatars:['🙂','🤖'],isAI:[false,true],mySeat:0,seed:20260909})`);
  await page.addStyleTag({content:SHARED});
  // 轮询: 出现我的回合动作栏(含 #pkFold 且非 lobby 骨架)就停; 若可过牌则我先 check 推进到翻牌再抓
  let found=null;
  for(let i=0;i<60;i++){
    const info=await page.evaluate(()=>{
      const fold=document.querySelector('#pkFold'), call=document.querySelector('#pkCall');
      if(!fold||!call || fold.hasAttribute('disabled')&&call.hasAttribute('disabled')) return null;
      return { foldDisabled: fold.hasAttribute('disabled'),
               callTxt: (call.textContent||'').trim(),
               canCheck: /过牌/.test(call.textContent||'') };
    });
    if(info){
      found=info;
      if(info.canCheck) break;               // 抓到"可免费过牌"态: 正是要验的场景
      // 还需跟注: 点跟注推进到下一街, 翻牌后大概率过牌到我
      try{ await page.locator('#pkCall').click({timeout:800}); }catch(_){}
    }
    await page.waitForTimeout(450);
  }
  console.log('  探测结果:', JSON.stringify(found));
  await page.screenshot({path:path.join(SHOT,'probe-fold.png')});
  console.log('  📸 '+path.join(SHOT,'probe-fold.png')+(errs.length?'  ⚠ '+errs.slice(0,2).join(' | '):''));
  await browser.close();
  if(found && found.canCheck && found.foldDisabled){ console.log('❌ 可过牌时弃牌钮仍被禁用'); process.exit(1); }
  if(found && !found.foldDisabled){ console.log('✅ 弃牌钮可点'+(found.canCheck?'(且当前可免费过牌)':'')); }
})().catch(e=>{console.error(e);process.exit(1);});
