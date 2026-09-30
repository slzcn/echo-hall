#!/usr/bin/env node
'use strict';
// test-guandan-rules.js — 掼蛋牌型识别 / 比较 / 百搭替换 / 级牌抬权 单测
const R = require('../js/games/guandan-rules.js');

let pass = 0, fail = 0;
function ok(cond, msg){ if(cond){ pass++; } else { fail++; console.error('✗ '+msg); } }

// 造牌小工具: c('h',5)=♥5, c('s',14)=♠A, c('h',2,'x')=第二副♥2, jk('big')/jk('small')
const SUIT = {s:'♠',h:'♥',c:'♣',d:'♦'};
function c(suitKey, natRank, sfx){
  const rank = natRank === 2 ? 15 : natRank;   // 自然点2 → deck rank 15
  const suit = SUIT[suitKey];
  return { rank, suit, joker:null, label:String(natRank), id:(suitKey+rank)+(sfx||'') };
}
function jk(kind, sfx){ return { rank: kind==='big'?17:16, suit:null, joker:kind, label:kind==='big'?'W':'w', id:(kind==='big'?'jb':'js')+(sfx||'') }; }

// ── 基础牌型(level=2, ♥2 为百搭) ──────────────────────────
const L = 2;
ok(R.parse([c('s',7)], L).type==='single', '单张');
ok(R.parse([c('s',7),c('h',7)], L).type==='pair', '对子');
ok(R.parse([c('s',7),c('h',7),c('c',7)], L).type==='trio', '三张');
ok(R.parse([c('s',7),c('h',7),c('c',7),c('s',9),c('d',9)], L).type==='fullhouse', '三带二');
ok(R.parse([c('s',3),c('h',4),c('c',5),c('s',6),c('d',7)], L).type==='straight', '顺子 34567');
ok(R.parse([c('s',10),c('h',11),c('c',12),c('s',13),c('d',14)], L).type==='straight', '顺子 10JQKA');
ok(R.parse([c('s',14),c('h',3),c('c',4),c('s',5),c('d',6)], L)===null || R.parse([c('s',14),c('h',2),c('c',3),c('s',4),c('d',5)],L).type==='straight', '占位');
ok(R.parse([c('s',14),c('h',2),c('c',3),c('s',4),c('d',5)], L).type==='straight', '顺子 A2345(A作低)');
ok(R.parse([c('s',11),c('h',12),c('c',13),c('s',14),c('d',2)], L)===null, 'JQKA2 不是顺子(不回绕)');
ok(R.parse([c('s',5),c('h',5),c('c',6),c('h',6),c('s',7),c('d',7)], L).type==='pairline', '连对 556677');
ok(R.parse([c('s',5),c('h',5),c('c',5),c('s',6),c('h',6),c('d',6)], L).type==='trioline', '钢板 555666');

// ── 炸弹层级 ────────────────────────────────────────────────
const b4 = R.parse([c('s',9),c('h',9),c('c',9),c('d',9)], L);
const b5 = R.parse([c('s',9),c('h',9),c('c',9),c('d',9),c('s',9,'x')], L);
const b6 = R.parse([c('s',9),c('h',9),c('c',9),c('d',9),c('s',9,'x'),c('h',9,'x')], L);
const sf = R.parse([c('s',3),c('s',4),c('s',5),c('s',6),c('s',7)], L);
const jb = R.parse([jk('big'),jk('big','x'),jk('small'),jk('small','x')], L);
ok(b4 && b4.type==='bomb' && b4.size===4, '4 张炸');
ok(b5 && b5.size===5, '5 张炸');
ok(sf && sf.type==='straightflush', '同花顺');
ok(jb && jb.type==='jokerbomb', '四大天王');
ok(R.beats(b5, b4, L), '5 炸 > 4 炸');
ok(R.beats(sf, b5, L), '同花顺 > 5 炸');
ok(R.beats(b6, sf, L), '6 炸 > 同花顺');
ok(R.beats(jb, b6, L), '四大天王 > 6 炸');
ok(R.beats(b4, R.parse([c('s',14),c('h',14),c('c',14)], L), L), '炸弹压三张(非炸)');
ok(!R.beats(R.parse([c('s',3)],L), b4, L), '单张压不过炸');

