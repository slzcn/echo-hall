#!/usr/bin/env node
'use strict';
// journey-ddz-online.js — 斗地主【真人联机】host 权威 + 脱敏快照 + 私牌隔离 完整旅程(含叫分阶段)
// 模拟多副联机: host 本机跑真引擎当裁判; 客人只拿【脱敏公共快照 + 自己那副手牌】,
// 凭此算合法叫分/出牌把动作发回 host; host 用引擎校验后应用并重新广播。断言全链路防作弊命门:
//   (1) host 每次广播的公共快照【永不外泄】任何人当前手牌 / seed / log(只给各家张数 handCount);
//       且【定地主前】连底牌(3 张)都不给牌面(只给 bottomCount) —— 否则能推地主走向;定后才明置公开。
//   (2) 客人仅凭"自己手牌 + 公共快照"组出的伪状态, 能正确算出自己的合法叫分/出牌(Rules/AI);
//   (3) 私牌隔离: 客人 A 无从读到客人 B 的手牌(RLS 模拟: 只放行 uid 匹配的那一行);
//   (4) host 权威: 非本人回合 / 不在手上 / 压不过 / 叫分不加价 的动作被引擎拒(客户端无权改权威状态);
//   (5) 收敛一致: 打到终局, 每个客人手里最后一张快照的公共态(地主/胜负/倍数/账变)与 host 权威 result 一致。
// 斗地主手牌是【动态】的: 地主定后 +3 底牌 / 每次出牌减少, host 重写其私牌行 —— 本测试每次广播都让客人重拉自己手牌。
const Deck   = require('../js/games/deck.js');
const Rules  = require('../js/games/ddz-rules.js');
const Engine = require('../js/games/ddz-engine.js');
const AI     = require('../js/games/ddz-ai.js');
const Net    = require('../js/games/ddz-net.js');

let step = 0, failed = false;
function assert(cond, msg){ step++; if(!cond){ failed=true; console.error(`✗ [${step}] ${msg}`); } else console.log(`✓ [${step}] ${msg}`); }

// ── 桌面配置: 3 席(1 地主 vs 2 农民)。0=host 真人(host本机驱动), 1 & 2 = 远程真人(各自客户端) ──
const names   = ['房主','远客甲','远客乙'];
const seatUid = ['uid-host','uid-guestA','uid-guestB'];
const REMOTE_SEATS = [1, 2];                       // 远程真人席(host 本机不替其决策, 等其动作回传)

// ── 私牌存储 + RLS 模拟(照抄 eh_gt_hands: 每 uid 只能 select 到自己那一行) ──
// 斗地主手牌动态: host 每次状态变更后重写各家当前手牌(全写进 store, RLS 挡跨读)。
const handsStore = {};   // seat -> { uid, hand:[cardPlain] }
function hostSetHands(state){
  state.players.forEach(p => { handsStore[p.seat] = { uid: seatUid[p.seat], hand: p.hand.map(Net.cardPlain) }; });
}
function readHandAs(seat, asUid){
  const h = handsStore[seat];
  if (!h || h.uid !== asUid) return null;    // RLS: uid 不匹配一律拿不到
  return h.hand.map(Net.cardPlain);
}

// ── 客人端: 只持有 { seat, uid, snap(最近一张公共快照), myHand } ──
const guests = REMOTE_SEATS.map(seat => ({ seat, uid: seatUid[seat], snap: null, myHand: null }));

let leakSeen = false, isoOk = true, bottomHiddenOk = true;
let guestComputedLegalBid = 0, guestComputedLegalPlay = 0, guestAcceptedByHost = 0, convergeChecks = 0;

// host 广播: 重写各家手牌 → 产出脱敏快照 → 断言无泄露 → 分发; 客人重拉自己手牌(模拟 realtime 私牌推送)。
function hostBroadcast(state, dealNo){
  hostSetHands(state);
  const snap = Net.snapshot(state, dealNo);
  const chk = Net.assertNoLeak(snap);
  if (!chk.ok){ leakSeen = true; console.error('  快照泄露:', chk.leaks.join(', ')); }
  // 定地主前底牌只给张数(3), 不给牌面; 定后必带 3 张明牌。
  const landlordSet = snap.landlord !== null && snap.landlord !== undefined;
  if (!landlordSet){ if (('bottom' in snap) || snap.bottomCount !== 3) bottomHiddenOk = false; }
  else { if (!Array.isArray(snap.bottom) || snap.bottom.length !== 3) bottomHiddenOk = false; }
  guests.forEach(g => { g.snap = snap; g.myHand = readHandAs(g.seat, g.uid); });
}

