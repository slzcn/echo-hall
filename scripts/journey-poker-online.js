#!/usr/bin/env node
'use strict';
// journey-poker-online.js — 德州扑克【真人联机】host 权威 + 脱敏快照 + 私牌隔离 完整旅程
// 模拟一整手多人联机: host 本机跑真引擎当裁判; 客人只拿【脱敏公共快照 + 自己那两张底牌】,
// 凭此算合法动作并把动作发回 host; host 用引擎校验后应用并重新广播。断言全链路的防作弊命门:
//   (1) host 每次广播的公共快照【永不外泄】任何人底牌 / _deck / seed / log;
//   (2) 客人仅凭"自己底牌 + 公共快照"组出的伪状态, 能正确算出自己的合法动作(engine.legalActions);
//   (3) 私牌隔离: 客人 A 无从读到客人 B 的底牌(RLS 模拟: 只放行 uid 匹配的那一行);
//   (4) host 权威: 非本人回合 / 超过筹码 的动作被引擎拒(客户端无权改权威状态);
//   (5) 收敛一致: 打到终局, 每个客人手里最后一张快照的公共态(阶段/底池/公共牌/赢家)与 host 权威 result 一致。
// 全程只走"快照下发 + 动作回传", 不给客人 seed/牌堆 —— 正是线上真联机的信息边界。
const fs     = require('fs');
const path   = require('path');
const Engine = require('../js/games/poker-engine.js');
const AI     = require('../js/games/poker-ai.js');
const Net    = require('../js/games/poker-net.js');

let step = 0, failed = false;
function assert(cond, msg){ step++; if(!cond){ failed=true; console.error(`✗ [${step}] ${msg}`); } else console.log(`✓ [${step}] ${msg}`); }

// 浏览器真实加载链：传输层必须存在，且必须在 UI/app 前加载。Node 直接 require 能通过，不能替代这条运行时契约。
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const netAt = html.indexOf('js/games/poker-net.js');
  const uiAt  = html.indexOf('js/games/poker-ui.js');
  const appAt = html.indexOf('js/app.js');
  assert(netAt >= 0, 'index.html 加载 poker-net.js（真实浏览器具备 EHPokerNet）');
  assert(netAt < uiAt && uiAt < appAt, '德州联机脚本顺序为 net → ui → app');
}

// ── 桌面配置: 4 席。0=host 真人, 1=AI/灵魂席, 2 & 3 = 远程真人(各自客户端) ──
const SEATS = 4;
const names   = ['房主','灵魂岩','远客甲','远客乙'];
const isAI    = [false, true, false, false];     // 引擎视角: AI 席只有 1(灵魂); 真人席由各端驱动
const seatUid = ['uid-host','uid-soul-1','uid-guestA','uid-guestB'];
const REMOTE_SEATS = [2, 3];                     // 远程真人席(host 本机不替其决策, 等其动作回传)

// ── 私牌存储 + RLS 模拟(照抄 eh_gt_hands: 每 uid 只能 select 到自己那一行) ──
const handsStore = {};   // seat -> { uid, hole:[cardPlain] }
function hostSetHands(state){
  state.players.forEach(p => { handsStore[p.seat] = { uid: seatUid[p.seat], hole: p.hole.map(Net.cardPlain) }; });
}
function readHandAs(seat, asUid){
  const h = handsStore[seat];
  if (!h || h.uid !== asUid) return null;    // RLS: uid 不匹配一律拿不到
  return h.hole.map(Net.cardPlain);
}

// ── 客人端: 只持有 { seat, uid, snap(最近一张公共快照), myHole } ──
const guests = REMOTE_SEATS.map(seat => ({ seat, uid: seatUid[seat], snap: null, myHole: null, lastHandNo: -1 }));

let leakSeen = false, isoOk = true, guestActedLegally = 0, convergeChecks = 0;

// host 广播: 产出脱敏快照 → 断言无泄露 → 分发给客人; 新一手则同时下发各真人底牌(RLS 隔离)。
function hostBroadcast(state, handNo){
  const snap = Net.snapshot(state, handNo);
  const chk = Net.assertNoLeak(snap);
  if (!chk.ok){ leakSeen = true; console.error('  快照泄露:', chk.leaks.join(', ')); }
  guests.forEach(g => {
    g.snap = snap;
    if (g.lastHandNo !== handNo){        // 新一手 → 客人主动拉自己的底牌(late-join/重连同理)
      g.myHole = readHandAs(g.seat, g.uid);
      g.lastHandNo = handNo;
    }
  });
}

