#!/usr/bin/env node
'use strict';
/* 批3验证: 牌桌高光引擎 table-fx 三档演出(tier1轻彩带 / tier2大牌型+横幅 / tier3名场面+金彩+光晕)。
 * 把 table-fx.js 注入一个仿绒面容器, 逐档 celebrate() 并在动画中段截图, 肉眼核对彩带/横幅/光晕是否分级递进。
 * 用法: node scripts/probe-highlight-fx.js → /tmp/eh-lobby/fx-tier{1,2,3}.png */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FX = fs.readFileSync(path.join(ROOT, 'js/games/table-fx.js'), 'utf8');
const SHOT_DIR = '/tmp/eh-lobby';
fs.mkdirSync(SHOT_DIR, { recursive: true });
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('playwright-core')); }
const EXE = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));

const CASES = [
  { tier: 1, palette: ['🎉', '🃏', '✨', '🎊', '⭐', '💠'], label: '', sub: '', tag: 'tier1' },
  { tier: 2, palette: ['🎉', '🃏', '✨', '🎊', '⭐', '💠', '🀄'], label: '连升 2 级！', sub: '', tag: 'tier2' },
  { tier: 3, palette: ['🎉', '💰', '✨', '🎊', '⭐', '🪙'], label: '皇家同花顺！', sub: '通吃全场', tag: 'tier3' },
];

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0d1524;font-family:-apple-system,"PingFang SC",sans-serif}
  #felt{position:relative;width:390px;height:560px;margin:20px auto;border-radius:16px;overflow:hidden;
    background:radial-gradient(ellipse at 50% 35%,#1c5c3f,#0d3325);border:3px solid #0a241a;
    box-shadow:inset 0 0 60px rgba(0,0,0,.5)}
</style></head><body><div id="felt"></div><script>${FX}</script></body></html>`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  for (const c of CASES) {
    const page = await browser.newPage({ viewport: { width: 430, height: 620 } });
    await page.setContent(HTML, { waitUntil: 'load' });
    await page.evaluate((c) => {
      window.EHTableFx.celebrate(document.getElementById('felt'), c);
    }, c);
    await page.waitForTimeout(560); // 横幅已弹入定格、彩带下落中、光晕峰值
    await page.locator('#felt').screenshot({ path: path.join(SHOT_DIR, 'fx-' + c.tag + '.png') });
    console.log('shot fx-' + c.tag + '.png');
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
