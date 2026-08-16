#!/usr/bin/env node
'use strict';
// test-poker-engine.js — 无限注德州扑克引擎状态机测试
// 守护: 盲注/轮转/最小加注/全下短加不重开 · 弃牌收池 · 自动发街 · 全下跑完 ·
//       边池分层正确 · 筹码守恒(任何终局∑stack==∑起始) · replay(seed+log) 复现终局。
const G = require('../js/games/poker-engine.js');

let pass = 0, fail = 0;
function ok(cond, msg){ if (cond){ pass++; } else { fail++; console.error('✗ ' + msg); } }

// 起局工具: seed 固定 → 可复现
function game(opts){ return G.createGame(Object.assign({ seed: 12345 }, opts)); }
function chips(st){ return st.players.reduce((s, p) => s + p.stack, 0); }
function startChips(st){ return st.players.reduce((s, p) => s + p.start, 0); }

// ── ① 建局与盲注 ──
{
  const st = game({ names:['A','B','C'], sb:5, bb:10, button:0, startStack:1000 });
  ok(st.players.length === 3, '3 人局');
  ok(st.players.every(p => p.hole.length === 2), '每人两张底牌');
  ok(st.players[1].committed === 5, '按钮左手位下小盲 5');
  ok(st.players[2].committed === 10, '再左手位下大盲 10');
  ok(st.currentBet === 10, '当前注=大盲 10');
  ok(st.toAct === 0, '3人局首行动=按钮左三(此处回到座0=UTG)');
  ok(st.pot === 15, '底池=小盲+大盲=15');
}

// ── ② 单挑(heads-up)盲注与首行动 ──
{
  const st = game({ names:['A','B'], sb:5, bb:10, button:0 });
  ok(st.players[0].committed === 5, '单挑: 按钮下小盲');
  ok(st.players[1].committed === 10, '单挑: 对方下大盲');
  ok(st.toAct === 0, '单挑翻前: 按钮(小盲)先行动');
}

// ── ③ 弃牌收池: 除一人全弃 → 直接结束无摊牌 ──
{
  const st = game({ names:['A','B','C'], sb:5, bb:10, button:0 });
  G.applyAction(st, 0, 'fold');       // UTG 弃
  G.applyAction(st, 1, 'fold');       // SB 弃
  ok(st.phase === 'over', '仅剩大盲一人 → 立即结束');
  ok(st.result.wentToShowdown === false, '弃牌胜, 不摊牌');
  ok(st.result.winnersBySeat[0] === 2, '大盲(座2)收池');
  ok(st.players[2].stack === st.players[2].start + 5, '大盲净赚 5(收池15-自投10=小盲的5)');
  ok(chips(st) === startChips(st), '筹码守恒');
}

// ── ④ 逐街到摊牌: 全过牌/跟注一路到河 ──
{
  const st = game({ names:['A','B'], sb:5, bb:10, button:0 });
  G.applyAction(st, 0, 'call');       // 按钮补齐到 10
  G.applyAction(st, 1, 'check');      // 大盲过牌 → 翻牌
  ok(st.phase === 'flop' && st.board.length === 3, '翻前结束 → 发 3 张翻牌');
  // 翻牌后首行动=大盲位(座1)
  ok(st.toAct === 1, '翻后: 非按钮先动');
  G.applyAction(st, 1, 'check');
  G.applyAction(st, 0, 'check');
  ok(st.phase === 'turn' && st.board.length === 4, '发转牌');
  G.applyAction(st, 1, 'check');
  G.applyAction(st, 0, 'check');
  ok(st.phase === 'river' && st.board.length === 5, '发河牌');
  G.applyAction(st, 1, 'check');
  G.applyAction(st, 0, 'check');
  ok(st.phase === 'over' && st.result.wentToShowdown === true, '河牌过完 → 摊牌');
  ok(chips(st) === startChips(st), '筹码守恒');
  ok(st.result.reveal && Object.keys(st.result.reveal).length === 2, '摊牌亮两家底牌');
}