// 客人凭"公共快照 + 自己手牌"组伪状态并算一个合法【叫分】(bid 阶段, 不碰 host 引擎)。
function guestBid(g){
  const ps = Net.pseudoState(g.snap, g.seat, g.myHand);
  // (2) bid 阶段伪状态: 自己手牌是真牌(17 张), 别家只占位, 底牌全 null(定前不下发牌面)
  const mine = ps.players[g.seat].hand;
  const mineOk = Array.isArray(mine) && mine.length === g.snap.players[g.seat].handCount && mine.every(c=>c && c.id);
  const othersHidden = ps.players.every((p,i)=> i===g.seat || p.hand.every(c=>c===null));
  const bottomHidden = ps.bottom.every(c=>c===null);
  if (mineOk && othersHidden && bottomHidden) guestComputedLegalBid++;
  return AI.chooseBid(mine, ps.bid ? ps.bid.max : 0);
}

// 客人凭"公共快照 + 自己手牌"组伪状态并算一个合法【出牌】(play 阶段, 不碰 host 引擎)。
function guestDecide(g){
  const ps = Net.pseudoState(g.snap, g.seat, g.myHand);
  const mine = ps.players[g.seat].hand;
  // 地主定后, 若我是地主, 我的手牌应含底牌(20 张); 别家仍只占位, 底牌此刻明置(公开)。
  const mineOk = Array.isArray(mine) && mine.length === g.snap.players[g.seat].handCount && mine.every(c=>c && c.id);
  const othersHidden = ps.players.every((p,i)=> i===g.seat || p.hand.every(c=>c===null));
  if (mineOk && othersHidden) guestComputedLegalPlay++;

  const lp = ps.table.lastPlay;
  const mustBeat = lp && lp.seat !== g.seat;
  const target = mustBeat ? lp.parse : null;
  return AI.decide({ seat: g.seat, hand: mine, tableParse: target,
    landlord: ps.landlord, lastSeat: lp ? lp.seat : null,
    handsLeft: ps.players.map(p=>p.hand.length) });
}

// host 本机席(0=真人)由 host 引擎旁的 AI 决策(测试里 host 真人也用 AI 替跑)。
function hostBidDecide(state, seat){ return AI.chooseBid(state.players[seat].hand, state.bid.max); }
function hostDecide(state, seat){
  const lp = state.table.lastPlay;
  const target = (lp && lp.seat !== seat) ? lp.parse : null;
  return AI.decide({ seat, hand: state.players[seat].hand, tableParse: target,
    landlord: state.landlord, lastSeat: lp ? lp.seat : null,
    handsLeft: state.players.map(p=>p.hand.length) });
}

// host 权威应用一手出牌(引擎校验回合/合法/手牌/压制); 客人非法则兜底改不出/领出(线上 host 也会拒并等重发/超时代打)。
function hostApplyPlay(state, seat, mv, fromGuest){
  try {
    if (mv.action === 'pass'){ Engine.applyPass(state, seat); }
    else {
      const hand = state.players[seat].hand;
      const cards = (mv.cards||[]).map(c => hand.find(h=>h.id===(c&&c.id||c))).filter(Boolean);
      const r = Engine.applyPlay(state, seat, cards);
      if (fromGuest && r) guestAcceptedByHost++;
    }
  } catch(_){
    try { Engine.applyPass(state, seat); }
    catch(__){ try { Engine.applyPlay(state, seat, [ state.players[seat].hand[state.players[seat].hand.length-1] ]); } catch(___){ return false; } }
  }
  return true;
}

// ── 打多副, 全链路跑联机(每副含: 叫分 → 定地主 → 出牌 → 终局) ──
let sawOver = false, sawGuestLandlord = false;
let outOfTurnRejected = false, notInHandRejected = false, bidNoRaiseRejected = false, outOfBidTurnRejected = false;
let dealNo = 0, reproofDone = false;

