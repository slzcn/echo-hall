#!/usr/bin/env node
'use strict';
// test-guandan-hint.js — 掼蛋「提示」智能系统性测试
// 复现并守护主人报的 bug: 剩两张牌是对子, 点提示不该一张张出, 而应直接提示打对子(一把走完)。
// 系统性覆盖提示应有的智能: 能走完最优先 / 领出走长牌型垫单张 / 跟牌最小代价、炸弹垫底 / 只提示合法(可压)牌。
const AI = require('../js/games/guandan-ai.js');
const Rules = require('../js/games/guandan-rules.js');

let pass = 0, fail = 0;
function ok(cond, msg){ if(cond){pass++;} else {fail++; console.error('✗ '+msg);} }

let _id = 0;
// rank: 3..14=3..A, 15='2'(最小), 16小王, 17大王
function C(rank, suit){ return { id:'c'+(_id++), rank, suit, joker: rank===16?'small':rank===17?'big':undefined }; }
function ids(cards){ return cards.map(c=>c.id).sort().join(','); }
function sameSet(a, b){ return ids(a)===ids(b); }
function parseOf(cards, level){ return Rules.parse(cards, level); }

const LV = 2; // 打 2, 避免 ♥2 百搭干扰(测试牌里不放 ♥2)

// ── ① 主人报的核心 bug: 剩两张=对子, 领出 → 首条提示必须是「打这对」(一把走完) ──
{
  const hand = [C(5,'♠'), C(5,'♣')];
  const h = AI.hints({ hand, tableParse:null, level:LV });
  ok(h.length>0, '对子领出: 有提示');
  ok(sameSet(h[0], hand), '对子领出: 首条提示=打整对(一把走完), 不是拆成单张');
  ok(h[0].length===2, '对子领出: 首条提示是 2 张而非 1 张 ← 主人报的 bug');
}

// ── ② 剩三张=三张, 领出 → 首条提示=打三张(走完) ──
{
  const hand = [C(7,'♠'), C(7,'♣'), C(7,'♦')];
  const h = AI.hints({ hand, tableParse:null, level:LV });
  ok(h[0] && h[0].length===3 && sameSet(h[0], hand), '三张领出: 首条=打整组走完');
}

// ── ③ 手牌正好凑成顺子(5 张), 领出 → 首条提示=打顺子走完 ──
{
  const hand = [C(3,'♠'), C(4,'♣'), C(5,'♦'), C(6,'♠'), C(7,'♣')];
  const h = AI.hints({ hand, tableParse:null, level:LV });
  ok(h[0] && h[0].length===5, '顺子领出: 首条=一把走完(5张)');
  const p = parseOf(h[0], LV);
  ok(p && (p.cards? true : true), '顺子领出: 提示合法牌型');
}

// ── ④ 领出且无法一把走完: 先出长牌型清散牌, 不首选甩大单张(A) ──
{
  // 顺子 3-4-5-6-7 + 一张大单张 A → 应先提示顺子, 而不是甩 A
  const hand = [C(3,'♠'), C(4,'♣'), C(5,'♦'), C(6,'♠'), C(7,'♣'), C(14,'♦')];
  const h = AI.hints({ hand, tableParse:null, level:LV });
  const p0 = parseOf(h[0], LV);
  ok(p0 && p0.type!=='single', '领出混合手: 首条不是甩单张(优先长牌型)');
  ok(h[0].length===5, '领出混合手: 首条=顺子(清 5 张)');
}

// ── ⑤ 跟牌: 用最小代价的合法牌压, 且所有提示都真能压过桌面 ──
{
  const target = parseOf([C(5,'♠')], LV);            // 桌面: 单 5
  const hand = [C(6,'♣'), C(9,'♦'), C(9,'♠')];        // 单6 / 一对9
  const h = AI.hints({ hand, tableParse:target, level:LV });
  ok(h.length>0, '跟单张: 有能压的提示');
  ok(h.every(pick => { const p=parseOf(pick, LV); return p && Rules.beats(p, target, LV); }),
     '跟单张: 每条提示都真能压过桌面(合法性)');
  ok(sameSet(h[0], [hand[0]]), '跟单张: 首条=最小的能压单张(单6), 不拆对子');
}

