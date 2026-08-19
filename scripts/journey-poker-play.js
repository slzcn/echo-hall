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

// ── 步骤: 聊天融合 + app.js/UI 接入闭环(静态源码断言, 治"引擎能跑但接不进聊天室") ──
// 编码→解码字段序必须一致(否则战绩卡渲染错乱)。
// 2026-08-19 单机/联机合一: /德州 只开【真牌桌】(eh_gt_open), 默认停招募中等真人; 开局走 host 引擎路径
//   gtLaunchPoker —— EHPokerGame.open + 灵魂性格映射 + onResult 战绩卡 都在这里(不再在 launchTexas 里另起单机局)。
const fs = require('fs'), path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const src = R('js/app.js');
const ui  = R('js/games/poker-ui.js');
const html = R('index.html');

// slash 命令 + 唤起
assert(/\{c:'\/德州'/.test(src), '/德州 已注册进 SLASH_CMDS(聊天可直接开局)');
assert(/cmd==='\/德州'\|\|cmd==='\/texas'\|\|cmd==='\/poker'\|\|cmd==='\/holdem'/.test(src), 'handleSlash 认 /德州·/texas·/poker·/holdem');
assert(/async function launchTexas\(/.test(src), '存在 launchTexas(开真牌桌)');
assert(/async function launchTexas\(\)\{[\s\S]*?eh_gt_open[\s\S]*?\n\}/.test(src), 'launchTexas 走 eh_gt_open 开真牌桌(不再另起单机 EHPokerGame 局)');
// 开局在 host 引擎路径 gtLaunchPoker: EHPokerGame.open + 座位名册来自 gtSeatArrays
assert(/function gtLaunchPoker\(row\)/.test(src) && /window\.EHPokerGame\.open\(/.test(src), 'gtLaunchPoker 调 EHPokerGame.open 开桌');
assert(/mySeat:A\.mySeat/.test(src) && /isAI:A\.isAI/.test(src), '座位/mySeat/isAI 由 gtSeatArrays 名册驱动(真人坐人席, 灵魂/空位=AI)');
assert(/isAI\[i\]=!human/.test(src), 'gtSeatArrays: 非真人席(灵魂/AI/空位)一律标记 AI(host 本机代打)');
assert(/archetype:\s*soul\.archetype\|\|soul\.soul_archetype/.test(src), '房里灵魂原型传进 souls(AI 按灵魂性格映射打法)');
// 灵魂补位: 指定某席用座位下拉 seatSoul; 点「开始」即由 gtStart→gtSeatSoulsIntoEmpties 把空位补满房里灵魂(灵魂来玩, 非匿名 AI)。
assert(/async function gtSeatSoulsIntoEmpties\([\s\S]*?eh_gt_seat_soul/.test(src), 'gtSeatSoulsIntoEmpties: 把空位坐满房里灵魂(eh_gt_seat_soul)');
assert(/async function gtStart\(id\)\{[\s\S]*?gtSeatSoulsIntoEmpties/.test(src), 'gtStart 开局前先灵魂补位(点开始=灵魂来玩, 非匿名机器人)');

// 结束回调 → 战绩卡 + 落库(在 gtLaunchPoker 的 onResult 里, 名册取 A.names/A.avatars)
assert(/onResult:\(res,log,meta\)=>/.test(src), 'open 传 onResult 结束回调(不再"打完什么都没留下")');
assert(/postTexasResult\(res,A\.names,meta\)/.test(src) && /recordTexasResult\(res,log,A\.names,A\.avatars,soulPick,meta\)/.test(src),
  'onResult 里发战绩卡 + 落库战绩(seed/log 供回看)');
assert(/async function postTexasResult\(/.test(src), '存在 postTexasResult(发德州战绩卡)');
// 编码→解码闭环: 生产字段序与 buildGameEl 的 nlhe 分支解码字段序一致
assert(/\['game','nlhe', outcome, delta, hand\|\|'-', potTotal, champName\]\.join\('\|'\)/.test(src),
  '战绩卡编码 game|nlhe|outcome|delta|hand|pot|champ(字段序钉死)');
assert(/postTexasResult[\s\S]{0,700}kind:'game'/.test(src), '战绩卡以 kind:game 落库(走消息流, 全房可见)');
assert(/if\(ev==='nlhe'\)/.test(src), 'buildGameEl 有 nlhe 分支(把战绩卡渲染回来)');
assert(/const champName=esc\(p\.slice\(6\)\.join\('\|'\)\|\|''\)/.test(src), '赢家名取 slice(6).join("|")(兜住名字里的 | 不截断)');
assert(/data-nlhe-again/.test(src) && /data-nlhe-again[\s\S]{0,200}launchTexas\(\)/.test(src), '战绩卡"下一局"按钮接 launchTexas');
assert(/p\[1\]==='nlhe'[\s\S]{0,160}德州扑克/.test(src), '消息预览把 nlhe 卡显示成"🎰 德州扑克 · 胜/负/平"(不露原始 game|nlhe| 编码)');
assert(/game:'nlhe'/.test(src) && /from\('eh_game_results'\)\.insert\(row\)/.test(src), '战绩落 eh_game_results(game=nlhe, N 席结构)');
assert(/\.ddz-room,\s*\.gd-room,\s*\.pk-room/.test(src), '_restoreActiveGameIfAny 认 .pk-room(返回聊天后能折叠回活牌桌)');

// UI 接线
assert(/root\.EHPokerGame\s*=\s*\{ open \}/.test(ui), 'poker-ui 导出 EHPokerGame.open');
assert(/opts\.mySeat/.test(ui), 'mySeat 可由 opts 传入(联机真人坐非 0 席地基)');
assert(/AI\.personaForSoul\(soul\)\.key/.test(ui), '灵魂原型→打法性格映射(personaForSoul)');
assert(/function applyMove\(seat, move\)/.test(ui), 'applyMove 就位(供 host 权威应用远程真人动作/测试驱动)');
// 反回退: 对手须落在【上弧】收在桌内(曾因 ±43% 侧位戳出屏外点不到)
assert(/const cx = 50 \+ 40\*Math\.cos\(t\)/.test(ui) && /const cy = 46 - 34\*Math\.sin\(t\)/.test(ui),
  '对手沿上弧分布(横40%/竖34%收在桌内)——防侧位溢出屏外');
assert(/for\(let i=st\.board\.length;i<5;i\+\+\)/.test(ui), '公共牌区恒 5 槽(已发+暗背占位)');
assert(/function onHumanTimeout\(/.test(ui) && /HUMAN_ACT_MS/.test(ui), '到我行动亮倒计时, 超时自动过牌/弃牌');
assert(/function showOver\(/.test(ui) && /opts\.onResult==='function'[\s\S]{0,80}opts\.onResult\(res, st\.log/.test(ui),
  '摊牌结算里回调 onResult(res, log, meta)(把结果交回聊天室)');

// index.html 已挂 4 个扑克脚本 + 版本指纹
assert(/poker-eval\.js\?v=/.test(html) && /poker-engine\.js\?v=/.test(html) && /poker-ai\.js\?v=/.test(html) && /poker-ui\.js\?v=/.test(html),
  'index.html 挂齐 poker-eval/engine/ai/ui 四脚本(带 ?v= 指纹)');

console.log(`\n德州扑克旅程: 打了 ${handNo} 手, ${step} 步全过${failed ? ' —— 有失败' : ''}`);
process.exit(failed ? 1 : 0);
