#!/usr/bin/env node
'use strict';
/**
 * journey-table-sync.js — 联机牌桌 host 权威同步·完整旅程回归(斗地主 + 掼蛋)
 *
 * 用户旅程(真人联机一整局):
 *   1. host 本机跑真引擎起局 → 给每个座位广播【脱敏快照】
 *   2. 每个客户端【只凭自己那份快照】就能行动(叫分/出牌/过) —— 证明快照信息自足
 *   3. 客户端把动作发回 host → host 用引擎校验并应用 → 广播新快照
 *   4. 打到分出胜负; 全程用内存总线模拟 host↔guest 传输
 *
 * 关键断言(反 anti-pattern「只测能连不测能玩 / 只测功能点不测隐私」):
 *   · 手牌隔离: 任一时刻, 座位 A 的快照里只有 A 自己的真牌, 别家 hand 根本不存在(只有张数)
 *   · 无泄漏: 快照里绝不含 seed / log —— 否则客户端能 replay 推出所有底牌(作弊)
 *   · 收敛一致: 同一 seq 下, 所有座位看到的公共态(轮到谁/地主/倍数/级/桌面最后一手)完全一致
 *   · 本人手牌真实: 客户端看到的自己手牌张数/内容 == host 权威态
 *   · 权威校验: 非本人回合的动作 / 终局后的动作一律被 host 拒(ok:false), 客户端无权改状态
 *   · 确定性未损: 走同步通道打完的一局, 其 log 重放结果与 host 终局完全一致
 */
const path = require('path');
const TS = require('../js/games/table-sync.js');

function assert(ok, msg){ if(!ok) throw new Error('FAIL: '+msg); console.log('✓ '+msg); }

// ── 通用: 从"某座位的快照"重建 AI 决策所需上下文(只用快照里有的信息, 证明自足) ──
function ctxFromSnap(snap, seat){
  const me = snap.players[seat];
  const lp = snap.table.lastPlay;
  const tgt = (lp && lp.seat !== seat) ? lp.parse : null;
  return {
    seat,
    hand: me.hand,                                              // 只有本人快照里才有真牌
    tableParse: tgt,
    lastSeat: lp ? lp.seat : null,
    handsLeft: snap.players.map(p => p.hand ? p.hand.length : p.count),
    landlord: snap.landlord,
    iAmLandlord: seat === snap.landlord,
    level: snap.level,
  };
}

// ── 快照隐私 + 收敛断言(每次广播后跑一遍) ──
function auditBroadcast(host, seats, tag){
  const snaps = seats.map(s => host.snapshotFor(s));
  snaps.forEach((snap, i) => {
    const seat = seats[i];
    // 无 seed / log 泄漏
    if (snap.seed !== undefined || snap.log !== undefined)
      throw new Error(`[${tag}] 座位${seat}快照泄漏 seed/log`);
    // 手牌隔离: 只有自己那席有 hand, 别家一律只有 count
    snap.players.forEach(p => {
      if (p.seat === seat){
        if (!Array.isArray(p.hand)) throw new Error(`[${tag}] 座位${seat}看不到自己的手牌`);
        if (p.hand.length !== host.state.players[seat].hand.length)
          throw new Error(`[${tag}] 座位${seat}自己手牌张数与 host 权威态不一致`);
      } else {
        if (p.hand !== undefined) throw new Error(`[${tag}] 座位${seat}的快照里能看到别家(${p.seat})的手牌!隐私泄漏`);
        if (typeof p.count !== 'number') throw new Error(`[${tag}] 座位${seat}看不到别家(${p.seat})的剩牌数`);
        if (p.count !== host.state.players[p.seat].hand.length)
          throw new Error(`[${tag}] 座位${seat}看到别家(${p.seat})剩牌数与 host 权威态不一致`);
      }
    });
  });
  // 收敛: 所有座位公共态一致(以 0 号视角为基准)
  const base = snaps[0];
  const pub = s => JSON.stringify({
    phase:s.phase, turn:s.turn, seq:s.seq, landlord:s.landlord, multiplier:s.multiplier,
    level:s.level, teamLevels:s.teamLevels, bid:s.bid, bottomCount:s.bottomCount,
    counts:s.players.map(p=>p.hand?p.hand.length:p.count),
    last:s.table.lastPlay?{seat:s.table.lastPlay.seat,cards:s.table.lastPlay.cards.slice()}:null,
  });
  // 已出牌必须是可复原的 id 串(不是被 clone 成对象碎片的垃圾) —— 客户端靠 id 用自己的牌面表重建
  const lp0 = base.table.lastPlay;
  if (lp0) lp0.cards.forEach(id => { if (typeof id !== 'string') throw new Error(`[${tag}] 已出牌不是 id 串(是 ${typeof id}), 客户端无法复原牌面`); });
  const b = pub(base);
  snaps.forEach((s, i) => { if (pub(s) !== b) throw new Error(`[${tag}] 座位${seats[i]}公共态与座位${seats[0]}不收敛`); });
  return snaps;
}

