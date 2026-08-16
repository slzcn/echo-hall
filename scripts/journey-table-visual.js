#!/usr/bin/env node
'use strict';
/**
 * journey-table-visual.js — 三桌视觉一致性 + 融合升级验证
 *
 * 覆盖 2026-08-17 20260816-exp2 视觉升级：
 *   A. 卡牌不能落回 'Arial Narrow'（Windows/安卓无字体，回退丑）
 *   B. 卡牌背面不能是 45° 斜条纹（旧生硬风）
 *   C. 三款桌面（.ddz-felt / .gd-felt / .pk-felt）都要有绿绒毡径向渐变
 *   D. 顶栏 title 要 chip 化（背景 + border 非零）
 *   E. table-shared.css 在 index.html 里挂上
 *   F. .gd-tag 字号 ≥10.5px（不再 9px 眯眼级）
 *
 * 静态断言优先，能不启动浏览器就不启（CI 更快）；有 Chrome 时才做真机复验补一层。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let step = 0, failed = false;
function assert(ok, msg){ step++; if(!ok){ failed = true; console.error(`✗ [${step}] ${msg}`); } else console.log(`✓ [${step}] ${msg}`); }

// ── 静态断言 ────────────────────────────────────────────────
const HTML   = R('index.html');
const SHARED = R('js/games/table-shared.css');
const DDZ    = R('js/games/game-ui.js');
const GD     = R('js/games/guandan-ui.js');
const PK     = R('js/games/poker-ui.js');

assert(/js\/games\/table-shared\.css\?v=20260816-exp2/.test(HTML),
  'index.html 挂了 table-shared.css?v=20260816-exp2');

// A. 三款 UI 不能再出现 'Arial Narrow'（连回退都不允许，字体链已换成 SF Pro Rounded）
for(const [name, src] of [['game-ui', DDZ], ['guandan-ui', GD], ['poker-ui', PK]]){
  assert(!/Arial Narrow/.test(src), `${name}.js 里彻底移除了 'Arial Narrow' 字体`);
}

// B. 三款卡牌背面已经不是 repeating-linear-gradient
for(const [name, src] of [['game-ui', DDZ], ['guandan-ui', GD], ['poker-ui', PK]]){
  assert(!/card\.back\{background:repeating-linear-gradient/.test(src),
    `${name}.js 卡牌背面已废弃 45° 斜条纹`);
  assert(/card\.back\{background:radial-gradient/.test(src),
    `${name}.js 卡牌背面改成 radial-gradient 暗玻璃 + 微光`);
}

// C. 共享皮肤层核心块必须齐
assert(/\.ddz-felt.*\.gd-felt.*\.pk-felt[\s\S]{0,140}radial-gradient/.test(SHARED),
  'table-shared.css 给三款 felt 加了统一的桌面绒毡径向渐变');
assert(/\.ddz-title[\s\S]{0,80}\.gd-title[\s\S]{0,80}\.pk-title[\s\S]{0,400}border-radius:\s*999px/.test(SHARED),
  'table-shared.css 把三款 title 做成 999px chip');
assert(/\.gd-room \.gd-tag\{[^}]*font-size:\s*10\.5px/.test(SHARED),
  'table-shared.css 把掼蛋 gd-tag 字号提到 10.5px（原 9px 太小）');
assert(/\.ddz-room \.tchat-toggle[\s\S]{0,20}\.gd-room  \.tchat-toggle[\s\S]{0,20}\.pk-room  \.tchat-toggle/.test(SHARED),
  'table-shared.css 三桌 tchat-toggle 升级毛玻璃 + accent 呼应');
assert(/\.ddz-hand-wrap[\s\S]{0,40}\.gd-hand-wrap[\s\S]{0,240}rgba\(0,\s*0,\s*0,\s*\.28\)/.test(SHARED),
  'table-shared.css 手牌区补了底部渐隐托盘感');

// D. 三处版本号保持一致(随功能推进升号): BUILD_VER == ver.txt, 且 SW_VERSION 含 BUILD_VER
assert(/BUILD_VER='20260817-ddz-online'/.test(HTML), 'index.html BUILD_VER=20260817-ddz-online');
assert(/eh-sw-v316-20260817-ddz-online/.test(R('sw.js')), 'sw.js SW_VERSION 含 BUILD_VER(升 v316-ddz-online)');
assert(/^20260817-ddz-online\s*$/.test(R('ver.txt')), 'ver.txt=20260817-ddz-online');

// ── 真机复验 ─────────────────────────────────────────────
function findChrome(){
  const cands = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                 '/Applications/Chromium.app/Contents/MacOS/Chromium',
                 process.env.CHROME_PATH].filter(Boolean);
  return cands.find(p => { try { return fs.existsSync(p); } catch(_){ return false; } });
}
let chromium;
try { ({chromium} = require('playwright')); } catch(_){ try { ({chromium} = require('playwright-core')); } catch(__){} }

async function realCheck(){
  const exe = findChrome();
  if(!chromium || !exe){
    console.log('⏭ 跳过真机复验：' + (!chromium ? 'playwright 未安装' : '未找到 Chrome'));
    return;
  }
  const CSS_ROOT = ':root{--accent:#00e5d4;--amber:#ffc24d;--sub:#86cbc6;--ink:#eaf6ff;--bg:#070a12;--bg2:#0d1524;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel-solid:#132a29;--dim:#498d88;--glow-cyan:0 0 12px rgba(0,229,212,.5);--glow-mag:0 0 12px rgba(255,45,142,.5);--panel:rgba(21,50,48,.8);--magenta:#ff2d8e;--green:#34e0b0;--btn-ink:#04060c}html,body{margin:0;background:#070a12;color:#eaf6ff;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}#hall{position:relative;width:390px;height:844px;overflow:hidden}';
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport:{width:390, height:844}, deviceScaleFactor:2 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+CSS_ROOT+'</style><link rel="stylesheet" href="table-shared.css"><div id="hall"></div>');
  await page.addStyleTag({ content: SHARED });
  for(const f of ['deck.js', 'ddz-rules.js', 'ddz-engine.js', 'ddz-ai.js', 'game-ui.js']){
    await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8') });
  }
  await page.evaluate(() => { window.__g = EHDdzGame.open({ mount: document.getElementById('hall'), seat:1, names:['我','西家','北家'], avatars:['🦞','🐼','🐺'] }); });
  await page.waitForTimeout(650);
  const dv = await page.evaluate(() => {
    const felt = document.querySelector('.ddz-felt');
    const title = document.querySelector('.ddz-title');
    const back = document.querySelector('.card.back');
    if(!felt || !title) return { err: 'no ddz-felt/title' };
    const feltCS = getComputedStyle(felt);
    const titleCS = getComputedStyle(title);
    const backCS = back ? getComputedStyle(back) : null;
    return {
      feltBg: feltCS.backgroundImage,
      titleRadius: titleCS.borderRadius,
      titleBg: titleCS.backgroundColor,
      titleFont: titleCS.fontFamily,
      backBg: backCS ? backCS.backgroundImage : ''
    };
  });
  assert(/radial-gradient/.test(dv.feltBg), '真机：斗地主 felt 桌面径向渐变生效');
  assert(/999px|9999px/.test(dv.titleRadius), '真机：斗地主 title 已 chip 化 border-radius 999px');
  assert(!/SF Mono|Arial Narrow/.test(dv.titleFont), '真机：斗地主 title 字体链已修正（无 SF Mono/Arial Narrow）');
  assert(!/repeating-linear-gradient/.test(dv.backBg), '真机：斗地主卡背不再是斜条纹');
  assert(/radial-gradient/.test(dv.backBg), '真机：斗地主卡背改成暗玻璃径向渐变');
  assert(errs.length === 0, '真机：斗地主视觉复验零 pageerror');
  await browser.close();
}

(async () => {
  await realCheck();
  if(failed){ console.error(`\n❌ 视觉一致性 ${step} 步有失败`); process.exit(1); }
  console.log(`\n✅ 视觉一致性 ${step} 步全通过：字体链修正 / 卡背换新 / 桌面绒毡 / title chip / 手牌托盘 / 融合毛玻璃`);
})().catch(e => { console.error(e); process.exit(1); });