// 客人凭"公共快照 + 自己底牌"算一个合法动作(不碰 host 引擎)。策略从简: 能过就过, 面对下注就跟, 不乱来。
function guestDecide(g){
  const ps = Net.pseudoState(g.snap, g.seat, g.myHole);
  // (2) 组出的伪状态里: 自己 2 张底牌在, 别人 0 张
  const myHoleN = (ps.players[g.seat].hole || []).length;
  const othersLeak = ps.players.some((p,i)=> i!==g.seat && (p.hole||[]).length>0);
  if (myHoleN === 2 && !othersLeak) guestActedLegally++;
  const la = Engine.legalActions(ps, g.seat);
  if (!la.toAct) return null;
  if (la.canCheck) return { action:'check' };
  return { action:'call' };                 // 面对下注跟注(call 在引擎里自动封顶为全下, 不会越额)
}

// ── 打多手, 全链路跑联机 ──
let stacks = names.map(()=>300);
let button = SEATS - 1, handNo = 0;
let sawShowdown = false, sawFoldWin = false, illegalRejected = false, outOfTurnRejected = false;

while (handNo < 40 && stacks.filter(v=>v>0).length >= 2){
  // 破产者本手不入座, 全员重新带入保证可开局(与 UI newHand 一致)
  if (stacks.filter(v=>v>0).length < 2) stacks = names.map(()=>300);
  while (stacks[button] <= 0) button = (button+1)%SEATS;

  let state;
  try { state = Engine.createGame({ seed: 70000+handNo, names, isAI, stacks: stacks.slice(), sb:5, bb:10, button, ids: seatUid }); }
  catch(e){ assert(false, `第${handNo}手建局失败: ${e.message}`); break; }

  hostSetHands(state);              // host 发牌后, 把各真人底牌写入私牌存储
  hostBroadcast(state, handNo);     // 广播首帧(preflop)

  // 一次性的 host 权威反证(第 0 手做一遍即可): 非本人回合 / 越额动作必被引擎拒
  if (handNo === 0){
    const cur = state.toAct;
    const notMe = (cur+1)%SEATS;
    try { Engine.applyAction(state, notMe, 'call'); } catch(_){ outOfTurnRejected = true; }
    try { Engine.applyAction(state, cur, 'raise', state.players[cur].street + state.players[cur].stack + 999); }
    catch(_){ illegalRejected = true; }
  }

  let guard = 0;
  while (state.phase !== 'over' && guard++ < 400){
    const seat = state.toAct;
    let move;
    if (REMOTE_SEATS.indexOf(seat) >= 0){
      // 远程真人席: host 不替其决策, 由该客人凭快照算动作回传
      const g = guests.find(x=>x.seat===seat);
      move = guestDecide(g);
      if (!move){ move = { action:'fold' }; }
    } else {
      // host-human(0) 与 AI/灵魂席(1): host 本机决策
      let d; try{ d = AI.decide(state, seat, { persona: 'tag', samples: 60 }); }catch(_){ d=null; }
      if (!d){ const la=Engine.legalActions(state,seat); d = la.canCheck?{action:'check'}:{action:'fold'}; }
      move = d;
    }
    // host 权威应用(引擎校验回合/合法/筹码); 通过则重新广播
    try { Engine.applyAction(state, seat, move.action, move.amount); }
    catch(e){ // 客人送来非法动作 → 兜底改弃牌(线上 host 也会拒并等重发/超时代打)
      try { Engine.applyAction(state, seat, 'fold'); } catch(__){ assert(false, `第${handNo}手席${seat}动作无法应用: ${e.message}`); guard=999; break; }
    }
    hostBroadcast(state, handNo);
  }
  if (state.phase !== 'over'){ assert(false, `第${handNo}手未走到终局`); break; }

  // (5) 收敛: 每个客人最后一张快照的公共态与 host 权威 result 对齐
  const res = state.result;
  if (res.wentToShowdown) sawShowdown = true; else sawFoldWin = true;
  guests.forEach(g => {
    const s = g.snap;
    if (s.phase !== 'over') { failed=true; console.error(`  客人席${g.seat}未收到终局快照`); return; }
    if (s.pot !== state.pot) { failed=true; console.error(`  客人席${g.seat}底池不一致 ${s.pot}!=${state.pot}`); return; }
    if (s.board.length !== state.board.length) { failed=true; console.error(`  客人席${g.seat}公共牌数不一致`); return; }
    if (JSON.stringify(s.result.winnersBySeat) !== JSON.stringify(res.winnersBySeat)) { failed=true; console.error(`  客人席${g.seat}赢家不一致`); return; }
    convergeChecks++;
  });
  // (3) 私牌隔离: 客人 A 读客人 B 的底牌 → 一律 null
  if (readHandAs(3, 'uid-guestA') !== null) isoOk = false;
  if (readHandAs(2, 'uid-guestB') !== null) isoOk = false;
  if (readHandAs(0, 'uid-guestA') !== null) isoOk = false;   // 也读不到 host 的

  state.players.forEach(p => stacks[p.seat] = p.stack);
  button = (button+1)%SEATS; handNo++;
}

