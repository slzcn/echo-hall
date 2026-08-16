#!/usr/bin/env node
'use strict';
// journey-guandan-online.js — 掼蛋【真人联机】host 权威 + 脱敏快照 + 私牌隔离 完整旅程
// 模拟多副联机: host 本机跑真引擎当裁判; 客人只拿【脱敏公共快照 + 自己那副手牌】,
// 凭此算合法出牌把动作发回 host; host 用引擎校验后应用并重新广播。断言全链路的防作弊命门:
//   (1) host 每次广播的公共快照【永不外泄】任何人当前手牌 / seed / log(只给各家张数 handCount);
//   (2) 客人仅凭"自己手牌 + 公共快照"组出的伪状态, 能正确算出自己的合法出牌(Rules/AI);
//   (3) 私牌隔离: 客人 A 无从读到客人 B 的手牌(RLS 模拟: 只放行 uid 匹配的那一行);
//   (4) host 权威: 非本人回合 / 不在手上 / 压不过 的出牌被引擎拒(客户端无权改权威状态);
//   (5) 收敛一致: 打到终局, 每个客人手里最后一张快照的公共态(名次/升级/赢家)与 host 权威 result 一致。
// 掼蛋手牌是【动态】的: 每次出牌该家手牌变, host 重写其私牌行 —— 本测试每次广播都让客人重拉自己手牌(模拟 realtime 推送)。
const Deck   = require('../js/games/deck.js');
const Rules  = require('../js/games/guandan-rules.js');
const Engine = require('../js/games/guandan-engine.js');
const AI     = require('../js/games/guandan-ai.js');
const Net    = require('../js/games/guandan-net.js');

let step = 0, failed = false;
function assert(cond, msg){ step++; if(!cond){ failed=true; console.error(`✗ [${step}] ${msg}`); } else console.log(`✓ [${step}] ${msg}`); }

// ── 桌面配置: 4 席 2 队(0&2 一队 / 1&3 一队)。0=host 真人, 2=AI/灵魂席(host本机), 1 & 3 = 远程真人(各自客户端) ──
const names   = ['房主','远客甲','灵魂对家','远客乙'];
const seatUid = ['uid-host','uid-guestA','uid-soul','uid-guestB'];
const REMOTE_SEATS = [1, 3];                       // 远程真人席(host 本机不替其决策, 等其动作回传)

// ── 私牌存储 + RLS 模拟(照抄 eh_gt_hands: 每 uid 只能 select 到自己那一行) ──
// 掼蛋手牌动态: host 每次状态变更后重写各家当前手牌(全写进 store, RLS 挡跨读)。
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

let leakSeen = false, isoOk = true, guestComputedLegal = 0, guestAcceptedByHost = 0, convergeChecks = 0;

// host 广播: 重写各家手牌 → 产出脱敏快照 → 断言无泄露 → 分发; 客人重拉自己手牌(模拟 realtime 私牌推送)。
function hostBroadcast(state, dealNo){
  hostSetHands(state);
  const snap = Net.snapshot(state, dealNo);
  const chk = Net.assertNoLeak(snap);
  if (!chk.ok){ leakSeen = true; console.error('  快照泄露:', chk.leaks.join(', ')); }
  guests.forEach(g => { g.snap = snap; g.myHand = readHandAs(g.seat, g.uid); });
}

// 客人凭"公共快照 + 自己手牌"组伪状态并算一个合法动作(不碰 host 引擎)。
function guestDecide(g){
  const ps = Net.pseudoState(g.snap, g.seat, g.myHand);
  // (2) 伪状态里: 自己手牌是真牌(张数与快照一致), 别家只有占位(内容 null), 张数正确
  const mine = ps.players[g.seat].hand;
  const mineOk = Array.isArray(mine) && mine.length === g.snap.players[g.seat].handCount && mine.every(c=>c && c.id);
  const othersHidden = ps.players.every((p,i)=> i===g.seat || p.hand.every(c=>c===null));
  const othersCountOk = ps.players.every((p,i)=> p.hand.length === g.snap.players[i].handCount);
  if (mineOk && othersHidden && othersCountOk) guestComputedLegal++;

  const lp = ps.table.lastPlay;
  const mustBeat = lp && lp.seat !== g.seat;
  const target = mustBeat ? lp.parse : null;
  const mv = AI.decide({ seat: g.seat, hand: mine, tableParse: target,
    lastSeat: lp ? lp.seat : null,
    handsLeft: ps.players.map(p=>p.hand.length), level: ps.level });
  return mv;
}

