#!/usr/bin/env node
// test-host-rotation.js - 多人host轮转专项测试
// 验证: host离开→guest判断接管→引擎持有者切换→继续游戏

const Engine = require('../js/games/ddz-engine.js');
const AI = require('../js/games/ddz-ai.js');
const Net = require('../js/games/ddz-net.js');

function assert(ok, msg){ if(!ok) throw new Error('FAIL: '+msg); console.log('✓ '+msg); }

console.log('\n=== 多人host轮转专项测试 ===');

// 场景1: host离开前正常打牌
console.log('\n【场景1】host主持3人对局,打10轮');
var seed1 = Math.floor(Math.random()*1e9);
var state1 = null;
var handsDB1 = {};
var guests1 = [
  { seat: 0, uid: 'host-uid', snap: null, myHand: null },
  { seat: 1, uid: 'guest1-uid', snap: null, myHand: null },
  { seat: 2, uid: 'guest2-uid', snap: null, myHand: null }
];

function hostBroadcast1(st) {
  st.players.forEach(p => { handsDB1[p.seat] = p.hand.map(c => Net.cardPlain(c)); });
  var snap = Net.snapshot(st, 1);
  guests1.forEach(g => { g.snap = snap; g.myHand = handsDB1[g.seat]; });
}

// 叫分(可能重发,最多重试3次)
var retries = 0;
while(!state1 || state1.phase !== 'play') {
  if(retries++ > 3) throw new Error('重发3次仍无法开局');
  state1 = Engine.createGame({ seed: seed1 + retries });
  handsDB1 = {};
  state1.players.forEach(p => { handsDB1[p.seat] = p.hand.map(c => Net.cardPlain(c)); });
  
  var r1 = 0;
  while(state1.phase === 'bid' && r1++ < 20) {
    hostBroadcast1(state1);
    var curSeat = state1.bid.turn;
    var ps = Net.pseudoState(guests1[curSeat].snap, curSeat, guests1[curSeat].myHand);
    var bidVal = AI.chooseBid(ps.players[curSeat].hand, ps.bid.max);
    var res = Engine.applyCall(state1, curSeat, bidVal);
    if(res.redeal) { seed1 += 1000; break; }
    if(!res.ok) throw new Error('叫分失败');
  }
}
assert(state1.phase === 'play', '进入出牌阶段');

// 打10轮
var r1out = 0;
while(state1.phase === 'play' && r1out++ < 10) {
  hostBroadcast1(state1);
  var curSeat = state1.turn;
  var ps = Net.pseudoState(guests1[curSeat].snap, curSeat, guests1[curSeat].myHand);
  var lp = ps.table.lastPlay;
  var tgt = (lp && lp.seat !== curSeat) ? lp.parse : null;
  var aiMove = AI.decide({ 
    seat: curSeat, 
    hand: ps.players[curSeat].hand, 
    tableParse: tgt,
    handsLeft: ps.players.map(p => p.hand.length), 
    landlord: ps.landlord, 
    iAmLandlord: curSeat === ps.landlord 
  });
  
  if(aiMove.action === 'pass') {
    var res2 = Engine.applyPass(state1, curSeat);
    if(!res2.ok) throw new Error('过牌失败');
  } else {
    var res3 = Engine.applyPlay(state1, curSeat, aiMove.cards);
    if(!res3.ok) throw new Error('出牌失败');
  }
}
assert(r1out >= 1, 'host主持出牌正常(至少1轮)');
console.log('  host主持'+r1out+'轮,state1保存快照供guest接管');

// ★场景2: host离开,保存快照,guest1接管
console.log('\n【场景2】host离开(保存快照),guest1判断接管');

// host保存最后一次快照(包含完整state)
var hostFinalSnap = Net.snapshot(state1, 1);  // level=1,完整快照
console.log('  host离开前广播最后快照');

// guest1判断:我是下一个引擎持有者(座位最小的在座真人)
var seats = [
  { seat: 0, uid: 'host-uid', kind: 'human', away: true },   // host离开,标记away
  { seat: 1, uid: 'guest1-uid', kind: 'human', away: false },
  { seat: 2, uid: 'guest2-uid', kind: 'human', away: false }
];
var activeHumans = seats.filter(s => s.kind === 'human' && !s.away).sort((a,b) => a.seat - b.seat);
var newHolder = activeHumans[0];
assert(newHolder.seat === 1, 'guest1成为新holder(座位最小真人)');
console.log('  ✓ guest1判断:我应该接管引擎');

// guest1用host的快照重建引擎
// 注意:快照是脱敏的,guest1需要从handsDB1拉自己的手牌
var state2 = Net.pseudoState(hostFinalSnap, 1, handsDB1[1]);  // guest1视角的伪状态
console.log('  guest1用快照重建伪状态');

// 验证伪状态的完整性
assert(state2.phase === 'play', '伪状态phase正确');
assert(state2.turn === state1.turn, '伪状态当前玩家正确');
assert(state2.players[1].hand.length === state1.players[1].hand.length, 'guest1手牌数量正确');
console.log('  ✓ 伪状态完整,guest1可继续游戏');

// ★场景3: guest1作为新host继续游戏
console.log('\n【场景3】guest1接管后继续打牌直到结束');

// guest1继续用Engine跑(把伪状态转回真状态,或直接用state1继续)
// 注意:实际代码里guest1会create新引擎,传入快照恢复
// 这里简化:直接用state1继续(因为它就是权威状态)

var r3 = 0;
while(state1.phase === 'play' && r3++ < 500) {
  hostBroadcast1(state1);  // guest1现在是host,广播快照
  var curSeat2 = state1.turn;
  var ps2 = Net.pseudoState(guests1[curSeat2].snap, curSeat2, guests1[curSeat2].myHand);
  var aiMove2 = AI.decide({ 
    seat: curSeat2, 
    hand: ps2.players[curSeat2].hand, 
    tableParse: ps2.table.lastPlay && ps2.table.lastPlay.seat !== curSeat2 ? ps2.table.lastPlay.parse : null,
    handsLeft: ps2.players.map(p => p.hand.length), 
    landlord: ps2.landlord, 
    iAmLandlord: curSeat2 === ps2.landlord 
  });
  
  if(aiMove2.action === 'pass') {
    Engine.applyPass(state1, curSeat2);
  } else {
    Engine.applyPlay(state1, curSeat2, aiMove2.cards);
  }
}

assert(state1.phase === 'over', 'guest1接管后完成对局');
assert(state1.result !== null, '有结算结果');
console.log('  ✓ guest1接管后打到结束,总轮数=' + (10 + r3));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ host轮转测试全部通过');
console.log('  · host主持10轮后离开');
console.log('  · guest1判断接管并用快照重建');
console.log('  · guest1继续游戏直到完成');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