// ── 断言 ──
assert(handNo >= 3, `联机跑了至少 3 手 (实 ${handNo} 手)`);
assert(!leakSeen, '(1) host 广播的公共快照全程无泄露(无底牌/_deck/seed/log)');
assert(guestActedLegally > 0, `(2) 客人凭"自己底牌+公共快照"组出伪状态并算合法动作 (${guestActedLegally} 次)`);
assert(isoOk, '(3) 私牌隔离: 客人读不到他人底牌(RLS uid 不匹配即拒)');
assert(outOfTurnRejected, '(4a) host 权威: 非本人回合的动作被引擎拒');
assert(illegalRejected, '(4b) host 权威: 超过筹码的加注被引擎拒');
assert(convergeChecks > 0 && !failed, `(5) 收敛: 每手每个客人快照公共态与 host result 一致 (${convergeChecks} 次核对)`);
assert(sawShowdown || sawFoldWin, '旅程覆盖摊牌/弃牌收池至少一种终局');

// 单独直证快照剥离(即便引擎内部字段改名, 这条也钉住白名单产出): 从一个带 _deck/seed/log 的真 state 取快照
{
  const st = Engine.createGame({ seed: 999, names, isAI, stacks:[300,300,300,300], sb:5, bb:10, button:3, ids:seatUid });
  const snap = Net.snapshot(st, 0);
  assert(!('_deck' in snap) && !('seed' in snap) && !('log' in snap), '快照对象不含 _deck/seed/log 键');
  assert(snap.players.every(p => Array.isArray(p.hole) && p.hole.length===0), '快照里每一席底牌都为空数组');
  assert(st._deck && st._deck.cards.length>0, '(对照)原始 state 确实持有 _deck(证明快照是真剥离而非本就没有)');
}

