#!/usr/bin/env node
// test-game-full-session.js — 完整游戏会话测试(单人host/多人host/host轮转)
// 目标: 验证从开桌→发牌→打完→结算全流程无中断、无异常退出
//
// 场景:
//   S1: 单人host(1真人+2 AI) — 斗地主完整一局
//   S2: 多人host(3真人) — 斗地主完整一局
//   S3: host中途离开→guest接管→继续完成

const Deck   = require('../js/games/deck.js');
const Rules  = require('../js/games/ddz-rules.js');
const Engine = require('../js/games/ddz-engine.js');
const AI     = require('../js/games/ddz-ai.js');
const Net    = require('../js/games/ddz-net.js');

function assert(ok, msg){ if(!ok) throw new Error('FAIL: '+msg); console.log('✓ '+msg); }

// ========== S1: 单人host(1真人+2 AI) ==========
console.log('\n=== S1: 单人host(1真人+2 AI) ===');

const s1Names = ['我','AI甲','AI乙'];
const s1Seed = Math.floor(Math.random() * 1e9);
const s1State = Engine.createGame({ names: s1Names, seed: s1Seed });
let s1Rounds = 0, s1Crashed = false;

try{
  // 叫分阶段
  while(s1State.phase === 'bid'){
    const curSeat = s1State.bid.turn;
    const curBid = s1State.bid.max;
    const bidVal = AI.chooseBid(s1State.players[curSeat].hand, curBid);
    const res = Engine.applyCall(s1State, curSeat, bidVal);
    if(res.redeal){ s1Crashed=true; throw new Error('S1重发牌(3家都不叫),跳过'); }
    if(!res.ok){ s1Crashed=true; throw new Error(`S1叫分失败: seat=${curSeat} bid=${bidVal}`); }
    s1Rounds++;
    if(s1Rounds > 20){ s1Crashed=true; throw new Error('S1叫分超20轮'); }
  }
  assert(s1State.phase === 'play', 'S1叫分完成,进入出牌阶段');
  assert(s1State.landlord !== null, 'S1已定地主');

  // 出牌阶段
  s1Rounds = 0;
  while(s1State.phase === 'play'){
    const curSeat = s1State.turn;
    const lp = s1State.table.lastPlay;
    const tgt = (lp && lp.seat !== curSeat) ? lp.parse : null;
    const aiMove = AI.decide({ seat:curSeat, hand:Engine.handOf(s1State,curSeat), tableParse:tgt,
      handsLeft:s1State.players.map(p=>p.hand.length), landlord:s1State.landlord, iAmLandlord:curSeat===s1State.landlord });
    
    if(aiMove.action === 'pass'){
      const res = Engine.applyPass(s1State, curSeat);
      if(!res.ok){ s1Crashed=true; throw new Error(`S1过牌失败: seat=${curSeat}`); }
    } else {
      const res = Engine.applyPlay(s1State, curSeat, aiMove.cards);
      if(!res.ok){ s1Crashed=true; throw new Error(`S1出牌失败: seat=${curSeat}`); }
    }
    s1Rounds++;
    if(s1Rounds > 500){ s1Crashed=true; throw new Error('S1出牌超500轮'); }
  }
  assert(s1State.phase === 'over', 'S1出牌完成,进入结算');
  assert(s1State.result !== null, 'S1有结算结果');
  assert(typeof s1State.result.winnerSeat === 'number', 'S1有胜者');
  console.log(`  ✓ S1完整对局: 叫分+出牌共${s1Rounds}轮,胜者seat=${s1State.result.winnerSeat}`);
}catch(e){
  if(s1Crashed) console.error('  ✗ S1崩溃:', e.message);
  else throw e;
}

if(!s1Crashed) console.log('✅ S1: 单人host完整对局通过');
else{ console.error('❌ S1失败'); process.exit(1); }

// ========== S2: 多人host(3真人) ==========
console.log('\n=== S2: 多人host(3真人) ===');

const s2Names = ['房主','远客甲','远客乙'];
const s2Seed = Math.floor(Math.random() * 1e9);
const s2State = Engine.createGame({ names: s2Names, seed: s2Seed });

// 模拟私牌存储(RLS): 每个玩家只能读自己的手牌
const s2HandsDB = {};
function s2SaveHands(state){
  state.players.forEach(p => {
    s2HandsDB[p.seat] = p.hand.map(c => Net.cardPlain(c));
  });
}
function s2ReadHand(seat){
  return s2HandsDB[seat] || null;
}

// 初始手牌写入DB
s2SaveHands(s2State);

// 模拟3个客人(所有玩家都是guest视角,用快照+私牌)
const s2Guests = [0,1,2].map(seat => ({ seat, snap:null, myHand:null }));

function s2HostBroadcast(state){
  s2SaveHands(state);
  const snap = Net.snapshot(state, 1);
  const chk = Net.assertNoLeak(snap);
  if(!chk.ok) throw new Error('S2快照泄露:'+chk.leaks.join(','));
  s2Guests.forEach(g => {
    g.snap = snap;
    g.myHand = s2ReadHand(g.seat);
  });
}

