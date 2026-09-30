#!/usr/bin/env node
'use strict';
/**
 * journey-table-fold.js — F1 牌桌↔聊天室融合·折叠/展开【真实渲染】旅程(斗地主 + 掼蛋)
 *
 * 为什么存在(反 anti-pattern「正则测不出 DOM 生死 / 只测能开不测能收」):
 *   F1 把"✕ 返回"从【room.remove() 销毁牌局】改成【折叠成右下角活牌桌片, 牌局后台继续】。
 *   这是"牌局是否还活着"的行为改动, 正则证不了 —— 只有真的渲染 + 点按钮 + 查 DOM 生死 能证。
 *
 * 用户旅程(开一桌 → 返回聊天 → 再回牌桌 → 收工):
 *   1. 开局: 牌桌在场且可见, 右下角【没有】活牌桌片
 *   2. 点 ✕返回: 牌桌【仍在 DOM】(display:none, 没被销毁) + 活牌桌片浮现且文案非空 + isMinimized()=true
 *   3. 点活牌桌片: 牌桌重新可见 + 片子收起 + isMinimized()=false (同一局, 未重开)
 *   4. 收工(close): 牌桌与活牌桌片【双双移除】(这才是真正结束)
 *
 * 关键断言 = 旧实现(返回即 room.remove())的反证:
 *   若"返回"还销毁牌局, 第 2 步"牌桌仍在 DOM"必红 —— 本测就是挡这个回退的。
 *
 * playwright + 本机 Chrome 渲染; 二者不可用 → 跳过(退出码 0), 供无头 CI。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');

function findChrome(){
  const cands = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    process.env.CHROME_PATH,
  ].filter(Boolean);
  return cands.find(p => { try { return fs.existsSync(p); } catch(_) { return false; } });
}
let chromium;
try { ({ chromium } = require('playwright')); }
catch(_) { try { ({ chromium } = require('playwright-core')); } catch(__) {} }

const CSSVARS = ':root{--accent:#00e5d4;--magenta:#ff2d8e;--amber:#ffc24d;--sub:#86cbc6;--dim:#498d88;--ink:#eaf6ff;'
  + '--bg:#070a12;--bg2:#0d1524;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel-solid:#132a29;'
  + '--glow-cyan:0 0 12px rgba(0,229,212,.5);--glow-mag:0 0 12px rgba(255,45,142,.5)}'
  + 'html,body{margin:0;background:#0a0e18;color:#eaf6ff;font-family:system-ui,"PingFang SC",sans-serif}'
  + '#hall{position:relative;width:100%;height:100vh;overflow:hidden}';

const fails = [];
const ok = m => console.log('  ✓ ' + m);
const bad = m => { console.log('  ✗ ' + m); fails.push(m); };

async function newHall(browser, files){
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8>'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+CSSVARS+'</style><body><div id="hall"></div>',
    { waitUntil:'load' });
  for (const f of files) await page.addScriptTag({ content: G(f) });
  return { ctx, page, errs };
}

// 通用一趟折叠/展开旅程。sel: 前缀(ddz/gd), openExpr: 在页面里开局并把控制器挂到 window.__g
async function foldTrip(browser, tag, files, openExpr, roomSel, chipSel, xId){
  const { ctx, page, errs } = await newHall(browser, files);
  await page.evaluate(openExpr);
  await page.waitForTimeout(1600);   // 等发牌动画/首帧稳定

  // 1. 开局: 牌桌可见, 无活牌桌片
  const s1 = await page.evaluate(({roomSel, chipSel}) => {
    const room = document.querySelector(roomSel);
    return { hasRoom: !!room, roomVisible: !!room && getComputedStyle(room).display !== 'none',
      hasChip: !!document.querySelector(chipSel), min: window.__g.isMinimized() };
  }, {roomSel, chipSel});
  if (!s1.hasRoom || !s1.roomVisible) bad(`[${tag}] 开局后牌桌应可见`); else ok(`[${tag}] 开局: 牌桌在场且可见`);
  if (s1.hasChip) bad(`[${tag}] 开局时不该有活牌桌片(片子只在折叠后出现)`); else ok(`[${tag}] 开局: 右下角无活牌桌片`);
  if (s1.min) bad(`[${tag}] 开局 isMinimized 应为 false`); else ok(`[${tag}] 开局: 未折叠`);

  // 2. 点 ✕返回 → 折叠(不销毁)
  await page.evaluate(id => document.getElementById(id).click(), xId);
  await page.waitForTimeout(360);    // 折叠动画 240ms + 余量
  const s2 = await page.evaluate(({roomSel, chipSel}) => {
    const room = document.querySelector(roomSel), chip = document.querySelector(chipSel);
    return {
      roomStillInDom: !!room,                                             // ★反证旧 room.remove()
      roomHidden: !!room && getComputedStyle(room).display === 'none',
      chipShown: !!chip && getComputedStyle(chip).display !== 'none',
      chipText: chip ? (chip.querySelector('.ck-s') || {}).textContent || '' : '',
      min: window.__g.isMinimized(),
    };
  }, {roomSel, chipSel});
  if (!s2.roomStillInDom) bad(`[${tag}] ★返回后牌桌被销毁了(旧 room.remove() 回退) —— 应折叠不销毁`);
  else ok(`[${tag}] 返回: 牌桌仍在 DOM(未销毁, 牌局后台继续)`);
  if (!s2.roomHidden) bad(`[${tag}] 返回后牌桌应隐藏(display:none)`); else ok(`[${tag}] 返回: 牌桌已隐藏`);
  if (!s2.chipShown) bad(`[${tag}] 返回后应浮现活牌桌片`); else ok(`[${tag}] 返回: 活牌桌片浮现`);
  if (!s2.chipText || !s2.chipText.trim()) bad(`[${tag}] 活牌桌片状态文案为空(应显示轮到谁/剩几张)`); else ok(`[${tag}] 返回: 片子状态文案「${s2.chipText.trim()}」`);
  if (!s2.min) bad(`[${tag}] 折叠后 isMinimized 应为 true`); else ok(`[${tag}] 返回: isMinimized=true`);

  // 3. 点活牌桌片 → 展开回牌桌(同一局)
  await page.evaluate(chipSel => document.querySelector(chipSel).click(), chipSel);
  await page.waitForTimeout(360);
  const s3 = await page.evaluate(({roomSel, chipSel}) => {
    const room = document.querySelector(roomSel), chip = document.querySelector(chipSel);
    return { roomVisible: !!room && getComputedStyle(room).display !== 'none',
      chipHidden: !chip || getComputedStyle(chip).display === 'none', min: window.__g.isMinimized() };
  }, {roomSel, chipSel});
  if (!s3.roomVisible) bad(`[${tag}] 点片子后牌桌应重新可见`); else ok(`[${tag}] 展开: 牌桌重新可见`);
  if (!s3.chipHidden) bad(`[${tag}] 展开后活牌桌片应收起`); else ok(`[${tag}] 展开: 片子收起`);
  if (s3.min) bad(`[${tag}] 展开后 isMinimized 应为 false`); else ok(`[${tag}] 展开: isMinimized=false`);

  // 4. 收工 close → 牌桌 + 片子双双移除
  await page.evaluate(() => window.__g.close());
  await page.waitForTimeout(60);
  const s4 = await page.evaluate(({roomSel, chipSel}) => ({
    room: !!document.querySelector(roomSel), chip: !!document.querySelector(chipSel),
  }), {roomSel, chipSel});
  if (s4.room) bad(`[${tag}] 收工后牌桌应移除`); else ok(`[${tag}] 收工: 牌桌移除`);
  if (s4.chip) bad(`[${tag}] 收工后活牌桌片应移除`); else ok(`[${tag}] 收工: 活牌桌片移除`);

  if (errs.length) bad(`[${tag}] 页面报错: ` + errs.slice(0,2).join(' | '));
  await ctx.close();
}

async function main(){
  const exe = findChrome();
  if (!chromium || !exe) {
    console.log('⏭  跳过折叠/展开可视化旅程: ' + (!chromium ? 'playwright 未安装' : '未找到 Chrome') + '(无头 CI 环境正常)');
    process.exit(0);
  }
  const browser = await chromium.launch({ executablePath: exe });

  console.log('── 斗地主 折叠/展开旅程 ──');
  await foldTrip(browser, '斗地主',
    ['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','game-ui.js'],
    () => { window.__g = window.EHDdzGame.open({ names:['你','灵魂左','灵魂右'], avatars:['🙂','🤖','👾'], onResult(){} }); },
    '.ddz-room', '.ddz-chip', 'ddzX');

  console.log('\n── 掼蛋 折叠/展开旅程 ──');
  await foldTrip(browser, '掼蛋',
    ['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-ui.js'],
    () => { window.__g = window.EHGuandanGame.open({ names:['你','灵魂下','灵魂对','灵魂上'], avatars:['🙂','🔥','🌙','⚡'], onResult(){} }); },
    '.gd-room', '.gd-chip', 'gdX');

  await browser.close();
  if (fails.length){ console.log(`\n❌ 折叠/展开旅程 ${fails.length} 项未过`); process.exit(1); }
  console.log('\n✅ F1 折叠/展开旅程全通过: 返回折叠不销毁(牌局续跑) + 活牌桌片可展开 + 收工才真销毁(斗地主+掼蛋)');
}
main().catch(e => { console.error(e); process.exit(1); });