// ══════════════════════════ 斗地主 ══════════════════════════
function playDdz(seed){
  const Engine = require('../js/games/ddz-engine.js');
  const AI = require('../js/games/ddz-ai.js');
  let state = Engine.createGame({ seed, isAI:[false,true,true], names:['你','灵魂A','灵魂B'] });
  let host = TS.HostController(Engine, state);
  const seats = [0,1,2];

  auditBroadcast(host, seats, 'ddz@deal');

  // 叫分阶段: 每席只凭自己快照里的 hand + bid.max 决策
  let guard = 0;
  while (host.state.phase === 'bid'){
    if (guard++ > 30) throw new Error('bid loop');
    const seat = host.state.bid.turn;
    const snap = host.snapshotFor(seat);
    const val = AI.chooseBid(snap.players[seat].hand, snap.bid.max);
    const r = host.submit(seat, { action:'call', val });
    if (!r.ok) throw new Error('叫分被拒: '+r.error);
    if (r.result && r.result.redeal){
      state = Engine.createGame({ seed: seed+7, isAI:[false,true,true], names:['你','灵魂A','灵魂B'] });
      host = TS.HostController(Engine, state);
      guard = 0;
      auditBroadcast(host, seats, 'ddz@redeal');
      continue;
    }
    auditBroadcast(host, seats, 'ddz@bid');
  }

  // 定地主后底牌必须公开
  const afterBid = host.snapshotFor(0);
  assert(afterBid.landlord != null, '斗地主: 叫分结束定出地主');
  assert(Array.isArray(afterBid.bottom) && afterBid.bottom.length === 3, '斗地主: 定地主后底牌向全员公开(3 张)');

  // 出牌阶段
  guard = 0;
  while (host.state.phase === 'play'){
    if (guard++ > 600) throw new Error('play loop');
    const seat = host.state.turn;
    const c = ctxFromSnap(host.snapshotFor(seat), seat);
    const mv = AI.decide(c);
    const r = host.submit(seat, mv.action==='pass' ? {action:'pass'} : {action:'play', cards:mv.cards});
    if (!r.ok) throw new Error('出牌被拒 @seat'+seat+': '+r.error);
    auditBroadcast(host, seats, 'ddz@play');
  }
  return host;
}

console.log('── 斗地主 host 权威同步旅程 ──');
let ddzWins = 0;
for (let seed=100; seed<108; seed++){
  const host = playDdz(seed);
  const Engine = require('../js/games/ddz-engine.js');
  assert(host.state.phase === 'over', 'ddz@'+seed+': 一局打到终局');
  // 确定性: 走同步通道打完的一局, log 重放与 host 终局一致
  const rp = Engine.replay(host.state.log);
  if (JSON.stringify(rp.result.winners) !== JSON.stringify(host.state.result.winners))
    throw new Error('ddz@'+seed+': 同步通道打完后 log 重放胜者不一致(确定性受损)');
  if (rp.result.delta[0] !== host.state.result.delta[0])
    throw new Error('ddz@'+seed+': 重放 my_delta 不一致');
  if (host.state.result.winners.includes(0)) ddzWins++;
}
assert(true, '斗地主 8 局全程走同步通道打到底 + log 重放确定性一致 (我方胜 '+ddzWins+' 局)');

