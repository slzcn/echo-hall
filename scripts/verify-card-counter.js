#!/usr/bin/env node
'use strict';
/**
 * verify-card-counter.js — 记牌器/出牌历史 UI 真浏览器验证(手动跑, 非门禁)。
 *  纯单机(mode 默认 local)开桌 → 点顶栏 🃏 → 校验:
 *   (1) 记牌器钮存在且点开面板可见; (2) 网格恰 15 个 rank 格;
 *   (3) 全副张数守恒(斗地主 Σ=54, 掼蛋 Σ=108, 开局未出牌); (4) 历史区显示空占位;
 *   (5) 再点收起面板隐藏; (6) 全程 0 个 pageerror。
 *  记牌器随出牌【扣减】的正确性由 scripts/test-card-counter.js(31 断言)覆盖, 这里只验 UI 接线。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const SFX = fs.readFileSync(path.join(ROOT, 'js/sfx-engine.js'), 'utf8');
let chromium;
try{ ({chromium}=require('playwright')); }catch(_){ try{({chromium}=require('playwright-core'));}catch(__){} }
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';

const GAMES = {
  ddz: { files:['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','card-counter.js','game-ui.js'],
         open:'EHDdzGame', btn:'#ddzCnt', panel:'#ddzCntPanel', grid:'#ddzCntGrid', hist:'#ddzCntHist',
         names:['我','AI甲','AI乙'], avatars:['🙂','🤖','👾'], isAI:[false,true,true], sum:54 },
  guandan: { files:['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','card-counter.js','guandan-ui.js'],
         open:'EHGuandanGame', btn:'#gdCnt', panel:'#gdCntPanel', grid:'#gdCntGrid', hist:'#gdCntHist',
         names:['我','AI甲','AI乙','AI丙'], avatars:['🙂','🤖','👾','🐱'], isAI:[false,true,true,true], sum:108 },
};

async function fresh(browser, g){
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  await page.evaluate(()=>{ const S=window.EhSfx||{}; S.say=()=>{}; S.play=()=>{};
    window.EhSfx=S; window.EhGameBgm={enter:()=>{},exit:()=>{}}; });
  for(const f of g.files) await page.addScriptTag({content:G(f)});
  return { page, errs };
}

async function runGame(browser, key){
  const g = GAMES[key];
  const { page, errs } = await fresh(browser, g);
  const r = await page.evaluate((g)=>{
    const old=document.querySelector('.gd-room,.ddz-room'); if(old) old.remove();
    window.__g = window[g.open].open({ names:g.names, avatars:g.avatars, isAI:g.isAI, mySeat:0 });
    const sleep=ms=>new Promise(res=>setTimeout(res,ms));
    return (async()=>{
      const btn=document.querySelector(g.btn);
      const btnExists=!!btn;
      if(!btn) return { btnExists };
      btn.click(); await sleep(50);
      const panel=document.querySelector(g.panel);
      const opened = panel && !panel.hidden;
      const cells=[...document.querySelectorAll(g.grid+' .gd-cnt-cell, '+g.grid+' .ddz-cnt-cell')];
      const cellN=cells.length;
      let sum=0; cells.forEach(c=>{ const n=c.querySelector('.cc-n'); sum += n?(+n.textContent||0):0; });
      const histTxt=(document.querySelector(g.hist)||{}).textContent||'';
      // ── 动态: 往 live st.log 注入两手出牌(大王 + 一对3), 重开面板验证扣减 + 历史刷新 ──
      const st = window.__g.state();
      st.log.push({ t:'play', seat:1, cards:['jb'] });        // 大王一张
      st.log.push({ t:'play', seat:2, cards:['s3','h3'] });   // 两张 3
      btn.click(); await sleep(30);                            // 关
      btn.click(); await sleep(50);                            // 再开 → renderCounter 读新 log
      const cells2=[...document.querySelectorAll(g.grid+' .gd-cnt-cell, '+g.grid+' .ddz-cnt-cell')];
      let sum2=0; cells2.forEach(c=>{ const n=c.querySelector('.cc-n'); sum2 += n?(+n.textContent||0):0; });
      const histTxt2=(document.querySelector(g.hist)||{}).textContent||'';
      const histHas = /大王/.test(histTxt2) && /3/.test(histTxt2);
      // 收起
      btn.click(); await sleep(50);
      const closed = panel && panel.hidden;
      return { btnExists, opened, cellN, sum, histEmpty: /还没有人出牌/.test(histTxt), closed, sum2, histHas };
    })();
  }, g);
  await page.context().close();
  const dropOk = r.sum2 === g.sum - 3;   // 大王1 + 3两张 = 出 3 张
  const ok = r.btnExists && r.opened && r.cellN===15 && r.sum===g.sum && r.histEmpty && r.closed
           && dropOk && r.histHas && errs.length===0;
  console.log(`  [${key}] 钮=${r.btnExists} 开=${r.opened} 格数=${r.cellN} Σ张=${r.sum}(期${g.sum}) 历史空=${r.histEmpty} 出3张后Σ=${r.sum2}(期${g.sum-3}) 历史刷新=${r.histHas} 收起=${r.closed} err=${errs.length}`);
  if(errs.length) console.log('    pageerror:', errs.slice(0,3));
  return ok;
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  console.log('记牌器/出牌历史 UI 验证:');
  const a = await runGame(browser, 'ddz');
  const b = await runGame(browser, 'guandan');
  await browser.close();
  const ok = a && b;
  console.log(ok ? '\n✅ 记牌器 UI 接线通过(斗地主+掼蛋)' : '\n❌ 未通过');
  process.exit(ok ? 0 : 1);
})().catch(e=>{ console.error(e); process.exit(1); });