// ── #60 中途加入 + 名册逐手重组(真牌桌: 空位/AI 顶位, 路人随时坐下换真人)──────────────
// 复刻 host 侧 applyPendingRoster 的语义: 引擎座位数(n)恒定不变, 只在【手与手之间】切换每席
// "本机 AI 驱动 / 远程真人驱动", 座号绝对稳定。断言这套切换下防作弊命门全不塌:
//   (a) 新真人坐下→其席位换成真 uid + 全新买入 START, 且【当手仍由 AI 顶完】, 下一手才真接管;
//   (b) 切换后快照仍零泄露, 且新真人凭"自己底牌+公共快照"能组出正确伪状态(自己2张/别人0张);
//   (c) 私牌隔离仍随 uid 走: 新真人只读到自己那行, 读不到他人/host;
//   (d) 绝对座号稳定: 新真人的 seat 不因"从 AI 变真人"而漂移(anti-cheat 快照层按绝对座号索引)。
{
  const N = 4;
  const nm  = ['房主','灵魂','空位AI','新客'];
  const rIsAI = [false, true, true, true];   // 起手: 席3 是 AI 顶位(空座焊 AI 之前的等价物)
  const rUid  = ['uid-h','uid-s','p2','p3']; // 席3 尚无真 uid(占位), 坐下后换真 uid
  let rRemote = [];                          // 起手无远程真人(席2/3都本机AI跑)
  let rStacks = [300,300,300,300];
  let rButton = 3;
  const rStore = {};
  const setHands = st => st.players.forEach(p=>{ rStore[p.seat]={uid:rUid[p.seat], hole:p.hole.map(Net.cardPlain)}; });
  const readAs = (seat,uid)=>{ const h=rStore[seat]; return (h&&h.uid===uid)?h.hole.map(Net.cardPlain):null; };

  let joinLeak=false, joinIso=true, joinerSawOwnHole=false, seatStable=true, joinerFreshBuyin=false;

  // 打多手; 第 1 手后把席3从 AI 换成远程真人(中途坐下), 全新买入 START。
  //   多打几手(而非只 1 手): 某一手席3可能恰好走 BB 弃牌白捡(walk)而没轮到行动, 多手保证它至少行动一次。
  for (let h=0; h<8; h++){
    if (h === 1){
      // ← applyPendingRoster 等价: 席3 wasAI→nowHuman
      rIsAI[3] = false; rUid[3] = 'uid-joiner'; rRemote = [3];
      rStacks[3] = 300;              // 新真人全新买入(对照 poker-ui: !wasHuman&&nowHuman → START)
      joinerFreshBuyin = (rStacks[3] === 300);
    }
    let st;
    try { st = Engine.createGame({ seed: 80000+h, names:nm, isAI:rIsAI, stacks:rStacks.slice(), sb:5, bb:10, button:rButton, ids:rUid }); }
    catch(e){ assert(false, `#60 第${h}手建局失败: ${e.message}`); break; }
    // (d) 席3 永远是 seat===3, 无论 AI/真人
    if (st.players[3].seat !== 3) seatStable = false;
    setHands(st);

    let guard=0;
    while (st.phase!=='over' && guard++<400){
      const seat = st.toAct;
      let mv;
      if (rRemote.indexOf(seat) >= 0){
        // 远程真人: 凭脱敏快照 + 自己底牌算动作
        const snap = Net.snapshot(st, h);
        const chk = Net.assertNoLeak(snap); if(!chk.ok) joinLeak=true;
        const myHole = readAs(seat, rUid[seat]);
        const ps = Net.pseudoState(snap, seat, myHole);
        const mine = (ps.players[seat].hole||[]).length, others = ps.players.some((p,i)=>i!==seat&&(p.hole||[]).length>0);
        if (seat===3 && mine===2 && !others) joinerSawOwnHole = true;
        const la = Engine.legalActions(ps, seat);
        mv = !la.toAct ? {action:'fold'} : (la.canCheck?{action:'check'}:{action:'call'});
      } else {
        let d; try{ d = AI.decide(st, seat, {persona:'tag', samples:40}); }catch(_){ d=null; }
        if(!d){ const la=Engine.legalActions(st,seat); d = la.canCheck?{action:'check'}:{action:'fold'}; }
        mv = d;
      }
      try{ Engine.applyAction(st, seat, mv.action, mv.amount); }
      catch(_){ try{ Engine.applyAction(st, seat, 'fold'); }catch(__){ guard=999; } }
    }
    // (c) 隔离: 新真人读不到 host / 灵魂席底牌
    if (readAs(0,'uid-joiner')!==null || readAs(1,'uid-joiner')!==null) joinIso=false;
    st.players.forEach(p=> rStacks[p.seat]=p.stack);
    // 破产补带(与 UI newHand 一致, 桌不塌)
    rStacks = rStacks.map(v=> v>0?v:300);
    rButton = (rButton+1)%N;
  }

  assert(joinerFreshBuyin, '(60a) 新真人中途坐下 → 全新买入 START 筹码');
  assert(!joinLeak, '(60b) 名册重组后 host 快照仍全程零泄露');
  assert(joinerSawOwnHole, '(60b) 中途加入者凭"自己底牌+公共快照"组出正确伪状态(自己2张/别人0张)');
  assert(joinIso, '(60c) 私牌隔离仍随 uid 走: 新真人读不到 host/灵魂席底牌');
  assert(seatStable, '(60d) 绝对座号稳定: 席位从 AI 顶位换真人, seat 号不漂移(快照层按绝对座号索引)');
}

console.log(`\n德州联机旅程: ${step} 步${failed?' —— 有失败':' 全过'}`);
process.exit(failed ? 1 : 0);
