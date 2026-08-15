#!/usr/bin/env node
'use strict';
/**
 * journey-table-chat.js — F2 牌桌↔聊天室融合·边打边聊【真实渲染】旅程(斗地主 + 掼蛋)
 *
 * 为什么存在(反 anti-pattern「正则测不出坞是否真挂、消息是否真进弹幕/列表、回声是否真去重」):
 *   F2 给牌桌镶了一条可收起聊天坞 + 弹幕层, 走现有 realtime 通道边打边聊。这些是"消息真的进/
 *   出没有"的行为, 正则证不了 —— 只有真的挂载 + 派发 onRoomMsg + 查 DOM/回调 能证。
 *
 * 用户旅程(开桌带 chat 桥 → 收到房间消息 → 自己从坞里发 → 自发回声不重复 → 系统类不进桌):
 *   1. 开桌(带 chat): 牌桌里挂出 .tchat 坞 + .tchat-dm 弹幕层
 *   2. 别人/灵魂来一条 msg: 弹幕横掠(.tchat-bullet) + 坞列表进一行(.tchat-row) + 收起态未读角标+1
 *   3. 我从坞输入框发一条: send 回调被调到(带原文) + 列表乐观进一行(.me)
 *   4. 我这条经 realtime 回声(同 uid 同文本)再喂回来: 列表【不】再多一行(去重)
 *   5. 非聊天类(proj/enter/interact...): 不进牌桌坞(列表不增)
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

async function chatTrip(browser, tag, files, openExpr, roomSel){
  const { ctx, page, errs } = await newHall(browser, files);
  await page.evaluate(openExpr);
  await page.waitForTimeout(1600);   // 等发牌动画/首帧稳定

  // 1. 开桌带 chat: 坞 + 弹幕层就位
  const s1 = await page.evaluate(roomSel => {
    const room = document.querySelector(roomSel);
    return { hasDock: !!(room && room.querySelector('.tchat')),
      hasDm: !!(room && room.querySelector('.tchat-dm')),
      hasInput: !!(room && room.querySelector('.tchat-in')) };
  }, roomSel);
  if (!s1.hasDock) bad(`[${tag}] 开桌后没挂出聊天坞 .tchat(chat 桥没接上?)`); else ok(`[${tag}] 开桌: 聊天坞已挂载`);
  if (!s1.hasDm) bad(`[${tag}] 开桌后没挂出弹幕层 .tchat-dm`); else ok(`[${tag}] 开桌: 弹幕层已挂载`);
  if (!s1.hasInput) bad(`[${tag}] 坞里没有 mini 输入框`); else ok(`[${tag}] 开桌: mini 输入框在`);

  // 2. 别人/灵魂来一条 → 弹幕 + 列表行 + 未读(坞默认收起)
  await page.evaluate(() => window.__g.onRoomMsg({ user_id:'soul-1', name:'灵魂左', emoji:'🤖', text:'这把我先手', kind:'msg', is_bot:true }));
  await page.waitForTimeout(120);
  const s2 = await page.evaluate(roomSel => {
    const room = document.querySelector(roomSel);
    return { bullets: room.querySelectorAll('.tchat-dm .tchat-bullet').length,
      rows: room.querySelectorAll('.tchat-list .tchat-row').length,
      badgeOn: !!(room.querySelector('.tchat-badge') && room.querySelector('.tchat-badge').classList.contains('on')) };
  }, roomSel);
  if (!s2.bullets) bad(`[${tag}] 别人来消息没横掠弹幕(.tchat-bullet 应≥1)`); else ok(`[${tag}] 来消息: 弹幕横掠(${s2.bullets})`);
  if (s2.rows !== 1) bad(`[${tag}] 别人来消息坞列表应进 1 行, 实=${s2.rows}`); else ok(`[${tag}] 来消息: 坞列表进 1 行`);
  if (!s2.badgeOn) bad(`[${tag}] 坞收起时来消息应亮未读角标`); else ok(`[${tag}] 来消息: 未读角标亮`);

  // 3. 我从坞里发一条 → send 回调被调 + 列表乐观进一行(.me)
  await page.evaluate(roomSel => {
    const room = document.querySelector(roomSel);
    const inp = room.querySelector('.tchat-in'); inp.value = '稳住能赢';
    room.querySelector('.tchat-inputbar').dispatchEvent(new Event('submit', { cancelable:true, bubbles:true }));
  }, roomSel);
  await page.waitForTimeout(120);
  const s3 = await page.evaluate(roomSel => {
    const room = document.querySelector(roomSel);
    return { sent: window.__sent.slice(),
      rows: room.querySelectorAll('.tchat-list .tchat-row').length,
      mineRows: room.querySelectorAll('.tchat-list .tchat-row.me').length };
  }, roomSel);
  if (s3.sent.length !== 1 || s3.sent[0] !== '稳住能赢') bad(`[${tag}] 从坞发送没调到 send 回调(实=${JSON.stringify(s3.sent)})`); else ok(`[${tag}] 发送: send 回调收到原文`);
  if (s3.rows !== 2) bad(`[${tag}] 自发后列表应共 2 行(来1+发1), 实=${s3.rows}`); else ok(`[${tag}] 发送: 乐观进列表`);
  if (s3.mineRows !== 1) bad(`[${tag}] 自发那行应标记 .me, 实=${s3.mineRows}`); else ok(`[${tag}] 发送: 自发行标记为我`);

  // 4. 我这条经 realtime 回声(同 uid 同文本)喂回 → 不重复
  await page.evaluate(() => window.__g.onRoomMsg({ user_id:'ME', name:'我', emoji:'🙂', text:'稳住能赢', kind:'msg', is_bot:false }));
  await page.waitForTimeout(80);
  const s4 = await page.evaluate(roomSel => document.querySelector(roomSel).querySelectorAll('.tchat-list .tchat-row').length, roomSel);
  if (s4 !== 2) bad(`[${tag}] ★自发消息 realtime 回声没去重(列表变 ${s4} 行, 应仍 2)`); else ok(`[${tag}] 回声: 自发消息不重复(去重生效)`);

  // 5. 非聊天类不进牌桌坞
  await page.evaluate(() => {
    window.__g.onRoomMsg({ user_id:'x', name:'系统', text:'投影了一张图', kind:'proj' });
    window.__g.onRoomMsg({ user_id:'y', name:'路人', text:'进入了房间', kind:'enter' });
  });
  await page.waitForTimeout(80);
  const s5 = await page.evaluate(roomSel => document.querySelector(roomSel).querySelectorAll('.tchat-list .tchat-row').length, roomSel);
  if (s5 !== 2) bad(`[${tag}] proj/enter 等非聊天类不该进坞(列表变 ${s5} 行, 应仍 2)`); else ok(`[${tag}] 过滤: 非聊天类不进牌桌坞`);

  if (errs.length) bad(`[${tag}] 页面报错: ` + errs.slice(0,2).join(' | '));
  await ctx.close();
}

async function main(){
  const exe = findChrome();
  if (!chromium || !exe) {
    console.log('⏭  跳过边打边聊可视化旅程: ' + (!chromium ? 'playwright 未安装' : '未找到 Chrome') + '(无头 CI 环境正常)');
    process.exit(0);
  }
  const browser = await chromium.launch({ executablePath: exe });

  const CHAT = `chat:{ send:(t)=>{ window.__sent=window.__sent||[]; window.__sent.push(t); return Promise.resolve(); }, me:{uid:'ME',name:'我',emoji:'🙂',color:'#00e5d4'} }`;

  console.log('── 斗地主 边打边聊旅程 ──');
  await chatTrip(browser, '斗地主',
    ['table-chat.js','deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','game-ui.js'],
    `window.__sent=[]; window.__g = window.EHDdzGame.open({ names:['你','灵魂左','灵魂右'], avatars:['🙂','🤖','👾'], ${CHAT}, onResult(){} });`,
    '.ddz-room');

  console.log('\n── 掼蛋 边打边聊旅程 ──');
  await chatTrip(browser, '掼蛋',
    ['table-chat.js','deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-ui.js'],
    `window.__sent=[]; window.__g = window.EHGuandanGame.open({ names:['你','灵魂下','灵魂对','灵魂上'], avatars:['🙂','🔥','🌙','⚡'], ${CHAT}, onResult(){} });`,
    '.gd-room');

  await browser.close();
  if (fails.length){ console.log(`\n❌ 边打边聊旅程 ${fails.length} 项未过`); process.exit(1); }
  console.log('\n✅ F2 边打边聊旅程全通过: 坞+弹幕挂载 + 来消息进弹幕/列表/未读 + 自发走桥+乐观上屏 + 回声去重 + 非聊天类过滤(斗地主+掼蛋)');
}
main().catch(e => { console.error(e); process.exit(1); });
