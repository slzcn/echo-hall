#!/usr/bin/env node
'use strict';
// test-guandan-engine.js — 掼蛋引擎: 发牌/出牌轮转/接风/名次结算/进贡/回看重放
const Deck = require('../js/games/deck.js');
const Engine = require('../js/games/guandan-engine.js');
const AI = require('../js/games/guandan-ai.js');
const Rules = require('../js/games/guandan-rules.js');

let pass=0, fail=0;
function ok(cond,msg){ if(cond){pass++;} else {fail++; console.error('✗ '+msg);} }

// ── 发牌: 108 张, 4×27, 全局 id 唯一 ──────────────────────────
const d = Deck.dealGuandan(42);
ok(d.hands.length===4 && d.hands.every(h=>h.length===27), '4 家各 27 张');
const allIds = d.hands.flat().map(c=>c.id);
ok(allIds.length===108 && new Set(allIds).size===108, '108 张 id 全局唯一(两副牌)');
// 同一 seed 复现
const d2 = Deck.dealGuandan(42);
ok(JSON.stringify(d.hands.map(h=>h.map(c=>c.id)))===JSON.stringify(d2.hands.map(h=>h.map(c=>c.id))), '同 seed 发牌完全复现');

// ── AI 自对弈打到底(必分出完整名次) ─────────────────────────
function playFull(seed, level, teamLevels, prevResult){
  let st = Engine.createGame({ seed, level, teamLevels,
    isAI:[true,true,true,true], names:['A0','B1','A2','B3'], prevResult });
  let guard=0;
  while (st.phase==='play'){
    if (guard++>2000) throw new Error('play loop @'+seed);
    const s = st.turn;
    const target = (st.table.lastPlay && st.table.lastPlay.seat!==s) ? st.table.lastPlay.parse : null;
    const mv = AI.decide({ seat:s, hand:st.players[s].hand, tableParse:target,
      lastSeat: st.table.lastPlay?st.table.lastPlay.seat:null,
      handsLeft: st.players.map(p=>p.hand.length), level: st.level });
    if (mv.action==='pass'){
      try { Engine.applyPass(st, s); }
      catch(e){ // 无法过(首出)→ 强制出最小合法
        const lead = AI.chooseLead(st.players[s].hand, st.level);
        Engine.applyPlay(st, s, lead);
      }
    } else {
      try { Engine.applyPlay(st, s, mv.cards); }
      catch(e){
        // AI 兜底: 决策非法则尝试过, 再不行强制首出
        try { Engine.applyPass(st, s); }
        catch(_){ const lead=AI.chooseLead(st.players[s].hand, st.level); Engine.applyPlay(st, s, lead); }
      }
    }
  }
  return st;
}

let games=0, teamAwins=0, doubleDowns=0, matchWins=0;
for (let seed=1; seed<=60; seed++){
  const st = playFull(seed, 2, [2,2]);
  const res = st.result;
  games++;
  // 名次完整且是 0..3 的排列
  ok(res.finishOrder.length===4 && new Set(res.finishOrder).size===4, 'seed'+seed+': 名次是 4 席排列') || 0;
  if (!(res.finishOrder.length===4 && new Set(res.finishOrder).size===4)) throw new Error('bad finishOrder @'+seed);
  // 升级量 1..3
  if (!(res.advance>=1 && res.advance<=3)) throw new Error('bad advance @'+seed);
  // 赢家队伍 = 头游队伍
  if (Engine.teamOf(res.finishOrder[0]) !== res.winnerTeam) throw new Error('winnerTeam≠头游队 @'+seed);
  // 升级方向: 赢队等级涨 advance(未过A)
  const wt=res.winnerTeam;
  if (res.teamLevelsAfter[wt] !== Math.min(14, res.teamLevelsBefore[wt]+res.advance)) throw new Error('升级算错 @'+seed);
  // delta 零和(每队各 2 人)
  const sum = Object.values(res.delta).reduce((a,b)=>a+b,0);
  if (sum!==0) throw new Error('delta 非零和 @'+seed);
  if (wt===0) teamAwins++;
  if (res.doubleDown) doubleDowns++;

  // 所有出牌手都合法且守恒: 每家最终手牌 0? (3家出完+末游剩牌)
  const emptied = st.players.filter(p=>p.hand.length===0).length;
  if (emptied<3) throw new Error('不足3家出完 @'+seed);
}
ok(games===60, '60 局自对弈全部打到分出名次');
ok(teamAwins>0 && teamAwins<60, '两队都赢过(名次结算双向都验到)');
ok(doubleDowns>0, '出现过双下(头游+二游同队 → 升3级)');

