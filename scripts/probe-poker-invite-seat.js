#!/usr/bin/env node
'use strict';
/* 验证: 德州"邀请机器人后立即入座"(主人反馈滞后)。
 *   A 招募态(lobby): host 点空位→菜单→邀请机器人 → 座位【立即】显示机器人(非仍"空位")。
 *   A2 名册刷新存活: 邀请后 setLobby(DB名册刷新) → 本地机器人不被抹掉, 仍在座。
 *   A3 撤下回落: 点机器人✕ → 该席回落"空位"。
 *   A4 开局上桌: startDeal(DB名册, 该席在DB仍空) → 机器人正常入座发牌(非被 sitOut)。
 *   B 局中空位(vacated): 对手输光离场后邀请机器人 → 立即显示"下一手入座"占位(非停在"空位")。 */
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
  await page.addStyleTag({content:SHARED});

  const BOT_NAMES=['阿岩','小凶','疯哥','冷面','老练','莽夫','狐狸','铁头'];
  let ok=true; const fail=(m)=>{ ok=false; console.log('❌ '+m); };

  // 招募态 lobby 名册(4 席: 我 + 3 空位)。lobbyCtx.isHost 触发 host 招募视角。
  const openLobby = ()=>page.evaluate(()=>{
    if(window.__pk&&window.__pk.close) try{window.__pk.close();}catch(_){}
    const seats=[{seat:0,kind:'human',name:'你',uid:'me'},{seat:1,kind:'empty'},{seat:2,kind:'empty'},{seat:3,kind:'empty'}];
    const names=seats.map(s=>s.kind==='human'?'你':'机器人'+s.seat);
    const avatars=seats.map(s=>s.kind==='human'?'🙂':'🤖');
    const isAI=seats.map(s=>s.kind!=='human');
    window.__seats=seats;
    window.__pk=window.EHPokerGame.open({
      lobby:true, isHost:true, lobbySeats:seats,
      lobbyCtx:{ isHost:true, souls:[], actions:{ seatSoul(){}, kick(){}, start(){}, inviteHumans(){} } },
      names, avatars, isAI, mySeat:0, sb:5, bb:10, startStack:1000, seed:20260915,
    });
  });
  const seat1=()=>page.evaluate(()=>{
    const el=document.querySelector('.pk-seat[data-seat="1"]'); const p=window.__pk.state().players[1];
    return { cls:el?el.className:'(无)', txt:el?(el.textContent||'').replace(/\s+/g,' ').trim():'',
      kind:p&&p.kind, name:p&&p.name, isAI:p&&p.isAI, empty:!!document.querySelector('.pk-seat[data-seat="1"].pk-lobby-empty') };
  });
  const inviteSeat1=()=>page.evaluate(()=>{
    const emp=document.querySelector('.pk-seat[data-seat="1"] [data-invite], .pk-seat[data-seat="1"].pk-lobby-empty[data-invite]')
      || document.querySelector('.pk-seat[data-seat="1"].pk-lobby-empty');
    const clickTarget=document.querySelector('.pk-seat[data-seat="1"].pk-lobby-empty[data-invite]');
    if(!clickTarget) return {ok:false, why:'座位1非可邀请空位', cls:(document.querySelector('.pk-seat[data-seat="1"]')||{}).className};
    clickTarget.click();
    const bot=document.querySelector('.pk-invite-menu [data-bot]');
    if(!bot) return {ok:false, why:'菜单无邀请机器人项'};
    bot.click(); return {ok:true};
  });

  // ---------- A 招募态邀请立即入座 ----------
  console.log('===== A 招募态: 邀请机器人立即入座 =====');
  await openLobby(); await page.waitForTimeout(200);
  const ci=await inviteSeat1(); if(!ci.ok) fail('A 无法邀请: '+JSON.stringify(ci));
  await page.waitForTimeout(150);
  const a=await seat1(); console.log('  邀请后:', JSON.stringify(a));
  if(a.empty || a.kind!=='bot') fail('A 座位1未立即入座(仍空位/非bot): '+JSON.stringify(a));
  else if(!BOT_NAMES.includes(a.name)) fail('A 机器人名不是花名: '+a.name);
  else console.log('✅ A 邀请后座位1立即显示机器人('+a.name+'), 非"空位"');

  // ---------- A2 setLobby 名册刷新, 机器人存活 ----------
  console.log('===== A2 名册刷新(setLobby)后机器人不被抹掉 =====');
  await page.evaluate(()=>window.__pk.setLobby(window.__seats, { isHost:true, souls:[], actions:{ seatSoul(){}, kick(){}, start(){}, inviteHumans(){} } }));
  await page.waitForTimeout(150);
  const a2=await seat1(); console.log('  刷新后:', JSON.stringify(a2));
  if(a2.empty || a2.kind!=='bot') fail('A2 名册刷新把本地机器人抹掉了: '+JSON.stringify(a2));
  else console.log('✅ A2 setLobby 刷新后机器人仍在座('+a2.name+')');

  // ---------- A3 撤下(点✕)回落空位 ----------
  console.log('===== A3 点✕撤下机器人 → 回落空位 =====');
  const unb=await page.evaluate(()=>{
    const x=document.querySelector('.pk-seat[data-seat="1"] .pk-lob-kick[data-unbot]');
    if(!x) return {ok:false, why:'机器人席无本地撤下✕', has:!!document.querySelector('.pk-seat[data-seat="1"] .pk-lob-kick')};
    x.click(); return {ok:true};
  });
  console.log('  点撤下:', JSON.stringify(unb));
  await page.waitForTimeout(150);
  const a3=await seat1(); console.log('  撤下后:', JSON.stringify(a3));
  if(!unb.ok) fail('A3 找不到撤下按钮: '+JSON.stringify(unb));
  else if(!a3.empty) fail('A3 撤下后座位1未回落空位: '+JSON.stringify(a3));
  else console.log('✅ A3 撤下后座位1回落"空位·点击邀请"');

  // ---------- A4 开局(startDeal DB名册该席仍空)→ 机器人上桌 ----------
  console.log('===== A4 开局后邀请的机器人真上桌发牌 =====');
  await openLobby(); await page.waitForTimeout(150);
  await inviteSeat1(); await page.waitForTimeout(120);
  const preName=(await seat1()).name;
  const a4=await page.evaluate((preName)=>{
    // DB 名册 A: 座位1 在 DB 仍是空 → 兜底成 AI bot(无灵魂/uid), 模拟真实 gtStart(row 无本地机器人)。
    const A={ names:['你','机器人1','机器人2','机器人3'], avatars:['🙂','🤖','🤖','🤖'],
      isAI:[false,true,true,true], ids:[null,null,null,null], souls:[null,null,null,null], remoteSeats:[] };
    window.__pk.startDeal(A, 20260915);
    const p=window.__pk.state().players[1];
    return { phase:window.__pk.state().phase, vacant:window.__pk._isVacant(1),
      name:p&&p.name, isAI:p&&p.isAI, keepName:(p&&p.name)===preName };
  }, preName);
  console.log('  开局后(招募时名='+preName+'):', JSON.stringify(a4));
  if(a4.vacant) fail('A4 开局后座位1被 sitOut(没上桌): '+JSON.stringify(a4));
  else if(!a4.isAI) fail('A4 开局后座位1不是AI: '+JSON.stringify(a4));
  else { console.log('✅ A4 开局后座位1机器人正常入座发牌'+(a4.keepName?'(且沿用招募时花名'+a4.name+')':'(名='+a4.name+')')); }

  // ---------- B 局中空位邀请立即显示"下一手入座" ----------
  console.log('===== B 局中空位: 邀请后立即显示"下一手入座" =====');
  await page.evaluate(()=>{ if(window.__pk&&window.__pk.close) window.__pk.close(); });
  await page.evaluate(()=>{
    window.__pk=window.EHPokerGame.open({names:['你','机器人1','机器人2','机器人3'],avatars:['🙂','🤖','🤖','🤖'],isAI:[false,true,true,true],mySeat:0,seed:20260915,actMs:300});
  });
  await page.waitForTimeout(300);
  await page.evaluate(()=>{ window.__pk._bustSeat(1); window.__pk._nextHand(); });
  await page.waitForTimeout(300);
  const b0=await seat1(); console.log('  离场后:', JSON.stringify({cls:b0.cls,vacant_txt:b0.txt}));
  const cb=await page.evaluate(()=>{
    const v=document.querySelector('.pk-seat[data-seat="1"].pk-vacant[data-invite]');
    if(!v) return {ok:false, why:'座位1非可邀请空位', cls:(document.querySelector('.pk-seat[data-seat="1"]')||{}).className};
    v.click(); const bot=document.querySelector('.pk-invite-menu [data-bot]');
    if(!bot) return {ok:false, why:'菜单无邀请机器人项'}; bot.click(); return {ok:true};
  });
  await page.waitForTimeout(200);
  const b=await seat1(); console.log('  邀请后:', JSON.stringify({cls:b.cls,txt:b.txt}));
  if(!cb.ok) fail('B 无法邀请: '+JSON.stringify(cb));
  else if(/pk-vacant/.test(b.cls) || /空位/.test(b.txt)) fail('B 邀请后座位1仍停在"空位": '+JSON.stringify(b));
  else if(!/下一手入座|入座/.test(b.txt)) fail('B 邀请后座位1未显示入座占位: '+JSON.stringify(b));
  else console.log('✅ B 局中邀请后座位1立即显示"下一手入座"占位(不再停在空位)');

  if(errs.length){ ok=false; console.log('❌ pageerror:', errs.slice(0,4).join(' | ')); }
  await browser.close();
  console.log(ok?'\n—— 通过':'\n—— 失败');
  process.exit(ok?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
