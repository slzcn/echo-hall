#!/usr/bin/env node
'use strict';
// test-poker-eval.js — 德州扑克成手牌评估/比较系统性测试
// 守护: 9 档牌型识别正确 · 破平(点数/踢脚)正确 · A-2-3-4-5 轮抽顺 · 7 张自动取最优 5 张 · 档间大小序。
const E = require('../js/games/poker-eval.js');

let pass = 0, fail = 0;
function ok(cond, msg){ if (cond){ pass++; } else { fail++; console.error('✗ ' + msg); } }
function c(rank, suit){ return { rank, suit }; }
// 简写: "As" "Kd" "Th" "2c" → {rank,suit}
const RK = { A:14, K:13, Q:12, J:11, T:10 };
const SU = { s:'♠', h:'♥', c:'♣', d:'♦' };
function h(str){ return str.trim().split(/\s+/).map(t => {
  const rc = t[0], sc = t[1];
  const rank = RK[rc] != null ? RK[rc] : parseInt(rc, 10);
  return c(rank, SU[sc]);
}); }
const ev = str => E.evaluate(h(str));
const cmp = (a, b) => E.compare(ev(a), ev(b));

// ── ① 九档牌型识别 ──
ok(ev('As Ks Qs Js Ts').cat === E.CAT.SF, '皇家同花顺 → 同花顺档');
ok(ev('As Ks Qs Js Ts').tie[0] === 14, '皇家同花顺 → 高牌 A(14)');
ok(ev('As Ks Qs Js Ts').name === '皇家同花顺', 'A 高同花顺单独命名为皇家同花顺');
ok(ev('9s 8s 7s 6s 5s').name === '同花顺', '非 A 高同花顺仍叫同花顺');
ok(ev('5h 4h 3h 2h Ah').cat === E.CAT.SF && ev('5h 4h 3h 2h Ah').tie[0] === 5, '钢轮 A-2-3-4-5 同花顺 → 高牌 5');
ok(ev('Ac Ad Ah As Kd').cat === E.CAT.QUADS, '四条识别');
ok(ev('Ac Ad Ah Ks Kd').cat === E.CAT.FULL, '葫芦识别');
ok(ev('As Ts 7s 4s 2s').cat === E.CAT.FLUSH, '同花识别');
ok(ev('Ts Jd Qc Kh As').cat === E.CAT.STRAIGHT && ev('Ts Jd Qc Kh As').tie[0] === 14, '百老汇顺子 → 高牌 A');
ok(ev('Ah 2d 3c 4s 5h').cat === E.CAT.STRAIGHT && ev('Ah 2d 3c 4s 5h').tie[0] === 5, '轮抽顺(A 作 1) → 高牌 5');
ok(ev('Ac Ad Ah Ks Qd').cat === E.CAT.TRIPS, '三条识别');
ok(ev('Ac Ad Ks Kd Qh').cat === E.CAT.TWO_PAIR, '两对识别');
ok(ev('Ac Ad Ks Qd Jh').cat === E.CAT.PAIR, '一对识别');
ok(ev('Ac Kd Qh Js 9d').cat === E.CAT.HIGH, '高牌识别');

// ── ② 档间大小序: SF>四条>葫芦>同花>顺>三条>两对>对>高牌 ──
const chain = ['As Ks Qs Js Ts', 'Ac Ad Ah As Kd', 'Ac Ad Ah Ks Kd', 'As Ts 7s 4s 2s',
               'Ts Jd Qc Kh As', 'Ac Ad Ah Ks Qd', 'Ac Ad Ks Kd Qh', 'Ac Ad Ks Qd Jh', 'Ac Kd Qh Js 9d'];
for (let i = 0; i + 1 < chain.length; i++){
  ok(cmp(chain[i], chain[i+1]) === 1, `档间序: [${ev(chain[i]).name}] 大于 [${ev(chain[i+1]).name}]`);
}

// ── ③ 破平: 牌型档相同, 比点数/踢脚 ──
ok(cmp('Ac Ad Ks Qd Jh', 'Kc Kd As Qd Jh') === 1, '对A > 对K');
ok(cmp('Kc Kd As Qd Jh', 'Kc Kd Qs Jd 9h') === 1, '对K·A踢脚 > 对K·Q踢脚');
ok(cmp('Ac Ad Ks Kd Qh', 'Ac Ad Ks Kd Jh') === 1, '两对AAKK·Q踢 > 同两对·J踢');
ok(cmp('Ac Ad Ks Kd Qh', 'Ac Ad Qs Qd Kh') === 1, '两对AAKK > 两对AAQQ(次对更大)');
ok(cmp('As Ts 7s 4s 2s', 'Ks Qs 7s 4s 2s') === 1, '同花 A高 > K高');
ok(cmp('Ac Ad Ah Ks Kd', 'Kc Kd Kh As Ad') === 1, '葫芦AAA-KK > KKK-AA(三条点先比)');
ok(cmp('6s 5d 4c 3h 2s', 'Ah 2d 3c 4s 5h') === 1, '顺 6高 > 轮抽 5高');

// ── ④ 相等牌返回 0(公共牌成手, 花色不计) ──
ok(cmp('Ts Jd Qc Kh As', 'Th Jc Qd Ks Ad') === 0, '同一顺子(不同花色) → 相等');
ok(E.compare(ev('Ac Ad 5s 5d 9h'), ev('Ad Ah 5c 5h 9d')) === 0, '同两对同踢脚 → 相等');

// ── ⑤ 7 张自动取最优 5 张 ──
ok(E.evaluate(h('As Ks 2h 5s 9s 3d Qs')).cat === E.CAT.FLUSH, '7张: 5张黑桃 → 同花(丢掉非同花牌)');
{
  // 手 A♠A♥ + 公共 A♦K♣K♠2♦3♥ → 最优=葫芦 AAA-KK
  const r = E.evaluate(h('As Ah Ad Kc Ks 2d 3h'));
  ok(r.cat === E.CAT.FULL && r.tie[0] === 14 && r.tie[1] === 13, '7张: AAAKK → 葫芦 AAA-KK');
}
{
  // 7张里两个三条(AAA + KKK) → 葫芦取高三条 + 低三条当对
  const r = E.evaluate(h('As Ah Ad Kc Kh Kd 2s'));
  ok(r.cat === E.CAT.FULL && r.tie[0] === 14 && r.tie[1] === 13, '7张双三条 → 葫芦AAA-KKK取AAA+KK');
}
{
  // 7张: 顺子藏在里面 5-6-7-8-9, 外加杂牌
  const r = E.evaluate(h('9c 8d 7h 6s 5c Ah Kd'));
  ok(r.cat === E.CAT.STRAIGHT && r.tie[0] === 9, '7张: 内嵌顺子 5-9 → 顺子高牌9');
}
{
  // 四条压过同花: 7张里既有同花听感又有四条 → 必须选四条
  const r = E.evaluate(h('7s 7h 7c 7d As Ks Qs'));
  ok(r.cat === E.CAT.QUADS, '7张: 四条优先于潜在同花');
}

console.log(`\n德州扑克评估器: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
