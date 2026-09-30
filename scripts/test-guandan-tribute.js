#!/usr/bin/env node
'use strict';
// test-guandan-tribute.js — 掼蛋【手动进贡/还贡】引擎流程:
//   阶段轮转 · 候选合法性 · 拒绝非法牌 · 牌数守恒 · 抗贡 · 全程日志可重放。
const Deck = require('../js/games/deck.js');
const Engine = require('../js/games/guandan-engine.js');
const AI = require('../js/games/guandan-ai.js');
const Rules = require('../js/games/guandan-rules.js');

let pass=0, fail=0;
function ok(cond,msg){ if(cond){pass++;} else {fail++; console.error('✗ '+msg);} }
const teamOf = Engine.teamOf;

const NAMES=['A0','B1','A2','B3'];
function newManual(seed, prevResult){
  return Engine.createGame({ seed, isAI:[false,true,true,true], names:NAMES,
    teamLevels:[2,2], dealerTeam:0, prevResult, manualTribute:true });
}
// 全副牌 id 集合快照(守恒校验)
function allIds(st){ return st.players.flatMap(p=>p.hand.map(c=>c.id)).sort(); }

// ── 单下(赢家只占头游): finishOrder=[0,1,2,3] → loserLow=3 进贡给 0, 0 还贡给 3 ──
{
  const prev = { finishOrder:[0,1,2,3] };
  const st = newManual(7, prev);
  ok(st.phase==='tribute', '单下: 进入 tribute 阶段');
  ok(st.turn===3, '单下: 首个进贡任务由 loserLow(3) 执行');
  const tp = st.tributePending;
  ok(tp && tp.tasks.length===2 && tp.tasks[0].kind==='give' && tp.tasks[1].kind==='return', '单下: 2 个任务(先进贡后还贡)');
  ok(tp.tasks[0].from===3 && tp.tasks[0].to===0, '单下: 进贡 3→0');
  const idsBefore = allIds(st);

  // 进贡候选 = 座位3 最大牌(powerOf 顶点)
  const giveC = Engine.tributeCandidates(st, 3);
  let maxp=-1; for(const c of st.players[3].hand){ if(Rules.isWild(c,st.level))continue; const p=Rules.powerOf(c,st.level); if(p>maxp)maxp=p; }
  ok(giveC.length>=1 && giveC.every(id=>{ const c=st.players[3].hand.find(x=>x.id===id); return Rules.powerOf(c,st.level)===maxp; }), '单下: 进贡候选均为最大牌');

  // 非当前行动席不能进贡
  let threw=false; try{ Engine.applyTribute(st, 0, giveC[0]); }catch(e){ threw = e.message==='not_your_tribute_turn'; }
  ok(threw, '单下: 非当前席进贡被拒');
  // 进贡一张非最大牌被拒
  const notMax = st.players[3].hand.find(c=>!Rules.isWild(c,st.level) && Rules.powerOf(c,st.level)<maxp);
  if(notMax){ let t2=false; try{ Engine.applyTribute(st,3,notMax.id); }catch(e){ t2=e.message==='illegal_tribute_card'; } ok(t2,'单下: 进贡非最大牌被拒'); }

  const giveId = giveC[0];
  const r1 = Engine.applyTribute(st, 3, giveId);
  ok(!r1.tributeDone && st.phase==='tribute' && st.turn===0, '单下: 进贡后转到还贡席(0)');
  ok(st.players[0].hand.some(c=>c.id===giveId), '单下: 贡牌已到收贡席手中');

  // 还贡候选 = 座位0 自然点≤10 的非百搭牌
  const backC = Engine.tributeCandidates(st, 0);
  ok(backC.length>=1 && backC.every(id=>{ const c=st.players[0].hand.find(x=>x.id===id); return !c.joker && !Rules.isWild(c,st.level) && Rules.naturalRank(c)<=10; }), '单下: 还贡候选均为 ≤10 非百搭');
  // 还贡一张 >10 的牌被拒(若有)
  const big = st.players[0].hand.find(c=>!c.joker && Rules.naturalRank(c)>10);
  if(big){ let t3=false; try{ Engine.applyTribute(st,0,big.id); }catch(e){ t3=e.message==='illegal_tribute_card'; } ok(t3,'单下: 还贡 >10 的牌被拒'); }

  const backId = backC[0];
  const r2 = Engine.applyTribute(st, 0, backId);
  ok(r2.tributeDone && st.phase==='play', '单下: 还贡后进入 play 阶段');
  ok(st.turn===3, '单下: 首出席 = loserLow(3)');
  ok(st.tribute && !st.tribute.refused && st.tribute.transfers.length===1, '单下: tribute 摘要 1 条');
  ok(st.tribute.transfers[0].give===giveId && st.tribute.transfers[0].back===backId, '单下: 摘要含正确 give/back');
  // 守恒: 108 张不增不减, 且各家仍 27 张(净交换)
  ok(JSON.stringify(allIds(st))===JSON.stringify(idsBefore), '单下: 全副牌 id 集合守恒');
  ok(st.players.every(p=>p.hand.length===27), '单下: 交换后各家仍 27 张');
}