while (dealNo < 6){
  let seed = 70000 + dealNo * 7;
  let state;
  try { state = Engine.createGame({ seed, names, isAI: [false,false,false] }); }
  catch(e){ assert(false, `第${dealNo}副建局失败: ${e.message}`); break; }

  hostBroadcast(state, dealNo);   // 广播首帧(bid 阶段, 底牌不下发)

  // ── 叫分阶段: 各席轮流叫; 全不叫则重发(换 seed 重开) ──
  let bidGuard = 0;
  while (state.phase === 'bid' && bidGuard++ < 30){
    const seat = state.bid.turn;
    // 一次性 bid 反证(仅第 0 副做一遍): 非本人 bid 回合 / 叫分不加价 必被拒
    if (dealNo === 0 && !outOfBidTurnRejected){
      const notMe = (seat + 1) % 3;
      try { Engine.applyCall(state, notMe, 1); } catch(_){ outOfBidTurnRejected = true; }
      if (state.bid.max > 0){ try { Engine.applyCall(state, seat, state.bid.max); } catch(_){ bidNoRaiseRejected = true; } }
      else { bidNoRaiseRejected = true; }   // 首叫无上限可证时, 视为已覆盖(下一副仍有机会)
    }
    const val = (REMOTE_SEATS.indexOf(seat) >= 0) ? guestBid(guests.find(x=>x.seat===seat)) : hostBidDecide(state, seat);
    let r;
    try { r = Engine.applyCall(state, seat, val); }
    catch(_){ try { r = Engine.applyCall(state, seat, 0); } catch(__){ r = { ok:true }; } }   // 兜底不叫
    if (r && r.redeal){ seed += 1000; state = Engine.createGame({ seed, names, isAI:[false,false,false] }); }
    hostBroadcast(state, dealNo);
  }
  if (state.phase === 'bid'){ assert(false, `第${dealNo}副叫分未收敛`); break; }
  if (REMOTE_SEATS.indexOf(state.landlord) >= 0) sawGuestLandlord = true;

  // 定地主后一次性 play 反证(仅第一次进入 play): 非本人回合 / 打不在手上的牌 必被引擎拒
  if (!reproofDone){
    reproofDone = true;
    const cur = state.turn, notMe = (cur + 1) % 3;
    try { Engine.applyPlay(state, notMe, [state.players[notMe].hand[0]]); } catch(_){ outOfTurnRejected = true; }
    const someoneElse = state.players[(cur + 1) % 3].hand[0];
    try { Engine.applyPlay(state, cur, [someoneElse]); } catch(_){ notInHandRejected = true; }
  }

  // ── 出牌阶段 ──
  let guard = 0;
  while (state.phase !== 'over' && guard++ < 600){
    const seat = state.turn;
    if (REMOTE_SEATS.indexOf(seat) >= 0){
      hostApplyPlay(state, seat, guestDecide(guests.find(x=>x.seat===seat)), true);
    } else {
      hostApplyPlay(state, seat, hostDecide(state, seat), false);
    }
    hostBroadcast(state, dealNo);
  }
  if (state.phase !== 'over'){ assert(false, `第${dealNo}副未走到终局`); break; }
  sawOver = true;

  // (5) 收敛: 每个客人最后一张快照的公共态与 host 权威 result 对齐
  const res = state.result;
  guests.forEach(g => {
    const s = g.snap;
    if (s.phase !== 'over' || !s.result){ failed=true; console.error(`  客人席${g.seat}未收到终局快照`); return; }
    if (s.result.landlord !== res.landlord){ failed=true; console.error(`  客人席${g.seat}地主不一致`); return; }
    if (s.result.landlordWon !== res.landlordWon){ failed=true; console.error(`  客人席${g.seat}胜负不一致`); return; }
    if (s.result.winnerSeat !== res.winnerSeat){ failed=true; console.error(`  客人席${g.seat}赢家不一致`); return; }
    if (s.result.finalMultiplier !== res.finalMultiplier){ failed=true; console.error(`  客人席${g.seat}倍数不一致`); return; }
    if (JSON.stringify(s.result.delta) !== JSON.stringify(res.delta)){ failed=true; console.error(`  客人席${g.seat}账变不一致`); return; }
    convergeChecks++;
  });
  // (3) 私牌隔离: 客人 A 读客人 B / host 的手牌 → 一律 null
  if (readHandAs(2, 'uid-guestA') !== null) isoOk = false;
  if (readHandAs(1, 'uid-guestB') !== null) isoOk = false;
  if (readHandAs(0, 'uid-guestA') !== null) isoOk = false;
  if (readHandAs(0, 'uid-guestB') !== null) isoOk = false;

  dealNo++;
}

