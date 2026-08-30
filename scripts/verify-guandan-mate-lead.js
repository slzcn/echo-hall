#!/usr/bin/env node
'use strict';
// 冒烟验证: 队友当家时操作条引导"不出"且提示禁用(不推荐压/炸队友); 理牌短按恒按大小(无智能组牌分堆)。
// open 内部 state 是闭包, 只能驱动真实对局 + 轮询 DOM 观察。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const OUT = '/tmp/eh-diag'; fs.mkdirSync(OUT, { recursive:true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = require('playwright');
const CSSVARS = ':root{--accent:#00e5d4;--magenta:#ff2d8e;--amber:#ffc24d;--sub:#86cbc6;--dim:#498d88;--ink:#eaf6ff;'
  + '--bg:#070a12;--bg2:#0d1524;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4)}'
  + 'html,body{margin:0;background:#0a0e18;color:#eaf6ff;font-family:system-ui,sans-serif}'
  + '#hall{position:relative;width:100%;height:100vh;overflow:hidden}';
const MODS = ['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','table-orient.js','guandan-ui.js'];

(async()=>{
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><style>'+CSSVARS+'</style><body><div id="hall"></div>', {waitUntil:'load'});
  for (const f of MODS) await page.addScriptTag({ content:G(f) });
  await page.evaluate(()=> window.EHGuandanGame.open({ mount:document.getElementById('hall'),
    names:['深海狐狸','灵魂下','狼姐','灵魂上'], avatars:['🦊','🔥','🐺','⚡'], onResult(){} }));

  // 主动推进对局(玩家回合出最小单张或不出), 加速到达"队友当家轮到我"局面; 命中即截图+记录提示禁用态。
  const seen = new Set(); let mateShot=false, mateSnap=null;
  const t0 = Date.now();
  while (Date.now()-t0 < 80000 && !mateShot){
    const snap = await page.evaluate(()=>{
      const pass=document.getElementById('gdPass'), hint=document.getElementById('gdHint'), play=document.getElementById('gdPlay');
      if(!pass) return null;
      return { pass: pass.textContent.trim(), passPrimary: pass.className.includes('primary'),
               hintDisabled: hint?hint.disabled:null, passDisabled: pass.disabled, playDisabled: play?play.disabled:true };
    });
    if (snap){
      seen.add(snap.pass + (snap.passPrimary?' [primary]':''));
      if (snap.pass.includes('队友当家')){
        mateShot=true; mateSnap=snap;
        await page.screenshot({ path: path.join(OUT,'mate-lead.png') });
        break;
      }
      // 推进: 玩家回合(pass 可点=跟牌 或 play 可点=能出) → 选最后一张牌尝试出单张, 否则不出
      await page.evaluate(()=>{
        const cards=[...document.querySelectorAll('#gdHand .card')];
        const pass=document.getElementById('gdPass'), play=document.getElementById('gdPlay');
        if(cards.length){ cards[cards.length-1].click(); }   // 选最小一张
        setTimeout(()=>{
          const p=document.getElementById('gdPlay');
          if(p && !p.disabled) p.click();
          else if(pass && !pass.disabled) pass.click();
        }, 60);
      });
    }
    await page.waitForTimeout(220);
  }

  // 理牌短按: 连点两次, 都应 toast"按大小", 不再出现"智能组牌"
  const toasts=[];
  page.on('console', m=>{});
  await page.evaluate(()=>{ window.__toasts=[]; });
  // 直接查 toast 文案: 点两下 #gdSort, 抓 .gd-toast
  for (let i=0;i<2;i++){
    await page.evaluate(()=>{ const b=document.getElementById('gdSort'); if(b) b.click(); });
    await page.waitForTimeout(300);
    const tt = await page.evaluate(()=>{ const t=document.querySelector('.gd-toast'); return t?t.textContent.trim():''; });
    toasts.push(tt);
  }
  await page.screenshot({ path: path.join(OUT,'after-tidy.png') });

  console.log('运行时报错:', errs.length? errs.slice(0,3).join(' | ') : '无');
  console.log('操作条出现过的 pass 文案:', [...seen]);
  console.log('捕捉到"队友当家"操作条:', mateShot, mateShot? ('| pass主键='+mateSnap.passPrimary+' 提示禁用='+mateSnap.hintDisabled):'');
  console.log('理牌短按 toast 两次:', toasts, '| 含"智能组牌"?', toasts.some(t=>t.includes('智能组牌')));
  await browser.close();
})();
