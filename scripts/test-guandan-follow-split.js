#!/usr/bin/env node
'use strict';
// test-guandan-follow-split.js — 掼蛋 AI 跟牌【别拆成型牌型】守护。
// 主人反馈"拆牌不好": 跟一手小牌时, 过去以 playCost(只看点力+拆炸/三/对)为主序, 看不见顺子/连对/钢板,
//   会挑 key 最小的牌哪怕它正是顺子中段, 一刀把成型顺子拆成一堆孤张。改为 estTricks(剩余手数)为主序后,
//   拆结构的走法手数飙升会被自然淘汰。本测守护跟牌路径保留顺子/连对, 且不为此白扔大牌(有孤小张先走孤小张)。
const AI = require('../js/games/guandan-ai.js');
const Rules = require('../js/games/guandan-rules.js');

let pass = 0, fail = 0;
function ok(cond, msg){ if(cond){pass++;} else {fail++; console.error('✗ '+msg);} }
let _id = 0;
function C(rank, suit){ return { id:'c'+(_id++), rank, suit, joker: rank===16?'small':rank===17?'big':undefined }; }
function ids(cards){ return cards.map(c=>c.id).sort().join(','); }
const LV = 2; // 打 2, 牌里不放 ♥2 → 无百搭干扰

// ── ① 顺子完整: 跟单张 5, 手里有成型顺子 3-4-5-6-7 + 孤张 9 → 该出孤张 9, 别拆顺子 ──
{
  const straight = [C(3,'♠'),C(4,'♣'),C(5,'♦'),C(6,'♠'),C(7,'♣')];
  const lone = C(9,'♥');
  const hand = [...straight, lone];
  const target = Rules.parse([C(5,'♠')], LV);
  ok(target && target.type==='single', '桌面=单张 5');
  const d = AI.decide({ hand, tableParse:target, seat:0, lastSeat:1, handsLeft:[6,8,7,9], level:LV });
  ok(d.action==='play', '① 跟牌: 出牌不过');
  ok(d.action==='play' && d.cards.length===1 && d.cards[0].id===lone.id,
     '① 跟单张: 出孤张 9 保住顺子(不拆 6/7)');
  // 反证: 出后应仍是 1 手(完整顺子), 而拆顺子会变 5 手
  const rest = hand.filter(c=>c.id!==d.cards[0].id);
  ok(AI.estTricks(rest, LV) === 1, '① 出后剩余=完整顺子(1 手)');
}

// ── ② 连对完整: 跟单张 4, 手里 5566778(连对 55-66-77)+ 孤张 T(10) → 出孤张 10, 别拆连对 ──
{
  const pairline = [C(5,'♠'),C(5,'♣'), C(6,'♠'),C(6,'♣'), C(7,'♠'),C(7,'♣')];
  const lone = C(10,'♥');
  const hand = [...pairline, lone];
  const target = Rules.parse([C(4,'♠')], LV);
  const d = AI.decide({ hand, tableParse:target, seat:0, lastSeat:1, handsLeft:[7,8,7,9], level:LV });
  ok(d.action==='play' && d.cards.length===1 && d.cards[0].id===lone.id,
     '② 跟单张: 出孤张 10 保住连对(不拆 5/6/7)');
  ok(AI.estTricks(hand.filter(c=>c.id!==d.cards[0].id), LV) === 1, '② 出后剩余=完整连对(1 手)');
}

// ── ③ 不白扔大牌: 有孤小张(9)时优先走孤小张, 别为"少一手"去甩大单张 A ──
//     手数相同(9 与 A 都是独立孤张)→ 次序 playCost 选点力低的 9。
{
  const straight = [C(3,'♠'),C(4,'♣'),C(5,'♦'),C(6,'♠'),C(7,'♣')];
  const hand = [...straight, C(9,'♥'), C(14,'♦')]; // + 孤 9 + 孤 A
  const target = Rules.parse([C(8,'♠')], LV); // 桌面单张 8 → 9 和 A 都能压
  const d = AI.decide({ hand, tableParse:target, seat:0, lastSeat:1, handsLeft:[7,8,7,9], level:LV });
  ok(d.action==='play' && d.cards.length===1 && d.cards[0].rank===9,
     '③ 跟单张 8: 出孤张 9(不白扔 A, 手数相同挑点力低)');
}

// ── ④ 拆结构确有收益时仍拆: 桌面单张 8, 手里只有顺子 4-8(含 8)可压, 无更优孤张 → 允许拆 ──
{
  const hand = [C(4,'♠'),C(5,'♣'),C(6,'♦'),C(7,'♠'),C(8,'♣')]; // 顺子 4-8, 仅 8 能压单张? 单张需 >8
  // 桌面单张 7 → 顺子里的 8 能压; 没有别的牌 → 只能拆顺子出 8
  const target = Rules.parse([C(7,'♥')], LV);
  const d = AI.decide({ hand, tableParse:target, seat:0, lastSeat:1, handsLeft:[5,8,7,9], level:LV });
  ok(d.action==='play' && d.cards.length===1 && d.cards[0].rank===8,
     '④ 无更优选择时: 允许拆顺子出唯一能压的 8');
}

console.log(`\n掼蛋跟牌拆牌: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
