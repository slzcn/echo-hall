#!/usr/bin/env node
'use strict';
/* 机器人输光离场 + 手动邀请补位 · 端到端(本机)体检:
 *   1) 3 席(我+2机器人), 让 1 号机器人输光 → 下一手它离场, 台面出"＋点击邀请"空位, 引擎跳过它发牌;
 *   2) 点空位 → 邀请菜单 → "邀请机器人" → 下一手该席补位重新发牌;
 *   3) 把两个机器人都打光 → 通吃结算面板出现"邀请对手继续", 点它补位续打。
 * 用法: node scripts/probe-poker-leave-invite.js  */
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

  // —— 1) 让 1 号机器人输光, 推进一手 → 应离场空缺 ——
  await page.evaluate(()=>{ window._G._bustSeat(1); window._G._nextHand(); });
  await page.waitForTimeout(500);
  let r=await page.evaluate(()=>{
    const g=window._G;
    return { vacant1:g._isVacant(1), stack1:g._stackOf(1),
      tile: !!document.querySelector('.pk-vacant[data-invite="1"]'),
      st: g.state().players[1].sitOut, cards: g.state().players[1].hole.length,
      dealtToMe: g.state().players[0].hole.length };
  });
  ok(r.vacant1===true, '1号机器人已标记离场(vacated)');
  ok(r.stack1===0, '1号席筹码=0(未自动补带)');
  ok(r.tile===true, '台面出现"＋点击邀请"空位 tile');
  ok(r.st===true && r.cards===0, '引擎本手跳过空缺席(sitOut, 不发牌)');
  ok(r.dealtToMe===2, '在座席正常发牌(我 2 张)');

  // —— 2) 点空位 → 邀请菜单 → 邀请机器人 ——
  await page.click('.pk-vacant[data-invite="1"]');
  await page.waitForTimeout(200);
  let menu=await page.evaluate(()=> !!document.querySelector('.pk-invite-menu [data-bot]'));
  ok(menu===true, '邀请菜单弹出且含"邀请机器人"项');
  await page.click('.pk-invite-menu [data-bot]');
  await page.waitForTimeout(300);
  let r2=await page.evaluate(()=>{ const g=window._G; return { vacant1:g._isVacant(1), stack1:g._stackOf(1) }; });
  ok(r2.vacant1===false, '邀请后 1 号席解除空缺');
  ok(r2.stack1===1000, '补位机器人全新买入 1000');
  // 推进一手, 该席应被正常发牌
  await page.evaluate(()=>{ window._G._nextHand(); });
  await page.waitForTimeout(300);
  let r3=await page.evaluate(()=>{ const g=window._G; return { sitOut:g.state().players[1].sitOut, cards:g.state().players[1].hole.length }; });
  ok(r3.sitOut===false && r3.cards===2, '补位机器人下一手正常入座发牌');

  // —— 3) 通吃全场结算面板 → "邀请对手继续" ——
  await page.evaluate(()=>{ window._G._fakeWinAllOver(); });
  await page.waitForTimeout(400);
  let r4=await page.evaluate(()=>{
    return { over: !!document.querySelector('.pk-over'),
      inviteOn: !!document.querySelector('#pkInviteOn') };
  });
  ok(r4.over===true, '出现通吃结算面板');
  ok(r4.inviteOn===true, '通吃面板出现"邀请对手继续"按钮');
  await page.screenshot({path:path.join(ROOT,'scripts','_poker-winall-panel.png')});
  if(r4.inviteOn){
    await page.click('#pkInviteOn');
    await page.waitForTimeout(500);
    let r5=await page.evaluate(()=>{
      const g=window._G; const st=g.state();
      const seated=st.players.filter(p=>!p.sitOut).length;
      return { v1:g._isVacant(1), v2:g._isVacant(2), seated, phase:st.phase };
    });
    ok(r5.v1===false && r5.v2===false, '点"邀请对手继续"→ 空位全部补位');
    ok(r5.seated>=2, '补位后在座≥2, 已续开新一手');
  }

  await page.screenshot({path:path.join(ROOT,'scripts','_poker-leave-invite.png')});
  console.log('截图: scripts/_poker-leave-invite.png');
  console.log(errs.length?('⚠ pageerror: '+errs.slice(0,4).join(' | ')):'(无 pageerror)');
  console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
  await browser.close();
  process.exit(fail||errs.length?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
