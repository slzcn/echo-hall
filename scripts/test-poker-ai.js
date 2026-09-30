#!/usr/bin/env node
'use strict';
// test-poker-ai.js — 德州扑克「全局意识」AI 测试
// 守护: 蒙特卡洛胜率贴合已知牌理 · Chen 打分 · 强牌进攻/弱牌弃 · 性格差异(松紧) ·
//       决策确定性(同局面同种子→同解) · 决策永远合法 · 全 AI 对局筹码守恒。
const AI = require('../js/games/poker-ai.js');
const E = require('../js/games/poker-eval.js');
const G = require('../js/games/poker-engine.js');
const Deck = require('../js/games/deck.js');

let pass = 0, fail = 0;
function ok(cond, msg){ if (cond){ pass++; } else { fail++; console.error('✗ ' + msg); } }
function card(r, s){ return { rank:r, suit:s }; }

// ── ① 蒙特卡洛胜率贴合牌理 ──
{
  const AA = [card(14,'♠'), card(14,'♥')];
  const t72 = [card(7,'♠'), card(2,'♦')];
  const eqAA = AI.equityMC(AA, [], 1, Deck.mulberry32(1), 500);
  const eq72 = AI.equityMC(t72, [], 1, Deck.mulberry32(1), 500);
  ok(eqAA > 0.80 && eqAA < 0.90, `AA 单挑胜率 ~85% (实测 ${(eqAA*100|0)}%)`);
  ok(eq72 > 0.25 && eq72 < 0.42, `72o 单挑胜率偏低 (实测 ${(eq72*100|0)}%)`);
  ok(eqAA > eq72, 'AA 胜率明显高于 72o');
  const eqAA4 = AI.equityMC(AA, [], 4, Deck.mulberry32(1), 500);
  ok(eqAA4 < eqAA, `AA 多人局(4 对手)胜率下降 (实测 ${(eqAA4*100|0)}%)`);
}
// 河牌坚果 vs 死牌: 确定性胜率
{
  const board = [card(14,'♠'), card(13,'♠'), card(12,'♠'), card(2,'♦'), card(3,'♥')];
  const nut = [card(11,'♠'), card(10,'♠')];   // 皇家同花顺, 必胜
  const eq = AI.equityMC(nut, board, 1, Deck.mulberry32(1), 200);
  ok(eq === 1, '河牌皇家同花顺 → 胜率 100%');
}

// ── ② Chen 打分 ──
ok(AI.chenScore([card(14,'♠'), card(14,'♥')]) === 20, 'AA → Chen 20');
ok(AI.chenScore([card(13,'♠'), card(13,'♥')]) === 16, 'KK → Chen 16');
ok(AI.chenScore([card(14,'♠'), card(13,'♠')]) === 12, 'AKs → Chen 12');
ok(AI.chenScore([card(7,'♠'), card(2,'♦')]) < 0, '72o → Chen 负分');
ok(AI.chenScore([card(10,'♠'), card(9,'♠')]) >= 7, 'T9s → Chen 有连张同花加成');

// ── ③ 强牌进攻 / 弱牌弃(紧凶) ──
{
  // 构造翻前: AI 在 UTG 拿 AA, 面对大盲, tag 应加注(不会弃/只跟)
  const st = G.createGame({ seed: 100, names:['AI','B','C'], sb:5, bb:10, button:0, startStack:1000 });
  st.players[0].hole = [card(14,'♠'), card(14,'♥')];
  const d = AI.decide(st, 0, { persona:'tag' });
  ok(d && (d.action === 'raise' || d.action === 'bet' || d.action === 'allin'), `紧凶拿 AA 翻前进攻 (实测 ${d && d.action})`);
}
{
  // 紧凶(rock 更极端)拿 72o UTG 面对下注 → 弃
  const st = G.createGame({ seed: 101, names:['AI','B','C'], sb:5, bb:10, button:0, startStack:1000 });
  st.players[0].hole = [card(7,'♠'), card(2,'♦')];
  const d = AI.decide(st, 0, { persona:'rock' });
  ok(d && d.action === 'fold', `岩石拿 72o 翻前弃牌 (实测 ${d && d.action})`);
}

