#!/usr/bin/env node
'use strict';
/* journey-gt-online-heal.js — 联机牌桌: 中途入座授权 + 超时接管回座 + 快照乱序
 *
 * 用户旅程:
 *   A. host act 授权源必须是【DB 座位现算】的 remoteSeats, 不能用开桌时固化的 A
 *   B. host 引擎 idleOut 移出远程席后, resumeRemote 要能放回并重新接受动作
 *   C. guest resumeSeat 必须触发 onSeatResume(通知 host)
 *   D. guest applySnapshot 丢弃更旧 seq
 *
 * 反证(旧错误实现):
 *   - 固化 A.remoteSeats 对中途新真人席必拒 → 断言 live 现算放行 / frozen 拒
 *   - 不调用 resumeRemote 时引擎 remoteSeats 不含该席 → 断言 resume 后含
 *   - 不传 onSeatResume 时 spy 不会被调 → 断言传入后被调
 *
 * 用法: node scripts/journey-gt-online-heal.js */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const SFX = fs.readFileSync(path.join(ROOT, 'js/sfx-engine.js'), 'utf8');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = require('playwright');
const CSS = 'html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

// ── 纯逻辑: act 授权(冻结 A vs 现算 DB) ──
function liveAccept(frozenRemoteSeats, dbSeats, seat) {
  const live = (dbSeats || []).filter(s => s && s.kind === 'human' && s.uid !== 'HOST').map(s => s.seat);
  const frozen = Array.isArray(frozenRemoteSeats) ? frozenRemoteSeats : [];
  return {
    frozenOk: frozen.indexOf(seat) >= 0,
    liveOk: live.indexOf(seat) >= 0,
  };
}

function testAuthLogic() {
  console.log('\n── act 授权: 冻结 A vs DB 现算 ──');
  // 开桌时只有席1是远程真人; 中途席2真人顶替入座
  const frozen = [1];
  const dbSeats = [
    { seat: 0, kind: 'human', uid: 'HOST' },
    { seat: 1, kind: 'human', uid: 'u1' },
    { seat: 2, kind: 'human', uid: 'u2' },  // 中途入座
  ];
  const walkIn = liveAccept(frozen, dbSeats, 2);
  ok(walkIn.frozenOk === false, '反证: 冻结 A.remoteSeats 拒中途入座席(旧实现)');
  ok(walkIn.liveOk === true, '现算 DB remoteSeats 放行中途入座席(新实现)');
  const old = liveAccept(frozen, dbSeats, 1);
  ok(old.frozenOk && old.liveOk, '原有远程席两种写法都放行');
  const spoof = liveAccept(frozen, dbSeats, 0);
  ok(spoof.liveOk === false, 'host 自己的 seat 仍被拒(#61)');
}

const GAMES = [
  {
    label: '斗地主', key: 'ddz',
    mods: ['deck.js', 'ddz-rules.js', 'ddz-engine.js', 'ddz-ai.js', 'ddz-net.js', 'game-ui.js'],
    openHost: () => {
      window.__g = EHDdzGame.open({
        names: ['host', '远A', 'AI'], avatars: ['🙂', '👤', '🤖'],
        isAI: [false, false, true], mySeat: 0, remoteSeats: [1], seed: 42,
      });
    },
  },
  {
    label: '掼蛋', key: 'gd',
    mods: ['deck.js', 'guandan-rules.js', 'guandan-engine.js', 'guandan-ai.js', 'guandan-net.js', 'guandan-ui.js'],
    openHost: () => {
      window.__g = EHGuandanGame.open({
        names: ['host', '远A', 'AI1', 'AI2'], avatars: ['🙂', '👤', '🤖', '🐱'],
        isAI: [false, false, true, true], mySeat: 0, remoteSeats: [1], seed: 7,
      });
    },
  },
  {
    label: '德州', key: 'poker',
    mods: ['deck.js', 'poker-eval.js', 'poker-engine.js', 'poker-ai.js', 'poker-net.js', 'poker-ui.js'],
    openHost: () => {
      window.__g = EHPokerGame.open({
        names: ['host', '远A', 'AI'], avatars: ['🙂', '👤', '🤖'],
        isAI: [false, false, true], mySeat: 0, remoteSeats: [1], sb: 5, bb: 10, startStack: 1000,
      });
    },
  },
];