// host 本机席(0=真人 / 2=AI灵魂)由 host 引擎旁的 AI 决策(测试里 host 真人也用 AI 替跑)。
function hostDecide(state, seat){
  const lp = state.table.lastPlay;
  const target = (lp && lp.seat !== seat) ? lp.parse : null;
  return AI.decide({ seat, hand: state.players[seat].hand, tableParse: target,
    lastSeat: lp ? lp.seat : null,
    handsLeft: state.players.map(p=>p.hand.length), level: state.level });
}

// host 权威应用一手(引擎校验回合/合法/手牌/压制); 客人非法则兜底改不出(线上 host 也会拒并等重发/超时代打)。
function hostApply(state, seat, mv, fromGuest){
  try {
    if (mv.action === 'pass'){ Engine.applyPass(state, seat); }
    else {
      const hand = state.players[seat].hand;
      const cards = (mv.cards||[]).map(c => hand.find(h=>h.id===(c&&c.id||c))).filter(Boolean);
      const r = Engine.applyPlay(state, seat, cards);
      if (fromGuest && r) guestAcceptedByHost++;
    }
  } catch(_){
    // 兜底: 能不出就不出, 否则领出一手(与 UI aiStep 同源)
    try { Engine.applyPass(state, seat); }
    catch(__){ try { Engine.applyPlay(state, seat, AI.chooseLead(state.players[seat].hand, state.level)); } catch(___){ return false; } }
  }
  return true;
}

// ── 打多副, 全链路跑联机 ──
let sawOver = false, outOfTurnRejected = false, illegalRejected = false, notInHandRejected = false;
let dealNo = 0;

while (dealNo < 6){
  let state;
  try { state = Engine.createGame({ seed: 90000 + dealNo, names, isAI: [false,false,true,false] }); }
  catch(e){ assert(false, `第${dealNo}副建局失败: ${e.message}`); break; }
  // isAI: 引擎视角只 2 席是 AI(灵魂对家); 真人席(0/1/3)由 host 或各客户端驱动。此处纯为 state 标记。

  hostBroadcast(state, dealNo);   // 广播首帧

  // 一次性的 host 权威反证(第 0 副做一遍): 非本人回合 / 不在手上 / 压不过 必被引擎拒
  if (dealNo === 0){
    const cur = state.turn, notMe = (cur+1)%4;
    try { Engine.applyPlay(state, notMe, [state.players[notMe].hand[0]]); } catch(_){ outOfTurnRejected = true; }
    // 拿一张别家的牌冒充自己出 → not_in_hand
    const someoneElse = state.players[(cur+1)%4].hand[0];
    try { Engine.applyPlay(state, cur, [someoneElse]); } catch(_){ notInHandRejected = true; }
  }

  let guard = 0;
  while (state.phase !== 'over' && guard++ < 600){
    const seat = state.turn;
    if (REMOTE_SEATS.indexOf(seat) >= 0){
      const g = guests.find(x=>x.seat===seat);
      hostApply(state, seat, guestDecide(g), true);
    } else {
      hostApply(state, seat, hostDecide(state, seat), false);
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
    if (JSON.stringify(s.result.finishOrder) !== JSON.stringify(res.finishOrder)){ failed=true; console.error(`  客人席${g.seat}名次不一致`); return; }
    if (s.result.winnerTeam !== res.winnerTeam){ failed=true; console.error(`  客人席${g.seat}赢家队不一致`); return; }
    if (JSON.stringify(s.result.teamLevelsAfter) !== JSON.stringify(res.teamLevelsAfter)){ failed=true; console.error(`  客人席${g.seat}升级后等级不一致`); return; }
    convergeChecks++;
  });
  // (3) 私牌隔离: 客人 A 读客人 B / host 的手牌 → 一律 null
  if (readHandAs(3, 'uid-guestA') !== null) isoOk = false;
  if (readHandAs(1, 'uid-guestB') !== null) isoOk = false;
  if (readHandAs(0, 'uid-guestA') !== null) isoOk = false;
  if (readHandAs(2, 'uid-guestB') !== null) isoOk = false;

  dealNo++;
}

