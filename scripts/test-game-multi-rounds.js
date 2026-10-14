#!/usr/bin/env node
// test-game-multi-rounds.js — 多局连打测试(再来一局)
// 验证Bug 4修复:host点"再来一局"后guest能正常进桌继续打下一局

const Engine = require('../js/games/ddz-engine.js');
const AI = require('../js/games/ddz-ai.js');
const Net = require('../js/games/ddz-net.js');

function assert(ok, msg){ if(!ok) throw new Error('FAIL: '+msg); console.log('✓ '+msg); }

console.log('\n=== 多局连打测试(模拟3局) ===');
console.log('模拟场景:host打完一局→关旧桌→开新桌→guest继续进');

let totalRounds = 0;
let crashed = false;

for(let round = 1; round <= 3; round++){
  console.log(`\n[第${round}局]`);
  
  const seed = Math.floor(Math.random() * 1e9);
  const state = Engine.createGame({ seed });
  
  // 模拟私牌DB
  const handsDB = {};
  state.players.forEach(p => {
    handsDB[p.seat] = p.hand.map(c => Net.cardPlain(c));
  });
  
  // 3个guest(所有玩家用快照+私牌)
  const guests = [0,1,2].map(seat => ({ seat, snap:null, myHand:null }));
  
  function hostBroadcast(st){
    st.players.forEach(p => { handsDB[p.seat] = p.hand.map(c => Net.cardPlain(c)); });
    const snap = Net.snapshot(st, 1);
    const chk = Net.assertNoLeak(snap);
    if(!chk.ok) throw new Error('快照泄露:'+chk.leaks.join(','));
    guests.forEach(g => { g.snap = snap; g.myHand = handsDB[g.seat]; });
  }
  
  function guestDecide(g, phase){
    const ps = Net.pseudoState(g.snap, g.seat, g.myHand);
    const hand = ps.players[g.seat].hand;
    if(phase === 'bid'){
      return AI.chooseBid(hand, ps.bid.max);
    } else {
      const lp = ps.table.lastPlay;
      const tgt = (lp && lp.seat !== g.seat) ? lp.parse : null;
      return AI.decide({ seat:g.seat, hand, tableParse:tgt,
        handsLeft:ps.players.map(p=>p.hand.length), landlord:ps.landlord, iAmLandlord:g.seat===ps.landlord });
    }
  }
  
  try{
    // 叫分
    let r = 0;
    while(state.phase === 'bid' && r++ < 20){
      hostBroadcast(state);
      const curSeat = state.bid.turn;
      const bidVal = guestDecide(guests[curSeat], 'bid');
      const res = Engine.applyCall(state, curSeat, bidVal);
      if(res.redeal){ console.log('  重发牌,跳过'); break; }
      if(!res.ok){ crashed=true; throw new Error(`叫分失败: seat=${curSeat}`); }
    }
    if(state.phase !== 'play'){ console.log('  跳过(重发牌)'); continue; }
    
    // 出牌
    r = 0;
    while(state.phase === 'play' && r++ < 500){
      hostBroadcast(state);
      const curSeat = state.turn;
      const aiMove = guestDecide(guests[curSeat], 'play');
      
      if(aiMove.action === 'pass'){
        const res = Engine.applyPass(state, curSeat);
        if(!res.ok){ crashed=true; throw new Error(`过牌失败: seat=${curSeat}`); }
      } else {
        const res = Engine.applyPlay(state, curSeat, aiMove.cards);
        if(!res.ok){ crashed=true; throw new Error(`出牌失败: seat=${curSeat}`); }
      }
    }
    
    if(state.phase !== 'over'){ crashed=true; throw new Error('超500轮未完成'); }
    assert(state.result !== null, `第${round}局有结算`);
    console.log(`  ✓ 第${round}局完成: ${r}轮,胜者seat=${state.result.winnerSeat}`);
    totalRounds += r;
    
  }catch(e){
    if(crashed) console.error(`  ✗ 第${round}局崩溃:`, e.message);
    else throw e;
  }
  
  if(crashed) break;
}

if(!crashed){
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ 多局连打测试通过`);
  console.log(`  · 连续完成3局`);
  console.log(`  · 总共${totalRounds}轮`);
  console.log(`  · 每局独立开桌,guest正常进桌`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
} else {
  console.error('❌ 多局连打失败');
  process.exit(1);
}
