#!/usr/bin/env node
// Echo Hall 折叠屏 Web 排版回归（Layer 1，Playwright + Chrome）。
// 覆盖多款折叠屏形态在“折叠态 / 展开态 × 竖 / 横”下的关键排版指标：
//   #hall 高度 / visualViewport / viewport-segments / hinge env / 关键节点可点区。
// 只探测线上真实 URL，不模拟软键盘（软键盘由 Layer 2 真机/AVD 覆盖）。
// 输出 JSON + 每个 case 一张截图，失败退出码非0。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 每款设备给两组「折叠态 / 展开态」的物理尺寸，覆盖竖屏；横屏由 orientation 翻转。
// 数值来自厂商公开规格与 Chrome DevTools 内置预设的 CSS 像素。
const DEVICES = [
  // Samsung Galaxy Z Fold 5/6：外屏 344×882（折叠态），内屏 673×841（展开态）。
  { key: 'zfold-outer',  name: 'Galaxy Z Fold 外屏(折叠)', width: 344, height: 882, dpr: 3, segments: 1 },
  { key: 'zfold-inner',  name: 'Galaxy Z Fold 内屏(展开)', width: 673, height: 841, dpr: 3, segments: 2, foldAxis: 'vertical' },
  // Pixel Fold：外屏 412×901，内屏 674×841。
  { key: 'pixel-outer',  name: 'Pixel Fold 外屏(折叠)',    width: 412, height: 901, dpr: 2.625, segments: 1 },
  { key: 'pixel-inner',  name: 'Pixel Fold 内屏(展开)',    width: 674, height: 841, dpr: 2.625, segments: 2, foldAxis: 'vertical' },
  // 小米 Mix Fold 3：外屏 390×866，内屏 862×947（近似）。
  { key: 'mifold-outer', name: '小米 Mix Fold 外屏(折叠)', width: 390, height: 866, dpr: 3, segments: 1 },
  { key: 'mifold-inner', name: '小米 Mix Fold 内屏(展开)', width: 862, height: 947, dpr: 3, segments: 2, foldAxis: 'vertical' },
  // Surface Duo 2：单屏 540×720，双屏 720×540 + 720×540（近似），验证 dual-screen 分段。
  { key: 'duo-single',   name: 'Surface Duo 单屏',         width: 540, height: 720, dpr: 3, segments: 1 },
  { key: 'duo-dual',     name: 'Surface Duo 双屏',         width: 1114, height: 705, dpr: 3, segments: 2, foldAxis: 'vertical', hingePx: 34 },
];

