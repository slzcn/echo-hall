#!/usr/bin/env node
'use strict';
/* 掼蛋 残局×横竖屏 截图(复现+验证"最后几张牌乱版 + 上一手看不清"):
 *   造"我头游(剩0)→亮队友的牌 + 各席上一手 chip"的残局, 用真渲染路径(applyMove→renderAll)出图。
 * 用真 Chrome。用法: node scripts/shot-gd-orient.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium }=require('playwright');
const CSSVARS=':root{--accent:#00e5d4;--magenta:#ff2d8e;--amber:#ffc24d;--sub:#86cbc6;--dim:#498d88;--ink:#eaf6ff;--cw:38px;--ch:54px;'
  +'--bg:#070a12;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel:rgba(0,0,0,.2);--panel-solid:#132a29}'
  +'html,body{margin:0;background:#0a0e18;color:#eaf6ff;font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}';
const MODS=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','card-counter.js','table-orient.js','guandan-ui.js'];

(async()=>{
  const browser=await chromium.launch({executablePath:CHROME});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+CSSVARS+'</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of MODS) await page.addScriptTag({content:G(f)});
  await page.evaluate(()=>{ window.EhSfx={say:()=>{},play:()=>{}}; window.EhGameBgm={enter:()=>{},exit:()=>{}};
    window._G=window.EHGuandanGame.open({mount:document.getElementById('hall'),seed:11,
      names:['深海狐狸','狼姐·分身','狼姐·分身2','狼姐·分身3'],avatars:['🦊','🐺','🐺','🐺'],isAI:[false,true,true,true],mySeat:0,onResult(){}}); });
  await page.waitForTimeout(900);

  // 造残局: 我(0)头游剩0; 队友(2)剩3张且上一手打了"连对"(真实牌 id, 中央+chip 都读得出); 对手 1/3 少牌。
  //   然后走真渲染: 让当前该动的对手 applyMove(pass) → afterMove→renderAll, 座位/队友天窗/上一手 chip 全刷新。
  const scene = await page.evaluate(()=>{
    const st=window._G.state();
    const ALL = {}; // 从任一手牌反推不到全库, 用连对真实 id(第一副 s/h 花色, deck.js 认得)
    st.phase='play';
    st.players[0].hand=[]; if(!st.finished) st.finished=[]; if(!st.finished.includes(0)) st.finished.push(0);
    // 队友(2)剩 3 张(保留其真实手牌前 3), 上一手用真实连对牌
    st.players[2].hand = st.players[2].hand.slice(0,3);
    st.players[1].hand = st.players[1].hand.slice(0,2);
    st.players[3].hand = st.players[3].hand.slice(0,4);
    const play = ['s5','h5','s6','h6','s7','h7'];   // 5566 77 连对
    st.table.lastPlay = { seat:2, cards:play, parse: (window.EHGuandanRules.parse(play,st.level)||{type:'pairline',size:3}) };
    st.table.passesInRow = 0;
    st.turn = 3;   // 让对手(3)来"不出", 触发一次真渲染
    // 走真路径刷新
    window._G.applyMove(3, {action:'pass'});
    const st2=window._G.state();
    return { turn:st2.turn, phase:st2.phase, lens:st2.players.map(p=>p.hand.length),
      chip: document.querySelector('#hall #gdP2 .gd-lastplay .lp-chip')?.textContent||null,
      peek: !!document.querySelector('#hall #gdP2 .gd-peek'),
      played: [...document.querySelectorAll('#hall .gd-played .card')].length };
  });
  console.log('场景:', JSON.stringify(scene));

  await page.waitForTimeout(200);
  await page.screenshot({path:path.join(ROOT,'scripts/_gd-o-portrait.png')});
  console.log('竖屏 → _gd-o-portrait.png');

  // 横屏: 视口转横 → reflect 挂 .is-land; 再触发一次渲染
  await page.setViewportSize({width:844,height:390});
  await page.evaluate(()=>{ window.dispatchEvent(new Event('resize')); window._G.applyMove(window._G.state().turn, {action:'pass'}); });
  await page.waitForTimeout(200);
  const isLand=await page.evaluate(()=>document.querySelector('.gd-room')?.classList.contains('is-land'));
  console.log('横屏 is-land =', isLand);
  await page.screenshot({path:path.join(ROOT,'scripts/_gd-o-land.png')});
  console.log('横屏 → _gd-o-land.png  errs:', errs.length?errs[0]:'none');
  await browser.close();
})().catch(e=>{ console.error(e); process.exit(1); });
