#!/usr/bin/env node
// 复现"无故弃牌"bug: 直接构造"A出→B过→C过→又轮A"场景

const Engine = require('../js/games/ddz-engine.js');

console.log('\n=== 复现"无故弃牌"bug ===\n');

// 模拟 game-ui.js 的原始 turnChanged 判定(有bug版本)
let turnSeatActive = -1;
let turnPhaseActive = '';
let turnStart = 0;

function checkTurnChanged(seat, phase, label) {
  const turnChanged = (seat !== turnSeatActive) || (phase !== turnPhaseActive);
  
  console.log(`${label}: seat=${seat}, phase=${phase}`);
  console.log(`  turnSeatActive=${turnSeatActive}, turnPhaseActive='${turnPhaseActive}'`);
  console.log(`  判定: turnChanged=${turnChanged}`);
  
  turnSeatActive = seat;
  turnPhaseActive = phase;
  
  if (turnChanged) {
    turnStart = Date.now();
    console.log(`  → 重置 turnStart\n`);
  } else {
    console.log(`  ❌ turnStart 未重置! (还用旧值)\n`);
  }
  
  return { changed: turnChanged, start: turnStart };
}

// 构造出牌阶段状态
const state = Engine.createGame({ seed: 12345 });
state.phase = 'play';
state.landlord = 0;
state.turn = 0;
state.table.lastPlay = null;

console.log('【第1手】seat0出单牌');
const t1 = checkTurnChanged(0, 'play', '回合1');
const card1 = state.players[0].hand[0].id;
Engine.applyPlay(state, 0, [card1]);

console.log('【第2手】seat1过牌');
const t2 = checkTurnChanged(1, 'play', '回合2');
Engine.applyPass(state, 1);

console.log('【第3手】seat2过牌');
const t3 = checkTurnChanged(2, 'play', '回合3');
Engine.applyPass(state, 2);

console.log('【第4手】又轮seat0(连续领出)');
const t4 = checkTurnChanged(0, 'play', '回合4');

console.log('━━━━━━━━━━━━━━━━━━━━━━');
if (!t4.changed) {
  console.log('❌ BUG复现成功!');
  console.log(`  seat0第二手时, seat和phase都没变`);
  console.log(`  turnChanged=false → turnStart 未重置`);
  console.log(`  仍用第一手的起点 → 几乎立即超时!`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(1);
} else {
  console.log('✓ turnChanged=true, 正确重置');
  console.log('━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
}
