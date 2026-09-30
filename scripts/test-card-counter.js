#!/usr/bin/env node
'use strict';
// test-card-counter.js — 记牌器/出牌历史计算内核单测(纯函数)。
const assert = require('assert');
const CC = require('../js/games/card-counter.js');

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m + ` (得 ${a} 期 ${b})`); n++; };

// ── rankOfId: 普通牌/王/第二副尾缀 ───────────────────────────────
eq(CC.rankOfId('s14'), 14, 'A');
eq(CC.rankOfId('h3'), 3, '3');
eq(CC.rankOfId('d15'), 15, '2');
eq(CC.rankOfId('c11'), 11, 'J');
eq(CC.rankOfId('js'), 16, '小王');
eq(CC.rankOfId('jb'), 17, '大王');
eq(CC.rankOfId('s14x'), 14, '掼蛋第二副 A');
eq(CC.rankOfId('jsx'), 16, '掼蛋第二副小王');
eq(CC.rankOfId('jbx'), 17, '掼蛋第二副大王');

// ── remaining: 斗地主(1 副)满副 = 4 普通/1 王 ──────────────────
{
  const r = CC.remaining([], 1);
  eq(r.length, 15, '15 个 rank');
  eq(r[0].rank, 17, '首列大王');
  eq(r[0].total, 1, '大王满副 1');
  eq(r[0].remain, 1, '大王未出剩 1');
  const three = r.find(x => x.rank === 3);
  eq(three.total, 4, '3 满副 4');
  eq(three.remain, 4, '3 未出剩 4');
}

// ── remaining: 出了牌后扣减 ──────────────────────────────────────
{
  const log = [
    { t: 'deal' },
    { t: 'play', seat: 0, cards: ['s14', 'h14'] },  // 两张 A
    { t: 'pass', seat: 1 },
    { t: 'play', seat: 2, cards: ['jb'] },          // 大王
    { t: 'play', seat: 0, cards: ['s3', 'h3', 'c3'] }, // 三张 3
  ];
  const r = CC.remaining(log, 1);
  eq(r.find(x => x.rank === 14).remain, 2, 'A 出 2 剩 2');
  eq(r.find(x => x.rank === 17).remain, 0, '大王出光');
  eq(r.find(x => x.rank === 3).remain, 1, '3 出 3 剩 1');
  eq(r.find(x => x.rank === 15).remain, 4, '2 未出仍 4');
}

// ── remaining: 掼蛋(2 副)满副 = 8 普通/2 王, 尾缀牌照样计 ────────
{
  const log = [
    { t: 'play', seat: 0, cards: ['s14', 's14x'] }, // 两副各一张 A
    { t: 'play', seat: 1, cards: ['jb', 'jbx'] },   // 两张大王
  ];
  const r = CC.remaining(log, 2);
  eq(r.find(x => x.rank === 14).total, 8, '掼蛋 A 满副 8');
  eq(r.find(x => x.rank === 14).remain, 6, '掼蛋 A 出 2 剩 6');
  eq(r.find(x => x.rank === 17).total, 2, '掼蛋大王满副 2');
  eq(r.find(x => x.rank === 17).remain, 0, '掼蛋大王出光');
}

// ── history: 倒序取最近 n, play 带 label, pass 无 ─────────────────
{
  const log = [
    { t: 'deal' },
    { t: 'play', seat: 0, cards: ['s14', 'h14'] },
    { t: 'pass', seat: 1 },
    { t: 'play', seat: 2, cards: ['jb'] },
  ];
  const h = CC.history(log, ['甲', '乙', '丙', '丁'], 8);
  eq(h.length, 3, '3 条动作(deal 不计)');
  eq(h[0].name, '丙', '最近在前=丙');
  eq(h[0].kind, 'play', '丙出牌');
  eq(h[0].labels.join(','), '大王', '丙出大王');
  eq(h[1].kind, 'pass', '乙不出');
  eq(h[1].labels, null, 'pass 无 label');
  eq(h[2].labels.join(','), 'A,A', '甲出对 A');
}
// history 截断: 只留最后 n
{
  const log = [];
  for (let i = 0; i < 20; i++) log.push({ t: 'play', seat: i % 4, cards: ['s3'] });
  eq(CC.history(log, [], 8).length, 8, '截断到 8 条');
}

console.log(`\n✅ card-counter 内核 ${n} 断言全过`);
