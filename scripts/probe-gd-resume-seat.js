#!/usr/bin/env node
'use strict';
/* 掼蛋"多次超时进自动托管 → 手动接管恢复"体检(主人诉求)。
 *   T0 连续超时到 MAX_MISS(=3, 用 actMs 压到 200ms 快速触发) → 本席离座旁观, isSpectating()=true。
 *   T1 旁观态操作区出现可点的"🙋 我回来了 · 接管座位"钮(#gdResume), 不再是禁用的旁观占位。
 *   T2 点该钮 → isSpectating()=false; 操作区恢复正常(出牌/提示钮回来, #gdResume 消失)。
 *   T3 接管瞬间 AI 不抢先代打: 若正轮到我, 短等后我手牌张数不减(托管 aiTimer 已被清)。
 * 用真 Chrome。用法: node scripts/probe-gd-resume-seat.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium }=require('playwright');
const CSSVARS=':root{--accent:#00e5d4;--magenta:#ff2d8e;--amber:#ffc24d;--sub:#86cbc6;--dim:#498d88;--ink:#eaf6ff;--cw:38px;--ch:54px;'
  +'--bg:#070a12;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel:rgba(0,0,0,.2);--panel-solid:#132a29}'
  +'html,body{margin:0;background:#0a0e18;color:#eaf6ff;font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}';
const MODS=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','table-orient.js','guandan-ui.js'];
let pass=0,fail=0; const ok=(c,m)=>{ if(c){pass++;console.log('  ✓ '+m);}else{fail++;console.log('  ✗ '+m);} };

(async()=>{
  const browser=await chromium.launch({executablePath:CHROME});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><style>'+CSSVARS+'</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of MODS) await page.addScriptTag({content:G(f)});
  await page.evaluate(()=>{ window.EhSfx={say:()=>{},play:()=>{}}; window.EhGameBgm={enter:()=>{},exit:()=>{}};
    // actMs=200: 我方思考死线压到 200ms, 便于快速累计超时; maxMiss=3 默认。
    window.__gd = window.EHGuandanGame.open({mount:document.getElementById('hall'),seed:1,actMs:200,
      names:['深海狐狸','灵魂下','狼姐','灵魂上'],avatars:['🦊','🔥','🐺','⚡'],onResult(){}}); });
  await page.waitForTimeout(1600);

  const isSpec=async()=>page.evaluate(()=>window.__gd.isSpectating());
  const missOf=async(s)=>page.evaluate((s)=>window.__gd.missOf(s), s);
  const mySeat=await page.evaluate(()=>window.__gd.mySeat());
  const turn=async()=>page.evaluate(()=>{ const st=window.__gd.state(); return st?st.turn:-1; });
  const myHandN=async()=>page.evaluate((ms)=>{ const st=window.__gd.state(); return st&&st.players[ms]?st.players[ms].hand.length:-1; }, mySeat);

  // T0: 每逢轮到我就强制超时, 直到 spectating(真走 onHumanTimeout→bumpMiss→idleOut 累计路径)
  let spun=0;
  while(!(await isSpec()) && spun<400){
    if ((await turn())===mySeat){ await page.evaluate(()=>window.__gd._forceTimeout()); await page.waitForTimeout(60); }
    else await page.waitForTimeout(80);
    spun++;
  }
  ok(await isSpec(), '连续超时累计 → 已离座旁观 isSpectating()=true (miss='+await missOf(mySeat)+')');

  // T1: 旁观态操作区有可点的接管钮
  const t1=await page.evaluate(()=>{ const b=document.querySelector('#gdResume'); return { exist:!!b, disabled:b?b.disabled:true, txt:b?b.textContent.trim():'' }; });
  ok(t1.exist && !t1.disabled, '旁观态出现可点"接管座位"钮(实:'+t1.txt+')');

  // T2: 点接管钮 → 恢复
  await page.evaluate(()=>{ const b=document.querySelector('#gdResume'); b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1})); b.click(); });
  await page.waitForTimeout(200);
  ok(!(await isSpec()), '点接管 → isSpectating()=false');
  const t2=await page.evaluate(()=>({ resumeGone: !document.querySelector('#gdResume'),
    hasPlay: !!document.querySelector('#gdPlay') || !!document.querySelector('#gdPass') }));
  ok(t2.resumeGone, '接管钮消失');
  ok(t2.hasPlay, '操作区恢复正常(出牌/不出钮回来)');

  // T3: 接管瞬间 AI 不抢先代打 —— 记录手牌张数, 短等确认不减
  const n0=await myHandN();
  await page.waitForTimeout(500);
  const n1=await myHandN();
  ok(n1>=n0, '接管后 AI 未抢先代打(手牌 '+n0+'→'+n1+' 未减)');

  ok(errs.length===0,'无页面报错'+(errs.length?': '+errs.slice(0,2).join(' | '):''));
  await browser.close();
  console.log('\n'+(fail?'💥 有失败 ('+pass+'✓ '+fail+'✗)':'🎉 全部通过 ('+pass+'✓)'));
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
