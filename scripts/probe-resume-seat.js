#!/usr/bin/env node
'use strict';
/* 三游戏"离座旁观 → 手动接管恢复"体检(主人诉求"进自动后应可手动取消恢复")。
 * 用 enterSpectator() 直达旁观态(等价多次超时的终态; 掼蛋的真·累计超时路径另见 probe-gd-resume-seat.js),
 * 再验: 旁观态出现可点"接管座位"钮 → 点击 → isSpectating()=false、钮消失、操作区恢复、无报错。
 * 用法: node scripts/probe-resume-seat.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SFX=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium }=require('playwright');
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';
let pass=0,fail=0; const ok=(c,m)=>{ if(c){pass++;console.log('  ✓ '+m);}else{fail++;console.log('  ✗ '+m);} };

const GAMES=[
  { label:'斗地主', mods:['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js'],
    open:()=>{ window.__g=EHDdzGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0}); }, resume:'#ddzResume' },
  { label:'掼蛋', mods:['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','guandan-ui.js'],
    open:()=>{ window.__g=EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0}); }, resume:'#gdResume' },
  { label:'德州', mods:['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'],
    open:()=>{ window.__g=EHPokerGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0}); }, resume:'#pkResume' },
];

(async()=>{
  const browser=await chromium.launch({executablePath:CHROME});
  for(const gm of GAMES){
    console.log('\n── '+gm.label+' ──');
    const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
    await page.setContent('<!doctype html><meta charset=utf-8><style>'+CSS+'</style><div id="hall"></div>');
    await page.addScriptTag({content:SFX});
    await page.evaluate(()=>{ window.EhGameBgm={enter:()=>{},exit:()=>{}}; const S=window.EhSfx||{}; S.say=()=>{}; S.play=()=>{}; window.EhSfx=S; });
    for(const f of gm.mods) await page.addScriptTag({content:G(f)});
    await page.evaluate(gm.open);
    await page.waitForTimeout(700);

    const isSpec=async()=>page.evaluate(()=>window.__g.isSpectating());
    // 进旁观(等价多次超时终态)
    await page.evaluate(()=>window.__g.enterSpectator());
    await page.waitForTimeout(250);
    ok(await isSpec(), '进旁观 isSpectating()=true');

    const btn=await page.evaluate((sel)=>{ const b=document.querySelector(sel); return { exist:!!b, disabled:b?!!b.disabled:true, txt:b?b.textContent.trim():'' }; }, gm.resume);
    ok(btn.exist && !btn.disabled, '旁观态出现可点"接管座位"钮(实:'+btn.txt+')');

    if(btn.exist){
      await page.evaluate((sel)=>{ const b=document.querySelector(sel); b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1})); b.click(); }, gm.resume);
      await page.waitForTimeout(300);
      ok(!(await isSpec()), '点接管 → isSpectating()=false');
      const gone=await page.evaluate((sel)=>!document.querySelector(sel), gm.resume);
      ok(gone, '接管钮消失');
      // 操作区恢复: 旁观占位不再, 至少有一个可见操作/等待条(容器非空)
      const ctrlLive=await page.evaluate(()=>{
        const c=document.querySelector('.ddz-acts,.gd-acts,#pkActs,.pk-acts,[id$="Ctrl"]');
        const anyBtn=document.querySelector('#ddzPlay,#ddzPass,[data-bid],[data-dbl],#gdPlay,#gdPass,#pkFold,#pkCall,.pk-waitbar,[data-pre]');
        return { hasBtn:!!anyBtn };
      });
      ok(ctrlLive.hasBtn, '操作区恢复正常(出牌/下注/等待条回来)');
    }
    ok(errs.length===0,'无页面报错'+(errs.length?': '+errs.slice(0,2).join(' | '):''));
    await ctx.close();
  }
  await browser.close();
  console.log('\n'+(fail?'💥 有失败 ('+pass+'✓ '+fail+'✗)':'🎉 全部通过 ('+pass+'✓)'));
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