// ── 双下(赢家占头游+二游): finishOrder=[0,2,1,3] → 3→0, 1→2 各进贡, 再各还贡 ──
{
  const prev = { finishOrder:[0,2,1,3] };
  const st = newManual(11, prev);
  ok(st.phase==='tribute' && st.tributePending.doubleDown, '双下: tribute 阶段且 doubleDown');
  const tp = st.tributePending;
  ok(tp.tasks.length===4, '双下: 4 个任务(2 进贡 + 2 还贡)');
  ok(tp.tasks[0].from===3 && tp.tasks[0].to===0 && tp.tasks[1].from===1 && tp.tasks[1].to===2, '双下: 进贡 3→0 与 1→2');
  const idsBefore = allIds(st);
  // 依次执行 4 步(默认: 进贡取候选首张, 还贡取最小 power)
  let guard=0;
  while(st.phase==='tribute'){
    if(guard++>8) throw new Error('tribute loop');
    const seat = st.turn;
    const cands = Engine.tributeCandidates(st, seat);
    const task = st.tributePending.tasks[st.tributePending.idx];
    let pick = cands[0];
    if(task.kind==='return'){ // 取 power 最小
      let mp=999; for(const id of cands){ const c=st.players[seat].hand.find(x=>x.id===id); const p=Rules.powerOf(c,st.level); if(p<mp){mp=p;pick=id;} }
    }
    Engine.applyTribute(st, seat, pick);
  }
  ok(st.phase==='play' && st.turn===3, '双下: 完成后 play 且首出=order[3]=3');
  ok(st.tribute.transfers.length===2 && st.tribute.transfers.every(t=>t.give!=null && t.back!=null), '双下: 2 条转移均含 give/back');
  ok(JSON.stringify(allIds(st))===JSON.stringify(idsBefore), '双下: 全副牌 id 集合守恒');
}

// ── 抗贡(输方合计双大王)直接开打, 不进 tribute 阶段 ──
{
  // finishOrder=[1,3,0,2]: winnerTeam=B(1,3), losers=A(0,2); 把两大王塞进 0 与 2
  const fake = { level:2, log:[], players:[
    { seat:0, hand:[{joker:'big',id:'BJ1'},{rank:5,suit:'♠',id:'x5'}] },
    { seat:1, hand:[{rank:6,suit:'♠',id:'x6'}] },
    { seat:2, hand:[{joker:'big',id:'BJ2'},{rank:7,suit:'♠',id:'x7'}] },
    { seat:3, hand:[{rank:8,suit:'♠',id:'x8'}] },
  ]};
  const lead = Engine._setupManualTribute(fake, { finishOrder:[1,3,0,2] });
  ok(fake.phase==='play', '抗贡: 直接进入 play');
  ok(fake.tribute && fake.tribute.refused===true, '抗贡: tribute.refused=true');
  ok(lead===1, '抗贡: 头游(1)首出');
}

// ── 全程可重放: 手动进贡→打到底, replay(log) 重建同名次 ──
{
  const prev = { finishOrder:[0,1,2,3] };
  const st = newManual(23, prev);
  // 驱动进贡(默认策略)
  let g=0; while(st.phase==='tribute'){ if(g++>8)throw new Error('trib'); const s=st.turn; const cands=Engine.tributeCandidates(st,s); Engine.applyTribute(st,s,cands[0]); }
  // AI 自对弈打到底
  let guard=0;
  while(st.phase==='play'){
    if(guard++>3000) throw new Error('play loop');
    const s=st.turn;
    const target=(st.table.lastPlay && st.table.lastPlay.seat!==s)?st.table.lastPlay.parse:null;
    const mv=AI.decide({ seat:s, hand:st.players[s].hand, tableParse:target,
      lastSeat: st.table.lastPlay?st.table.lastPlay.seat:null,
      handsLeft: st.players.map(p=>p.hand.length), level: st.level });
    if(mv.action==='pass'){ try{ Engine.applyPass(st,s); }catch(e){ const lead=AI.chooseLead(st.players[s].hand,st.level); Engine.applyPlay(st,s,lead); } }
    else { try{ Engine.applyPlay(st,s,mv.cards); }catch(e){ try{ Engine.applyPass(st,s);}catch(_){ const lead=AI.chooseLead(st.players[s].hand,st.level); Engine.applyPlay(st,s,lead);} } }
  }
  ok(st.phase==='over' && st.result, '重放: 手动进贡局能打到 over');
  const rp = Engine.replay(st.log);
  ok(rp.result && JSON.stringify(rp.result.finishOrder)===JSON.stringify(st.result.finishOrder), '重放: replay(log) 名次一致');
}

console.log(`\n掼蛋手动进贡测试: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
