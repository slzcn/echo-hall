#!/usr/bin/env node
'use strict';
/* 验证"游戏指令→进招募态牌桌页,不自动开始": ddz/guandan/poker 以 lobby:true 开 →
 * isLobby()===true(招募态未发牌); 调 startDeal() 后 isLobby()===false(手动开始才发牌)。
 * 另断言 app.js 三个入口都落 lobby(不再 gtStart 自动开)。用法: node scripts/probe-lobby-landing.js */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const R=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}

// ── 静态断言: 三个入口都不再 await gtStart, 而是落各自 lobby ──
const APP=R('js/app.js');
function near(anchor, needle, span){ const i=APP.indexOf(anchor); if(i<0) return false; return APP.slice(i, i+span).includes(needle); }
const staticChecks=[
  ['斗地主入口落招募态', near("async function launchDoudizhu", "gtLaunchDdzLobby(row)", 1400) && !near("async function launchDoudizhu", "await gtStart(row.id)", 1400)],
  ['掼蛋入口落招募态',   near("async function launchGuandan", "gtLaunchGuandanLobby(row)", 1600) && !near("async function launchGuandan", "await gtStart(row.id)", 1600)],
  ['德州入口落招募态',   near("async function launchTexas", "gtLaunchPokerLobby(row)", 2200)],
];
let sfail=0;
for(const [n,ok] of staticChecks){ console.log((ok?'✓':'✗')+' '+n); if(!ok) sfail++; }

(async()=>{
  if(!chromium){ console.log('⚠ 无 playwright, 仅跑静态断言'); process.exit(sfail?1:0); }
  const MANIFEST={
    ddz:     ['js/games/ddz-rules.js','js/games/ddz-engine.js','js/games/ddz-ai.js','js/games/ddz-net.js','js/games/card-counter.js','js/games/game-ui.js'],
    guandan: ['js/games/guandan-rules.js','js/games/guandan-engine.js','js/games/guandan-ai.js','js/games/guandan-net.js','js/games/card-counter.js','js/games/guandan-ui.js'],
    poker:   ['js/games/poker-eval.js','js/games/poker-engine.js','js/games/poker-ai.js','js/games/poker-net.js','js/games/poker-ui.js'],
  };
  const GLOBAL={ ddz:'EHDdzGame', guandan:'EHGuandanGame', poker:'EHPokerGame' };
  const SEATS={ ddz:3, guandan:4, poker:6 };
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';
  await page.setContent('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:R('js/sfx-engine.js')});
  await page.evaluate(()=>{const S=window.EhSfx||{};S.say=()=>{};S.play=()=>{};window.EhSfx=S;window.EhGameBgm={enter:()=>{},exit:()=>{}};});
  await page.addScriptTag({content:R('js/games/deck.js')});

  let fail=sfail;
  for(const game of ['ddz','guandan','poker']){
    for(const f of MANIFEST[game]) await page.addScriptTag({content:R(f)});
    const n=SEATS[game];
    const r=await page.evaluate(async(args)=>{
      const {G,n}=args;
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const names=['我']; const avatars=['🙂']; const isAI=[false];
      for(let i=1;i<n;i++){ names.push('席'+i); avatars.push('🤖'); isAI.push(true); }
      const lobbySeats=[{seat:0,kind:'human',uid:'me',name:'我',emoji:'🙂'}];
      for(let i=1;i<n;i++) lobbySeats.push({seat:i,kind:'empty'});
      const g=window[G].open({
        scoreKey:'t', lobby:true, isHost:true, lobbySeats, lobbyCtx:{myUid:'me',actions:{}},
        names,avatars,isAI, mySeat:0, remoteSeats:[], sb:5,bb:10,startStack:1000,
        chat:{post:()=>{}}, onBeat:()=>{}, onSync:()=>{}, onResult:()=>{},
      });
      await sleep(400);
      const inLobbyAtOpen = !!(g.isLobby && g.isLobby());
      // 招募态不应有已发到手的牌(用 .card 计数近似: 招募态牌桌页无手牌)
      const dealtCards = document.querySelectorAll('.card').length;
      let inLobbyAfterStart = inLobbyAtOpen;
      if(g.startDeal){ try{ g.startDeal(); }catch(_){}; await sleep(500); inLobbyAfterStart = !!(g.isLobby && g.isLobby()); }
      try{ g.close && g.close(); }catch(_){}
      return { inLobbyAtOpen, dealtCards, inLobbyAfterStart, hasStartDeal: !!g.startDeal };
    }, {G:GLOBAL[game], n});
    const okOpen = r.inLobbyAtOpen && r.dealtCards===0;
    const okStart = r.hasStartDeal && !r.inLobbyAfterStart;
    console.log(`${(okOpen?'✓':'✗')} ${game}: 开局即招募态(isLobby=${r.inLobbyAtOpen}, 手牌=${r.dealtCards}) · ${(okStart?'✓':'✗')} startDeal 后转正局(isLobby=${r.inLobbyAfterStart})`);
    if(!okOpen||!okStart) fail++;
  }
  if(errs.length) console.log('ERR:', errs.slice(0,4).join(' | '));
  await browser.close();
  console.log(fail? `\n✗ ${fail} 项未过` : '\n✓ 全部通过: 三游戏都落招募态, 手动 startDeal 才发牌');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
