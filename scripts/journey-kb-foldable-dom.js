#!/usr/bin/env node
'use strict';
/**
 * 折叠屏展开态主聊天室真实 DOM 坐标旅程。
 *
 * 覆盖历史盲区：旧旅程只测 keyboard.js 的 visibleHeight 数值，没有把 index.html 的
 * 桌面 #hall top:12px / 92dvh 与触屏键盘高度放进同一个真实布局树，导致“计算正确、
 * 输入框仍越过键盘顶沿”未被抓到。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function assert(ok, msg) { if (!ok) throw new Error('FAIL: ' + msg); console.log('✓ ' + msg); }

const mediaRule = /@media \(max-width:640px\), \(hover:none\) and \(pointer:coarse\)\s*\{[\s\S]*?#hall\s*\{left:0;top:0;[\s\S]*?max-height:none/;
assert(mediaRule.test(HTML), '折叠屏粗指针展开态进入 #hall 全屏坐标系');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { try { ({ chromium } = require('playwright-core')); } catch (_) {} }
const chrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  process.env.CHROME_PATH,
].filter(Boolean).find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });

function styles(src) {
  return [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
}
const css = styles(HTML);
const shell = cssText => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${cssText}</style>
<body class="hall-on"><div class="scene" id="hall" style="display:flex;height:439px">
  <div class="hall-top"></div><div class="presence"></div><div class="stream" id="stream"></div>
  <form class="composer"><button class="plus-btn" type="button">＋</button><div class="cin-wrap"><textarea class="cin" id="cin"></textarea></div></form>
</div></body>`;

async function measure(browser, isTouch, cssText, widths = [690]) {
  const ctx = await browser.newContext({ viewport: { width: widths[0], height: 719 }, isMobile: isTouch, hasTouch: isTouch, deviceScaleFactor: 2.5 });
  const page = await ctx.newPage();
  await page.setContent(shell(cssText), { waitUntil: 'load' });
  const samples = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 719 });
    await page.waitForTimeout(50);
    samples.push(await page.evaluate(() => {
      const r = id => document.querySelector(id).getBoundingClientRect();
      const h = r('#hall'), c = r('#cin');
      return { hallTop: h.top, hallBottom: h.bottom, hallH: h.height, cinBottom: c.bottom,
        coarse: matchMedia('(hover:none) and (pointer:coarse)').matches };
    }));
  }
  await ctx.close();
  return widths.length === 1 ? samples[0] : samples;
}

(async () => {
  if (!chromium || !chrome) {
    console.log('⏭  无 Playwright/Chrome，静态契约已通过，跳过真实 DOM 坐标复验');
    return;
  }
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const keyboardTop = 439;
    const touch = await measure(browser, true, css);
    assert(touch.coarse, '690px 折叠屏展开态命中粗指针媒体查询');
    assert(Math.abs(touch.hallTop) <= 1, `折叠屏 #hall 顶沿归零（实际 ${touch.hallTop}px）`);
    assert(touch.hallBottom <= keyboardTop + 0.5,
      `折叠屏 #hall 不越过键盘顶沿（hall=${touch.hallBottom.toFixed(1)} ≤ keyboard=${keyboardTop}）`);
    assert(touch.cinBottom <= keyboardTop + 0.5,
      `折叠屏输入框底沿不越过键盘顶沿（cin=${touch.cinBottom.toFixed(1)} ≤ keyboard=${keyboardTop}）`);

    const roundTrip = await measure(browser, true, css, [360, 690, 360]);
    for (const [i, sample] of roundTrip.entries()) {
      assert(Math.abs(sample.hallTop) <= 1 && sample.hallBottom <= keyboardTop + 0.5,
        `折叠屏 360→690→360 往返第 ${i + 1} 态坐标不残留`);
    }

    const desktop = await measure(browser, false, css);
    assert(!desktop.coarse, '同宽桌面细指针不命中折叠屏规则');
    assert(desktop.hallTop >= 11, `同宽桌面仍保留卡片顶部留白（实际 ${desktop.hallTop}px）`);

    const oldCss = css.replace('@media (max-width:640px), (hover:none) and (pointer:coarse){', '@media (max-width:640px){');
    const oldTouch = await measure(browser, true, oldCss);
    assert(oldTouch.hallBottom > keyboardTop + 1,
      `反证：旧 ≤640px 单宽度门使 #hall 越过键盘顶沿（超出 ${(oldTouch.hallBottom-keyboardTop).toFixed(1)}px）`);
    console.log('\n✅ 折叠屏展开态真实 DOM 坐标旅程通过；当前实现绿，旧宽度门必红，桌面布局不回归。');
  } finally { await browser.close(); }
})().catch(e => { console.error(e.stack || e); process.exit(1); });
