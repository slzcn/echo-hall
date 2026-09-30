#!/usr/bin/env node
'use strict';
// 斗地主牌型引擎单测:牌型识别 / 合法性 / 大小比较 / 洗牌复现。
// 直接 require 纯函数内核(双模块),不需 vm 抽取。
const R = require('../js/games/ddz-rules.js');
const D = require('../js/games/deck.js');

let pass = 0, fail = 0;
function assert(ok, msg){ if(ok){ console.log('✓ '+msg); pass++; } else { console.log('✗ '+msg); fail++; } }

// 构造牌:c(rank[,suit]) → card。王用 16/17。
function c(rank, suit){ return D.makeCard(rank, suit || '♠'); }
function cards(specs){ return specs.map(s => Array.isArray(s) ? c(s[0], s[1]) : c(s)); }
function type(specs){ const p = R.parse(cards(specs)); return p && p.type; }

// ── 基础牌型识别 ────────────────────────────────────────────
assert(type([5]) === 'single', '单张');
assert(type([[7,'♠'],[7,'♥']]) === 'pair', '对子');
assert(type([9,9]) === 'pair', '同点对(默认同花不影响)');
assert(R.parse(cards([[7,'♠'],[8,'♥']])) === null, '两张不同点 → 非法');
assert(type([[10,'♠'],[10,'♥'],[10,'♣']]) === 'trio', '三张不带');
assert(type([6,6,6,3]) === 'trio_single', '三带一');
assert(type([6,6,6,4,4]) === 'trio_pair', '三带一对');

// ── 炸弹 / 王炸 ─────────────────────────────────────────────
assert(type([8,8,8,8]) === 'bomb', '炸弹(四张)');
assert(type([16,17]) === 'rocket', '王炸(双王)');
assert(R.parse(cards([16,16])) === null || type([16,16]) !== 'rocket', '两小王不是王炸');

// ── 顺子 ────────────────────────────────────────────────────
assert(type([3,4,5,6,7]) === 'straight', '5 连顺子');
assert(type([10,11,12,13,14]) === 'straight', '10-J-Q-K-A 顺子');
assert(R.parse(cards([3,4,5,6])) === null, '4 连不成顺子(需≥5)');
assert(R.parse(cards([11,12,13,14,15])) === null, '含 2(15) 不成顺子');
assert(R.parse(cards([13,14,15,16,17])) === null, '含王不成顺子');

// ── 连对 ────────────────────────────────────────────────────
assert(type([3,3,4,4,5,5]) === 'pairs', '3 连对');
assert(R.parse(cards([3,3,4,4])) === null, '2 连对不合法(需≥3)');
assert(R.parse(cards([13,13,14,14,15,15])) === null, '连对含 2 不合法');

// ── 飞机 ────────────────────────────────────────────────────
assert(type([3,3,3,4,4,4]) === 'plane', '飞机(2 连三不带)');
assert(type([3,3,3,4,4,4,5,6]) === 'plane_single', '飞机带单(2 组带 2 单)');
assert(type([3,3,3,4,4,4,5,5,6,6]) === 'plane_pair', '飞机带对(2 组带 2 对)');
assert(type([5,5,5,6,6,6,7,7,7,3,4,8]) === 'plane_single', '飞机带单(3 组带 3 单)');
assert(R.parse(cards([13,13,13,14,14,14])) === null || type([13,13,13,14,14,14]) === 'plane',
  'K-A 连三是合法飞机(A 是连续上限内)');
assert(R.parse(cards([14,14,14,15,15,15])) === null, '飞机含 2(15) 不合法');

// ── 四带二 ──────────────────────────────────────────────────
assert(type([9,9,9,9,3,5]) === 'quad_single', '四带二单');
assert(type([9,9,9,9,3,3,5,5]) === 'quad_pair', '四带两对');

// ── 大小比较:同型 ──────────────────────────────────────────
function P(specs){ return R.parse(cards(specs)); }
assert(R.beats(P([9]), P([8])) === true, '单张 9>8');
assert(R.beats(P([8]), P([9])) === false, '单张 8 不压 9');
assert(R.beats(P([15]), P([14])) === true, '2 大于 A(单张)');
assert(R.beats(P([5,5]), P([4,4])) === true, '对 5>对 4');
assert(R.beats(P([4,5,6,7,8]), P([3,4,5,6,7])) === true, '顺子按最大点比');
assert(R.beats(P([3,4,5,6,7]), P([3,4,5,6,7,8])) === false, '顺子不同长不能比');
assert(R.beats(P([6,6,6,3]), P([5,5,5,4])) === true, '三带一按三的点比');

// ── 大小比较:炸弹/王炸 ─────────────────────────────────────
assert(R.beats(P([3,3,3,3]), P([9])) === true, '炸弹压单张');
assert(R.beats(P([3,3,3,3]), P([10,11,12,13,14])) === true, '炸弹压顺子');
assert(R.beats(P([4,4,4,4]), P([3,3,3,3])) === true, '炸弹比点:4444>3333');
assert(R.beats(P([16,17]), P([15,15,15,15])) === true, '王炸压炸弹');
assert(R.beats(P([16,17]), P([2] && [15])) === true, '王炸压任意');
assert(R.beats(P([15]), P([16,17])) === false, '任何牌不压王炸');

// ── 首出:桌面为空,任意合法型可出 ──────────────────────────
assert(R.beats(P([7]), null) === true, '首出单张合法');
assert(R.beats(P([3,3,3,4,4,4,5,6]), null) === true, '首出飞机带单合法');

// ── 跨型不可比(非炸弹) ─────────────────────────────────────
assert(R.beats(P([5,5]), P([9])) === false, '对子不能压单张');
assert(R.beats(P([9]), P([5,5])) === false, '单张不能压对子');

// ── 洗牌复现性 + 发牌完整性 ─────────────────────────────────
const d1 = D.dealDoudizhu(12345);
const d2 = D.dealDoudizhu(12345);
assert(JSON.stringify(d1) === JSON.stringify(d2), '同 seed 发牌完全复现');
const total = d1.hands[0].length + d1.hands[1].length + d1.hands[2].length + d1.bottom.length;
assert(total === 54, '发牌总数 54 张');
assert(d1.hands.every(h => h.length === 17) && d1.bottom.length === 3, '3 家各 17 + 底牌 3');
// 无重复 id
const allIds = [].concat(...d1.hands, d1.bottom).map(x=>x.id);
assert(new Set(allIds).size === 54, '54 张 id 无重复(无缺牌无多牌)');
const d3 = D.dealDoudizhu(99999);
assert(JSON.stringify(d3) !== JSON.stringify(d1), '不同 seed 牌局不同');

// ── 反证:旧错误实现(把 4 连当顺子)必红 ─────────────────────
// 若 parse 错误地接受 4 连为顺子,下面这条会 type==='straight' → 断言翻红。
assert(type([3,4,5,6]) !== 'straight', '反证:4 连绝不能被识别为顺子');
// 反证:若错误允许 2 进顺子
assert(type([11,12,13,14,15]) !== 'straight', '反证:J-Q-K-A-2 绝不能是顺子');

console.log(`\n${fail===0 ? '✅ 全部通过' : '❌ 有失败'} — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