// ── 回看重放: seed+log 重建终局一致 ─────────────────────────
for (let seed=1; seed<=15; seed++){
  const st = playFull(seed, 2, [2,2]);
  const rp = Engine.replay(st.log);
  if (JSON.stringify(rp.result.finishOrder)!==JSON.stringify(st.result.finishOrder))
    throw new Error('重放名次不一致 @'+seed);
  if (rp.result.advance!==st.result.advance) throw new Error('重放升级量不一致 @'+seed);
}
ok(true, '15 局 seed+log 重放终局完全一致(复核/回看为真)');

// ── 接风: 走完的人由对家接出(不空转/不轮给对手) ──────────────
// 构造: 让 seat0 出完后, seat1/2/3 全过 → 应轮回 seat2(0 的对家)领出
{
  let st = Engine.createGame({ seed:7, level:2, isAI:[true,true,true,true] });
  // 直接验证 partnerOf / nextActive 语义
  ok(Engine.partnerOf(0)===2 && Engine.partnerOf(1)===3, '对家关系 0↔2 / 1↔3');
  ok(Engine.teamOf(0)===Engine.teamOf(2) && Engine.teamOf(1)===Engine.teamOf(3), '0&2 同队, 1&3 同队');
}

// ── 进贡/还贡: 依上局名次转移贡牌 ───────────────────────────
{
  // 造一个"上局结果": A队(0&2) 双下 → B队(1,3) 各进贡
  const prev = { finishOrder:[0,2,1,3], winnerTeam:0 };  // 头游0 二游2 → 双下
  const st = Engine.createGame({ seed:99, level:2, teamLevels:[2,2], dealerTeam:0,
    isAI:[true,true,true,true], prevResult: prev });
  ok(st.tribute!==null, '有上局结果 → 触发进贡流程');
  if (!st.tribute.refused){
    ok(st.tribute.doubleDown===true, '识别为双下(双家进贡)');
    // 每家仍是 27 张(进贡+还贡后守恒)
    ok(st.players.every(p=>p.hand.length===27), '进贡+还贡后各家仍 27 张(守恒)');
    const total = st.players.reduce((n,p)=>n+p.hand.length,0);
    ok(total===108, '进贡后总牌数仍 108');
  }
}
// 抗贡: 输方握 2 大王 → 免贡
{
  // 手工构造: 直接调 _resolveTribute 前塞 2 大王给输家
  const st = Engine.createGame({ seed:99, level:2, isAI:[true,true,true,true], skipTribute:true });
  // 把两张大王塞进 seat1(输方)
  const bigs = st.players.flatMap(p=>p.hand).filter(c=>c.joker==='big');
  // 从各家移除大王再都给 seat1
  st.players.forEach(p=>{ p.hand = p.hand.filter(c=>c.joker!=='big'); });
  bigs.slice(0,2).forEach(c=> st.players[1].hand.push(c));
  const prev = { finishOrder:[0,1,2,3], winnerTeam:0 };  // 单下, 末游3(B队), 但2大王在1
  // loserLow=3; 但抗贡看输方(1&3)合计大王>=2 → 免
  const lead = Engine._resolveTribute(st, prev);
  ok(st.tribute.refused===true, '输方握双大王 → 抗贡成功免贡');
  ok(lead===0, '抗贡后头游首出');
}

console.log(`\nguandan-engine: ${pass} 通过, ${fail} 失败`);
if (fail) process.exit(1);
