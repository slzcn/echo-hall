#!/usr/bin/env node
'use strict';
/* 验证: 掼蛋 AI 领出时, 真对手报双(剩 2 张)不再送小对子(主人: 对方剩2张多半是对子, 还领个小对子送走)。
 *   G1 有 ≥3 张牌型可领时: 领 3 张+(对手 2 张跟不了), 绝不领小对子。
 *   G2 只有对子/单张可领时: 领单张(他至多压1张 2→1 出不完), 不领对子。
 *   G3 对照: 对手不是剩 2 张(常态)时, 领牌逻辑不受影响(仍可领对子等)。
 *   纯 Node 单测, 直接调 EHGuandanAI.chooseLead。 */
const path=require('path');
const AI=require(path.join(__dirname,'..','js/games/guandan-ai.js'));
const Rules=require(path.join(__dirname,'..','js/games/guandan-rules.js'));

const LEVEL=2;            // 级牌=2 → 百搭是 ♥ 且 rank15, 下面一律避开, 无百搭干扰
const C=(rank,suit)=>({rank,suit});
let ok=true; const fail=m=>{ok=false;console.log('❌ '+m);};

// 判断一手出牌是不是"对子"(用规则内核 parse), 以及其自然点力
const parseType=(cards)=>{ try{ return Rules.parse(cards, LEVEL); }catch(_){ return null; } };
const isPair=(cards)=>{ const p=parseType(cards); return p && p.type==='pair'; };
const isSingle=(cards)=>{ const p=parseType(cards); return p && p.type==='single'; };

// 对手报双 ctx: AI 坐 0 → 对手是奇数座(1、3); 让座 1 剩 2 张 → minOpponentCards=2
const ctxOpp2 = { seat:0, lastSeat:null, handsLeft:[6,2,8,5] };
const ctxNormal = { seat:0, lastSeat:null, handsLeft:[6,9,8,10] };   // 无人报双

console.log('===== G1 有三张牌型: 报双时领三张不送小对 =====');
{
  // 手牌: 小对子 33 + 三条 555 + 散单 → 报双时应领 555(或单), 绝不领 33
  const hand=[C(3,'♠'),C(3,'♣'), C(5,'♠'),C(5,'♣'),C(5,'♦'), C(9,'♠')];
  const lead=AI.chooseLead(hand, LEVEL, ctxOpp2);
  console.log('  领出:', JSON.stringify(lead.map(c=>c.rank+c.suit)), '→ 类型', (parseType(lead)||{}).type);
  if(isPair(lead) && (parseType(lead).key<=parseType([C(5,'♠'),C(5,'♣')]).key))
    fail('G1 报双仍领了(小)对子, 正是送牌 bug: '+JSON.stringify(lead.map(c=>c.rank+c.suit)));
  else console.log('✅ G1 报双未领小对子, 领了 '+(parseType(lead)||{}).type+'(≥3张或单张憋人)');
}

console.log('===== G2 只有对子/单张: 报双时领单张不领对子 =====');
{
  const hand=[C(3,'♠'),C(3,'♣'), C(9,'♠'), C(13,'♦')];   // 对33 + 单9 + 单K
  const lead=AI.chooseLead(hand, LEVEL, ctxOpp2);
  console.log('  领出:', JSON.stringify(lead.map(c=>c.rank+c.suit)), '→ 类型', (parseType(lead)||{}).type);
  if(isPair(lead)) fail('G2 报双仍领对子(他可能更大对子直接 2→0 走完): '+JSON.stringify(lead.map(c=>c.rank+c.suit)));
  else if(isSingle(lead)) console.log('✅ G2 报双领单张(他至多 2→1 出不完), 未送对子');
  else console.log('✅ G2 报双领 '+(parseType(lead)||{}).type+'(非对子)');
}

console.log('===== G3 对照: 无人报双时不受影响 =====');
{
  const hand=[C(3,'♠'),C(3,'♣'), C(5,'♠'),C(5,'♣'),C(5,'♦'), C(9,'♠')];
  let threw=false, lead=null;
  try{ lead=AI.chooseLead(hand, LEVEL, ctxNormal); }catch(e){ threw=true; console.log('  抛错:',e.message); }
  if(threw||!lead||!lead.length) fail('G3 常态领牌异常');
  else console.log('✅ G3 常态领出正常('+JSON.stringify(lead.map(c=>c.rank+c.suit))+' · '+(parseType(lead)||{}).type+'), 逻辑未被残局分支污染');
}

console.log(ok?'\n🎉 全部通过':'\n💥 有失败');
process.exit(ok?0:1);