// ── ⑥ 跟牌: 有高单张也有炸弹 → 炸弹垫底, 首选普通牌 ──
{
  const target = parseOf([C(5,'♠')], LV);            // 桌面: 单 5
  const hand = [C(9,'♣'), C(3,'♠'), C(3,'♣'), C(3,'♦'), C(3,'♥')]; // 单9 + 四个3(炸)
  const h = AI.hints({ hand, tableParse:target, level:LV });
  ok(sameSet(h[0], [hand[0]]), '跟牌有炸: 首选普通单9, 不轻易上炸');
  const last = h[h.length-1];
  ok(last.length===4, '跟牌有炸: 炸弹排最后(垫底)');
}

// ── ⑦ 跟牌: 只有炸弹能压 → 必须提示炸弹(不能空手) ──
{
  const target = parseOf([C(14,'♠'), C(14,'♣')], LV); // 桌面: 一对 A
  const hand = [C(3,'♠'), C(3,'♣'), C(3,'♦'), C(3,'♥'), C(6,'♠')]; // 四个3(炸) + 单6
  const h = AI.hints({ hand, tableParse:target, level:LV });
  ok(h.length>0, '只有炸能压: 有提示(不空手)');
  ok(h.every(pick => { const p=parseOf(pick, LV); return p && Rules.beats(p, target, LV); }),
     '只有炸能压: 提示的牌真能压过');
  ok(h[0].length===4, '只有炸能压: 首条=炸弹');
}

// ── ⑧ 跟牌压不过 → 空数组(UI 会提示"只能不出") ──
{
  const target = parseOf([C(17,'♠')], LV);           // 桌面: 大王(最大单张)
  const hand = [C(6,'♠'), C(9,'♣'), C(10,'♦')];       // 全是小单张, 压不过
  const h = AI.hints({ hand, tableParse:target, level:LV });
  ok(h.length===0, '压不过: 返回空(交给 UI 提示不出)');
}

// ── ⑨ 最后一张=大单张 A, 领出 → 必须提示打它(唯一走完手段) ──
{
  const hand = [C(14,'♠')];
  const h = AI.hints({ hand, tableParse:null, level:LV });
  ok(h.length===1 && sameSet(h[0], hand), '最后一张大单张: 提示打出走完(不因"大单张垫底"而漏)');
}

// ── ⑩ 提示序列无重复(不同一手牌反复弹) ──
{
  const hand = [C(5,'♠'), C(5,'♣'), C(9,'♦'), C(9,'♠'), C(6,'♣')];
  const h = AI.hints({ hand, tableParse:null, level:LV });
  const keys = h.map(ids);
  ok(new Set(keys).size===keys.length, '提示序列无重复项');
}

// ── ⑪ 残局意识: 真对手报单(剩1张)时领出全散单 → 甩最大单张憋他, 不送小单 ──
{
  // 我 seat0(队 0/2), 对手 seat1/3; seat1 报单(剩1张)。手全散单 4/7/10/K
  const hand = [C(4,'♠'), C(7,'♣'), C(10,'♦'), C(13,'♠')];
  const r1 = AI.decide({ seat:0, hand, tableParse:null, lastSeat:null, handsLeft:[4,1,4,4], level:LV });
  ok(r1.cards.length===1 && r1.cards[0].rank===13, '残局全单张·对手报单: 领最大单张(K)憋他, 不送最小单(4)');
  // 无人报单 → 照常领最小单张清散牌
  const r2 = AI.decide({ seat:0, hand, tableParse:null, lastSeat:null, handsLeft:[4,5,4,4], level:LV });
  ok(r2.cards.length===1 && r2.cards[0].rank===4, '残局全单张·无人报单: 照常领最小单张(4)清散牌');
}

// ── ⑫ 残局意识: 有对子可领·对手报单 → 优先领非单牌型(报单者跟不了≥2张) ──
{
  const hand = [C(5,'♠'), C(8,'♣'), C(11,'♠'), C(11,'♥')]; // 散单5/8 + 一对J
  const r = AI.decide({ seat:0, hand, tableParse:null, lastSeat:null, handsLeft:[4,1,4,4], level:LV });
  ok(r.cards.length>=2, '残局有对子·对手报单: 领非单牌型(≥2张)憋住报单者');
}

// ── ⑬ 队友报单不误判为对手(队友 seat2 剩1张不改变领出策略) ──
{
  const hand = [C(4,'♠'), C(7,'♣'), C(10,'♦'), C(13,'♠')];
  const r = AI.decide({ seat:0, hand, tableParse:null, lastSeat:null, handsLeft:[4,4,1,4], level:LV });
  ok(r.cards[0].rank===4, '队友报单不算对手: 照常领最小单张(4)');
}

console.log(`\n掼蛋提示智能: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
