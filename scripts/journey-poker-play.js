#!/usr/bin/env node
'use strict';
// journey-poker-play.js — 德州扑克「一桌人从坐下到分出胜负」完整旅程
// 模拟一整场多手牌局(按钮轮转、筹码延续、有人筹码归零即出局), 断言全链路:
//   开局发牌 → 下盲 → 逐街(翻/转/河)→ 摊牌或弃牌收池 → 筹码转移 → 下一手轮庄。
// 全程 AI(5 性格轮流)自动决策; 校验每手合法、守恒, 整场收敛出唯一赢家或到手数上限。
const G = require('../js/games/poker-engine.js');
const AI = require('../js/games/poker-ai.js');

let step = 0, failed = false;
function assert(cond, msg){ step++; if (!cond){ failed = true; console.error(`✗ [${step}] ${msg}`); } else { console.log(`✓ [${step}] ${msg}`); } }

// ── 一整场: 4 人, 每人 300, 盲注 5/10, 打到只剩一人或 60 手 ──
const SEATS = 4;
let stacks = Array.from({length:SEATS}, () => 300);
const names = ['你','阿岩','小凶','疯哥'];
const personaBySeat = ['tag','rock','lag','maniac'];
const START_TOTAL = stacks.reduce((a, b) => a + b, 0);
let button = 0;
let handNo = 0;
let sawFlop = false, sawTurn = false, sawRiver = false, sawShowdown = false, sawFoldWin = false;
let anyStackChanged = false;

function aliveSeats(){ return stacks.map((v, i) => v > 0 ? i : -1).filter(i => i >= 0); }

while (aliveSeats().length >= 2 && handNo < 60){
  handNo++;
  const alive = aliveSeats();
  // 只让有筹码的人入座本手(引擎按传入名单坐, 用子集重映射)
  const seatIdx = alive;                       // 全局座号
  const subNames = seatIdx.map(i => names[i]);
  const subStacks = seatIdx.map(i => stacks[i]);
  // 按钮落在下一个还活着的人身上
  while (!alive.includes(button)) button = (button + 1) % SEATS;
  const subButton = seatIdx.indexOf(button);

  const before = subStacks.reduce((a, b) => a + b, 0);
  let st;
  try {
    st = G.createGame({ seed: 40000 + handNo, names: subNames, stacks: subStacks, sb:5, bb:10, button: subButton });
  } catch(e){ assert(false, `第${handNo}手建局失败: ${e.message}`); break; }

  // 驱动一手到底
  let guard = 0, illegal = false;
  while (st.phase !== 'over' && guard++ < 400){
    const localSeat = st.toAct;
    const globalSeat = seatIdx[localSeat];
    const d = AI.decide(st, localSeat, { persona: personaBySeat[globalSeat], samples: 80 });
    if (!d){ break; }
    try { G.applyAction(st, localSeat, d.action, d.amount); }
    catch(e){ illegal = true; console.error(`  非法动作 手${handNo} 座${localSeat}: ${d.action} ${d.amount} — ${e.message}`); break; }
  }
  if (illegal){ assert(false, `第${handNo}手出现非法动作`); break; }
  if (st.phase !== 'over'){ assert(false, `第${handNo}手未走到终局`); break; }

  // 记录见证到的阶段
  if (st.board.length >= 3) sawFlop = true;
  if (st.board.length >= 4) sawTurn = true;
  if (st.board.length >= 5) sawRiver = true;
  if (st.result.wentToShowdown) sawShowdown = true; else sawFoldWin = true;

  // 本手守恒
  const after = st.players.reduce((a, p) => a + p.stack, 0);
  if (after !== before){ assert(false, `第${handNo}手筹码不守恒 ${after}!=${before}`); break; }

  // 写回全局筹码
  st.players.forEach((p, li) => {
    if (p.stack !== stacks[seatIdx[li]]) anyStackChanged = true;
    stacks[seatIdx[li]] = p.stack;
  });

  button = (button + 1) % SEATS;              // 轮庄
}

// ── 断言整场旅程 ──
assert(handNo >= 1, `至少打了 1 手 (实打 ${handNo} 手)`);
assert(sawFlop, '旅程中出现过翻牌街');
assert(sawTurn, '旅程中出现过转牌街');
assert(sawRiver, '旅程中出现过河牌街');
assert(sawShowdown || sawFoldWin, '旅程中出现过摊牌或弃牌收池');
assert(anyStackChanged, '筹码在玩家间发生过转移');
assert(stacks.reduce((a, b) => a + b, 0) === START_TOTAL, `全场筹码守恒 (${stacks.reduce((a,b)=>a+b,0)}==${START_TOTAL})`);
const alive = aliveSeats();
assert(alive.length >= 1, `收敛: 剩 ${alive.length} 名幸存者 (${alive.map(i=>names[i]+':'+stacks[i]).join(', ')})`);
assert(alive.length === 1 || handNo === 60, alive.length === 1 ? `打出唯一赢家 ${names[alive[0]]}` : `到手数上限 60 手仍在博弈`);

console.log(`\n德州扑克旅程: 打了 ${handNo} 手, ${step} 步全过${failed ? ' —— 有失败' : ''}`);
process.exit(failed ? 1 : 0);
