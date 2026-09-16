#!/usr/bin/env node
'use strict';
/* 掼蛋机器人命名规范探针(主人"全都规范一下"): 兜底名「机器人N」→ 花名池, 灵魂/真人名不动, 花名不重名。
 * 用真 Chrome。用法: node scripts/probe-guandan-bot-flowernames.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium }=require('playwright');
const CSSVARS=':root{--accent:#00e5d4;--magenta:#ff2d8e;--amber:#ffc24d;--sub:#86cbc6;--dim:#498d88;--ink:#eaf6ff;--cw:38px;--ch:54px;'
  +'--bg:#070a12;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel:rgba(0,0,0,.2);--panel-solid:#132a29}'
  +'html,body{margin:0;background:#0a0e18;color:#eaf6ff;font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}';
const MODS=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','table-orient.js','guandan-ui.js'];
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
      window._G=window.EHGuandanGame.open({mount:document.getElementById('hall'),seed:1,names:a.names,avatars:a.avatars,isAI:a.isAI,mySeat:0,onResult(){}}); }, {names,avatars,isAI});
    await page.waitForTimeout(800);
  };
  const seatName=async(s)=>page.evaluate((s)=>{ const st=window._G.state(); return st.players[s]?st.players[s].name:'?'; }, s);

  await boot(['你','机器人1','机器人2','机器人3'],['🙂','🤖','🤖','🤖'],[false,true,true,true]);
  const nm=[await seatName(1),await seatName(2),await seatName(3)];
  ok(nm.every(n=>POOL.includes(n)), 'A 三个兜底「机器人N」→ 花名(实:'+nm.join(' / ')+')');
  ok(new Set(nm).size===3, 'C 三个 AI 席花名互不重名');

  await boot(['你','狼姐','机器人2','机器人3'],['🙂','🐺','🤖','🤖'],[false,true,true,true]);
  const b1=await seatName(1);
  ok(b1==='狼姐', 'B 灵魂真名「狼姐」原样保留(实:'+b1+')');
  ok(POOL.includes(await seatName(2)), 'B 同桌兜底名仍规范成花名');

  ok(errs.length===0, '无页面报错'+(errs.length?': '+errs[0]:''));
  console.log('\n'+(fail?('❌ '+fail+' 失败 / '+pass+' 通过'):('🎉 全部通过 ('+pass+'✓)')));
  await browser.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