// ── ⑤ 最小加注规则 ──
{
  const st = game({ names:['A','B','C'], sb:5, bb:10, button:0 });
  // UTG(座0) 加注到 30 (raise size 20 ≥ minRaise 10) 合法
  G.applyAction(st, 0, 'raise', 30);
  ok(st.currentBet === 30 && st.minRaise === 20, '加注到30 → 当前注30, 最小加注更新为20');
  // 座1 想加注到 40 (raise size 10 < minRaise 20) 非法
  let threw = false;
  try { G.applyAction(st, 1, 'raise', 40); } catch(e){ threw = true; }
  ok(threw, '不足全额加注(<当前注+最小加注) 被拒');
  // 座1 加注到 50 合法
  G.applyAction(st, 1, 'raise', 50);
  ok(st.currentBet === 50, '加注到50合法');
}

// ── ⑥ 加注重开叫注: 已跟注者需再次行动 ──
{
  const st = game({ names:['A','B','C'], sb:5, bb:10, button:0 });
  G.applyAction(st, 0, 'call');        // UTG 跟到10
  G.applyAction(st, 1, 'call');        // SB 补到10
  // 此刻大盲(座2)有权选择; 大盲加注到 30
  ok(st.toAct === 2, '轮到大盲行使选择权');
  G.applyAction(st, 2, 'raise', 30);
  ok(st.toAct === 0, '大盲加注 → 重开, 轮回 UTG');
  ok(st.players[0].acted === false, '被加注方 acted 复位');
}

// ── ⑦ 全下短加不重开叫注 ──
{
  // A 富, B 短码。构造: B 全下额不足一个全额加注 → 不应重置已行动者
  const st = game({ names:['A','B','C'], sb:5, bb:10, button:0, stacks:[1000, 25, 1000] });
  G.applyAction(st, 0, 'raise', 40);   // UTG 加到40, minRaise=30
  // 座1(短码, 街内已下5小盲? 不, 座1是SB=5) 全下: 5+25? stack25 → to = 5+? 其实B是座1=SB已投5, stack剩? startStack给了stacks[1]=25 → 下小盲后 stack=20, street=5
  // B 全下 → to = 5 + 20 = 25, 相对当前注40其实更小 → 这是"跟注全下"而非加注; 换个构造
  ok(true, '(占位, 见下 ⑦b 精确构造)');
}
// ⑦b 精确: 全下额 > 当前注但 < 全额加注 → currentBet 提升但不重开
{
  const st = game({ names:['A','B','C'], sb:5, bb:10, button:0, stacks:[1000, 1000, 55] });
  // 座0 UTG 加注到 40 (minRaise=30)
  G.applyAction(st, 0, 'raise', 40);
  // 座1 跟注到 40
  G.applyAction(st, 1, 'call');
  ok(st.players[1].acted === true && st.players[1].street === 40, '座1 跟到40');
  // 座2 是大盲, street=10, stack=45 → 全下 to=55. raiseSize=15 < minRaise30 → 短加, 不重开
  G.applyAction(st, 2, 'allin');
  ok(st.players[2].allin && st.players[2].street === 55, '座2 全下到55');
  ok(st.currentBet === 55, '当前注升到55');
  ok(st.players[0].acted === true, '短加不重置座0(仍视为已行动, 但未跟平→仍需补齐)');
  // 座0 仍需补齐(street40<55) → 应轮到座0
  ok(st.toAct === 0, '轮到座0面对全下(补齐或弃)');
}

// ── ⑧ 边池分层 buildSidePots ──
{
  // 三家投入不同: A=100, B=50(全下), C=100 → 主池 150(50×3), 边池 100(50×2, A/C)
  const st = game({ names:['A','B','C'], sb:5, bb:10, button:0 });
  st.players[0].committed = 100; st.players[0].folded = false;
  st.players[1].committed = 50;  st.players[1].folded = false;
  st.players[2].committed = 100; st.players[2].folded = false;
  const pots = G.buildSidePots(st);
  ok(pots.length === 2, '两层池');
  ok(pots[0].amount === 150 && pots[0].eligible.length === 3, '主池 150, 三家有份');
  ok(pots[1].amount === 100 && pots[1].eligible.length === 2 && !pots[1].eligible.includes(1), '边池 100, 仅 A/C');
}
// ⑧b 弃牌者投入仍计入池金额但无资格
{
  const st = game({ names:['A','B','C'], sb:5, bb:10, button:0 });
  st.players[0].committed = 100; st.players[0].folded = false;
  st.players[1].committed = 30;  st.players[1].folded = true;   // 中途弃, 投了30
  st.players[2].committed = 100; st.players[2].folded = false;
  const pots = G.buildSidePots(st);
  const total = pots.reduce((s, p) => s + p.amount, 0);
  ok(total === 230, '池金额含弃牌者的30');
  // 30 那层三家都有份(金额), 但资格里不含座1
  ok(pots[0].eligible.indexOf(1) === -1, '弃牌者无任何池资格');
}

