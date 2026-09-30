#!/usr/bin/env node
'use strict';
// test-ddz-double.js — 斗地主【加倍系统】引擎测试(仅本地单机 opts.doubling 开启的那条流程)
// 验证:
//   · doubling 开 → 定地主后进入 'double' 阶段(不是直接 play), 按 地主→农民→农民 轮转
//   · applyDouble 校验: 非本人回合/非法系数/重复加倍 被拒
//   · 三家选完才进 play, 地主先出
//   · 结算按家独立系数: 每农民与地主那一对赌注 = score×地主系数×该农民系数, 恒零和
//   · 与经典对照: 全不加倍(1,1,1) 的加倍局结算 === 无加倍局结算(退化不变式)
//   · replay(log) 能重放加倍局(deal 记 doubling + double 日志) 且 result 完全一致
//   · doubling 关(默认) → 无 double 阶段, 定地主后直接 play(老流程不受影响)
const E = require('../js/games/ddz-engine.js');
const AI = require('../js/games/ddz-ai.js');

let pass=0, fail=0;
function assert(ok,msg){ if(ok){pass++; console.log('✓ '+msg);} else {console.log('✗ '+msg); fail++;} }

// ── 加倍阶段流程 + 轮转 + 反证 ──────────────────────────────
{
  const st = E.createGame({ seed: 777, isAI:[false,true,true], doubling:true });
  E.applyCall(st, 0, 3);   // 0 叫 3 立即定地主
  assert(st.phase==='double', 'doubling 开: 定地主后进入 double 阶段(非直接 play)');
  assert(st.landlord===0 && st.dbl && st.dbl.turn===0, '加倍轮地主先手(dbl.turn=地主)');
  assert(JSON.stringify(st.dbl.order)===JSON.stringify([0,1,2]), '加倍轮转顺序 地主→农民→农民');

  // 反证: 非本人回合加倍被拒
  let threw=false; try{ E.applyDouble(st, 1, 2); }catch(e){ threw = e.message==='not_your_double_turn'; }
  assert(threw, '非本人加倍回合被拒');
  // 反证: 非法系数被拒
  threw=false; try{ E.applyDouble(st, 0, 3); }catch(e){ threw = e.message==='bad_double'; }
  assert(threw, '非法系数(3)被拒(只认 1/2/4)');

  E.applyDouble(st, 0, 2);   // 地主加倍
  assert(st.phase==='double' && st.dbl.turn===1, '地主选完轮到农民1(仍在 double)');
  // 反证: 已选过的家再插手被拒(轮转已过它 → not_your_double_turn; already_doubled 为更内层防御)
  threw=false; try{ E.applyDouble(st, 0, 4); }catch(e){ threw = (e.message==='not_your_double_turn'||e.message==='already_doubled'); }
  assert(threw, '已加倍过的家再插手被拒');
  E.applyDouble(st, 1, 4);   // 农民1 超级加倍
  assert(st.phase==='double' && st.dbl.turn===2, '农民1选完轮到农民2');
  const r = E.applyDouble(st, 2, 1);   // 农民2 不加倍
  assert(r.doubleDone===true, '三家选完 doubleDone');
  assert(st.phase==='play' && st.turn===0, '加倍轮结束进入 play, 地主先出');
  assert(st.players[0].hand.length===20, '地主 20 张(底牌已并入)');
}

// ── 结算数学: 按家独立系数, 零和 ────────────────────────────
// 用一副能打到底的 seed, 手动开加倍局, 强制系数, 跑到终局验 delta。
function playDoubledToEnd(seed, factors){   // factors:[地主,农1,农2] 按座位?—— 这里按 dbl.order 给
  let st = E.createGame({ seed, isAI:[true,true,true], doubling:true });
  let guard=0;
  while(st.phase==='bid'){ if(guard++>10) throw new Error('bid'); const s=st.bid.turn; const r=E.applyCall(st,s,AI.chooseBid(st.players[s].hand, st.bid.max)); if(r&&r.redeal){ st=E.createGame({seed:seed+1,isAI:[true,true,true],doubling:true}); guard=0; } }
  // double 阶段: 按 dbl.order 顺序喂 factors
  const order = st.dbl.order.slice();
  order.forEach((seat,i)=> E.applyDouble(st, seat, factors[i]));
  guard=0;
  while(st.phase==='play'){ if(guard++>500) throw new Error('play'); const s=st.turn; const tgt=(st.table.lastPlay&&st.table.lastPlay.seat!==s)?st.table.lastPlay.parse:null; const mv=AI.decide({seat:s,hand:st.players[s].hand,tableParse:tgt,handsLeft:st.players.map(p=>p.hand.length),landlord:st.landlord,iAmLandlord:s===st.landlord}); if(mv.action==='pass') E.applyPass(st,s); else E.applyPlay(st,s,mv.cards); }
  return st;
}

