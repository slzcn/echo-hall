#!/usr/bin/env node
'use strict';
// test-ddz-mingpai.js — 斗地主【明牌】引擎测试(仅本地单机 doubling 局, 地主亮牌换 ×2)。
// 验证: 只在 double 阶段/地主/地主自己回合可明; 明牌 multiplier ×2 且不推进加倍轮; 一局只能明一次;
//        明后仍可正常选加倍系数(叠加); replay(log) 能重放明牌; 明牌相对不明恰好 2× 倍数(其余相同)。
const E = require('../js/games/ddz-engine.js');

let pass=0, fail=0;
function assert(ok,msg){ if(ok){pass++;} else {console.log('✗ '+msg); fail++;} }

// ── ① 基本流程: 定地主进 double, 地主明牌 → ×2, 仍在 double 且轮次未推进 ──
{
  const st = E.createGame({ seed: 777, isAI:[false,true,true], doubling:true });
  E.applyCall(st, 0, 3);
  const before = st.multiplier;
  assert(st.phase==='double' && st.dbl.turn===0 && st.landlord===0, '① 进入 double, 地主(0)先手');
  assert(st.mingpai===false, '① 初始未明牌');
  const r = E.applyMingpai(st, 0);
  assert(r.ok && st.mingpai===true, '① 明牌成功, mingpai=true');
  assert(st.multiplier === before*2, '① 明牌 multiplier ×2');
  assert(st.phase==='double' && st.dbl.turn===0, '① 明牌不推进加倍轮(仍等地主选系数)');
  // 明后仍可正常加倍(叠加)
  E.applyDouble(st, 0, 2);
  assert(st.multiplier === before*2 && st.dbl.turn===1, '① 明后地主可再选加倍系数, 轮到农民1');
}

// ── ② 反证: 非地主 / 非本人回合 / 重复明 / 非 double 阶段 全被拒 ──
{
  const st = E.createGame({ seed: 42, isAI:[false,true,true], doubling:true });
  E.applyCall(st, 0, 3);   // 地主=0
  let threw;
  threw=false; try{ E.applyMingpai(st, 1); }catch(e){ threw = e.message==='not_landlord'; }
  assert(threw, '② 非地主明牌被拒(not_landlord)');
  E.applyDouble(st, 0, 1);  // 地主选完不加倍 → 轮到农民1, 地主已不是 dbl.turn
  threw=false; try{ E.applyMingpai(st, 0); }catch(e){ threw = e.message==='not_your_double_turn'; }
  assert(threw, '② 过了地主回合再明被拒(not_your_double_turn)');
}
{
  const st = E.createGame({ seed: 42, isAI:[false,true,true], doubling:true });
  E.applyCall(st, 0, 3);
  E.applyMingpai(st, 0);
  let threw=false; try{ E.applyMingpai(st, 0); }catch(e){ threw = e.message==='already_mingpai'; }
  assert(threw, '② 重复明牌被拒(already_mingpai)');
}
{
  const st = E.createGame({ seed: 42, isAI:[false,true,true], doubling:false });
  E.applyCall(st, 0, 3);   // doubling 关 → 直接 play, 无 double 阶段
  let threw=false; try{ E.applyMingpai(st, 0); }catch(e){ threw = e.message==='not_double_phase'; }
  assert(threw && st.phase==='play', '② 非加倍局(直接 play)明牌被拒(not_double_phase)');
}

// ── ③ replay: 含 mingpai 日志的加倍局能重放, 结果一致(mingpai + multiplier) ──
{
  const st = E.createGame({ seed: 2024, isAI:[false,true,true], doubling:true });
  E.applyCall(st, 0, 3);
  E.applyMingpai(st, 0);
  E.applyDouble(st, 0, 2); E.applyDouble(st, 1, 1); E.applyDouble(st, 2, 1);
  const re = E.replay(st.log);
  assert(re.mingpai===true, '③ replay 后 mingpai=true');
  assert(re.multiplier===st.multiplier, '③ replay multiplier 与原局一致');
  assert(re.phase==='play', '③ replay 到达 play 阶段');
}

// ── ④ 明牌 vs 不明牌: 其余动作相同, 明牌局倍数恰为不明局的 2× ──
{
  const mk = (ming)=>{
    const st = E.createGame({ seed: 999, isAI:[false,true,true], doubling:true });
    E.applyCall(st, 0, 3);
    if (ming) E.applyMingpai(st, 0);
    E.applyDouble(st, 0, 2); E.applyDouble(st, 1, 1); E.applyDouble(st, 2, 1);
    return st.multiplier;
  };
  assert(mk(true) === mk(false)*2, '④ 明牌局倍数 = 不明局 ×2(其余全同)');
}

console.log(`\n斗地主明牌: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
