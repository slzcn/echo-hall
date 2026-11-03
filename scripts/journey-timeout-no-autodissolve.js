#!/usr/bin/env node
'use strict';
/* journey-timeout-no-autodissolve.js
 *
 * 旅程: 连续回合超时【不得】把本席踢离座位 / 【不得】触发腾座散桌链。
 * 背景: v145/v146「两次超时→离座」+ gtCheckNoHumansThenClose 会在单人桌
 *       (或最后一人)把整局销毁 = 用户反馈的「游戏自动结束」。
 *       诊断单: docs/triage/2026-11-02-game-auto-end-timeout-exit.md
 *
 * 场景:
 *   A. host 独自对 AI，连续 3 次回合超时 → 仍在座、未 vacate（座位保留）
 *   B. 远程席超时仍应离座交 AI（防联机卡死）— 契约不变
 *   C. 反证: 旧实现(本席 idleOut→doEnterSpectator)在场景 A 必红
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function loadGame() {
  const dom = new JSDOM('<!doctype html><body><div id="hall"></div></body>', { pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  win.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
  win.cancelAnimationFrame = id => clearTimeout(id);
  win.scrollTo = () => {};
  const ctx = dom.getInternalVMContext();
  for (const f of ['js/games/deck.js', 'js/games/ddz-rules.js', 'js/games/ddz-engine.js', 'js/games/ddz-ai.js', 'js/games/game-ui.js']) {
    vm.runInContext(R(f) + '\n//# sourceURL=' + f, ctx, { filename: f });
  }
  return win;
}

function runScenario(opts) {
  return new Promise(resolve => {
    const win = loadGame();
    const idleSeats = [];
    let vacate = false, mineVacate = false, spec = false;
    const game = win.EHDdzGame.open({
      mount: win.document.getElementById('hall'),
      mySeat: 0, seed: 7, isHost: true, actMs: 40, maxMiss: 2,
      onSeatIdle: (seat, info) => {
        idleSeats.push(seat);
        if (info && info.vacate) vacate = true;
        if (info && info.vacate && info.mine) mineVacate = true;
      },
      onSync: () => {},
    });
    const t0 = Date.now();
    const poll = setInterval(() => {
      try { if (game.isSpectating()) spec = true; } catch (_) {}
    }, 10);
    // 用测试驱动接口连续触发本席超时(比等真实计时器更稳)
    setTimeout(() => {
      try { if (game._forceTimeout) game._forceTimeout(); } catch (_) {}
    }, 80);
    setTimeout(() => {
      try { if (game._forceTimeout) game._forceTimeout(); } catch (_) {}
    }, 200);
    setTimeout(() => {
      try { if (game._forceTimeout) game._forceTimeout(); } catch (_) {}
    }, 320);
    setTimeout(() => {
      clearInterval(poll);
      try { game.close(); } catch (_) {}
      resolve({ vacate, mineVacate, spec, idleSeats, ms: Date.now() - t0, forceTimeout: typeof game._forceTimeout === 'function' });
    }, opts.waitMs || 600);
  });
}

(async () => {
  console.log('旅程: 连续超时不得自动离座/散桌 …');

  // ── 场景 A: 本席连续超时 → 座位保留 ──
  const A = await runScenario({ waitMs: 700 });
  console.log('  A 本席×3 超时:', JSON.stringify(A));
  const okA = A.forceTimeout && !A.mineVacate && !A.spec && !A.vacate;
  if (okA) console.log('  ✓ A: 本席超时后仍在座，未触发腾座（不会连锁解散）');
  else console.error('  ✗ A: 期望仍在座且不 vacate，实际 spec=' + A.spec + ' vacate=' + A.vacate + ' mineVacate=' + A.mineVacate);

  // ── 场景 C: 反证旧实现（本席 idleOut → doEnterSpectator → vacate）──
  //   在当前源码上「模拟旧契约」：若把 idleOut(本席) 改回 doEnterSpectator，A 的 mineVacate 应为 true。
  //   这里用源码断言代替真回滚：idleOut 对 mySeat 分支不得再调用 doEnterSpectator。
  const ui = R('js/games/game-ui.js');
  const idleOutBlock = ui.slice(ui.indexOf('function idleOut(seat)'), ui.indexOf('function resumeSeat'));
  const oldImplCallsEnter = /if \(seat===mySeat\)\{\s*doEnterSpectator\(\)/.test(idleOutBlock)
    || /seat===mySeat\)\{\s*doEnterSpectator/.test(idleOutBlock);
  const okC = !oldImplCallsEnter;
  if (okC) console.log('  ✓ C 反证契约: idleOut(本席) 已不再 doEnterSpectator（旧实现必红）');
  else console.error('  ✗ C: idleOut(本席) 仍调用 doEnterSpectator = 旧错误实现');

  // ── 场景 B: 源码契约 — 远程席 idleOut 仍应腾座 ──
  const okB = /onSeatIdle\)\{\s*try\{\s*onSeatIdle\(seat,\s*\{\s*mine:false\s*\}\)/.test(idleOutBlock)
    || /onSeatIdle\(seat,\s*\{\s*mine:false\s*\}\)/.test(idleOutBlock);
  if (okB) console.log('  ✓ B: 远程席超时仍走 onSeatIdle(mine:false) 腾座/交 AI');
  else console.error('  ✗ B: 远程席 idleOut 契约丢失');

  // ── 掼蛋/德州同契约抽查 ──
  const gd = R('js/games/guandan-ui.js');
  const pk = R('js/games/poker-ui.js');
  const gdOk = /seat===mySeat\)\{\s*toast\('连续超时 · 已自动代打/.test(gd) || /座位保留/.test(gd);
  const pkOk = /座位保留/.test(pk) && !/if \(seat===mySeat\)\{\s*doEnterSpectator\(\)/.test(pk.slice(pk.indexOf('function idleOut'), pk.indexOf('function resumeSeat') + 200));
  if (gdOk) console.log('  ✓ 掼蛋: 本席超时不离座');
  else console.error('  ✗ 掼蛋: 本席仍会离座');
  if (pkOk) console.log('  ✓ 德州: 本席超时不离座');
  else console.error('  ✗ 德州: 本席仍会离座');

  // ── 假超时防护: onHumanTimeout 不得在未推进时 bumpMiss（德州）──
  const pkFnAt = pk.indexOf('function onHumanTimeout(){');
  const pkTimeout = pk.slice(pkFnAt, pkFnAt + 900);
  const pkSafe = /beforeToAct/.test(pkTimeout) && /turnSeatActive\s*=\s*-1/.test(pkTimeout)
    && /if \(st\.toAct!==beforeToAct \|\| st\.phase==='over'\) bumpMiss/.test(pkTimeout);
  if (pkSafe) console.log('  ✓ 德州: 超时仅在真正出牌后计 miss（防假两连）');
  else console.error('  ✗ 德州: onHumanTimeout 仍可能假计 miss');

  const ok = okA && okB && okC && gdOk && pkOk && pkSafe;
  console.log(ok ? '\n✅ 旅程通过: 连续超时不会把本席踢走/散桌；远程席契约保留；旧实现必红' : '\n❌ 旅程失败');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
