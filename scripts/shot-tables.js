#!/usr/bin/env node
'use strict';
/* Batch C 验证: 三游戏牌桌"真桌面"绒面统一(绿绒+实心暗边+青描边), 日/夜各一版, 找灰蛋/割裂。
 * 单机开局→等发牌→截打牌态。用法: node scripts/shot-tables.js [前缀] → /tmp/eh-lobby/<前缀>-<game>-<day|night>.png */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const PREFIX = process.argv[2] || 'tbl';
const SHOT_DIR = '/tmp/eh-lobby';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const DAY = '--bg:#eff8f8;--bg2:#daf1ef;--panel:rgba(255,255,255,.9);--panel-solid:#ffffff;--line:rgba(0,127,118,0.28);--line2:rgba(0,127,118,0.42);--ink:#0c312e;--sub:#3d8f89;--dim:#81bbb7;--cyan:#007f76;--magenta:#ef006e;--violet:#7b5cff;--amber:#C8892E;--green:#148566;--accent:#007f76;--grid:rgba(0,127,118,0.06);--glow-cyan:0 2px 10px rgba(0,127,118,0.18);--glow-mag:0 2px 10px rgba(239,0,110,0.16);';
const NIGHT = '--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';

let chromium;
try { ({ chromium } = require('playwright')); }
catch(_) { try { ({ chromium } = require('playwright-core')); } catch(__) {} }
const EXE = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});

const GAMES = {
  ddz:     { files:['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js'], ns:'EHDdzGame',
             open:`window.EHDdzGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0})`, wait:'.ddz-hand .card' },
  guandan: { files:['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','guandan-ui.js'], ns:'EHGuandanGame',
             open:`window.EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0})`, wait:'.gd-hand .card' },
  poker:   { files:['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'], ns:'EHPokerGame',
             open:`window.EHPokerGame.open({names:['我','AI甲','AI乙','AI丙','AI丁','AI戊'],avatars:['🙂','🤖','👾','🐱','🦊','🐼'],isAI:[false,true,true,true,true,true],mySeat:0,seed:20260909})`, wait:'#pkMe .pk-hole .card' },
};

async function shot(browser, game, palette, tag){
  const cfg = GAMES[game];
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  const modeAttr = tag==='day' ? ' data-mode="day"' : '';
  await page.setContent('<!doctype html><html'+modeAttr+'><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>html{'+palette+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"PingFang SC",sans-serif}'
    + '#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>', { waitUntil:'load' });
  for (const f of cfg.files) await page.addScriptTag({ content: G(f) });
  await page.evaluate(cfg.open);
  // 共享皮肤层(index.html 里是 <link>, 探针里手动注入, 否则截到的是没套 table-shared.css 的裸桌)
  await page.addStyleTag({ content: fs.readFileSync(path.join(ROOT, 'js/games/table-shared.css'), 'utf8') });
  await page.waitForFunction(sel=>document.querySelector(sel), cfg.wait, { timeout: 12000 }).catch(()=>{});
  await page.waitForTimeout(900);
  const out = path.join(SHOT_DIR, PREFIX+'-'+game+'-'+tag+'.png');
  await page.screenshot({ path: out });
  console.log('  📸 '+out + (errs.length ? '  ⚠ '+errs.slice(0,2).join(' | ') : ''));
  await ctx.close();
}

(async () => {
  if (!chromium || !EXE){ console.log('缺 playwright/Chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE });
  for (const game of Object.keys(GAMES)){
    await shot(browser, game, NIGHT, 'night');
    await shot(browser, game, DAY, 'day');
  }
  await browser.close();
  console.log('done');
})().catch(e=>{ console.error(e); process.exit(1); });
