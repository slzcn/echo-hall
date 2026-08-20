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

// ── ⑪ 残局意识: 真对手报单(剩1张)时领出, 全是单张 → 甩最大单张憋他, 不送小单 ← 主人报的"我剩1张AI还出小单张"──
{
  // 地主(seat0)手里全散单: 3/6/9/K; 农民 seat1 报单(剩1张)
  const hand = [c(3),c(6),c(9),c(13)];
  const r1 = AI.decide({ seat:0, hand, tableParse:null, lastSeat:null, handsLeft:[4,1,5], landlord:0, iAmLandlord:true });
  ok(r1.action==='play' && r1.cards.length===1 && r1.cards[0].rank===13, '残局全单张·对手报单: 领最大单张(K)憋他, 不送最小单(3)');
  // 无人报单(都剩5张) → 照常领最小单张清散牌
  const r2 = AI.decide({ seat:0, hand, tableParse:null, lastSeat:null, handsLeft:[4,5,5], landlord:0, iAmLandlord:true });
  ok(r2.action==='play' && r2.cards.length===1 && r2.cards[0].rank===3, '残局全单张·无人报单: 照常领最小单张(3)清散牌');
}

// ── ⑫ 残局意识: 有多张牌型可领时·对手报单 → 优先领非单牌型(剩1张跟不了) ──
{
  // 手牌: 一对7 + 散单 4/10; 农民 seat1 报单
  const hand = [c(4), c(7,'♠'), c(7,'♥'), c(10)];
  const r = AI.decide({ seat:0, hand, tableParse:null, lastSeat:null, handsLeft:[4,1,5], landlord:0, iAmLandlord:true });
  ok(r.action==='play' && r.cards.length>=2, '残局有对子·对手报单: 领非单牌型(≥2张)憋住报单者');
}

// ── ⑬ 队友报单不误判为对手(我是农民, 队友农民剩1张不该改变领出策略) ──
{
  // 我 seat1 农民, 地主 seat0; 队友 seat2 农民报单(剩1) → 队友不是对手, minOpp 只看地主
  const hand = [c(3),c(6),c(9),c(13)];
  const r = AI.decide({ seat:1, hand, tableParse:null, lastSeat:null, handsLeft:[5,4,1], landlord:0, iAmLandlord:false });
  ok(r.action==='play' && r.cards[0].rank===3, '队友(农民)报单不算对手: 照常领最小单张');
}

// ── ⑭ 三带一领出: 翼挑「真散张」不拆对子 ← 主人报的"三带一/三带二做得不够好" ──
{
  // 三条5 + 一对3 + 散单9 → 三带一应带散单9, 绝不抠一张3把对子拆了
  const hand = [c(5,'♠'),c(5,'♥'),c(5,'♣'), c(3,'♠'),c(3,'♥'), c(9,'♦')];
  const h = AI.hints(hand, null);
  const tri1 = h.map(pick=>({pick,p:R.parse(pick)})).find(x=>x.p && x.p.type==='trio_single');
  ok(!!tri1, '三带一领出: 提示里有三带一');
  if (tri1){
    const wing = tri1.pick.find(x=>x.rank!==5);
    ok(wing && wing.rank===9, '三带一领出: 翼=散单9(不拆对子3)');
    ok(!tri1.pick.some(x=>x.rank===3), '三带一领出: 没抠对子3的牌');
  }
}

// ── ⑮ 跟单张: 有散张就出散张, 不为跟小单拆对子 ──
{
  const target = R.parse([c(3)]);                 // 桌面: 单3
  const hand = [c(6,'♦'), c(4,'♠'), c(4,'♥')];    // 散单6 + 一对4
  const h = AI.hints(hand, target);
  ok(sameSet(h[0], [hand[0]]), '跟小单: 首选散单6(留住对子4, 不拆对)');
}

// ── ⑯ 跟单张: 唯一散张是大牌时, 宁拆低对子也别浪费大单张 ──
{
  const target = R.parse([c(3)]);                 // 桌面: 单3
  const hand = [c(13,'♦'), c(4,'♠'), c(4,'♥')];   // 散单K + 一对4
  const h = AI.hints(hand, target);
  ok(h[0] && h[0].length===1 && h[0][0].rank===4, '跟小单: 散张是K→改拆低对子出单4(不浪费K)');
}

// ── ⑰ 提示接入报单意识(ctx): 对手报单时领出, 多张牌型提到最前(憋住剩1张的他) ──
{
  // 手牌: 一对7 + 散单 4/10; 地主 seat0, 农民 seat1 报单(剩1张)
  const hand = [c(4), c(7,'♠'), c(7,'♥'), c(10)];
  const ctx = { seat:0, handsLeft:[4,1,5], landlord:0 };
  const h = AI.hints(hand, null, ctx);
  ok(h[0] && h[0].length>=2, '提示·对手报单: 首条=多张牌型(不甩小单送他走)');
  // 不传 ctx → 退回老行为(不因报单改序), 首条仍是清散牌的最优
  const h2 = AI.hints(hand, null);
  ok(h2.length>0, '提示·无ctx: 兼容旧签名不报错');
}

// ── ⑱ 提示·报单+全单张: 改大单张优先(他大概率压不过) ──
{
  const hand = [c(3), c(6), c(9), c(13)];   // 全散单
  const ctx = { seat:0, handsLeft:[4,1,5], landlord:0 };
  const h = AI.hints(hand, null, ctx);
  ok(h[0] && h[0].length===1 && h[0][0].rank===13, '提示·报单全单张: 首条=最大单张K(不送最小单3)');
}

console.log(`\n斗地主提示智能: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
