#!/usr/bin/env node
'use strict';
// test-ddz-landlord-fairness.js — 验证 #5「首叫席逐局轮转 → 地主在三席均分」。
//   根因: 此前 createGame 恒 firstBidSeat=0(我先叫) → 先手抢地主, 我常当地主, "对面两位"恒是一家农民。
//   修法: game-ui 逐局 nextBidLead() 轮转首叫席。此处直接在引擎+AI 层复现分布, 证明轮转把地主摊匀。
const Engine=require('../js/games/ddz-engine.js');
const AI=require('../js/games/ddz-ai.js');

function playBid(firstBidSeat){
  const st=Engine.createGame({isAI:[true,true,true],names:['0','1','2'],firstBidSeat});
  let guard=0;
  while(st.phase==='bid' && guard++<12){
    const seat=st.bid.turn;
    const val=AI.chooseBid(st.players[seat].hand, st.bid.max);
    const r=Engine.applyCall(st,seat,val);
    if(r && r.redeal) return null;
    if(st.landlord!=null) break;
  }
  return st.landlord;
}
function run(rotate, N){
  const cnt=[0,0,0]; let lead=0, redeal=0;
  for(let i=0;i<N;i++){
    const fb = rotate ? (lead++%3) : 0;
    const L=playBid(fb);
    if(L==null){ redeal++; continue; }
    cnt[L]++;
  }
  const tot=cnt[0]+cnt[1]+cnt[2];
  return {cnt, pct:cnt.map(c=>+(100*c/tot).toFixed(1)), redeal};
}

const N=8000;
const fixed=run(false,N), rot=run(true,N);
console.log('固定首叫=0 席:   ', JSON.stringify(fixed));
console.log('轮转首叫(0→1→2): ', JSON.stringify(rot));

let ok=true;
// 断言1: 固定首叫下 0 席明显偏高(先手优势) —— 证明这是真实偏斜, 不是随机噪声
if(!(fixed.pct[0] >= fixed.pct[2] + 8)){ ok=false; console.log('❌ 固定首叫本应明显偏向 0 席'); }
// 断言2: 轮转后三席都落在 33.3%±4 —— 均分
const even = rot.pct.every(p=>Math.abs(p-33.3)<=4);
if(!even){ ok=false; console.log('❌ 轮转后三席未均分(应各≈33%)'); }
else console.log('✅ 轮转后三席均分(各≈33%, 偏差≤4pt)');
if(fixed.pct[0] >= fixed.pct[2] + 8) console.log('✅ 固定首叫确有先手偏斜(0 席比 2 席高 '+(fixed.pct[0]-fixed.pct[2]).toFixed(1)+'pt)');

console.log(ok?'—— 通过':'—— 失败');
process.exit(ok?0:1);