// ── 级牌抬权(level=5): 5 比 A 大, 比王小 ────────────────────
const L5 = 5;
const pairLevel = R.parse([c('s',5),c('c',5)], L5);   // 一对级牌
const pairA = R.parse([c('s',14),c('c',14)], L5);
ok(pairLevel.key===15 && pairA.key===14, '级牌对 key=15 > A 对 key=14');
ok(R.beats(pairLevel, pairA, L5), '级牌对 > A 对');
const pSmallJ = R.parse([jk('small'),jk('small','x')], L5);
const pBigJ = R.parse([jk('big'),jk('big','x')], L5);
ok(pSmallJ && pSmallJ.type==='pair' && pSmallJ.key===16, '双小王成对(力16>级牌对)');
ok(pBigJ && pBigJ.type==='pair' && pBigJ.key===17, '双大王成对(力17>小王对)');
ok(R.beats(pSmallJ, pairLevel, L5), '小王对 > 级牌对');
ok(R.beats(pBigJ, pSmallJ, L5), '大王对 > 小王对');
ok(R.parse([jk('big'),jk('small','x')], L5)===null, '一大一小点数不同, 不成对');
// 顺子里级牌按自然点(不抬权): 34567 里含级牌5, 仍是普通顺子, key=7
const stWithLevel = R.parse([c('s',3),c('h',4),c('c',5),c('s',6),c('d',7)], L5);
ok(stWithLevel && stWithLevel.type==='straight' && stWithLevel.key===7, '顺子里级牌按自然点(key=7)');

// ── 逢人配 / 百搭(♥level 替任意非王) ───────────────────────
// level=2 → ♥2 是百搭
const wild = c('h',2);         // ♥2 百搭
const wild2 = c('h',2,'x');    // 第二张百搭
ok(R.isWild(wild, L), '♥2 在 level=2 时是百搭');
ok(!R.isWild(c('s',2), L), '♠2 不是百搭(只有红桃级牌)');
// 百搭凑对: ♠7 + 百搭 = 对 7
const wpair = R.parse([c('s',7), wild], L);
ok(wpair && wpair.type==='pair' && wpair.key===7, '百搭凑对7');
// 百搭凑三: ♠7 ♣7 + 百搭 = 三条7
ok(R.parse([c('s',7),c('c',7),wild], L).type==='trio', '百搭凑三条');
// 百搭补顺子缺口: 3 4 _ 6 7 (缺5, 百搭补)
const wstraight = R.parse([c('s',3),c('h',4),wild,c('s',6),c('d',7)], L);
ok(wstraight && wstraight.type==='straight' && wstraight.key===7, '百搭补顺子缺口');
// 百搭补炸弹: 999 + 百搭 = 4 张炸9
ok(R.parse([c('s',9),c('h',9),c('c',9),wild], L).type==='bomb', '百搭凑炸弹');
// 两张百搭补三带二: 77 + 双百搭 = 三带二? 77(对) + 2百搭当三张... 需 trio+pair
const wfh = R.parse([c('s',7),c('c',7),c('s',9),wild,wild2], L);
ok(wfh && wfh.type==='fullhouse', '双百搭凑三带二');
// 百搭不能替王: 单张大王 + 百搭 ≠ 对(王对只能真王)
ok(R.parse([jk('big'), wild], L)===null, '百搭不替王(大王+百搭不成对)');

// ── beats 反对称性 抽样 ────────────────────────────────────
const A = R.parse([c('s',8),c('h',8)], L), B = R.parse([c('s',6),c('h',6)], L);
ok(R.beats(A,B,L) && !R.beats(B,A,L), '对子比较反对称');
ok(!R.beats(A, R.parse([c('s',9),c('h',9),c('c',9)],L), L), '对子压不过三张(异型)');

// ── 首出/空桌 ──────────────────────────────────────────────
ok(R.beats(R.parse([c('s',3)],L), null, L), '首出任意合法牌型');
ok(!R.beats(null, null, L), 'null 不算合法');

console.log(`\nguandan-rules: ${pass} 通过, ${fail} 失败`);
if (fail) process.exit(1);
