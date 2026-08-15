#!/usr/bin/env node
'use strict';
/**
 * journey-table-beat.js — F3 牌桌↔聊天室融合·牌局直播【真实渲染】旅程(斗地主 + 掼蛋)
 *
 * 为什么存在(反 anti-pattern「正则测不出 beat 到底有没有发、发的对不对、台词该不该配」):
 *   F3 让牌桌把高光瞬间(定地主/炸弹/报单/头游/终局升级)经 opts.onBeat 播报给聊天室, AI 对手
 *   还要配即时入戏台词(quip)。这些是"事件真的发出来了没 / 内容对不对 / 真人是否被误配台词"的
 *   行为, 正则证不了 —— 只有真渲一张牌桌、驱动一整局、收集实际 beat 能证。
 *
 * 打法(同步驱动, 不等 AI 定时器):
 *   用暴露的 applyMove(seat,move) + 各自 AI 引擎, 在一个 evaluate 里同步把整局走到 over。
 *   因为同步跑完只需几毫秒, 远早于 850ms+ 的 AI 定时器, 定时器醒来时局已 over(applyMove 自带
 *   phase/turn 守卫), 不会重复出牌。beat 经 onBeat 收进 window.__beats。
 *
 * 断言(两桌各自):
 *   1. 至少发出若干 beat, 每条都有非空 text
 *   2. 终局必有 type='over' 的战报(含比分/升级信息)
 *   3. 斗地主必有 type='landlord'(强制头家叫 3 立即定地主)
 *   4. ★真人(座 0, 名"你")的动作【绝不】配入戏台词 —— quip 只属于 AI 灵魂对手
 *   5. 若出现炸弹 beat, 必带 big 且文案含"炸"(高光档)
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

// 斗地主: 有叫分阶段, 强制头家叫 3 立即定地主, 之后 AI.decide 打到 over
const DRIVE_DDZ = `(() => {
  const g = window.__g, AI = window.EHDdzAI; let guard = 0;
  while (g.state().phase !== 'over' && guard++ < 500){
    const s = g.state();
    if (s.phase === 'bid'){ g.applyMove(s.bid.turn, {action:'call', val:3}); continue; }
    const seat = s.turn;
    const target = (s.table.lastPlay && s.table.lastPlay.seat!==seat) ? s.table.lastPlay.parse : null;
    const mv = AI.decide({ seat, hand:s.players[seat].hand, tableParse:target,
      lastSeat: s.table.lastPlay?s.table.lastPlay.seat:null,
      handsLeft: s.players.map(p=>p.hand.length), landlord:s.landlord, iAmLandlord: seat===s.landlord });
    g.applyMove(seat, mv.action==='play' ? {action:'play', cards:mv.cards.map(c=>({id:c.id}))} : {action:'pass'});
  }
  return window.__beats;
})()`;

// 掼蛋: 无叫分, 直接 play; AI.decide 打到 over
const DRIVE_GD = `(() => {
  const g = window.__g, AI = window.EHGuandanAI; let guard = 0;
  while (g.state().phase !== 'over' && guard++ < 600){
    const s = g.state();
    const seat = s.turn;
    const target = (s.table.lastPlay && s.table.lastPlay.seat!==seat) ? s.table.lastPlay.parse : null;
    const mv = AI.decide({ seat, hand:s.players[seat].hand, tableParse:target,
      lastSeat: s.table.lastPlay?s.table.lastPlay.seat:null,
      handsLeft: s.players.map(p=>p.hand.length), level:s.level });
    g.applyMove(seat, mv.action==='play' ? {action:'play', cards:mv.cards.map(c=>({id:c.id}))} : {action:'pass'});
  }
  return window.__beats;
})()`;

async function beatTrip(browser, tag, files, openExpr, driveExpr, wantLandlord){
  const { ctx, page, errs } = await newHall(browser, files);
  await page.evaluate(openExpr);
  const beats = await page.evaluate(driveExpr);

  // 1. 发出了 beat, 每条 text 非空
  if (!Array.isArray(beats) || !beats.length) bad(`[${tag}] 整局没发出任何 beat(onBeat 没接上?)`);
  else ok(`[${tag}] 一整局发出 ${beats.length} 条战报`);
  const emptyText = (beats||[]).filter(b => !b || !b.text || !String(b.text).trim());
  if (emptyText.length) bad(`[${tag}] 有 ${emptyText.length} 条 beat 文案为空`); else ok(`[${tag}] 每条战报都有文案`);

  const byType = t => (beats||[]).filter(b => b && b.type === t);

  // 2. 终局战报
  if (!byType('over').length) bad(`[${tag}] 缺终局战报(type=over)`);
  else ok(`[${tag}] 终局战报:「${byType('over')[0].text}」`);

  // 3. 斗地主必有定地主战报
  if (wantLandlord){
    if (!byType('landlord').length) bad(`[${tag}] 缺定地主战报(type=landlord)`);
    else ok(`[${tag}] 定地主战报:「${byType('landlord')[0].text}」`);
  }

  // 4. ★真人(名"你")的动作绝不配台词
  const humanQuip = (beats||[]).filter(b => b && b.quip && b.actor === '你');
  if (humanQuip.length) bad(`[${tag}] ★真人被误配了入戏台词(${humanQuip.length} 条) —— quip 只该属于 AI 灵魂`);
  else ok(`[${tag}] 真人动作不配台词(台词只属于灵魂对手)`);
  // 且确有灵魂配过台词(否则第 4 条是空过) —— 灵魂对手一整局至少入戏一次
  const soulQuip = (beats||[]).filter(b => b && b.quip && b.actor && b.actor !== '你');
  if (!soulQuip.length) bad(`[${tag}] 灵魂对手整局一句入戏台词都没有(quip 生成挂了?)`);
  else ok(`[${tag}] 灵魂对手入戏台词 ${soulQuip.length} 句, 如「${soulQuip[0].actor}: ${soulQuip[0].quip}」`);

  // 5. 炸弹战报若出现须为高光档且文案含"炸"
  const bombs = byType('bomb').concat(byType('rocket'));
  if (bombs.length){
    const badBomb = bombs.filter(b => !b.big || !/炸/.test(b.text));
    if (badBomb.length) bad(`[${tag}] 炸弹战报未标高光档/文案缺"炸"`); else ok(`[${tag}] 炸弹战报 ${bombs.length} 条(高光档)`);
  } else ok(`[${tag}] 本局无炸弹(不强制)`);

  if (errs.length) bad(`[${tag}] 页面报错: ` + errs.slice(0,2).join(' | '));
  await ctx.close();
}

async function main(){
  const exe = findChrome();
  if (!chromium || !exe) {
    console.log('⏭  跳过牌局直播可视化旅程: ' + (!chromium ? 'playwright 未安装' : '未找到 Chrome') + '(无头 CI 环境正常)');
    process.exit(0);
  }
  const browser = await chromium.launch({ executablePath: exe });

  console.log('── 斗地主 牌局直播旅程 ──');
  await beatTrip(browser, '斗地主',
    ['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','game-ui.js'],
    `window.__beats=[]; window.__g = window.EHDdzGame.open({ names:['你','灵魂左','灵魂右'], avatars:['🙂','🤖','👾'], onBeat:b=>window.__beats.push(b), onResult(){} });`,
    DRIVE_DDZ, true);

  console.log('\n── 掼蛋 牌局直播旅程 ──');
  await beatTrip(browser, '掼蛋',
    ['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-ui.js'],
    `window.__beats=[]; window.__g = window.EHGuandanGame.open({ names:['你','灵魂下','灵魂对','灵魂上'], avatars:['🙂','🔥','🌙','⚡'], onBeat:b=>window.__beats.push(b), onResult(){} });`,
    DRIVE_GD, false);

  await browser.close();
  if (fails.length){ console.log(`\n❌ 牌局直播旅程 ${fails.length} 项未过`); process.exit(1); }
  console.log('\n✅ F3 牌局直播旅程全通过: 高光 beat 真发出 + 终局/定地主战报到位 + 真人不配台词/灵魂入戏 + 炸弹高光档(斗地主+掼蛋)');
}
main().catch(e => { console.error(e); process.exit(1); });
