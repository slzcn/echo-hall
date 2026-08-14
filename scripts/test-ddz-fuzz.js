#!/usr/bin/env node
'use strict';
/**
 * test-ddz-fuzz.js — 斗地主引擎/规则模糊 + 不变量压测
 *
 * 目的:靠大量随机自对弈 + 边界构造,逼出"眼看代码看不出来"的隐藏 bug。
 * 不变量(每一步都必须成立,破一条即红):
 *   I1 牌张守恒:三家手牌 + 底牌(定地主前) + 已出牌 == 完整 54 张,无重无缺
 *   I2 turn 合法:play 阶段 turn∈{0,1,2} 且轮到谁谁能动
 *   I3 出牌合法:每次 applyPlay 的牌都能 parse,且跟牌时确实 beats 桌面
 *   I4 结束态:winner 手牌为 0;delta 三家和为 0(零和);winners/losers 不空且不相交
 *   I5 倍数单调:multiplier 只会因炸弹翻倍(≥叫分初值)
 *   I6 重放一致:log 重放出的 result 与实战完全一致
 * 另含 parse 边界反证:plane 带翼/四带/连对/顺子的非法组合必须被拒。
 */
const Engine = require('../js/games/ddz-engine.js');
const AI = require('../js/games/ddz-ai.js');
const Rules = require('../js/games/ddz-rules.js');
const Deck = require('../js/games/deck.js');

let pass = 0, fail = 0;
function ok(cond, msg){ if(cond){ pass++; } else { fail++; console.error('✗ FAIL: '+msg); } }

// 整副牌 id 集合(校验守恒用)
const FULL_IDS = new Set(Deck.standardDeck().map(c=>c.id));
const FULL_N = FULL_IDS.size; // 54

// ── 不变量:某一步的全局牌张守恒 ──
function checkConservation(st, playedIds, tag){
  const seen = new Set();
  let dup = false;
  const add = (id)=>{ if(seen.has(id)) dup = true; seen.add(id); };
  for (const p of st.players) for (const c of p.hand) add(c.id);
  // 底牌:定地主后已并入地主手牌,不再单独计
  if (st.landlord == null) for (const c of st.bottom) add(c.id);
  for (const id of playedIds) add(id);
  ok(!dup, `[${tag}] 无重复牌 id`);
  ok(seen.size === FULL_N, `[${tag}] 牌张守恒 = ${FULL_N} (实=${seen.size})`);
  for (const id of seen) if(!FULL_IDS.has(id)){ ok(false, `[${tag}] 出现非法牌 id ${id}`); break; }
}