// ── ④ 性格差异: 疯子入池率 >> 岩石 ──
{
  let maniacPlay = 0, rockPlay = 0;
  for (let s = 0; s < 120; s++){
    const st = G.createGame({ seed: 3000 + s, names:['AI','B','C'], sb:5, bb:10, button:0, startStack:1000 });
    const dm = AI.decide(st, 0, { persona:'maniac' });
    const dr = AI.decide(st, 0, { persona:'rock' });
    if (dm && dm.action !== 'fold') maniacPlay++;
    if (dr && dr.action !== 'fold') rockPlay++;
  }
  ok(maniacPlay > rockPlay, `疯子入池(${maniacPlay}) 明显多于岩石(${rockPlay})`);
  ok(rockPlay < 60, `岩石偏紧(入池 ${rockPlay}/120)`);
}

// ── ⑤ 决策确定性: 同局面同种子 → 同解 ──
{
  const mk = () => { const st = G.createGame({ seed: 555, names:['AI','B'], sb:5, bb:10, button:0 }); return st; };
  const d1 = AI.decide(mk(), 0, { persona:'lag', seed: 777 });
  const d2 = AI.decide(mk(), 0, { persona:'lag', seed: 777 });
  ok(d1.action === d2.action && d1.amount === d2.amount, '同种子决策完全一致');
}

// ── ⑥ 决策永远合法 + 全 AI 对局筹码守恒 ──
{
  const personas = AI.PERSONA_KEYS;
  let bad = 0, notOver = 0, conserveFail = 0;
  for (let s = 0; s < 300; s++){
    const n = 2 + (s % 3);               // 2~4 人
    const names = Array.from({length:n}, (_, i) => 'S'+i);
    const st = G.createGame({ seed: 9000 + s, names, sb:5, bb:10, button: s % n, startStack: 400 });
    const start = st.players.reduce((a, p) => a + p.start, 0);
    let guard = 0;
    while (st.phase !== 'over' && guard++ < 500){
      const seat = st.toAct;
      const per = personas[(s + seat) % personas.length];
      const d = AI.decide(st, seat, { persona: per, samples: 60 });
      if (!d){ break; }
      const la = G.legalActions(st, seat);
      // 校验决策在合法集合内
      const legal =
        (d.action === 'fold' && la.canFold) ||
        (d.action === 'check' && la.canCheck) ||
        (d.action === 'call' && la.canCall) ||
        (d.action === 'bet' && la.canBet && d.amount >= la.minRaiseTo && d.amount <= la.maxRaiseTo) ||
        (d.action === 'raise' && la.canRaise && d.amount >= la.minRaiseTo && d.amount <= la.maxRaiseTo) ||
        (d.action === 'allin');
      if (!legal){ bad++; break; }
      try { G.applyAction(st, seat, d.action, d.amount); }
      catch(e){ bad++; break; }
    }
    if (st.phase !== 'over') notOver++;
    else if (st.players.reduce((a, p) => a + p.stack, 0) !== start) conserveFail++;
  }
  ok(bad === 0, `300 局全 AI 对战: 决策全合法 (违规 ${bad})`);
  ok(notOver === 0, `300 局全部走到终局 (未结束 ${notOver})`);
  ok(conserveFail === 0, `300 局筹码守恒 (失败 ${conserveFail})`);
}

// ── ⑦ 灵魂原型映射 ──
ok(AI.personaForSoul('wild').key === 'maniac', '狂放灵魂 → 疯子打法');
ok(AI.personaForSoul('cool').key === 'rock', '清冷灵魂 → 岩石打法');
ok(AI.personaForSoul('unknown').key === 'tag', '未知原型 → 兜底紧凶');

console.log(`\n德州扑克 AI: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
