#!/usr/bin/env node
'use strict';
/* 牌背设计对比: 当前(A) vs 3 个候选(B/C/D), 各摆在夜/日绒面上, 截图肉眼选优。
 * 用法: node scripts/shot-cardbacks.js → /tmp/eh-lobby/cardbacks.png */
const fs = require('fs'); const path = require('path');
const SHOT_DIR = '/tmp/eh-lobby'; fs.mkdirSync(SHOT_DIR, { recursive: true });
let chromium; try { ({ chromium } = require('playwright')); } catch(_) { try { ({ chromium } = require('playwright-core')); } catch(__) {} }
const EXE = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});

// 候选牌背样式(留 ::after 徽记). key=类名
const BACKS = {
  'A 当前·暗玻璃': `
    background:radial-gradient(circle at 30% 22%,rgba(0,229,212,.18),transparent 55%),radial-gradient(circle at 74% 76%,rgba(156,133,255,.16),transparent 60%),linear-gradient(150deg,#182742,#0f1a2c 45%,#0a1220);
    border:1px solid rgba(0,229,212,.28);box-shadow:inset 0 0 0 1px rgba(255,255,255,.04),inset 0 6px 12px rgba(0,0,0,.35),0 2px 6px rgba(0,0,0,.45);`,
  'B 青菱格': `
    background:repeating-linear-gradient(45deg,rgba(0,229,212,.13) 0 1px,transparent 1px 7px),repeating-linear-gradient(-45deg,rgba(0,229,212,.13) 0 1px,transparent 1px 7px),linear-gradient(160deg,#16345a,#0e2340 55%,#0a1a30);
    border:1px solid rgba(0,229,212,.45);box-shadow:inset 0 0 0 1px rgba(0,229,212,.14),inset 0 6px 12px rgba(0,0,0,.34),0 2px 6px rgba(0,0,0,.45);`,
  'C 宝石徽记': `
    background:radial-gradient(circle at 50% 46%,rgba(0,229,212,.16),transparent 44%),repeating-radial-gradient(circle at 50% 46%,transparent 0 3px,rgba(255,255,255,.035) 3px 4px),linear-gradient(155deg,#1c2c54,#121e3c 60%,#0c1730);
    border:1px solid rgba(120,150,255,.42);box-shadow:inset 0 0 0 1px rgba(255,255,255,.05),inset 0 6px 14px rgba(0,0,0,.36),0 2px 6px rgba(0,0,0,.45);`,
  'D 碳纹双框': `
    background:repeating-linear-gradient(45deg,rgba(0,229,212,.09) 0 2px,transparent 2px 5px),linear-gradient(150deg,#16294a,#0d1930);
    border:none;box-shadow:inset 0 0 0 1px rgba(0,229,212,.5),inset 0 0 0 4px rgba(9,16,34,.92),inset 0 0 0 5px rgba(0,229,212,.28),0 2px 6px rgba(0,0,0,.5);`,
};
// 每个候选的 ::after 徽记(内联到 style 里用单独 span 画)
const EMBLEM = {
  'A 当前·暗玻璃': `inset:6% 12%;border-radius:4px;background:linear-gradient(135deg,transparent 46%,rgba(0,229,212,.18) 50%,transparent 54%),linear-gradient(45deg,transparent 46%,rgba(156,133,255,.16) 50%,transparent 54%);opacity:.55;`,
  'B 青菱格': `left:50%;top:50%;width:40%;height:28%;transform:translate(-50%,-50%) rotate(45deg);border-radius:2px;background:linear-gradient(135deg,rgba(0,229,212,.55),rgba(0,229,212,.15));box-shadow:0 0 8px rgba(0,229,212,.4),inset 0 0 0 1px rgba(255,255,255,.22);`,
  'C 宝石徽记': `left:50%;top:46%;width:44%;height:31%;transform:translate(-50%,-50%) rotate(45deg);border-radius:3px;background:linear-gradient(135deg,#8fd8ff,#3aa0ff 46%,#6a5cff);box-shadow:0 0 10px rgba(90,150,255,.55),inset 0 0 0 1.4px rgba(255,255,255,.5),inset 0 0 6px rgba(0,0,0,.3);`,
  'D 碳纹双框': `left:50%;top:50%;width:30%;height:30%;transform:translate(-50%,-50%) rotate(45deg);border-radius:2px;background:linear-gradient(135deg,rgba(0,229,212,.5),rgba(0,229,212,.12));box-shadow:0 0 6px rgba(0,229,212,.4),inset 0 0 0 1px rgba(255,255,255,.18);`,
};
const NIGHT_FELT = 'linear-gradient(160deg,#2ba07f,#17805f 34%,#0d5f49 60%,#084036 82%)';
const DAY_FELT   = 'linear-gradient(160deg,#8fe6cd,#4cc6a7 38%,#16a488 66%,#0a8874 88%)';

function cardsRow(styleKey){
  const back = BACKS[styleKey], em = EMBLEM[styleKey];
  const one = size => `<div class="card ${size}" style="${back}"><span class="em" style="${em}"></span></div>`;
  return `<div class="row"><div class="lbl">${styleKey}</div>${one('')}${one('')}${one('big')}</div>`;
}
function feltBlock(title, felt){
  return `<div class="felt" style="background:${felt}"><div class="ft">${title}</div>${Object.keys(BACKS).map(cardsRow).join('')}</div>`;
}
const HTML = `<!doctype html><meta charset=utf-8><style>
  body{margin:0;background:#070a12;font-family:system-ui,"PingFang SC",sans-serif;padding:14px;display:flex;gap:14px}
  .felt{flex:1;border-radius:16px;padding:14px 12px 18px;box-shadow:0 0 0 5px #071e1b,0 18px 44px rgba(0,0,0,.5)}
  .ft{color:#eaf6ff;font-weight:800;font-size:15px;margin-bottom:10px;text-shadow:0 1px 3px rgba(0,0,0,.5)}
  .row{display:flex;align-items:center;gap:8px;margin:12px 0}
  .lbl{width:120px;color:#eaf6ff;font-size:12.5px;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,.6)}
  .card{width:44px;height:62px;border-radius:8px;position:relative;overflow:hidden;flex:none}
  .card.big{width:58px;height:82px;border-radius:9px}
  .em{content:"";position:absolute;pointer-events:none}
</style>
${feltBlock('夜间绒面', NIGHT_FELT)}
${feltBlock('日间绒面', DAY_FELT)}`;

(async () => {
  if (!chromium || !EXE){ console.log('缺 playwright/Chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport:{width:860,height:640}, deviceScaleFactor:2 });
  const page = await ctx.newPage();
  await page.setContent(HTML, { waitUntil:'load' });
  await page.waitForTimeout(200);
  const out = path.join(SHOT_DIR, 'cardbacks.png');
  await page.screenshot({ path: out });
  console.log('  📸 '+out);
  await browser.close();
})().catch(e=>{ console.error(e); process.exit(1); });