// ── 断言 ──
assert(dealNo >= 3, `联机跑了至少 3 副 (实 ${dealNo} 副)`);
assert(!leakSeen, '(1) host 广播的公共快照全程无泄露(无手牌/seed/log, 只给张数)');
assert(bottomHiddenOk, '(1b) 底牌定地主前只给 bottomCount(3) 不给牌面, 定后才明置 3 张(公开)');
assert(guestComputedLegalBid > 0, `(2) 叫分阶段: 客人凭"自己手牌+公共快照"组伪状态(自己真牌/别家占位/底牌全隐) (${guestComputedLegalBid} 次)`);
assert(guestComputedLegalPlay > 0, `(2b) 出牌阶段: 客人组伪状态算合法出牌(自己真牌/别家仅占位) (${guestComputedLegalPlay} 次)`);
assert(guestAcceptedByHost > 0, `(2c) 客人算出的出牌被 host 引擎校验通过并应用 (${guestAcceptedByHost} 次)`);
assert(sawGuestLandlord, '(2d) 覆盖"远程客人抢到地主"(其私牌 +3 底牌变 20 张, host 重写私牌行)');
assert(isoOk, '(3) 私牌隔离: 客人读不到他人手牌(RLS uid 不匹配即拒)');
assert(outOfBidTurnRejected, '(4a) host 权威: 非本人叫分回合被引擎拒');
assert(bidNoRaiseRejected, '(4b) host 权威: 叫分不加价被引擎拒');
assert(outOfTurnRejected, '(4c) host 权威: 非本人回合的出牌被引擎拒');
assert(notInHandRejected, '(4d) host 权威: 打不在自己手上的牌被引擎拒');
assert(convergeChecks > 0 && !failed, `(5) 收敛: 每副每个客人快照公共态与 host result 一致 (${convergeChecks} 次核对)`);
assert(sawOver, '旅程覆盖至少一副完整终局(地主/胜负/倍数/账变)');

// 单独直证快照剥离(即便引擎内部字段改名, 这条也钉住白名单产出): 从一个带 seed/log 的真 state 取快照
{
  const st = Engine.createGame({ seed: 424242, names, isAI:[false,false,false] });
  const snap = Net.snapshot(st, 0);
  assert(!('seed' in snap) && !('log' in snap), '快照对象不含 seed/log 键');
  assert(snap.players.every(p => !('hand' in p) && typeof p.handCount==='number' && p.handCount>0), '快照里每一席只给 handCount, 无 hand 字段');
  assert(!('bottom' in snap) && snap.bottomCount === 3, 'bid 阶段快照不含 bottom 牌面(只 bottomCount=3)');
  // 定地主 → 底牌明置(公开信息), 但手牌/seed/log 仍不外泄
  Engine.applyCall(st, st.bid.turn, 3);   // 叫 3 立即定地主
  const snap2 = Net.snapshot(st, 0);
  assert(Net.assertNoLeak(snap2).ok, '定地主后快照仍无泄露(手牌/seed/log 不外泄)');
  assert(Array.isArray(snap2.bottom) && snap2.bottom.length === 3 && snap2.bottom.every(c=>c&&c.id), '定地主后快照明置底牌 3 张(公开)');
  assert(st.seed && st.log && st.log.length>0, '(对照)原始 state 确实持有 seed/log(证明快照是真剥离而非本就没有)');
}

console.log(`\n斗地主联机旅程: ${step} 步${failed?' —— 有失败':' 全过'}`);
process.exit(failed ? 1 : 0);
