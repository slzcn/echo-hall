#!/usr/bin/env node
'use strict';
/* 驱动到"打牌中"态截图, 看: 下注筹码位置遮挡 / AI思考+倒计时环重叠 / 牌背对比。
 * 用法: node scripts/shot-play.js [前缀] → /tmp/eh-lobby/<前缀>-<game>-<tag>.png */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const SHARED = fs.readFileSync(path.join(ROOT, 'js/games/table-shared.css'), 'utf8');
const PREFIX = process.argv[2] || 'play';
const SHOT_DIR = '/tmp/eh-lobby';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const DAY = '--bg:#eff8f8;--bg2:#daf1ef;--panel:rgba(255,255,255,.9);--panel-solid:#ffffff;--line:rgba(0,127,118,0.28);--line2:rgba(0,127,118,0.42);--ink:#0c312e;--sub:#3d8f89;--dim:#81bbb7;--cyan:#007f76;--magenta:#ef006e;--violet:#7b5cff;--amber:#C8892E;--green:#148566;--accent:#007f76;--grid:rgba(0,127,118,0.06);--glow-cyan:0 2px 10px rgba(0,127,118,0.18);--glow-mag:0 2px 10px rgba(239,0,110,0.16);';
const NIGHT = '--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';

let chromium;
try { ({ chromium } = require('playwright')); }
catch(_) { try { ({ chromium } = require('playwright-core')); } catch(__) {} }
const EXE = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});

const GAMES = {
  ddz:     { files:['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js'],
             open:`window.EHDdzGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0})` },
  guandan: { files:['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','guandan-ui.js'],
             open:`window.EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0})` },
  poker:   { files:['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'],
             open:`window.EHPokerGame.open({names:['我','AI甲','AI乙','AI丙','AI丁','AI戊'],avatars:['🙂','🤖','👾','🐱','🦊','🐼'],isAI:[false,true,true,true,true,true],mySeat:0,seed:20260909})` },
};

async function newPage(browser, palette, tag){
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  const modeAttr = tag==='day' ? ' data-mode="day"' : '';
  await page.setContent('<!doctype html><html'+modeAttr+'><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>html{'+palette+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"PingFang SC",sans-serif}'
    + '#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>', { waitUntil:'load' });
  page._errs = errs; page._ctx = ctx;
  return page;
}

async function boot(page, game){
  const cfg = GAMES[game];
  for (const f of cfg.files) await page.addScriptTag({ content: G(f) });
  await page.evaluate(cfg.open);
  await page.addStyleTag({ content: SHARED });
}

async function snap(page, name){
  const out = path.join(SHOT_DIR, PREFIX+'-'+name+'.png');
  await page.screenshot({ path: out });
  console.log('  📸 '+out + (page._errs.length ? '  ⚠ '+page._errs.slice(0,2).join(' | ') : ''));
}

(async () => {
  if (!chromium || !EXE){ console.log('缺 playwright/Chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE });

  for (const tag of ['night','day']){
    const palette = tag==='night'?NIGHT:DAY;

    // 德州: 等到"我的回合"(AI 已下注, 筹码摆桌上) — 抓下注位置 + 途中 AI 思考态
    {
      const page = await newPage(browser, palette, tag);
      await boot(page, 'poker');
      await page.waitForTimeout(1300);           // 翻牌前 AI 依次行动: 抓 AI 思考环
      await snap(page, 'poker-think-'+tag);
      await page.waitForTimeout(3200);           // 轮到我: 筹码都摆好了
      await snap(page, 'poker-commit-'+tag);
      await page._ctx.close();
    }

    // 斗地主: 点"不叫"让 AI 叫分/出牌 → 抓 AI 思考态
    {
      const page = await newPage(browser, palette, tag);
      await boot(page, 'ddz');
      await page.waitForTimeout(700);
      try { await page.locator('.ddz-btn', { hasText:'不叫' }).first().click({ timeout:2000 }); } catch(_){}
      await page.waitForTimeout(2600);
      await snap(page, 'ddz-think-'+tag);
      await page._ctx.close();
    }

    // 掼蛋: 我先手多半"随意出", 等一会看回合环; 点提示→出牌推进到 AI 思考
    {
      const page = await newPage(browser, palette, tag);
      await boot(page, 'guandan');
      await page.waitForTimeout(700);
      try { await page.locator('.gd-btn', { hasText:'提示' }).first().click({ timeout:2000 }); } catch(_){}
      await page.waitForTimeout(300);
      try { await page.locator('.gd-btn', { hasText:'出牌' }).first().click({ timeout:2000 }); } catch(_){}
      await page.waitForTimeout(2600);
      await snap(page, 'guandan-think-'+tag);
      await page._ctx.close();
    }
  }

  await browser.close();
  console.log('done');
})().catch(e=>{ console.error(e); process.exit(1); });