// ── ⑨ 全下跑完到摊牌(无更多下注轮) ──
{
  const st = game({ names:['A','B'], sb:5, bb:10, button:0, stacks:[100, 100] });
  G.applyAction(st, 0, 'allin');       // 按钮全下100
  G.applyAction(st, 1, 'call');        // 大盲跟全下 → 双方全下
  ok(st.phase === 'over', '双全下 → 自动跑完到摊牌结束');
  ok(st.board.length === 5, '自动发满 5 张公共牌');
  ok(chips(st) === startChips(st), '筹码守恒');
}

// ── ⑩ 筹码守恒: 多手随机行动序列(遍历合法动作) ──
{
  let conserveFails = 0;
  for (let s = 0; s < 200; s++){
    const st = G.createGame({ seed: 1000 + s, names:['A','B','C','D'], sb:5, bb:10, button: s % 4, startStack: 500 });
    let guard = 0;
    while (st.phase !== 'over' && guard++ < 400){
      const seat = st.toAct;
      const la = G.legalActions(st, seat);
      if (!la.toAct) break;
      // 简单策略: 有得看牌就过, 否则一半跟一半弃, 偶尔加注
      if (la.canCheck) G.applyAction(st, seat, 'check');
      else if ((s + seat) % 3 === 0 && la.canRaise) G.applyAction(st, seat, 'raise', la.minRaiseTo);
      else if ((s + seat) % 5 === 0) G.applyAction(st, seat, 'fold');
      else G.applyAction(st, seat, 'call');
    }
    if (st.phase !== 'over') conserveFails++;
    else if (chips(st) !== startChips(st)) conserveFails++;
  }
  ok(conserveFails === 0, `200 手随机对局: 全部结束且筹码守恒 (失败 ${conserveFails})`);
}

// ── ⑪ replay(seed+log) 复现终局 ──
{
  let mismatch = 0;
  for (let s = 0; s < 100; s++){
    const st = G.createGame({ seed: 7000 + s, names:['A','B','C'], sb:5, bb:10, button: s % 3, startStack: 400 });
    let guard = 0;
    while (st.phase !== 'over' && guard++ < 300){
      const seat = st.toAct;
      const la = G.legalActions(st, seat);
      if (!la.toAct) break;
      if (la.canCheck) G.applyAction(st, seat, 'check');
      else if ((s + seat) % 4 === 0 && la.canRaise) G.applyAction(st, seat, 'raise', la.minRaiseTo);
      else if ((s + seat) % 7 === 0) G.applyAction(st, seat, 'fold');
      else G.applyAction(st, seat, 'call');
    }
    if (st.phase !== 'over') continue;
    const re = G.replay(st.log);
    const a = JSON.stringify(st.players.map(p => p.stack));
    const b = JSON.stringify(re.players.map(p => p.stack));
    const ba = JSON.stringify(st.board.map(c => c.id));
    const bb = JSON.stringify(re.board.map(c => c.id));
    if (a !== b || ba !== bb) mismatch++;
  }
  ok(mismatch === 0, `100 手 replay: 终局筹码+公共牌完全复现 (不符 ${mismatch})`);
}

// ── ⑫ 非法行动被拒 ──
{
  const st = game({ names:['A','B','C'], sb:5, bb:10, button:0 });
  let t1 = false, t2 = false, t3 = false;
  try { G.applyAction(st, 1, 'check'); } catch(e){ t1 = true; }   // 非当前行动位
  try { G.applyAction(st, 0, 'check'); } catch(e){ t2 = true; }   // UTG 面对大盲不能过
  try { G.applyAction(st, 0, 'raise', 12); } catch(e){ t3 = true; } // 加注不足
  ok(t1, '非行动位行动被拒');
  ok(t2, '面对下注不能 check');
  ok(t3, '不足最小加注被拒');
}

console.log(`\n德州扑克引擎: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
