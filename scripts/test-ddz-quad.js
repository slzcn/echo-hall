#!/usr/bin/env node
'use strict';
// test-ddz-quad.js — 斗地主 AI「四带二」(quad_single 四带两单 / quad_pair 四带两对)出牌策略。
// 守护: ①首出能生成四带二候选; ②跟牌能用更大的四张压对手的四带二(不必浪费炸弹);
//        ③estTricks 把「炸 + 2 散翼」并作 1 手(四带二), 不再高估手数; ④四带二解析合法。
const AI = require('../js/games/ddz-ai.js');
const R  = require('../js/games/ddz-rules.js');
const D  = require('../js/games/deck.js');

let pass=0, fail=0;
function ok(cond,msg){ if(cond){pass++;} else {fail++; console.error('✗ '+msg);} }
function c(rank, suit){ return D.makeCard(rank, suit||'♠'); }
const S=['♠','♥','♣','♦'];
function quad(rank){ return S.map(s=>c(rank,s)); }   // 四张同点(四色)

// ── ① 首出: 候选里应含四带二(手里有炸 + 散翼) ──
{
  // 8888 + 3 + 5 (恰好 6 张 = 一手四带两单走完)
  const hand = [...quad(8), c(3), c(5)];
  const { plays } = AI.candidates(hand, null);
  const qs = plays.find(p=>p.parse.type==='quad_single');
  ok(!!qs, '首出: 生成 quad_single 候选');
  ok(qs && qs.cards.length===6, '首出: quad_single 恰 6 张');
  // 能一把走完 → decide 应直接打出整手
  const d = AI.decide({ hand, tableParse:null, seat:0, handsLeft:[6,9,9], landlord:0 });
  ok(d.action==='play' && d.cards.length===6, '首出: 6 张四带二一把走完');
}

// ── ② 首出: 四带两对 ──
{
  // 9999 + 33 + 55 (8 张 = 四带两对走完)
  const hand = [...quad(9), c(3,'♠'),c(3,'♥'), c(5,'♠'),c(5,'♥')];
  const { plays } = AI.candidates(hand, null);
  const qp = plays.find(p=>p.parse.type==='quad_pair');
  ok(!!qp, '首出: 生成 quad_pair 候选');
  ok(qp && qp.cards.length===8, '首出: quad_pair 恰 8 张');
}

// ── ③ 跟牌: 桌面四带两单, 我有更大的四张 → 用四带二压(而非炸弹) ──
{
  // 桌面 7777+3+4; 我手 TTTT(10) + 2,3,还有别的牌
  const target = R.parse([...quad(7), c(3,'♥'), c(4,'♥')]);
  ok(target && target.type==='quad_single', '桌面解析为 quad_single');
  const hand = [...quad(10), c(3), c(6), c(9,'♥'), c(9,'♣')];
  const { plays } = AI.candidates(hand, target);
  const beat = plays.find(p=>p.parse.type==='quad_single');
  ok(!!beat, '跟牌: 生成能压的 quad_single(更大四张)');
  ok(beat && R.beats(beat.parse, target), '跟牌: 该四带二确实压过桌面');
  const d = AI.decide({ hand, tableParse:target, seat:1, lastSeat:0, handsLeft:[6,8,9], landlord:0 });
  ok(d.action==='play', '跟牌: 决定出牌(不是过)');
  ok(d.action==='play' && R.beats(R.parse(d.cards), target), '跟牌: 出的牌压得过桌面四带二');
}

// ── ④ 跟牌: 桌面四带两对, 我有更大四张 → 四带两对压 ──
{
  const target = R.parse([...quad(6), c(3,'♠'),c(3,'♥'), c(4,'♠'),c(4,'♥')]);
  ok(target && target.type==='quad_pair', '桌面解析为 quad_pair');
  const hand = [...quad(11), c(3,'♠'),c(3,'♥'), c(5,'♠'),c(5,'♥'), c(9,'♣')];
  const { plays } = AI.candidates(hand, target);
  const beat = plays.find(p=>p.parse.type==='quad_pair' && R.beats(p.parse, target));
  ok(!!beat, '跟牌: 生成能压的 quad_pair');
}

// ── ⑤ estTricks: 炸 + 2 散单 应并作 1 手(四带两单), 不是 3 手 ──
{
  // 直接调内部? estTricks 未导出 → 用 hints/leadScore 间接验: 8888+3+5 领出首条=走完(6张)
  const hand = [...quad(8), c(3), c(5)];
  const h = AI.hints(hand, null);
  ok(h[0] && h[0].length===6, 'estTricks: 8888+3+5 领出首条=一把走完(6张四带二)');
}

// ── ⑥ 四带两单两翼必须不同点(否则解析失败) ──
{
  // 8888 + 33(一对) → pickQuadSingles 不该选出同点两张; 应生成 quad_single 用 3 + 别的点。
  // 这里手里只有 8888+3+3 = 6 张, 两翼只能是 3,3(同点) → 解析为四带一对? 引擎无此型 → 应【不生成】quad_single。
  const hand = [...quad(8), c(3,'♠'), c(3,'♥')];
  const { plays } = AI.candidates(hand, null);
  const qs = plays.find(p=>p.parse && p.parse.type==='quad_single');
  ok(!qs, '两翼同点(仅 3,3): 不生成非法 quad_single');
  // 但炸弹本身仍是合法候选(bombs)
  const { bombs } = AI.candidates(hand, null);
  ok(bombs.length===1, '仍识别出炸弹');
}

console.log(`\n四带二: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
