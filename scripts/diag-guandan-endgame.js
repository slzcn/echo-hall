#!/usr/bin/env node
'use strict';
// diag-guandan-endgame.js — 诊断"打到最后剩碎牌单张"观感:全 AI 自对弈, 统计每家出牌型序列。
//   量化: ① 结尾连续甩单张的尾巴长度(tail of consecutive singles before出完/结束)
//         ② 单张手数占该家总手数比例
//         ③ 各家"是否把成型牌型早早打光、把散单憋到最后"(前半 vs 后半 单张率)
const path=require('path');
const Deck=require(path.join(__dirname,'..','js/games/deck.js'));
const Engine=require(path.join(__dirname,'..','js/games/guandan-engine.js'));
const AI=require(path.join(__dirname,'..','js/games/guandan-ai.js'));
const Rules=require(path.join(__dirname,'..','js/games/guandan-rules.js'));

// 出这手前, 判断"若这是单张, 它是不是孤张"(手里该自然点只有1张 且 凑不进任何5连顺子)。
//   孤张单出=规则固有(掼蛋无三带一, 孤小单只能单出); 非孤张单出=AI 拆了对子/顺子=真 bug。
function classifySingle(handBefore, card, level){
  if(card.joker) return 'joker';
  const nr=Rules.naturalRank(card);
  const same=handBefore.filter(c=>!c.joker && Rules.naturalRank(c)===nr).length;
  if(same>=2) return 'broke-pair';   // 手里还有同点 → 拆对/三条出单
  // 凑顺子潜力: 该点周围 ±4 窗口内能否与其它牌 + 百搭凑成含它的5连
  const power=Rules.powerOf(card, level);
  return { kind:'lone', power };
}

function playFullTrace(seed, level){
  let st = Engine.createGame({ seed, level, teamLevels:[level,level],
    isAI:[true,true,true,true], names:['A0','B1','A2','B3'] });
  const plays = [[],[],[],[]];
  let guard=0;
  const rec=(s,cards)=>{
    const p=Rules.parse(cards, st.level);
    const item={type:p.type,len:p.len};
    if(p.type==='single'){ item.single=classifySingle(st.players[s].hand, cards[0], st.level); }
    plays[s].push(item);
  };
  while (st.phase==='play'){
    if (guard++>3000) throw new Error('loop @'+seed);
    const s = st.turn;
    const target = (st.table.lastPlay && st.table.lastPlay.seat!==s) ? st.table.lastPlay.parse : null;
    const mv = AI.decide({ seat:s, hand:st.players[s].hand, tableParse:target,
      lastSeat: st.table.lastPlay?st.table.lastPlay.seat:null,
      handsLeft: st.players.map(p=>p.hand.length), level: st.level });
    if (mv.action==='pass'){
      try { Engine.applyPass(st, s); }
      catch(e){ const lead=AI.chooseLead(st.players[s].hand, st.level); rec(s,lead); Engine.applyPlay(st, s, lead); }
    } else {
      try { rec(s,mv.cards); Engine.applyPlay(st, s, mv.cards); }
      catch(e){ plays[s].pop();
        try { Engine.applyPass(st, s); }
        catch(_){ const lead=AI.chooseLead(st.players[s].hand, st.level); rec(s,lead); Engine.applyPlay(st, s, lead); }
      }
    }
  }
  return { st, plays };
}

let totSingles=0, totPlays=0;
let tailSum=0, tailMax=0, tailSamples=0;
let firstHalfSingleRate=0, secondHalfSingleRate=0, halfN=0;
const tailHist={};   // 尾部连续单张数分布
const N=200;
for(let seed=1; seed<=N; seed++){
  const {plays}=playFullTrace(seed,2);
  for(let s=0;s<4;s++){
    const seq=plays[s];
    if(!seq.length) continue;
    const singles=seq.filter(p=>p.type==='single').length;
    totSingles+=singles; totPlays+=seq.length;
    // 结尾连续单张尾巴
    let tail=0;
    for(let i=seq.length-1;i>=0;i--){ if(seq[i].type==='single') tail++; else break; }
    tailSum+=tail; tailMax=Math.max(tailMax,tail); tailSamples++;
    tailHist[tail]=(tailHist[tail]||0)+1;
    // 前半/后半 单张率
    if(seq.length>=4){
      const mid=Math.floor(seq.length/2);
      const fh=seq.slice(0,mid), sh=seq.slice(mid);
      firstHalfSingleRate += fh.filter(p=>p.type==='single').length/fh.length;
      secondHalfSingleRate += sh.filter(p=>p.type==='single').length/sh.length;
      halfN++;
    }
  }
}
console.log(`=== 掼蛋全 AI 自对弈 ${N} 局 · 出牌型诊断 ===`);
console.log(`总出牌手数 ${totPlays}, 其中单张 ${totSingles} (${(100*totSingles/totPlays).toFixed(1)}%)`);
console.log(`结尾连续甩单张尾巴: 平均 ${(tailSum/tailSamples).toFixed(2)} 手, 最长 ${tailMax} 手`);
console.log(`尾巴长度分布(尾部连续单张手数 → 出现次数):`);
Object.keys(tailHist).map(Number).sort((a,b)=>a-b).forEach(k=>{
  console.log(`  ${k} 手: ${tailHist[k]} 次 ${'█'.repeat(Math.round(tailHist[k]/tailSamples*60))}`);
});
console.log(`前半程单张率 ${(100*firstHalfSingleRate/halfN).toFixed(1)}%  vs  后半程单张率 ${(100*secondHalfSingleRate/halfN).toFixed(1)}%`);
console.log(`(后半 >> 前半 = 把成型牌型早打光、散单憋到最后 → 正是观感差的根因)`);

// 单张出牌构成: 孤张(规则固有) vs 拆对/三条(真 bug) vs 甩王
let lone=0, brokePair=0, jokerS=0, loneBig=0;
for(let seed=1; seed<=N; seed++){
  const {plays}=playFullTrace(seed,2);
  for(let s=0;s<4;s++) for(const p of plays[s]){
    if(p.type!=='single'||!p.single) continue;
    if(p.single==='broke-pair') brokePair++;
    else if(p.single==='joker') jokerS++;
    else { lone++; if(p.single.power>=13) loneBig++; }   // ≥K 的大孤单
  }
}
const sTot=lone+brokePair+jokerS;
console.log(`\n单张构成(共 ${sTot} 次单张出牌):`);
console.log(`  孤张单出(规则固有, 无三带一只能单走) ${lone} (${(100*lone/sTot).toFixed(1)}%), 其中大孤单≥K ${loneBig}`);
console.log(`  拆对子/三条出单(疑似 bug) ${brokePair} (${(100*brokePair/sTot).toFixed(1)}%)`);
console.log(`  甩王单出 ${jokerS} (${(100*jokerS/sTot).toFixed(1)}%)`);
