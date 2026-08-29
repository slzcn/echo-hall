#!/usr/bin/env node
'use strict';
// 残局推进修复验证(治"队友能走掉却不出"): 队友领出后, 我已进残局(≤3张)且不比队友更远时,
//   AI 该出一手推进牌把自己往走完推, 而不是干让(pass); 队友比我更近时仍让。斗地主+掼蛋各一组。
const DDZ = require('../js/games/ddz-ai.js');
const DR  = require('../js/games/ddz-rules.js');
const GD  = require('../js/games/guandan-ai.js');
const GR  = require('../js/games/guandan-rules.js');
const D   = require('../js/games/deck.js');

let pass=0, fail=0;
const ok=(c,m)=>{ if(c)pass++; else{fail++;console.log('❌',m);} };
const c=(rank,suit)=>D.makeCard(rank, suit||'♠');

// ── 斗地主: 我(seat0 农民)3张全单, 队友(seat1 农民)领出单4, 地主=seat2 ──
{
  const hand=[c(5,'♠'),c(7,'♣'),c(9,'♦')];                 // 三张散单, 压得过单4但没法一手全出
  const target=DR.parse([c(4,'♦')]);
  const base={ seat:0, hand, tableParse:target, lastSeat:1, landlord:2 };
  // 队友(seat1)剩5张 → 我(3张)更近 → 该推进
  const r1=DDZ.decide(Object.assign({}, base, { handsLeft:[3,5,17] }));
  ok(r1.action==='play', '斗地主·残局推进: 队友领出、我3张更近 → 出牌而非干让');
  ok(r1.action==='play' && r1.cards.length===1 && r1.cards[0].rank===5,
     '斗地主·残局推进: 平局挑代价最小 → 甩最小单5');
  // 队友(seat1)剩2张 → 队友更近 → 仍让他走(pass)
  const r2=DDZ.decide(Object.assign({}, base, { handsLeft:[3,2,17] }));
  ok(r2.action==='pass', '斗地主·队友更近(2<3): 仍让牌 pass, 不抢队友');
  // 手牌多(5张)不算残局 → 走原垫牌/让牌逻辑, 不被残局推进误触发一手全清以外的东西
  const many=[c(5,'♠'),c(7,'♣'),c(9,'♦'),c(11,'♠'),c(13,'♣')];
  const r3=DDZ.decide({ seat:0, hand:many, tableParse:target, lastSeat:1, landlord:2, handsLeft:[5,5,17] });
  ok(r3.action==='play', '斗地主·手牌多: 走垫牌助攻(仍出牌, 但非残局推进路径)');
}

// ── 掼蛋: 我(seat0)3张全单, 对家(seat2 队友)领出单6 ──
{
  const L=2;
  const hand=[c(5,'♠'),c(8,'♣'),c(10,'♦')];                // 压得过单6但没法一手全出
  const target=GR.parse([c(6,'♦')], L);
  const base={ seat:0, hand, tableParse:target, lastSeat:2, level:L };
  const r1=GD.decide(Object.assign({}, base, { handsLeft:[3,8,6,8] }));  // 队友(seat2)6张, 我3张更近
  ok(r1.action==='play', '掼蛋·残局推进: 对家领出、我3张更近 → 出牌而非干让');
  ok(r1.action==='play' && r1.cards.length===1, '掼蛋·残局推进: 出的是单张(推进不拆炸)');
  const r2=GD.decide(Object.assign({}, base, { handsLeft:[3,8,2,8] }));  // 对家仅2张更近
  ok(r2.action==='pass', '掼蛋·对家更近(2<3): 仍让牌 pass');
}

// ── 立即走完·含炸/王炸(治"手握能一把清空的牌却不打") ──────────────
{
  // 斗地主 跟牌: 整手四个9(炸弹), 对手(地主 seat1)领出单5 → 该炸出去赢, 而非拆单9
  const r1=DDZ.decide({ seat:0, hand:[c(9,'♠'),c(9,'♥'),c(9,'♣'),c(9,'♦')],
    tableParse:DR.parse([c(5,'♦')]), lastSeat:1, landlord:1, handsLeft:[4,6,17] });
  ok(r1.action==='play' && r1.cards.length===4, '斗地主·跟牌: 整手炸弹能压单牌走完 → 炸出去赢(不拆单)');
  // 斗地主 跟牌: 整手双王(王炸), 对手领出单A → 王炸走完, 而非拆单个王
  const r2=DDZ.decide({ seat:0, hand:[c(16),c(17)],
    tableParse:DR.parse([c(14,'♦')]), lastSeat:1, landlord:1, handsLeft:[2,6,17] });
  ok(r2.action==='play' && r2.cards.length===2, '斗地主·跟牌: 整手王炸能压单 → 王炸走完(不拆王)');
  // 斗地主 首出: 整手四个9 → 炸出去走完, 而非领单9
  const r3=DDZ.decide({ seat:0, hand:[c(9,'♠'),c(9,'♥'),c(9,'♣'),c(9,'♦')],
    tableParse:null, lastSeat:null, landlord:2, handsLeft:[4,6,17] });
  ok(r3.action==='play' && r3.cards.length===4, '斗地主·首出: 整手炸弹 → 炸出去走完(不领单)');
  // 队友领出也一样: 整手炸弹能压 → 炸出去赢(农民清空即赢), 不让不垫
  const r4=DDZ.decide({ seat:0, hand:[c(9,'♠'),c(9,'♥'),c(9,'♣'),c(9,'♦')],
    tableParse:DR.parse([c(5,'♦')]), lastSeat:1, landlord:2, handsLeft:[4,6,17] });
  ok(r4.action==='play' && r4.cards.length===4, '斗地主·队友领出: 整手炸弹能压 → 炸出去赢(不干让)');
}
{
  // 掼蛋 跟牌: 整手四个8(天然炸弹), 对手(seat1)领出单6 → 炸出去走完
  const L=2;
  const r1=GD.decide({ seat:0, hand:[c(8,'♠'),c(8,'♥'),c(8,'♣'),c(8,'♦')],
    tableParse:GR.parse([c(6,'♦')],L), lastSeat:1, level:L, handsLeft:[4,8,6,8] });
  ok(r1.action==='play' && r1.cards.length===4, '掼蛋·跟牌: 整手炸弹能压单 → 炸出去走完(不拆单)');
}

{
  // 斗地主 chooseLead 直接调用(人类超时自动出/decide 兜底路径): 整手炸弹 → 领整炸走完, 不领单
  const hand=[c(9,'♠'),c(9,'♥'),c(9,'♣'),c(9,'♦')];
  const cand=DDZ.candidates(hand, null);
  const lead=DDZ.chooseLead(hand, cand.plays, cand.bombs, cand.rocket, {});
  ok(lead.length===4, '斗地主·chooseLead 直调: 整手炸弹 → 领整炸走完(不领单)');
}

console.log(`\n通过 ${pass} · 失败 ${fail}`);
process.exit(fail?1:0);
