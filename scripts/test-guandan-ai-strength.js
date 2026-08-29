#!/usr/bin/env node
'use strict';
// 掼蛋 AI 棋力强化验证: 新首出(手数评估 leadScore)对比旧首出(牌型顺序), 用【同一把正确的 estTricks】
// 当公共标尺量化"领出这手后剩余最少出牌手数"——手数越少越接近走完(先出完者赢)。
// 断言: ① estTricks 在构造手牌上给出合理手数; ② 大批随机手牌里, 新版平均剩余手数 <= 旧版, 且明显更优。
const path=require('path');
const NEW=require(path.join(__dirname,'..','js/games/guandan-ai.js'));
const Deck=require(path.join(__dirname,'..','js/games/deck.js'));
const Rules=require(path.join(__dirname,'..','js/games/guandan-rules.js'));

// 旧首出基线(强化前的"牌型顺序"算法)内联复现 —— 用 NEW 导出的 genCombos(未改动)构候选,
// 按 长牌型→三→对→单 + 清牌数 排, 避大单。自包含=不依赖外部旧文件, 永久回归对照。
function oldLead(hand, level){
  let combos = NEW.genCombos(hand, level, 0);
  if (!combos.length) combos = NEW.genCombos(hand, level, NEW.groups(hand,level).wilds.length);
  if (!combos.length) return [hand[hand.length-1]];
  const fin = combos.find(c=>c.cards.length===hand.length); if (fin) return fin.cards;
  const order = { straight:0, pairline:0, trioline:0, fullhouse:1, trio:2, pair:3, single:4 };
  const nonBomb = combos.filter(c=>!Rules.isBomb(c.parse));
  const pool = nonBomb.length ? nonBomb : combos;
  pool.sort((a,b)=>{
    const ra=order[a.parse.type]??9, rb=order[b.parse.type]??9;
    if (ra!==rb) return ra-rb;
    if (b.parse.len!==a.parse.len) return b.parse.len-a.parse.len;
    return a.parse.key-b.parse.key;
  });
  const notBig = pool.filter(c=>!(c.parse.type==='single' && c.parse.key>=14));
  return (notBig[0] || pool[0]).cards;
}

let pass=0,fail=0;
const ok=(c,m)=>{ if(c)pass++; else{fail++;console.log('❌',m);} };
const eq=(a,b,m)=>ok(a===b, m+` (得到 ${a}, 期望 ${b})`);

// —— ① estTricks 构造手牌合理性(level=2, 用 ♠♣ 非红桃避开百搭/级牌) ——
const C=(rank,suit)=>Deck.makeCard(rank,suit);
const L=2;
eq(NEW.estTricks([],L), 0, 'estTricks 空手=0');
eq(NEW.estTricks([C(3,'♠'),C(4,'♠'),C(5,'♠'),C(6,'♣'),C(7,'♣')],L), 1, 'estTricks 一条顺子=1手');
eq(NEW.estTricks([C(3,'♠'),C(5,'♠'),C(7,'♣'),C(9,'♣'),C(11,'♠')],L), 5, 'estTricks 五张孤散单=5手');
eq(NEW.estTricks([C(3,'♠'),C(3,'♣')],L), 1, 'estTricks 一对=1手');
eq(NEW.estTricks([C(3,'♠'),C(3,'♣'),C(3,'♦'),C(5,'♠')],L), 1, 'estTricks 三条白吃单张=1手(三带一)');
eq(NEW.estTricks([C(3,'♠'),C(3,'♣'),C(3,'♦'),C(5,'♠'),C(5,'♣')],L), 1, 'estTricks 三条+对=1手(三带二)');
// 拆散一个顺子会多出孤张 → 手数变大(证明"少留手数"能惩罚拆结构)
const straightPlus=[C(3,'♠'),C(4,'♠'),C(5,'♠'),C(6,'♣'),C(7,'♣'),C(9,'♦')];
eq(NEW.estTricks(straightPlus,L), 2, 'estTricks 顺子+1孤张=2手');
const broken=[C(3,'♠'),C(4,'♠'),C(5,'♠'),C(6,'♣'),C(9,'♦')]; // 抽走7断了顺子
ok(NEW.estTricks(broken,L) >= 2, 'estTricks 断顺(留孤张)手数不减');

// —— ② 新旧首出对比: 随机整手, 比"领出后剩余手数"(公共标尺=NEW.estTricks) ——
function without(hand,cards){ const ids=new Set(cards.map(c=>c.id)); return hand.filter(c=>!ids.has(c.id)); }
let nDeals=0, sumNew=0, sumOld=0, newBetter=0, oldBetter=0, tie=0, sumBase=0, errs=0;
for(let seed=1; seed<=600; seed++){
  let hands; try{ hands=Deck.dealGuandan(seed).hands; }catch(e){ errs++; continue; }
  for(const h of hands){
    const hand=h.slice();
    const ctx={level:L, hand};   // 无 handsLeft → 不触发报单分支, 纯比首出择牌
    let ln,lo;
    try{ ln=NEW.chooseLead(hand,L,ctx); lo=oldLead(hand,L); }catch(e){ errs++; continue; }
    // 合法性: 两版领出都必须是合法牌型
    if(!Rules.parse(ln,L) || !Rules.parse(lo,L)){ errs++; continue; }
    const rn=NEW.estTricks(without(hand,ln),L);
    const ro=NEW.estTricks(without(hand,lo),L);
    sumNew+=rn; sumOld+=ro; sumBase+=NEW.estTricks(hand,L);
    if(rn<ro) newBetter++; else if(ro<rn) oldBetter++; else tie++;
    nDeals++;
  }
}
const avgNew=sumNew/nDeals, avgOld=sumOld/nDeals, avgBase=sumBase/nDeals;
console.log(`\n随机手牌 ${nDeals} 手 (整手平均手数基线 ${avgBase.toFixed(2)}), 领出后剩余手数:`);
console.log(`  旧版(牌型顺序) 平均 ${avgOld.toFixed(3)}`);
console.log(`  新版(手数评估) 平均 ${avgNew.toFixed(3)}`);
console.log(`  逐手对比: 新更优 ${newBetter} · 旧更优 ${oldBetter} · 平手 ${tie} · 异常 ${errs}`);
ok(errs===0, '无异常/非法领出');
ok(avgNew <= avgOld, '新版平均剩余手数 <= 旧版');
ok(newBetter > oldBetter*3, '新版逐手明显更优(新优 > 旧优×3)');

console.log(`\n通过 ${pass} · 失败 ${fail}`);
process.exit(fail?1:0);
