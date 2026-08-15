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

// 固定 seed 集合 —— 让整局完全可复现(deck 洗牌吃 seed, 两 AI 均零 Math.random)。
// 每个 seed 各验一整局不变量, 跨 seed 聚合验"灵魂确有入戏", 全程无随机 → CI 不 flaky。
const SEEDS = [1, 2, 3, 4, 5, 6];

async function beatTrip(browser, tag, files, buildOpenExpr, driveExpr, wantLandlord){
  const all = [];              // 全 seed 汇总, 供聚合断言
  let dealsWithOver = 0, dealsWithLandlord = 0, bombTotal = 0, bombBad = 0;
  const allErrs = [];

  for (const seed of SEEDS){
    // 每 seed 一张全新页 —— 杜绝上一局残留 AI 定时器跨局污染 window.__beats
    const { ctx, page, errs } = await newHall(browser, files);
    await page.evaluate(buildOpenExpr(seed));
    const beats = await page.evaluate(driveExpr);
    if (errs.length) allErrs.push(...errs);
    await ctx.close();
    if (!Array.isArray(beats)) { bad(`[${tag}] seed ${seed}: 驱动没返回 beat 数组`); continue; }
    all.push(...beats);
    const byType = t => beats.filter(b => b && b.type === t);

    // 每局: 文案非空
    if (beats.some(b => !b || !b.text || !String(b.text).trim())) bad(`[${tag}] seed ${seed}: 有战报文案为空`);
    // 每局: 终局战报
    if (byType('over').length) dealsWithOver++; else bad(`[${tag}] seed ${seed}: 缺终局战报(type=over)`);
    // 斗地主每局: 定地主战报
    if (wantLandlord){ if (byType('landlord').length) dealsWithLandlord++; else bad(`[${tag}] seed ${seed}: 缺定地主战报(type=landlord)`); }
    // ★每局硬不变量: 真人(名"你")动作绝不配台词
    const humanQuip = beats.filter(b => b && b.quip && b.actor === '你');
    if (humanQuip.length) bad(`[${tag}] seed ${seed}: ★真人被误配入戏台词(${humanQuip.length} 条) —— quip 只该属于 AI 灵魂`);
    // 炸弹战报: 若出现须高光档 + 文案含"炸"
    const bombs = byType('bomb').concat(byType('rocket'));
    bombTotal += bombs.length;
    bombBad += bombs.filter(b => !b.big || !/炸/.test(b.text)).length;
  }

  ok(`[${tag}] ${SEEDS.length} 局固定牌局各驱动到终局, 共 ${all.length} 条战报`);
  if (dealsWithOver === SEEDS.length) ok(`[${tag}] 每局都有终局战报, 如「${all.find(b=>b.type==='over')?.text}」`);
  if (wantLandlord && dealsWithLandlord === SEEDS.length) ok(`[${tag}] 每局都有定地主战报, 如「${all.find(b=>b.type==='landlord')?.text}」`);
  if (!all.some(b => b && b.quip && b.actor === '你')) ok(`[${tag}] 全程真人动作零台词(台词只属于灵魂对手)`);

  // 聚合: 灵魂确有入戏(证 quip 路径真通)
  const soulQuip = all.filter(b => b && b.quip && b.actor && b.actor !== '你');
  if (!soulQuip.length) bad(`[${tag}] ${SEEDS.length} 局灵魂对手一句入戏台词都没有(quip 生成挂了?)`);
  else ok(`[${tag}] 灵魂对手累计入戏 ${soulQuip.length} 句, 如「${soulQuip[0].actor}: ${soulQuip[0].quip}」`);

  // 炸弹档位
  if (bombTotal){ if (bombBad) bad(`[${tag}] 有炸弹战报未标高光档/文案缺"炸"`); else ok(`[${tag}] 炸弹战报累计 ${bombTotal} 条, 均高光档`); }
  else ok(`[${tag}] 这批牌局无炸弹(不强制)`);

  if (allErrs.length) bad(`[${tag}] 页面报错: ` + allErrs.slice(0,2).join(' | '));
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
    seed => `window.__beats=[]; window.__g = window.EHDdzGame.open({ seed:${seed}, names:['你','灵魂左','灵魂右'], avatars:['🙂','🤖','👾'], onBeat:b=>window.__beats.push(b), onResult(){} });`,
    DRIVE_DDZ, true);

  console.log('\n── 掼蛋 牌局直播旅程 ──');
  await beatTrip(browser, '掼蛋',
    ['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-ui.js'],
    seed => `window.__beats=[]; window.__g = window.EHGuandanGame.open({ seed:${seed}, names:['你','灵魂下','灵魂对','灵魂上'], avatars:['🙂','🔥','🌙','⚡'], onBeat:b=>window.__beats.push(b), onResult(){} });`,
    DRIVE_GD, false);

  await browser.close();
  if (fails.length){ console.log(`\n❌ 牌局直播旅程 ${fails.length} 项未过`); process.exit(1); }
  console.log('\n✅ F3 牌局直播旅程全通过: 高光 beat 真发出 + 终局/定地主战报到位 + 真人不配台词/灵魂入戏 + 炸弹高光档(斗地主+掼蛋)');
}
main().catch(e => { console.error(e); process.exit(1); });
