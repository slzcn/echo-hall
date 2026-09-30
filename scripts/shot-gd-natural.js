#!/usr/bin/env node
'use strict';
/* 掼蛋 自然对局中局截图: 真跑几手(我点提示出牌, AI 自走), 停在"有人打出一手"时截图,
 * 看座位"上一手 chip"在真实版面里是否可读、不乱版。不推到终局(避开 showOver)。
 * 用真 Chrome。用法: node scripts/shot-gd-natural.js */
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
    window._G=window.EHGuandanGame.open({mount:document.getElementById('hall'),seed:7,
      names:['深海狐狸','狼姐·分身','狼姐·分身2','狼姐·分身3'],avatars:['🦊','🐺','🐺','🐺'],isAI:[false,true,true,true],mySeat:0,onResult(){}}); });
  await page.waitForTimeout(1000);

  // 真跑: 我的回合点提示→出牌(否则不出); AI 回合等它自走。跑到有 ≥2 席各出过一手就停(chip 铺开)。
  for(let i=0;i<40;i++){
    const s = await page.evaluate(()=>{ const st=window._G.state();
      return { phase:st.phase, turn:st.turn, fin:(st.finished||[]).length,
        acts: [...document.querySelectorAll('#hall .gd-seat .gd-lastplay .lp-chip')].length }; });
    if (s.phase!=='play') break;
    if (s.fin>0) break;               // 有人出完就停, 别逼近终局
    if (s.acts>=2 && i>6) break;      // 至少两席已有上一手 chip
    if (s.turn===0){
      await page.click('#gdHint').catch(()=>{}); await page.waitForTimeout(80);
      await page.evaluate(()=>{ const sel=[...document.querySelectorAll('#hall .gd-hand .card.sel')];
        const btns=[...document.querySelectorAll('#hall button,#hall .gd-btn')];
        if(sel.length){ const p=btns.find(b=>/出牌/.test(b.textContent)); if(p)p.click(); }
        else { const p=btns.find(b=>/不出|过/.test(b.textContent)); if(p)p.click(); } });
      await page.waitForTimeout(150);
    } else { await page.waitForTimeout(350); }
  }
  const info = await page.evaluate(()=>({
    chips: [...document.querySelectorAll('#hall .gd-seat .gd-lastplay .lp-chip')].map(c=>c.textContent),
    lens: window._G.state().players.map(p=>p.hand.length) }));
  console.log('中局:', JSON.stringify(info));
  await page.waitForTimeout(200);
  await page.screenshot({path:path.join(ROOT,'scripts/_gd-nat-portrait.png')});
  console.log('竖屏 → _gd-nat-portrait.png  errs:', errs.length?errs[0]:'none');
  await browser.close();
})().catch(e=>{ console.error(e); process.exit(1); });
