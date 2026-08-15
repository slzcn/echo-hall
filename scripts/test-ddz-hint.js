#!/usr/bin/env node
'use strict';
// test-ddz-hint.js — 斗地主「提示」智能系统性测试(与掼蛋同病同守护)
// 守护: 剩一对领出不该拆成单张一张张出; 能一把走完最优先; 跟牌走最小代价、炸弹垫底; 只提示合法(可压)牌。
const AI = require('../js/games/ddz-ai.js');
const R = require('../js/games/ddz-rules.js');
const D = require('../js/games/deck.js');

let pass=0, fail=0;
function ok(cond,msg){ if(cond){pass++;} else {fail++; console.error('✗ '+msg);} }
function c(rank, suit){ return D.makeCard(rank, suit||'♠'); }
function ids(cards){ return cards.map(x=>x.id).sort().join(','); }
function sameSet(a,b){ return ids(a)===ids(b); }

// ── ① 剩两张=对子, 领出 → 首条提示=打整对(走完), 不拆单张 ← 主人报的 bug 类 ──
{
  const hand = [c(7,'♠'), c(7,'♥')];
  const h = AI.hints(hand, null);
  ok(h.length>0, '对子领出: 有提示');
  ok(h[0] && h[0].length===2 && sameSet(h[0], hand), '对子领出: 首条=打整对走完, 不是单张');
}

// ── ② 剩三张=三张领出 → 首条=打整组走完 ──
{
  const hand = [c(9,'♠'), c(9,'♥'), c(9,'♣')];
  const h = AI.hints(hand, null);
  ok(h[0] && h[0].length===3 && sameSet(h[0], hand), '三张领出: 首条=打整组走完');
}

// ── ③ 手牌正好=顺子(5连), 领出 → 首条=顺子走完 ──
{
  const hand = [c(3),c(4),c(5),c(6),c(7)];
  const h = AI.hints(hand, null);
  ok(h[0] && h[0].length===5, '顺子领出: 首条=一把走完(5张)');
}

// ── ④ 领出无法走完: 先长牌型清散牌, 不首选甩 2/王大单张 ──
{
  // 顺子 3-4-5-6-7 + 大单张 2(15) → 应先提示顺子
  const hand = [c(3),c(4),c(5),c(6),c(7),c(15)];
  const h = AI.hints(hand, null);
  const p0 = R.parse(h[0]);
  ok(p0 && p0.type!=='single', '领出混合手: 首条不是甩大单张');
  ok(h[0].length===5, '领出混合手: 首条=顺子清5张');
}

// ── ⑤ 跟单张: 最小能压的单张优先, 且每条都真能压 ──
{
  const target = R.parse([c(5)]);              // 桌面: 单 5
  const hand = [c(6,'♣'), c(9,'♦'), c(9,'♠')];  // 单6 + 一对9
  const h = AI.hints(hand, target);
  ok(h.length>0, '跟单张: 有能压的提示');
  ok(h.every(pick => { const p=R.parse(pick); return p && R.beats(p, target); }), '跟单张: 每条提示都真能压');
  ok(sameSet(h[0], [hand[0]]), '跟单张: 首条=最小能压单张(单6)');
}

// ── ⑥ 跟牌有炸: 炸弹垫底, 首选普通牌 ──
{
  const target = R.parse([c(5)]);
  const hand = [c(9,'♣'), c(3,'♠'), c(3,'♥'), c(3,'♣'), c(3,'♦')]; // 单9 + 炸(四个3)
  const h = AI.hints(hand, target);
  ok(sameSet(h[0], [hand[0]]), '跟牌有炸: 首选普通单9');
  ok(h[h.length-1].length===4, '跟牌有炸: 炸弹垫底');
}

// ── ⑦ 只有炸/王炸能压 → 必须提示(不空手) ──
{
  const target = R.parse([c(14,'♠'), c(14,'♥')]); // 桌面: 一对 A
  const hand = [c(3,'♠'), c(3,'♥'), c(3,'♣'), c(3,'♦'), c(6)]; // 炸(四个3) + 单6
  const h = AI.hints(hand, target);
  ok(h.length>0, '只有炸能压: 有提示');
  ok(h.every(pick => { const p=R.parse(pick); return p && R.beats(p, target); }), '只有炸能压: 提示真能压');
  ok(h[0].length===4, '只有炸能压: 首条=炸弹');
}

// ── ⑧ 压不过 → 空数组 ──
{
  const target = R.parse([c(16), c(17)]);       // 桌面: 王炸(通杀)
  const hand = [c(6), c(9,'♥'), c(9,'♣'), c(9,'♦'), c(9,'♠')]; // 有炸也压不过王炸
  const h = AI.hints(hand, target);
  ok(h.length===0, '压不过王炸: 返回空');
}

// ── ⑨ 最后一张=大单张 2, 领出 → 必须提示打它(唯一走完) ──
{
  const hand = [c(15)];
  const h = AI.hints(hand, null);
  ok(h.length===1 && sameSet(h[0], hand), '最后一张大单张: 提示打出走完(不因垫底而漏)');
}

// ── ⑩ 提示序列无重复 ──
{
  const hand = [c(7,'♠'),c(7,'♥'),c(9,'♦'),c(9,'♠'),c(6)];
  const h = AI.hints(hand, null);
  const keys = h.map(ids);
  ok(new Set(keys).size===keys.length, '提示序列无重复项');
}

console.log(`\n斗地主提示智能: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