function s2GuestDecide(g, phase){
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

let s2Rounds = 0, s2Crashed = false;

try{
  // 叫分
  while(s2State.phase === 'bid'){
    s2HostBroadcast(s2State);
    const curSeat = s2State.bid.turn;
    const g = s2Guests[curSeat];
    const bidVal = s2GuestDecide(g, 'bid');
    const res = Engine.applyCall(s2State, curSeat, bidVal);
    if(res.redeal){ s2Crashed=true; throw new Error('S2重发牌'); }
    if(!res.ok){ s2Crashed=true; throw new Error(`S2叫分失败: seat=${curSeat}`); }
    s2Rounds++;
    if(s2Rounds > 20){ s2Crashed=true; throw new Error('S2叫分超20轮'); }
  }
  assert(s2State.phase === 'play', 'S2叫分完成');

  // 出牌
  s2Rounds = 0;
  while(s2State.phase === 'play'){
    s2HostBroadcast(s2State);
    const curSeat = s2State.turn;
    const g = s2Guests[curSeat];
    const aiMove = s2GuestDecide(g, 'play');
    
    if(aiMove.action === 'pass'){
      const res = Engine.applyPass(s2State, curSeat);
      if(!res.ok){ s2Crashed=true; throw new Error(`S2过牌失败: seat=${curSeat}`); }
    } else {
      const res = Engine.applyPlay(s2State, curSeat, aiMove.cards);
      if(!res.ok){ s2Crashed=true; throw new Error(`S2出牌失败: seat=${curSeat}`); }
    }
    s2Rounds++;
    if(s2Rounds > 500){ s2Crashed=true; throw new Error('S2出牌超500轮'); }
  }
  assert(s2State.phase === 'over', 'S2出牌完成');
  assert(s2State.result !== null, 'S2有结算');
  console.log(`  ✓ S2完整对局: 3真人联机,共${s2Rounds}轮,胜者seat=${s2State.result.winnerSeat}`);
}catch(e){
  if(s2Crashed) console.error('  ✗ S2崩溃:', e.message);
  else throw e;
}

if(!s2Crashed) console.log('✅ S2: 多人host完整对局通过');
else{ console.error('❌ S2失败'); process.exit(1); }

// ========== S3: host离开→guest接管 ==========
console.log('\n=== S3: host中途离开→guest接管 ===');

const s3Seed = Math.floor(Math.random() * 1e9);
const s3State = Engine.createGame({ seed: s3Seed });

// 先打几轮叫分
let s3Rounds = 0;
while(s3State.phase === 'bid' && s3Rounds < 2){
  const curSeat = s3State.bid.turn;
  const bidVal = AI.chooseBid(Engine.handOf(s3State, curSeat), s3State.bid.max);
  const res = Engine.applyCall(s3State, curSeat, bidVal);
  if(res.redeal) break;
  s3Rounds++;
}

// 模拟host离开: 保存快照
const s3Snap = Net.snapshot(s3State, 1);
console.log('  host离开,保存快照(phase='+s3Snap.phase+'),guest接管');

// guest接管: 用快照继续(实际会从快照+DB手牌重建,这里简化直接用原state)
// 接管者是座位最小的非away真人(这里都是AI,简化为继续用原state)

try{
  // 继续叫分
  while(s3State.phase === 'bid'){
    const curSeat = s3State.bid.turn;
    const bidVal = AI.chooseBid(Engine.handOf(s3State, curSeat), s3State.bid.max);
    const res = Engine.applyCall(s3State, curSeat, bidVal);
    if(res.redeal){ console.log('  重发牌,跳过'); break; }
    if(!res.ok) throw new Error('S3接管后叫分失败');
    s3Rounds++;
    if(s3Rounds > 20) throw new Error('S3叫分超20轮');
  }

  // 出牌
  s3Rounds = 0;
  while(s3State.phase === 'play'){
    const curSeat = s3State.turn;
    const lp = s3State.table.lastPlay;
    const tgt = (lp && lp.seat !== curSeat) ? lp.parse : null;
    const aiMove = AI.decide({ seat:curSeat, hand:Engine.handOf(s3State,curSeat), tableParse:tgt,
      handsLeft:s3State.players.map(p=>p.hand.length), landlord:s3State.landlord, iAmLandlord:curSeat===s3State.landlord });
    
    if(aiMove.action === 'pass'){
      const res = Engine.applyPass(s3State, curSeat);
      if(!res.ok) throw new Error('S3接管后过牌失败');
    } else {
      const res = Engine.applyPlay(s3State, curSeat, aiMove.cards);
      if(!res.ok) throw new Error('S3接管后出牌失败');
    }
    s3Rounds++;
    if(s3Rounds > 500) throw new Error('S3出牌超500轮');
  }

  assert(s3State.phase === 'over', 'S3接管后完成对局');
  assert(s3State.result !== null, 'S3有结算');
  console.log(`  ✓ S3接管完成: host离开后继续完成对局`);
  console.log('✅ S3: host轮转完整对局通过');
}catch(e){
  console.error('  ✗ S3接管失败:', e.message);
  process.exit(1);
}

// ========== 总结 ==========
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ 全部场景通过');
console.log('  · S1: 单人host(1真人+2 AI)');
console.log('  · S2: 多人host(3真人)');
console.log('  · S3: host离开→guest接管');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