const ORIENTATIONS = ['portrait', 'landscape'];
const TARGET_URL = process.env.ECHO_URL || 'https://slzcn.github.io/echo-hall/';
const OUT_DIR = path.join(__dirname, '..', 'artifacts', 'foldable-web');
const REPORT = path.join(OUT_DIR, `report-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);

function pxFor(dev, orient) {
  return orient === 'landscape'
    ? { width: dev.height, height: dev.width }
    : { width: dev.width,  height: dev.height };
}

async function runCase(browser, dev, orient, attempt = 1) {
      const { width, height } = pxFor(dev, orient);
      const label = `${dev.key}-${orient}`;
      const ctx = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: dev.dpr,
        isMobile: true,
        hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; ' + dev.name + ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Mobile Safari/537.36',
      });
      const page = await ctx.newPage();
      // 折叠展开态下，若厂商暴露 viewport-segments，注入 hint（Playwright/Chromium 目前不能真正注入 segments API，
      // 但可以通过 CSS 变量把预期几何交给页面自查；页面里如果读到 --probe-segments===2 且实际 window 也够宽，就走双屏分支）。
      await page.addInitScript(({ segments, hingePx, foldAxis }) => {
        try {
          const root = document.documentElement;
          root.style.setProperty('--probe-segments', String(segments));
          if (hingePx) root.style.setProperty('--probe-hinge', hingePx + 'px');
          if (foldAxis) root.style.setProperty('--probe-fold-axis', foldAxis);
        } catch (_) {}
      }, { segments: dev.segments, hingePx: dev.hingePx || 0, foldAxis: dev.foldAxis || 'none' });
      const startedAt = Date.now();
      let navOk = true, navErr = null, shellReady = false, hallReady = false;
      try {
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
        try {
          await page.waitForFunction(() => !!document.getElementById('enterBtn'), null, { timeout: 15000 });
          shellReady = true;
        } catch (_e) { shellReady = false; }
      } catch (e) { navOk = false; navErr = String(e && e.message || e); }
      // 完整旅程：匿名进入大厅 → 点击官方房间 → 等聊天室 #hall/#cin 可见。
      await page.waitForTimeout(1000);
      if (shellReady) {
        await page.locator('#enterBtn').click().catch(() => {});
        await page.waitForFunction(() => document.body.innerText.includes('闲聊广场'), null, { timeout: 15000 }).catch(() => {});
        await page.evaluate(() => {
          const room = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === '闲聊广场');
          if (room) room.click();
        }).catch(() => {});
        try {
          await page.waitForFunction(() => {
            const h = document.getElementById('hall');
            const c = document.getElementById('cin');
            const hr = h && h.getBoundingClientRect();
            const cr = c && c.getBoundingClientRect();
            return !!(hr && hr.height > 100 && cr && cr.width > 1 && cr.height > 1);
          }, null, { timeout: 45000 });
          hallReady = true;
        } catch (_e) { hallReady = false; }
        await page.waitForTimeout(1000);
      }
      const metrics = await page.evaluate(() => {
        const hall = document.getElementById('hall');
        const stage = document.querySelector('.stage');
        const chatInput = document.querySelector('#cin, #msgInput, #chatInput, textarea[data-role="chat-input"], .chat-input textarea, .composer textarea, .composer [contenteditable="true"]');
        const composer = document.querySelector('.composer, #composer, .chat-input, .comp');
        const rect = el => el ? el.getBoundingClientRect().toJSON() : null;
        const style = el => el ? getComputedStyle(el) : null;
        const kv = s => s ? { position:s.position, height:s.height, overflow:s.overflow, transform:s.transform } : null;
        return {
          url: location.href,
          ver: (document.querySelector('meta[name="build-ver"]') || {}).content || null,
          inner: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
          visual: window.visualViewport ? { w: window.visualViewport.width, h: window.visualViewport.height, offsetTop: window.visualViewport.offsetTop } : null,
          segmentsApi: (window.visualViewport && window.visualViewport.segments) ? window.visualViewport.segments.map(s => ({ x:s.x, y:s.y, w:s.width, h:s.height })) : null,
          mq: {
            horizSegments2: matchMedia('(horizontal-viewport-segments: 2)').matches,
            vertSegments2: matchMedia('(vertical-viewport-segments: 2)').matches,
            spanningNone: matchMedia('(spanning: none)').matches,
            hover: matchMedia('(hover: hover)').matches,
          },
          hall: { rect: rect(hall), style: kv(style(hall)) },
          stage: { rect: rect(stage), style: kv(style(stage)) },
          chatInput: { rect: rect(chatInput), style: kv(style(chatInput)), tag: chatInput ? chatInput.tagName : null, id: chatInput ? chatInput.id : null },
          composer: { rect: rect(composer), tag: composer ? composer.tagName : null },
          rootVars: {
            probeSegments: getComputedStyle(document.documentElement).getPropertyValue('--probe-segments').trim(),
            probeHinge: getComputedStyle(document.documentElement).getPropertyValue('--probe-hinge').trim(),
            probeFoldAxis: getComputedStyle(document.documentElement).getPropertyValue('--probe-fold-axis').trim(),
          },
          consoleErrors: window.__probeErrors || [],
          horizScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          nodeCount: document.getElementsByTagName('*').length,
        };
      });
      const shot = path.join(OUT_DIR, `${label}.png`);
      let screenshotError = null;
      try {
        await page.screenshot({ path: shot, fullPage: false, timeout: 5000 });
      } catch (e) {
        screenshotError = String(e && e.message || e).slice(0, 180);
      }
      await ctx.close();
      const localIssues = [];
      if (!navOk) localIssues.push('导航失败：' + navErr);
      if (!shellReady) localIssues.push('应用入口未在 15s 内就绪');
      if (!hallReady) localIssues.push('#hall/#cin 未在 45s 内进入聊天室可见态');
      if (metrics.horizScroll) localIssues.push('产生水平滚动条（折叠屏窄屏下最忌讳）');
      if (hallReady && !metrics.hall.rect) localIssues.push('匿名进入后 #hall 未渲染');
      if (hallReady && metrics.hall.rect && metrics.hall.rect.height < Math.min(300, height*0.4)) localIssues.push('#hall 高度异常偏低: ' + Math.round(metrics.hall.rect.height));
      if (hallReady && metrics.chatInput.rect && metrics.chatInput.rect.bottom > height + 1) localIssues.push('输入框底边超出视口: ' + Math.round(metrics.chatInput.rect.bottom));
      return {
        label, device: dev.name, orient, width, height, dpr: dev.dpr, segmentsPredicted: dev.segments,
        attempt,
        durationMs: Date.now() - startedAt,
        shellReady, hallReady,
        screenshot: screenshotError ? null : path.relative(process.cwd(), shot),
        screenshotError,
        metrics, issues: localIssues,
      };
}

async function runScenario(browser, dev, orient) {
  let result = await runCase(browser, dev, orient, 1);
  const attempts = [result];
  while (result.issues.length && attempts.length < 3) {
    result = await runCase(browser, dev, orient, attempts.length + 1);
    attempts.push(result);
  }
  if (!result.issues.length && attempts.length > 1) {
    return { ...result, recoveredAfterRetry: true, previousAttemptIssues: attempts.slice(0, -1).map(a => a.issues) };
  }
  if (result.issues.length && attempts.length > 1) {
    return { ...result, previousAttemptIssues: attempts.slice(0, -1).map(a => a.issues) };
  }
  return result;
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const scenarios = DEVICES.flatMap(dev => ORIENTATIONS.map(orient => ({ dev, orient })));
  const concurrency = Number(process.env.FOLDABLE_CONCURRENCY || 4);
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < scenarios.length) {
      const index = cursor++;
      const { dev, orient } = scenarios[index];
      results[index] = await runScenario(browser, dev, orient);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, scenarios.length) }, () => worker()));
  await browser.close();

  const issues = results
    .filter(r => r.issues.length)
    .map(r => ({ label: r.label, issues: r.issues, previousAttemptIssues: r.previousAttemptIssues || [] }));

  const summary = {
    url: TARGET_URL,
    at: new Date().toISOString(),
    total_cases: results.length,
    issue_cases: issues.length,
    issues,
    results,
  };
  fs.writeFileSync(REPORT, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(JSON.stringify({ ok: issues.length === 0, url: TARGET_URL, cases: results.length, issue_cases: issues.length, report: path.relative(process.cwd(), REPORT) }, null, 2));
  process.exit(issues.length === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(2); });
