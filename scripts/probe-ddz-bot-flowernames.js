#!/usr/bin/env node
'use strict';
/* 斗地主机器人命名规范探针(主人"机器人命名还不是花名, 全都规范一下")。
 *   A 兜底名「机器人1/机器人2」→ 开局后规范成花名池里的名字(阿岩/狐狸…), 头像同步换掉🤖。
 *   B 灵魂真名 / 真人名不被动(状态忠实): 座位是灵魂花名/真人名的照旧显示。
 *   C 花名不重名(两个 AI 席拿到不同花名)。
 * 用真 Chrome。用法: node scripts/probe-ddz-bot-flowernames.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium }=require('playwright');
const CSSVARS=':root{--accent:#00e5d4;--magenta:#ff2d8e;--amber:#ffc24d;--sub:#86cbc6;--dim:#498d88;--ink:#eaf6ff;--cw:38px;--ch:54px;'
  +'--bg:#070a12;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel:rgba(0,0,0,.2);--panel-solid:#132a29}'
  +'html,body{margin:0;background:#0a0e18;color:#eaf6ff;font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}';
const MODS=['deck.js','card-counter.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js'];
const POOL=['阿岩','小凶','疯哥','冷面','老练','莽夫','狐狸','铁头'];
let pass=0,fail=0; const ok=(c,m)=>{ if(c){pass++;console.log('  ✓ '+m);}else{fail++;console.log('  ✗ '+m);} };

(async()=>{
  const browser=await chromium.launch({executablePath:CHROME});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  const boot=async(names,avatars,isAI)=>{
    await page.setContent('<!doctype html><meta charset=utf-8><style>'+CSSVARS+'</style><body><div id="hall"></div>',{waitUntil:'load'});
    for(const f of MODS) await page.addScriptTag({content:G(f)});
    await page.evaluate((a)=>{ window.EhSfx={say:()=>{},play:()=>{}}; window.EhGameBgm={enter:()=>{},exit:()=>{}};
      window._G=window.EHDdzGame.open({mode:'local',names:a.names,avatars:a.avatars,isAI:a.isAI,mySeat:0,mount:document.getElementById('hall')}); }, {names,avatars,isAI});
    await page.waitForTimeout(600);
  };
  const seatName=async(s)=>page.evaluate((s)=>{ const st=window._G.state(); return st.players[s]?st.players[s].name:'?'; }, s);
  const seatAv=async(s)=>page.evaluate((s)=>{ const el=document.querySelector('.ddz-seat[data-seat="'+s+'"] .av'); return el?el.textContent.trim():'?'; }, s);

  // ── A/C: 两个兜底「机器人N」→ 花名 ──
  await boot(['你','机器人1','机器人2'],['🙂','🤖','🤖'],[false,true,true]);
  const n1=await seatName(1), n2=await seatName(2), a1=await seatAv(1), a2=await seatAv(2);
  ok(POOL.includes(n1) && !/^机器人/.test(n1), 'A 席1「机器人1」→ 花名(实:'+n1+')');
  ok(POOL.includes(n2) && !/^机器人/.test(n2), 'A 席2「机器人2」→ 花名(实:'+n2+')');
  ok(a1!=='🤖' && a1!=='?' , 'A 席1头像换成花名头像(实:'+a1+')');
  ok(a2!=='🤖' && a2!=='?' , 'A 席2头像换成花名头像(实:'+a2+')');
  ok(n1!==n2, 'C 两个 AI 席花名不重名(实:'+n1+' / '+n2+')');

  // ── B: 灵魂花名 + 真人名不动 ──
  await boot(['你','深海狐狸','机器人2'],['🙂','🦊','🤖'],[false,true,true]);
  const b1=await seatName(1), b2=await seatName(2);
  ok(b1==='深海狐狸', 'B 灵魂真名「深海狐狸」原样保留(实:'+b1+')');
  ok(POOL.includes(b2), 'B 同桌兜底名「机器人2」仍规范成花名(实:'+b2+')');

  ok(errs.length===0, '无页面报错'+(errs.length?': '+errs[0]:''));
  console.log('\n'+(fail?('❌ '+fail+' 失败 / '+pass+' 通过'):('🎉 全部通过 ('+pass+'✓)')));
  await browser.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
