#!/usr/bin/env node
'use strict';
/* 一次性: 渲染掼蛋牌桌记分条 + 级牌进度轴, 多组等级组合(2v2 起步 / 5v9 拉开 / K vs A 决胜)截图核对定位。
 * 用法: node scripts/shot-guandan-lvltrack.js   → /tmp/eh-lvltrack/*.png */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const SHOT_DIR = '/tmp/eh-lvltrack';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const NIGHT = '--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);';

let chromium;
try { ({ chromium } = require('playwright')); }
catch(_) { try { ({ chromium } = require('playwright-core')); } catch(__) {} }
const EXE = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});

async function shot(browser, teamLevels, tag){
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"PingFang SC",sans-serif}'
    + '#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>', { waitUntil:'load' });
  for (const f of ['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-ui.js']) await page.addScriptTag({ content: G(f) });
  await page.evaluate((tl) => {
    const noop=()=>{};
    window.EHGuandanGame.open({
      names:['量子麋鹿','下家','对家','上家'], avatars:['🦌','🤖','🤝','👾'],
      match:{ teamLevels: tl, dealerTeam: 0 },
      onResult:noop,
    });
  }, teamLevels);
  await page.waitForTimeout(500);
  const score = await page.$('.gd-score');
  const out = path.join(SHOT_DIR, tag+'.png');
  if (score) await score.screenshot({ path: out });
  else { await page.screenshot({ path: out }); console.log('  ⚠ 未找到 .gd-score, 截全屏'); }
  if (errs.length) console.log('  ⚠ 渲染报错['+tag+']:', errs.slice(0,3).join(' | '));
  console.log('  📸 '+out+'  (队伍等级 '+JSON.stringify(teamLevels)+')');
  await ctx.close();
}

(async () => {
  if (!chromium || !EXE){ console.log('缺 playwright/Chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE });
  await shot(browser, [2,2], 'start-2v2');
  await shot(browser, [5,9], 'mid-5v9');
  await shot(browser, [13,14], 'final-KvA');
  await browser.close();
  console.log('done');
})().catch(e=>{ console.error(e); process.exit(1); });
