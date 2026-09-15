#!/usr/bin/env node
'use strict';
/* 验证: 德州招募态"路人不定时入座"(主人: 空位在不手动邀请时可随机来新玩家, 不必补满, 看牌桌情况)。
 *   W1 目标人数随机落在 [2,n], 开桌即定(不是恒满)。
 *   W2 路人只补到目标人数就停: occupied 收敛到 target, 从不超过 target、更不超过 n。
 *   W3 来的是真机器人(kind='bot' + 花名), 复用邀请路径(可被 host ✕ 请离)。
 *   W4 非 host 招募态不来人(路人入座是 host 桌的招待, 别乱补别人的桌)。
 *   用测试钩子 _walkInTick/_setWalkInTarget 做确定性断言(绕开 5~14s 真随机定时)。 */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const NIGHT='--bg:#070a12;--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--line:rgba(0,229,212,0.24);--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--accent:#00E5D4;--amber:#FFC24D;';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const FILES=['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'];
const BOT_NAMES=['阿岩','小凶','疯哥','冷面','老练','莽夫','狐狸','铁头'];

(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.addStyleTag({content:G('table-shared.css')});
  let ok=true; const fail=m=>{ok=false;console.log('❌ '+m);};

  const openLobby=(isHost)=>page.evaluate((isHost)=>{
    if(window.__pk&&window.__pk.close) try{window.__pk.close();}catch(_){}
    const seats=[{seat:0,kind:'human',name:'你',uid:'me'}];
    for(let i=1;i<6;i++) seats.push({seat:i,kind:'empty'});
    window.__pk=window.EHPokerGame.open({
      lobby:true, isHost, lobbySeats:seats,
      lobbyCtx:{ isHost, souls:[], actions:{ seatSoul(){}, kick(){}, start(){}, inviteHumans(){} } },
      names:seats.map(s=>s.kind==='human'?'你':'机器人'+s.seat), avatars:seats.map(s=>s.kind==='human'?'🙂':'🤖'),
      isAI:seats.map(s=>s.kind!=='human'), mySeat:0, sb:5, bb:10, startStack:1000, seed:20260915,
    });
  }, isHost);

  // ---------- W1 目标随机 [2,n] ----------
  console.log('===== W1 目标人数随机落在 [2,n] =====');
  const targets=[];
  for(let k=0;k<8;k++){ await openLobby(true); await page.waitForTimeout(60); const s=await page.evaluate(()=>window.__pk._walkInState()); targets.push(s.target); }
  console.log('  8 次开桌目标:', JSON.stringify(targets), '(n=6)');
  const badT=targets.find(t=>!(t>=2 && t<=6));
  if(badT!==undefined) fail('W1 目标越界(应 2..6): '+badT);
  else if(targets.every(t=>t===6)) fail('W1 目标恒为满(6), 未体现"不必补满"随机');
  else console.log('✅ W1 目标随机在 [2,6], 非恒满(体现"不是每次都补满")');

  // ---------- W2 + W3 收敛到目标, 来的是机器人 ----------
  console.log('===== W2/W3 路人补到目标就停, 来的是机器人 =====');
  await openLobby(true); await page.waitForTimeout(60);
  await page.evaluate(()=>window.__pk._setWalkInTarget(4));   // 固定目标=4
  let maxOcc=0, over=false;
  for(let i=0;i<80;i++){
    await page.evaluate(()=>window.__pk._walkInTick());
    const s=await page.evaluate(()=>window.__pk._walkInState());
    maxOcc=Math.max(maxOcc,s.occupied);
    if(s.occupied>4 || s.occupied>s.n){ over=true; }
  }
  const fin=await page.evaluate(()=>{
    const st=window.__pk.state();
    const bots=st.players.filter(p=>p.kind==='bot');
    return { occupied:window.__pk._walkInState().occupied, bots:bots.map(b=>({seat:b.seat,name:b.name,kind:b.kind})) };
  });
  console.log('  收敛后:', JSON.stringify(fin), 'maxOcc=',maxOcc);
  if(over) fail('W2 occupied 超过目标/超过 n(补过头了)');
  else if(fin.occupied!==4) fail('W2 未收敛到目标 4: '+fin.occupied);
  else console.log('✅ W2 路人补到目标 4 即停, 从不超目标/超席');
  const botsN=fin.bots.length;   // 目标4 = 我(1) + 路人3
  if(botsN!==3) fail('W3 路人机器人数不对(应 3): '+botsN);
  else if(fin.bots.some(b=>!BOT_NAMES.includes(b.name))) fail('W3 路人名非花名: '+JSON.stringify(fin.bots));
  else console.log('✅ W3 来的是 3 个机器人(花名: '+fin.bots.map(b=>b.name).join('/')+')');

  // ---------- W4 非 host 不来人 ----------
  console.log('===== W4 非 host 招募态不来人 =====');
  await openLobby(false); await page.waitForTimeout(60);
  const before=await page.evaluate(()=>window.__pk._walkInState());
  await page.evaluate(()=>{ window.__pk._setWalkInTarget(6); for(let i=0;i<30;i++) window.__pk._walkInTick(); });
  const after=await page.evaluate(()=>window.__pk._walkInState());
  console.log('  非host 前/后 occupied:', before.occupied, '→', after.occupied);
  if(after.occupied!==before.occupied) fail('W4 非 host 竟自动来人了: '+before.occupied+'→'+after.occupied);
  else console.log('✅ W4 非 host 招募态不自动来人');

  if(errs.length) fail('pageerror: '+errs.join(' | '));
  await browser.close();
  console.log(ok?'\n🎉 全部通过':'\n💥 有失败');
  process.exit(ok?0:1);
})();