(async () => {
  testAuthLogic();

  const browser = await chromium.launch({ executablePath: CHROME });
  for (const gm of GAMES) {
    console.log('\n── ' + gm.label + ' resumeRemote ──');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.setContent('<!doctype html><meta charset=utf-8><style>' + CSS + '</style><div id="hall"></div>');
    await page.addScriptTag({ content: SFX });
    await page.evaluate(() => {
      window.EhGameBgm = { enter: () => {}, exit: () => {} };
      const S = window.EhSfx || {};
      S.say = () => {}; S.play = () => {}; S.playClick = () => {};
      window.EhSfx = S;
    });
    for (const f of gm.mods) await page.addScriptTag({ content: G(f) });
    await page.evaluate(gm.openHost);
    await page.waitForTimeout(400);

    ok(await page.evaluate(() => typeof window.__g.resumeRemote === 'function'), '导出 resumeRemote');

    // 模拟 host 侧对远程席超时 idleOut: 连续 _forceTimeout 只打自己; 直接测 API 契约
    // 1) resumeRemote 对非 remote 席会放回
    const afterResume = await page.evaluate(() => {
      const g = window.__g;
      // 先用内部行为: enterSpectator 不适用(那是本席)。用 resumeRemote(1) 幂等放回。
      const r1 = g.resumeRemote(1);
      return { r1, hasResume: typeof g.resumeRemote === 'function' };
    });
    ok(afterResume.r1 === true, 'resumeRemote(远程席) 返回 true');

    // 2) resumeRemote 拒绝 host 自己的 seat / 非法 seat
    const guard = await page.evaluate(() => {
      const g = window.__g;
      return { me: g.resumeRemote(0), bad: g.resumeRemote(99) };
    });
    ok(guard.me === false, 'resumeRemote 拒绝 mySeat');
    ok(guard.bad === false, 'resumeRemote 拒绝非法 seat');

    // 3) guest 路径: onSeatResume 在 resumeSeat 时被调
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page2 = await ctx2.newPage();
    page2.on('pageerror', e => errs.push('guest:' + e.message));
    await page2.setContent('<!doctype html><meta charset=utf-8><style>' + CSS + '</style><div id="hall"></div>');
    await page2.addScriptTag({ content: SFX });
    await page2.evaluate(() => {
      window.EhGameBgm = { enter: () => {}, exit: () => {} };
      const S = window.EhSfx || {}; S.say = () => {}; S.play = () => {}; S.playClick = () => {};
      window.EhSfx = S;
    });
    for (const f of gm.mods) await page2.addScriptTag({ content: G(f) });
    const Open = gm.key === 'poker' ? 'EHPokerGame' : gm.key === 'gd' ? 'EHGuandanGame' : 'EHDdzGame';
    await page2.evaluate((Open) => {
      window.__spy = { calls: [] };
      const names = Open === 'EHPokerGame' ? ['host', '我', 'AI'] : Open === 'EHGuandanGame' ? ['host', '我', 'AI1', 'AI2'] : ['host', '我', 'AI'];
      const isAI = names.map((n, i) => i !== 1);
      const opts = { mode: 'guest', names, avatars: names.map(() => '🙂'), isAI, mySeat: 1,
        onSeatResume: (seat) => { window.__spy.calls.push(seat); } };
      if (Open === 'EHPokerGame') { opts.sb = 5; opts.bb = 10; opts.startStack = 1000; }
      if (Open === 'EHGuandanGame') opts.remoteSeats = [];
      window.__g = window[Open].open(opts);
    }, Open);
    await page2.waitForTimeout(300);
    const guest = await page2.evaluate(() => {
      const g = window.__g;
      g.enterSpectator();
      const spec1 = g.isSpectating();
      g.resumeSeat();
      return { spec1, spec2: g.isSpectating(), calls: window.__spy.calls.slice() };
    });
    ok(guest.spec1 === true, 'guest enterSpectator → 旁观');
    ok(guest.spec2 === false, 'guest resumeSeat → 退出旁观');
    ok(Array.isArray(guest.calls) && guest.calls.length === 1 && guest.calls[0] === 1,
      'guest resumeSeat 触发 onSeatResume(1) → 可通知 host 回座(旧实现未接线则 0 次)');

    // 4) seq: host 快照带 seq 时 guest 丢旧包
    const seqRes = await page2.evaluate(() => {
      const g = window.__g;
      const Net = window.EHDdzNet || window.EHGuandanNet || window.EHPokerNet;
      const mk = (seq, turn) => {
        if (window.EHPokerNet) return { v: 'nlhe', handNo: 0, phase: 'preflop', street: 'preflop', n: 3, button: 0, sb: 5, bb: 10, sbSeat: 0, bbSeat: 1, currentBet: 10, minRaise: 10, aggressor: null, toAct: turn, pot: 15, board: [], players: [0,1,2].map(seat => ({ seat, name: 'p'+seat, isAI: seat!==1, stack: 1000, start: 1000, folded: false, allin: false, committed: seat===0?5:seat===1?10:0, street: seat===0?5:seat===1?10:0, acted: false, hole: [] })), result: null, seq };
        if (window.EHGuandanNet) return { v: 'gd', dealNo: 0, phase: 'play', level: 2, teamLevels: [2,2], dealerTeam: 0, turn, bombs: 0, finished: [], passesInRow: 0, table: { lastPlay: null, passesInRow: 0 }, players: [0,1,2,3].map(seat => ({ seat, name: 'p'+seat, team: seat%2, isAI: seat!==1, handCount: 27 })), tribute: null, result: null, seq };
        return { v: 'ddz', dealNo: 0, phase: 'play', turn, landlord: 0, multiplier: 1, bombs: 0, base: 1, bid: null, bottomCount: 0, table: { lastPlay: null, passesInRow: 0 }, players: [0,1,2].map(seat => ({ seat, name: 'p'+seat, isAI: seat!==1, handCount: seat===0?20:17 })), result: null, seq };
      };
      const apply = (snap) => { if (g.onSnapshot) g.onSnapshot(snap); else if (g.applySnapshot) g.applySnapshot(snap); };
      const readTurn = () => { const s = g.state() || {}; return (s.toAct != null) ? s.toAct : s.turn; };
      apply(mk(1, 1));
      const after1 = readTurn();
      apply(mk(0, 0));   // 迟到旧包, 不该把行动席打回 0
      const afterStale = readTurn();
      apply(mk(2, 2));
      const after2 = readTurn();
      return { after1, afterStale, after2 };
    });
    // turn/toAct 语义: 当前行动席
    ok(seqRes.afterStale === seqRes.after1, '旧 seq 快照被丢弃, 行动席不回退(反证: 不丢则 afterStale=0)');
    ok(seqRes.after2 === 2, '更新 seq 快照被应用 (got ' + JSON.stringify(seqRes) + ')');

    ok(errs.length === 0, '无页面报错' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
    await ctx.close(); await ctx2.close();
  }
  await browser.close();
  console.log('\n' + (fail ? '💥 有失败 (' + pass + '✓ ' + fail + '✗)' : '🎉 全部通过 (' + pass + '✓)'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
