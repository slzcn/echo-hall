#!/usr/bin/env node
'use strict';
/* 一次性: 渲染德州招募态(host,只我一人坐着,五空位)截图, 日间+夜间两版。
 * 用法: node scripts/shot-poker-lobby.js <out前缀>   → /tmp/eh-lobby/<前缀>-day.png / -night.png */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const PREFIX = process.argv[2] || 'pk-head';
const SHOT_DIR = '/tmp/eh-lobby';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const DAY = '--bg:#eff8f8;--bg2:#daf1ef;--panel:rgba(255,255,255,.9);--panel-solid:#ffffff;--line:rgba(0,127,118,0.28);--line2:rgba(0,127,118,0.42);--ink:#0c312e;--sub:#3d8f89;--dim:#81bbb7;--cyan:#007f76;--magenta:#ef006e;--violet:#7b5cff;--amber:#C8892E;--green:#148566;--accent:#007f76;--grid:rgba(0,127,118,0.06);--glow-cyan:0 2px 10px rgba(0,127,118,0.18);--glow-mag:0 2px 10px rgba(239,0,110,0.16);';
const NIGHT = '--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';

let chromium;
try { ({ chromium } = require('playwright')); }
catch(_) { try { ({ chromium } = require('playwright-core')); } catch(__) {} }
const EXE = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});

async function shot(browser, palette, tag){
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  const modeAttr = tag==='day' ? ' data-mode="day"' : '';
  await page.setContent('<!doctype html><html'+modeAttr+'><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>html{'+palette+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"PingFang SC",sans-serif}'
    + '#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>', { waitUntil:'load' });
  for (const f of ['deck.js','poker-engine.js','poker-eval.js','poker-ai.js','poker-ui.js']) await page.addScriptTag({ content: G(f) });
  await page.evaluate(() => {
    const noop=()=>{};
    window.EHPokerGame.open({
      lobby:true, isHost:true,
      names:['量子麋鹿','','','','',''], avatars:['🦌','','','','',''],
      lobbySeats:[{seat:0,kind:'human',name:'量子麋鹿',emoji:'🦌'}],
      lobbyCtx:{ myUid:'me', hostName:'量子麋鹿',
        souls:[{auth_uid:'s1',name:'午夜电台DJ',emoji:'📻'},{auth_uid:'s2',name:'代码微光',emoji:'💡'}],
        actions:{ seatSoul:noop, kick:noop, fillSouls:noop, inviteHumans:noop, start:noop, close:noop } },
      onResult:noop,
    });
  });
  await page.waitForTimeout(700);
  const out = path.join(SHOT_DIR, PREFIX+'-'+tag+'.png');
  await page.screenshot({ path: out });
  if (errs.length) console.log('  ⚠ 渲染报错['+tag+']:', errs.slice(0,3).join(' | '));
  console.log('  📸 '+out);
  await ctx.close();
}

(async () => {
  if (!chromium || !EXE){ console.log('缺 playwright/Chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE });
  await shot(browser, DAY, 'day');
  await shot(browser, NIGHT, 'night');
  await browser.close();
  console.log('done');
})().catch(e=>{ console.error(e); process.exit(1); });