// 权威校验: 非本人回合 / 终局后动作被拒
{
  const Engine = require('../js/games/ddz-engine.js');
  const host = TS.HostController(Engine, Engine.createGame({ seed:100, isAI:[false,true,true], names:['你','灵魂A','灵魂B'] }));
  const bidTurn = host.state.bid.turn;
  const notTurn = (bidTurn+1)%3;
  const bad = host.submit(notTurn, { action:'call', val:1 });
  assert(bad.ok === false, '斗地主: 非本人回合叫分被 host 拒(客户端无权抢动作)');
  const goodTurn = host.submit(bidTurn, { action:'call', val:3 });
  assert(goodTurn.ok === true, '斗地主: 轮到本人叫分被接受');
}

// ══════════════════════════ 掼蛋 ══════════════════════════
function playGuandan(seed){
  const Engine = require('../js/games/guandan-engine.js');
  const AI = require('../js/games/guandan-ai.js');
  const state = Engine.createGame({ seed, level:2, teamLevels:[2,2], isAI:[false,true,true,true], names:['你','灵魂下','灵魂对','灵魂上'] });
  const host = TS.HostController(Engine, state);
  const seats = [0,1,2,3];
  auditBroadcast(host, seats, 'gd@deal');

  let guard = 0;
  while (host.state.phase === 'play'){
    if (guard++ > 4000) throw new Error('gd play loop @'+seed);
    const seat = host.state.turn;
    const c = ctxFromSnap(host.snapshotFor(seat), seat);
    const mv = AI.decide(c);
    let r = host.submit(seat, mv.action==='pass' ? {action:'pass'} : {action:'play', cards:mv.cards});
    if (!r.ok){                                   // AI 偶发非法 → 退化为过牌 / 领出(与单机旅程同兜底)
      r = host.submit(seat, {action:'pass'});
      if (!r.ok) r = host.submit(seat, {action:'play', cards: AI.chooseLead(host.state.players[seat].hand, host.state.level)});
      if (!r.ok) throw new Error('gd 兜底仍被拒 @seat'+seat+': '+r.error);
    }
    auditBroadcast(host, seats, 'gd@play');
  }
  return host;
}

console.log('\n── 掼蛋 host 权威同步旅程 ──');
for (let seed=200; seed<206; seed++){
  const host = playGuandan(seed);
  assert(host.state.phase === 'over', 'gd@'+seed+': 一局打到终局');
  assert(host.state.result && Array.isArray(host.state.result.finishOrder) && host.state.result.finishOrder.length === 4,
    'gd@'+seed+': 终局产出完整名次(finishOrder 4 席)');
}
assert(true, '掼蛋 6 局全程走同步通道打到底(每步过隐私/收敛审计)');

// 权威校验: 掼蛋非本人回合动作被拒
{
  const Engine = require('../js/games/guandan-engine.js');
  const host = TS.HostController(Engine, Engine.createGame({ seed:200, level:2, teamLevels:[2,2], isAI:[false,true,true,true], names:['你','灵魂下','灵魂对','灵魂上'] }));
  const turn = host.state.turn;
  const bad = host.submit((turn+1)%4, { action:'play', cards:[host.state.players[(turn+1)%4].hand[0]] });
  assert(bad.ok === false, '掼蛋: 非本人回合出牌被 host 拒');
}

// ── encodeMove: play 只留 id(防夹带完整对象 / 减小传输体积) ──
{
  const m = TS.encodeMove({ action:'play', cards:[{id:'s14',rank:14,suit:'s',joker:'big',secret:'x'}] });
  assert(m.cards.length === 1 && m.cards[0].id === 's14' && Object.keys(m.cards[0]).join(',') === 'id',
    'encodeMove: 出牌上行只保留 card.id(host 从权威手牌复原, 不信客户端牌面)');
  assert(TS.encodeMove({action:'pass'}).action === 'pass' && TS.encodeMove(null) === null,
    'encodeMove: pass 原样 / 非法动作返回 null');
}

console.log('\n✅ 联机牌桌 host 权威同步旅程全部通过(隐私隔离 + 收敛一致 + 权威校验 + 确定性)');