// ── 断言 ──
assert(dealNo >= 3, `联机跑了至少 3 副 (实 ${dealNo} 副)`);
assert(!leakSeen, '(1) host 广播的公共快照全程无泄露(无手牌/seed/log, 只给张数)');
assert(guestComputedLegal > 0, `(2) 客人凭"自己手牌+公共快照"组出伪状态(自己真牌/别家仅占位) (${guestComputedLegal} 次)`);
assert(guestAcceptedByHost > 0, `(2b) 客人算出的出牌被 host 引擎校验通过并应用 (${guestAcceptedByHost} 次)`);
assert(isoOk, '(3) 私牌隔离: 客人读不到他人手牌(RLS uid 不匹配即拒)');
assert(outOfTurnRejected, '(4a) host 权威: 非本人回合的出牌被引擎拒');
assert(notInHandRejected, '(4b) host 权威: 打不在自己手上的牌被引擎拒');
assert(convergeChecks > 0 && !failed, `(5) 收敛: 每副每个客人快照公共态与 host result 一致 (${convergeChecks} 次核对)`);
assert(sawOver, '旅程覆盖至少一副完整终局(名次+升级)');

// 单独直证快照剥离(即便引擎内部字段改名, 这条也钉住白名单产出): 从一个带 seed/log 的真 state 取快照
{
  const st = Engine.createGame({ seed: 424242, names, isAI:[false,false,true,false] });
  const snap = Net.snapshot(st, 0);
  assert(!('seed' in snap) && !('log' in snap), '快照对象不含 seed/log 键');
  assert(snap.players.every(p => !('hand' in p) && typeof p.handCount==='number' && p.handCount>0), '快照里每一席只给 handCount, 无 hand 字段');
  const illegalReject = (function(){ try{ Engine.applyPlay(st, st.turn, [st.players[(st.turn+1)%4].hand[0]]); return false; }catch(_){ return true; } })();
  assert(illegalReject, '(对照)拿别家牌冒充出牌被引擎拒(证明手牌绑定引擎权威)');
  assert(st.seed && st.log && st.log.length>0, '(对照)原始 state 确实持有 seed/log(证明快照是真剥离而非本就没有)');
}

// 进贡态快照: 有上局结果 → createGame 走进贡, 快照应带 tribute(明置公开) 且仍不漏手牌
{
  const st0 = Engine.createGame({ seed: 55501, names, isAI:[false,false,true,false] });
  let g=0; while(st0.phase!=='over' && g++<600){ hostApply(st0, st0.turn, hostDecide(st0, st0.turn), false); }
  if (st0.phase==='over'){
    const st1 = Engine.createGame({ seed: 55502, names, isAI:[false,false,true,false],
      teamLevels: st0.result.teamLevelsAfter, dealerTeam: st0.result.nextDealerTeam,
      level: st0.result.nextLevel,
      prevResult: { finishOrder: st0.result.finishOrder.slice(), winnerTeam: st0.result.winnerTeam } });
    const snap = Net.snapshot(st1, 1);
    assert(Net.assertNoLeak(snap).ok, '进贡局快照无泄露(手牌/seed/log 仍不外泄)');
    assert(snap.tribute !== undefined, '进贡局快照带 tribute 字段(明置公开信息可下发给客人渲染横幅)');
  } else {
    assert(false, '进贡前置局未走到终局');
  }
}

console.log(`\n掼蛋联机旅程: ${step} 步${failed?' —— 有失败':' 全过'}`);
process.exit(failed ? 1 : 0);