{
  // 地主×2, 农1×4, 农2×1
  const st = playDoubledToEnd(1, [2,4,1]);
  const res = st.result;
  const lord = res.landlord;
  const order = [lord, (lord+1)%3, (lord+2)%3];
  const dbl = res.doubles;
  assert(dbl[order[0]]===2 && dbl[order[1]]===4 && dbl[order[2]]===1, 'result.doubles 记录各家系数');
  // 零和
  const sum = Object.values(res.delta).reduce((a,b)=>a+b,0);
  assert(sum===0, `加倍局零和 (sum=${sum})`);
  // 手算每对赌注
  const score = res.score, dL = dbl[lord];
  const f1 = order[1], f2 = order[2];
  const amt1 = score*dL*dbl[f1], amt2 = score*dL*dbl[f2];
  const won = res.landlordWon;
  assert(res.delta[f1] === (won?-amt1:amt1), `农民1 账变=对赌注(${res.delta[f1]})`);
  assert(res.delta[f2] === (won?-amt2:amt2), `农民2 账变=对赌注(${res.delta[f2]})`);
  assert(res.delta[lord] === (won?amt1+amt2:-(amt1+amt2)), `地主账变=两对之和(${res.delta[lord]})`);
}

// ── 退化不变式: 加倍局全选 1 === 无加倍局 ────────────────────
{
  const dd = playDoubledToEnd(5, [1,1,1]).result;
  // 无加倍同 seed 同 AI
  let st = E.createGame({ seed:5, isAI:[true,true,true] });
  let guard=0;
  while(st.phase==='bid'){ if(guard++>10) throw new Error('bid'); const s=st.bid.turn; const r=E.applyCall(st,s,AI.chooseBid(st.players[s].hand, st.bid.max)); if(r&&r.redeal){ st=E.createGame({seed:6,isAI:[true,true,true]}); guard=0; } }
  guard=0;
  while(st.phase==='play'){ if(guard++>500) throw new Error('play'); const s=st.turn; const tgt=(st.table.lastPlay&&st.table.lastPlay.seat!==s)?st.table.lastPlay.parse:null; const mv=AI.decide({seat:s,hand:st.players[s].hand,tableParse:tgt,handsLeft:st.players.map(p=>p.hand.length),landlord:st.landlord,iAmLandlord:s===st.landlord}); if(mv.action==='pass') E.applyPass(st,s); else E.applyPlay(st,s,mv.cards); }
  const nd = st.result;
  assert(JSON.stringify(dd.delta)===JSON.stringify(nd.delta), '加倍局全选1的 delta === 无加倍局 delta(退化不变式)');
}

// ── replay 重放加倍局一致 ──────────────────────────────────
{
  const st = playDoubledToEnd(1, [2,4,1]);
  const rp = E.replay(st.log);
  assert(rp.phase==='over', '加倍局能重放到终局');
  assert(JSON.stringify(rp.result.delta)===JSON.stringify(st.result.delta), '重放 delta 一致');
  assert(JSON.stringify(rp.result.doubles)===JSON.stringify(st.result.doubles), '重放 doubles 一致');
  assert(rp.result.finalMultiplier===st.result.finalMultiplier, '重放 finalMultiplier 一致');
}

// ── doubling 默认关: 无 double 阶段(老流程) ───────────────────
{
  const st = E.createGame({ seed: 777, isAI:[false,true,true] });   // 不传 doubling
  E.applyCall(st, 0, 3);
  assert(st.phase==='play', 'doubling 默认关: 定地主后直接 play(无 double 阶段)');
  assert(st.dbl===null, 'doubling 关: dbl 恒 null');
}

console.log(`\n${fail===0 ? '✅ 加倍系统全部通过' : '❌ 有失败'} — pass=${pass} fail=${fail}`);
process.exit(fail===0 ? 0 : 1);
