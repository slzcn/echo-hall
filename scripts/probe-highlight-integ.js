#!/usr/bin/env node
'use strict';
/* 批3集成验证: 在【真实装配页】里开三局, 拿到各自绒面(els.felt), 调 EHTableFx.celebrate,
 * 确认 window.EHTableFx 已就位、彩带/横幅节点真挂进绒面、且全程零 pageerror。
 * 用法: node scripts/probe-highlight-integ.js */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const FX = fs.readFileSync(path.join(ROOT, 'js/games/table-fx.js'), 'utf8');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('playwright-core')); }
const EXE = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));

const GAMES = {
  ddz:     { files:['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js'],
             open:`window.EHDdzGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0})`,
             wait:'.ddz-hand .card', felt:'.ddz-felt' },
  guandan: { files:['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','guandan-ui.js'],
             open:`window.EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0})`,
             wait:'.gd-hand .card', felt:'.gd-felt' },
  poker:   { files:['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'],
             open:`window.EHPokerGame.open({names:['我','AI甲','AI乙','AI丙','AI丁','AI戊'],avatars:['🙂','🤖','👾','🐱','🦊','🐼'],isAI:[false,true,true,true,true,true],mySeat:0,seed:20260909})`,
             wait:'#pkMe .pk-hole .card', felt:'.pk-felt' },
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  let allOk = true;
  for (const [game, cfg] of Object.entries(GAMES)) {
    const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.setContent('<!doctype html><html><meta charset=utf-8><style>html,body{margin:0}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>', { waitUntil:'load' });
    await page.addScriptTag({ content: FX });   // 先装高光引擎(真实页里它先于 UI 加载)
    for (const f of cfg.files) await page.addScriptTag({ content: G(f) });
    await page.evaluate(cfg.open);
    await page.waitForFunction(sel => document.querySelector(sel), cfg.wait, { timeout: 12000 }).catch(()=>{});
    const r = await page.evaluate((cfg) => {
      const felt = document.querySelector(cfg.felt);
      const hasFx = !!(window.EHTableFx && typeof window.EHTableFx.celebrate === 'function');
      if (!felt || !hasFx) return { hasFx, feltFound: !!felt };
      window.EHTableFx.celebrate(felt, { tier:3, palette:['🎉','✨','⭐'], label:'测试高光！', sub:'集成探针' });
      return {
        hasFx, feltFound: true,
        confetti: felt.querySelectorAll('.eh-fx-confetti i').length,
        splash: !!felt.querySelector('.eh-fx-splash .t'),
        glow: !!felt.querySelector('.eh-fx-glow'),
      };
    }, cfg);
    const ok = r.hasFx && r.feltFound && r.confetti > 0 && r.splash && r.glow && errs.length === 0;
    allOk = allOk && ok;
    console.log((ok ? '✓' : '✗') + ' ' + game + ' → ' + JSON.stringify(r) + (errs.length ? '  pageerror: ' + errs.slice(0,2).join(' | ') : ''));
    await ctx.close();
  }
  await browser.close();
  console.log(allOk ? '\n全部通过: 三局绒面均能挂载分级高光, 零 pageerror' : '\n有失败');
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
