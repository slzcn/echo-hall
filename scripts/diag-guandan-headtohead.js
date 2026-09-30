#!/usr/bin/env node
'use strict';
// diag-guandan-headtohead.js — 对抗棋力验证: A队(0&2)开"孤小单早清", B队(1&3)关闭, 同牌局对打。
//   每步按当前出牌席所属队切换开关(单线程串行安全), 精确隔离"仅 earlyClear 差异"对胜率的影响。
//   判定: 若 A 胜率不明显低于 B(50% 附近或更高), 则早清不损棋力, 纯改善节奏/观感。
const path=require('path');
const Deck=require(path.join(__dirname,'..','js/games/deck.js'));
const Engine=require(path.join(__dirname,'..','js/games/guandan-engine.js'));
const AI=require(path.join(__dirname,'..','js/games/guandan-ai.js'));

function playMatch(seed){
  let st = Engine.createGame({ seed, level:2, teamLevels:[2,2],
    isAI:[true,true,true,true], names:['A0','B1','A2','B3'] });
  let guard=0;
  while (st.phase==='play'){
    if (guard++>3000) throw new Error('loop @'+seed);
    const s = st.turn;
    AI.setEarlyClear(s%2===0);   // A队(偶席)开早清, B队(奇席)关
    const target = (st.table.lastPlay && st.table.lastPlay.seat!==s) ? st.table.lastPlay.parse : null;
    const mv = AI.decide({ seat:s, hand:st.players[s].hand, tableParse:target,
      lastSeat: st.table.lastPlay?st.table.lastPlay.seat:null,
      handsLeft: st.players.map(p=>p.hand.length), level: st.level });
    if (mv.action==='pass'){
      try { Engine.applyPass(st, s); }
      catch(e){ Engine.applyPlay(st, s, AI.chooseLead(st.players[s].hand, st.level)); }
    } else {
      try { Engine.applyPlay(st, s, mv.cards); }
      catch(e){ try { Engine.applyPass(st, s); } catch(_){ Engine.applyPlay(st, s, AI.chooseLead(st.players[s].hand, st.level)); } }
    }
  }
  return st.result;
}

let aWins=0, bWins=0, aDD=0, bDD=0, aAdv=0, bAdv=0;
const N=600;
for(let seed=1; seed<=N; seed++){
  const res=playMatch(seed);
  if(res.winnerTeam===0){ aWins++; if(res.doubleDown)aDD++; aAdv+=res.advance; }
  else { bWins++; if(res.doubleDown)bDD++; bAdv+=res.advance; }
}
AI.setEarlyClear(true);   // 复位
console.log(`=== 对抗 ${N} 局: A队(孤小单早清 ON) vs B队(OFF) ===`);
console.log(`A 胜 ${aWins} (${(100*aWins/N).toFixed(1)}%) · 双下 ${aDD} · 累计升级 ${aAdv}`);
console.log(`B 胜 ${bWins} (${(100*bWins/N).toFixed(1)}%) · 双下 ${bDD} · 累计升级 ${bAdv}`);
console.log(aWins>=bWins ? '✓ 早清不损棋力(A 胜率 ≥ B)' : (aWins>=bWins*0.92 ? '~ 早清基本持平(差距<8%)' : '✗ 早清明显掉棋力, 需收手'));