// ── 一整局自对弈,逐步校验不变量 ──
function fuzzGame(seed){
  let st = Engine.createGame({ seed, isAI:[true,true,true], names:['A','B','C'] });
  const playedIds = [];
  let guard = 0;

  // 叫地主
  while (st.phase === 'bid'){
    if (guard++ > 20){ ok(false, `[seed ${seed}] 叫分死循环`); return; }
    const s = st.bid.turn;
    ok(s>=0 && s<3, `[seed ${seed}] bid turn 合法`);
    const r = Engine.applyCall(st, s, AI.chooseBid(st.players[s].hand, st.bid.max));
    if (r && r.redeal){ st = Engine.createGame({ seed: seed*7+1, isAI:[true,true,true], names:['A','B','C'] }); guard = 0; }
  }
  ok(st.landlord!=null && st.landlord>=0 && st.landlord<3, `[seed ${seed}] 定出地主`);
  ok(st.players[st.landlord].hand.length === 20, `[seed ${seed}] 地主 20 张(17+3底)`);
  checkConservation(st, playedIds, `seed ${seed} 定地主后`);
  const startMult = st.multiplier;

  // 出牌
  guard = 0;
  let lastMult = st.multiplier;
  while (st.phase === 'play'){
    if (guard++ > 600){ ok(false, `[seed ${seed}] 出牌死循环`); return; }
    const s = st.turn;
    ok(s>=0 && s<3, `[seed ${seed}] play turn 合法`);
    const target = (st.table.lastPlay && st.table.lastPlay.seat!==s) ? st.table.lastPlay.parse : null;
    const mv = AI.decide({ seat:s, hand:st.players[s].hand, tableParse:target,
      lastSeat: st.table.lastPlay ? st.table.lastPlay.seat : null,
      handsLeft: st.players.map(p=>p.hand.length), landlord:st.landlord, iAmLandlord:s===st.landlord });

    if (mv.action === 'pass'){
      // 领出不允许 pass —— AI 若在领出位返回 pass 就是 bug
      ok(!!target, `[seed ${seed}] AI 未在领出位 pass`);
      Engine.applyPass(st, s);
    } else {
      const p = Rules.parse(mv.cards);
      ok(!!p, `[seed ${seed}] AI 出的牌能 parse`);
      if (target) ok(Rules.beats(p, target), `[seed ${seed}] AI 跟牌确实压过桌面`);
      // 出的牌必须都在手上
      const handIds = new Set(st.players[s].hand.map(c=>c.id));
      ok(mv.cards.every(c=>handIds.has(c.id)), `[seed ${seed}] AI 出的牌都在手上`);
      const r = Engine.applyPlay(st, s, mv.cards);
      mv.cards.forEach(c=>playedIds.push(c.id));
      // 倍数只增不减,且只在炸弹时翻倍
      ok(st.multiplier>=lastMult, `[seed ${seed}] 倍数不回退`);
      if (Rules.isBomb(p)) ok(st.multiplier === lastMult*2, `[seed ${seed}] 炸弹翻倍`);
      else ok(st.multiplier === lastMult, `[seed ${seed}] 非炸不改倍数`);
      lastMult = st.multiplier;
      if (r && r.over) break;
    }
    // 每步守恒(抽样:每 7 步查一次,省时)
    if (guard % 7 === 0) checkConservation(st, playedIds, `seed ${seed} 步${guard}`);
  }

  // 结束态
  ok(st.phase === 'over', `[seed ${seed}] 终局到 over`);
  const res = st.result;
  const winner = res.winnerSeat;
  ok(st.players[winner].hand.length === 0, `[seed ${seed}] 赢家(座${winner})手牌清空`);
  const sum = Object.values(res.delta).reduce((a,b)=>a+b,0);
  ok(sum === 0, `[seed ${seed}] 结算零和(和=${sum})`);
  ok(res.winners.length>0 && res.losers.length>0, `[seed ${seed}] 胜负两方非空`);
  ok(res.winners.every(w=>!res.losers.includes(w)), `[seed ${seed}] 胜负不相交`);
  ok(res.winners.length + res.losers.length === 3, `[seed ${seed}] 胜负覆盖三家`);
  ok(res.finalMultiplier >= startMult, `[seed ${seed}] 终倍数≥初始`);
  checkConservation(st, playedIds, `seed ${seed} 终局`);

  // 重放一致
  const rp = Engine.replay(st.log);
  ok(rp.result.delta[0]===res.delta[0] && rp.result.delta[1]===res.delta[1] && rp.result.delta[2]===res.delta[2],
     `[seed ${seed}] 重放 delta 一致`);
  ok(rp.result.finalMultiplier===res.finalMultiplier, `[seed ${seed}] 重放倍数一致`);
  ok(JSON.stringify(rp.result.winners)===JSON.stringify(res.winners), `[seed ${seed}] 重放胜者一致`);
}

console.log('── 自对弈不变量压测(400 局) ──');
for (let seed = 1; seed <= 400; seed++) fuzzGame(seed);

// ── parse 边界反证:这些组合必须被判为非法(null)或正确归类 ──
console.log('── parse 边界反证 ──');
function mk(spec){ // spec: [[rank,count],...] → 造牌(suit 随便,rank<15 用普通,15=2,16/17=王)
  const cards=[]; let uid=0;
  for (const [rank,count] of spec) for(let i=0;i<count;i++)
    cards.push({ id:'x'+(uid++), rank, label:'?', suit:'♠', joker: rank===16?'small':rank===17?'big':undefined });
  return cards;
}
function typeOf(spec){ const p=Rules.parse(mk(spec)); return p?p.type:null; }

// 合法归类
ok(typeOf([[3,1]])==='single', 'single');
ok(typeOf([[3,2]])==='pair', 'pair');
ok(typeOf([[3,3]])==='trio', 'trio');
ok(typeOf([[3,3],[4,1]])==='trio_single', 'trio_single');
ok(typeOf([[3,3],[4,2]])==='trio_pair', 'trio_pair');
ok(typeOf([[3,4]])==='bomb', 'bomb');
ok(typeOf([[16,1],[17,1]])==='rocket', 'rocket 双王');
ok(typeOf([[3,1],[4,1],[5,1],[6,1],[7,1]])==='straight', '5 连顺子');
ok(typeOf([[3,2],[4,2],[5,2]])==='pairs', '3 连对');
ok(typeOf([[3,3],[4,3]])==='plane', '飞机(纯)');
ok(typeOf([[3,3],[4,3],[5,1],[6,1]])==='plane_single', '飞机带两单');
ok(typeOf([[3,3],[4,3],[5,2],[6,2]])==='plane_pair', '飞机带两对');
ok(typeOf([[3,4],[5,1],[6,1]])==='quad_single', '四带二单');
ok(typeOf([[3,4],[5,2],[6,2]])==='quad_pair', '四带两对');

