#!/usr/bin/env node
'use strict';
/* journey-gd-level-wild.js — 打级时优先普通级牌, 不先打红桃百搭 */
const AI = require('../js/games/guandan-ai.js');
const Rules = require('../js/games/guandan-rules.js');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

const LV=2;
const mk=(rank,suit,id)=>({ rank, suit, id, label: rank===15?'2':(rank===11?'J':rank===12?'Q':rank===13?'K':rank===14?'A':String(rank)) });
// 手牌: ♥2 百搭 + ♦2 ♣2 ♠2 普通级 + 几张散牌
const hand=[
  mk(15,'♥','h2'), mk(15,'♦','d2'), mk(15,'♣','c2'), mk(15,'♠','s2'),
  mk(9,'♠','s9'), mk(8,'♥','h8'), mk(7,'♦','d7'),
];
assert(Rules.isWild(hand[0], LV), '♥2 是百搭');
assert(!Rules.isWild(hand[1], LV), '♦2 是普通级牌');

const costWild = AI.playCost({ cards:[hand[0]], parse:Rules.parse([hand[0]],LV) }, hand, LV);
const costNat  = AI.playCost({ cards:[hand[1]], parse:Rules.parse([hand[1]],LV) }, hand, LV);
assert(costNat < costWild, `单张级牌: 普通♦2(${costNat}) 代价 < 百搭♥2(${costWild})`);

const wPen = AI.wildWastePenalty({ cards:[hand[0]], parse:Rules.parse([hand[0]],LV) }, hand, LV);
assert(wPen >= 100, '百搭当级牌且手里还有普通级 → 重罚 '+wPen);

assert(!AI.breaksBomb({ cards:[hand[1]], parse:Rules.parse([hand[1]],LV) }, hand, LV),
  '拆「3普通+百搭」级炸里的普通级 → 不算 breaksBomb');

// 领出: 应选普通级/散牌, 不应首推百搭
const lead = AI.chooseLead(hand, LV, null);
const leadHasWild = lead.some(c=>Rules.isWild(c, LV));
assert(!leadHasWild, '领出不首选红桃百搭 (实: '+lead.map(c=>c.id).join(',')+')');

// 跟牌: 桌面单张 5, 应用普通级/散牌压, 不用百搭
const five = mk(5,'♠','t5');
const target = Rules.parse([five], LV);
const follow = AI.decide({ seat:0, hand, tableParse:target, lastSeat:1, handsLeft:[hand.length,3,4,4], level:LV });
if (follow.action==='play'){
  assert(!follow.cards.some(c=>Rules.isWild(c, LV)), '跟牌不用百搭当级牌 (实: '+follow.cards.map(c=>c.id)+')');
} else {
  assert(true, '跟牌选择 pass (策略允许)');
}

// hints 同源: 首条若为级牌单张应是普通级
const hs = AI.hints({ hand, tableParse:target, level:LV, seat:0, lastSeat:1 });
if (hs.length){
  const first = hs[0];
  const lvlSingles = first.filter(c=>!c.joker && Rules.naturalRank(c)===LV);
  if (first.length===1 && lvlSingles.length===1){
    assert(!Rules.isWild(first[0], LV), 'hints 级牌单张优先普通花色');
  } else assert(true, 'hints 首条非级牌单 ('+first.map(c=>c.id)+')');
} else assert(true, 'hints 空(不可压)');

console.log('\n'+(failed?'❌ 有失败':'✅ 打级先普通级牌 / 留红桃百搭'));
process.exit(failed?1:0);
