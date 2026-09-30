#!/usr/bin/env node
'use strict';
/* dev-shots.js — 渲染三款牌桌真机截图, 供视觉/交互打磨对标。产出 /tmp/eh-shots/*.png
 * 用法: node scripts/dev-shots.js [ddz|gd|pk|all]  (缺省 all)
 * 非 CI 门, 纯开发观察工具。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = '/tmp/eh-shots';
fs.mkdirSync(OUT, { recursive: true });

let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { try { ({ chromium } = require('playwright-core')); } catch (__) {} }
const EXE = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium', process.env.CHROME_PATH]
  .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });

const CSS_ROOT = ':root{--accent:#00e5d4;--amber:#ffc24d;--sub:#86cbc6;--ink:#eaf6ff;--bg:#070a12;--bg2:#0d1524;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel-solid:#132a29;--dim:#498d88;--glow-cyan:0 0 12px rgba(0,229,212,.5);--glow-mag:0 0 12px rgba(255,45,142,.5);--panel:rgba(21,50,48,.8);--magenta:#ff2d8e;--green:#34e0b0;--btn-ink:#04060c}html,body{margin:0;background:#070a12;color:#eaf6ff;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}#hall{position:relative;width:390px;height:844px;overflow:hidden}';

const SHARED = fs.readFileSync(path.join(ROOT, 'js/games/table-shared.css'), 'utf8');

const GAMES = {
  ddz: { libs: ['deck.js', 'ddz-rules.js', 'ddz-engine.js', 'ddz-ai.js', 'game-ui.js'],
    boot: () => window.__g = EHDdzGame.open({ mount: document.getElementById('hall'), mySeat: 0, names: ['我', '西家', '北家'], avatars: ['🦞', '🐼', '🐺'], isAI: [false, true, true] }) },
  gd: { libs: ['deck.js', 'guandan-rules.js', 'guandan-engine.js', 'guandan-ai.js', 'guandan-ui.js'],
    boot: () => window.__g = EHGuandanGame.open({ mount: document.getElementById('hall'), mySeat: 0, names: ['我', '下家', '对家', '上家'], avatars: ['🦞', '🐼', '🐺', '🦊'], isAI: [false, true, true, true] }) },
  pk: { libs: ['deck.js', 'poker-eval.js', 'poker-engine.js', 'poker-ai.js', 'poker-ui.js'],
    boot: () => window.__g = EHPokerGame.open({ mount: document.getElementById('hall'), mySeat: 0, names: ['我', '阿祖', '小北', '幽岚', '西', '恩'], avatars: ['🦞', '🐼', '🐺', '🦊', '🐯', '🦉'], isAI: [false, true, true, true, true, true], sb: 5, bb: 10, startStack: 1000 }) },
};

async function shoot(page, key, tag) {
  await page.screenshot({ path: path.join(OUT, `${key}-${tag}.png`) });
  console.log(`  · ${key}-${tag}.png`);
}

async function run(key) {
  const g = GAMES[key];
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + CSS_ROOT + '</style><div id="hall"></div>');
  await page.addStyleTag({ content: SHARED });
  for (const f of g.libs) await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8') });
  await page.evaluate(g.boot);
  await page.waitForTimeout(900);
  await shoot(page, key, '1-open');
  await page.waitForTimeout(2500);
  await shoot(page, key, '2-mid');
  if (errs.length) console.log(`  ⚠ pageerror: ${errs.slice(0, 3).join(' | ')}`);
  await browser.close();
}

(async () => {
  if (!chromium || !EXE) { console.log('need chrome+playwright'); process.exit(0); }
  const which = process.argv[2] || 'all';
  const keys = which === 'all' ? Object.keys(GAMES) : [which];
  for (const k of keys) { console.log(`▶ ${k}`); await run(k); }
  console.log(`\n截图在 ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