// 非法必须为 null
ok(typeOf([[3,1],[4,1],[5,1],[6,1]])===null, '反证:4 连单张不是顺子');
ok(typeOf([[11,1],[12,1],[13,1],[14,1],[15,1]])===null, '反证:含 2 的顺子非法');
ok(typeOf([[13,1],[14,1],[15,1],[16,1],[17,1]])===null, '反证:含王的顺子非法');
ok(typeOf([[3,2],[4,2]])===null, '反证:2 连对(<3)非法');
ok(typeOf([[15,2],[3,2],[4,2]])===null || typeOf([[3,2],[4,2],[15,2]])===null, '反证:含 2 的连对非法');
ok(typeOf([[14,3],[15,3]])===null, '反证:A-2 三连飞机非法(含 2)');
ok(typeOf([[3,3],[4,3],[5,1]])===null, '反证:飞机翼数不匹配(2三带1单)非法');
ok(typeOf([[3,4],[5,1]])===null, '反证:四带一单(缺一翼)非法');
ok(typeOf([[3,4],[5,3]])===null, '反证:四带三张(非二单/二对)非法');
ok(typeOf([[3,1],[4,1]])===null, '反证:两张不同点单张(非对)非法');

// beats 关系反证
const P = (spec)=>Rules.parse(mk(spec));
ok(Rules.beats(P([[4,1]]), P([[3,1]]))===true, '4 单 > 3 单');
ok(Rules.beats(P([[3,1]]), P([[4,1]]))===false, '3 单 !> 4 单');
ok(Rules.beats(P([[3,4]]), P([[15,1]]))===true, '炸弹 > 单张 2');
ok(Rules.beats(P([[16,1],[17,1]]), P([[3,4]]))===true, '王炸 > 炸弹');
ok(Rules.beats(P([[3,1]]), P([[3,2]]))===false, '单张 !> 对子(异型)');
ok(Rules.beats(P([[5,1],[6,1],[7,1],[8,1],[9,1]]), P([[3,1],[4,1],[5,1],[6,1],[7,1]]))===true, '大顺子 > 小顺子(同长)');
ok(Rules.beats(P([[3,1],[4,1],[5,1],[6,1],[7,1],[8,1]]), P([[3,1],[4,1],[5,1],[6,1],[7,1]]))===false, '6 连 !> 5 连(异长)');

// ── AI 队友协作反证:农民不该压自己队友的牌 ──
console.log('── AI 队友协作 ──');
{
  // 场景:地主=座2。座0/座1 是农民队友。桌面这手由座1(队友)出的一个小对子 33。
  //   座0 手里有能压的对子(44),但不该压队友 —— 除非能一把出完。
  const hand0 = mk([[4,2],[7,1],[9,1],[10,1]]);  // 有 44 能压 33, 但出 44 不清空
  const mvCoop = AI.decide({ seat:0, hand:hand0, tableParse:Rules.parse(mk([[3,2]])),
    lastSeat:1, handsLeft:[4,1,10], landlord:2, iAmLandlord:false });
  ok(mvCoop.action==='pass', '农民不压队友的领出(让牌)');

  // 但若能一把走完 → 该出(直接终结本方胜)。手里正好是一个能压的对子。
  const mvFin = AI.decide({ seat:0, hand:mk([[4,2]]), tableParse:Rules.parse(mk([[3,2]])),
    lastSeat:1, handsLeft:[2,5,10], landlord:2, iAmLandlord:false });
  ok(mvFin.action==='play' && mvFin.cards.length===2, '能一把出完时压队友也要出(抢终结)');

  // 对手(地主)领出时,农民照常尝试压制,不受协作影响。
  const mvVsLord = AI.decide({ seat:0, hand:mk([[4,2],[7,1]]), tableParse:Rules.parse(mk([[3,2]])),
    lastSeat:2, handsLeft:[3,5,4], landlord:2, iAmLandlord:false });
  ok(mvVsLord.action==='play', '对手(地主)领出时农民照常压制');

  // 紧迫度只看真对手:队友(座1)剩 1 张不该触发"浪费炸弹"。
  // 手牌 7 张(>5,不触发 shouldBomb 的搏一把),地主(座2)剩 10 张、出了压不过的大单张
  //   → 既不紧急也不该搏 → 该 pass 留炸弹让队友赢。(修复前 minOpponentCards 会误取队友的 1 → 甩炸)
  const mvNoBomb = AI.decide({ seat:0, hand:mk([[5,4],[8,1],[9,1],[10,1]]), tableParse:Rules.parse(mk([[15,1]])),
    lastSeat:2, handsLeft:[7,1,10], landlord:2, iAmLandlord:false });
  ok(mvNoBomb.action==='pass', '队友快赢不算紧迫,不为压地主大单张浪费炸弹');
}

console.log(`\n${fail===0?'✅':'❌'} fuzz 压测完成 — pass=${pass} fail=${fail}`);
process.exit(fail===0?0:1);
