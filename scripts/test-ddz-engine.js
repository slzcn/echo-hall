#!/usr/bin/env node
'use strict';
// 斗地主引擎+AI 集成测试:
//   · createGame 发牌/叫地主/底牌归属
//   · AI 自对弈整局:每步合法(不抛错)、必分胜负、剩牌数守恒
//   · transition log → replay 重放,终局 result 完全一致
//   · 结算数学:地主 delta = +2s/两农民 -s(或反之),和为 0
const E = require('../js/games/ddz-engine.js');
const AI = require('../js/games/ddz-ai.js');
const R = require('../js/games/ddz-rules.js');
const D = require('../js/games/deck.js');

let pass=0, fail=0;
function assert(ok,msg){ if(ok){pass++;} else {console.log('✗ '+msg); fail++;} }
function ok(msg){ console.log('✓ '+msg); pass++; }

// 用固定 seed 起局(全 AI),跑到结束。返回终局 state。
function playOut(seed){
  let st = E.createGame({ seed, isAI:[true,true,true] });
  // 叫地主阶段
  let guard = 0;
  while (st.phase === 'bid'){
    if (guard++ > 10) throw new Error('bid_loop');
    const seat = st.bid.turn;
    const val = AI.chooseBid(st.players[seat].hand, st.bid.max);
    const r = E.applyCall(st, seat, val);
    if (r && r.redeal){
      // 全不叫:强制 0 号叫 1 继续(测试里避免死循环)
      st = E.createGame({ seed: seed+1, isAI:[true,true,true] });
      guard = 0;
    }
  }
  // 出牌阶段
  guard = 0;
  while (st.phase === 'play'){
    if (guard++ > 500) throw new Error('play_loop @seed '+seed);
    const seat = st.turn;
    const p = st.players[seat];
    const target = (st.table.lastPlay && st.table.lastPlay.seat !== seat) ? st.table.lastPlay.parse : null;
    const mv = AI.decide({
      seat, hand: p.hand, tableParse: target,
      handsLeft: st.players.map(x=>x.hand.length),
      landlord: st.landlord, iAmLandlord: seat===st.landlord,
    });
    if (mv.action === 'pass'){
      E.applyPass(st, seat);
    } else {
      E.applyPlay(st, seat, mv.cards);
    }
  }
  return st;
}

// ── 建局 & 叫地主基础 ───────────────────────────────────────
{
  const st = E.createGame({ seed: 777, isAI:[false,true,true] });
  assert(st.phase==='bid', '初始进入叫地主阶段');
  assert(st.players.length===3 && st.players.every(p=>p.hand.length===17), '3 家各 17 张');
  assert(st.bottom.length===3, '底牌 3 张');
  // 0 号叫 3 立即当地主
  E.applyCall(st, 0, 3);
  assert(st.phase==='play' && st.landlord===0, '叫 3 立即定地主');
  assert(st.players[0].hand.length===20, '地主拿底牌后 20 张');
  assert(st.turn===0, '地主先出');
  ok('叫地主流程 OK');
}

// ── 抢地主:一圈叫分,最高者当 ────────────────────────────
{
  const st = E.createGame({ seed: 888, isAI:[true,true,true] });
  E.applyCall(st, 0, 1);
  E.applyCall(st, 1, 2);
  E.applyCall(st, 2, 0);
  assert(st.phase==='play' && st.landlord===1, '一圈后最高分(2)当地主');
  assert(st.multiplier===2, '初始倍数=叫分 2');
  ok('抢地主 OK');
}

// ── 全不叫 → redeal 信号 ─────────────────────────────────────
{
  const st = E.createGame({ seed: 999, isAI:[true,true,true] });
  E.applyCall(st, 0, 0);
  E.applyCall(st, 1, 0);
  const r = E.applyCall(st, 2, 0);
  assert(r && r.redeal===true, '全不叫返回 redeal');
}

// ── 非法操作被拦 ────────────────────────────────────────────
{
  const st = E.createGame({ seed: 111, isAI:[false,true,true] });
  E.applyCall(st, 0, 3); // 地主 0
  let threw=false;
  try { E.applyPlay(st, 1, [st.players[1].hand[0]]); } catch(e){ threw=true; }
  assert(threw, '非当前回合出牌被拒');
  threw=false;
  try { E.applyPass(st, 0); } catch(e){ threw = e.message==='leader_cannot_pass'; }
  assert(threw, '首出者不能 pass');
}

// ── AI 自对弈:多局跑通 + 守恒 + 结算 ───────────────────────
let games=0, springs=0, bombsSeen=0;
for (let seed=1; seed<=40; seed++){
  const st = playOut(seed);
  games++;
  assert(st.phase==='over', `seed=${seed} 对局正常结束`);
  const res = st.result;
  // 胜者手牌为空
  assert(st.players[res.winnerSeat].hand.length===0, `seed=${seed} 胜者手牌清空`);
  // delta 和为 0(零和)
  const sum = Object.values(res.delta).reduce((a,b)=>a+b,0);
  assert(sum===0, `seed=${seed} 记分零和 (sum=${sum})`);
  // 地主 delta 绝对值 = 2 * 农民 delta 绝对值
  const lordDelta = Math.abs(res.delta[res.landlord]);
  const peasantDelta = Math.abs(res.delta[(res.landlord+1)%3]);
  assert(lordDelta === 2*peasantDelta, `seed=${seed} 地主分=2×农民分`);
  if (res.spring) springs++;
  bombsSeen += res.bombs;

  // ── 回看重放一致性 ──
  const rp = E.replay(st.log);
  assert(rp.phase==='over', `seed=${seed} 重放到终局`);
  assert(JSON.stringify(rp.result.delta)===JSON.stringify(res.result?res.result.delta:res.delta),
    `seed=${seed} 重放 delta 一致`);
  assert(rp.result.finalMultiplier===res.finalMultiplier, `seed=${seed} 重放倍数一致`);
  assert(rp.result.winnerSeat===res.winnerSeat, `seed=${seed} 重放胜者一致`);
}
ok(`AI 自对弈 ${games} 局全部跑通(spring=${springs}, 炸弹累计=${bombsSeen})`);

// ── AI 出牌合法性抽检:decide 产出必能 parse 且能压桌面 ──────
{
  const st = E.createGame({ seed: 2024, isAI:[true,true,true] });
  E.applyCall(st, 0, 3);
  let checks=0, guard=0;
  while (st.phase==='play' && guard++ < 300){
    const seat = st.turn;
    const target = (st.table.lastPlay && st.table.lastPlay.seat!==seat) ? st.table.lastPlay.parse : null;
    const mv = AI.decide({ seat, hand: st.players[seat].hand, tableParse: target,
      handsLeft: st.players.map(x=>x.hand.length), landlord: st.landlord, iAmLandlord: seat===st.landlord });
    if (mv.action==='play'){
      const p = R.parse(mv.cards);
      assert(!!p, `AI 出牌可解析 (seat ${seat})`);
      if (target) assert(R.beats(p, target), `AI 跟牌能压过桌面 (seat ${seat})`);
      checks++;
      E.applyPlay(st, seat, mv.cards);
    } else E.applyPass(st, seat);
  }
  ok(`AI 合法性抽检 ${checks} 手全部合法`);
}

// ── 叫分评分单调性 ──────────────────────────────────────────
{
  // 双王 + 4 个 2 → 必叫 3
  const strong = [D.makeCard(16),D.makeCard(17),D.makeCard(15,'♠'),D.makeCard(15,'♥'),D.makeCard(15,'♣'),D.makeCard(15,'♦')];
  assert(AI.chooseBid(strong, 0)===3, '超强手牌叫 3');
  // 一手小散牌 → 不叫 or 低分
  const weak = [D.makeCard(3,'♠'),D.makeCard(4,'♥'),D.makeCard(6,'♣'),D.makeCard(7,'♦'),D.makeCard(9,'♠')];
  assert(AI.chooseBid(weak, 0) <= 1, '弱手牌低分/不叫');
  // 当前已有人叫 3,则不再叫
  assert(AI.chooseBid(strong, 3)===0, '压不过当前最高分则不叫');
}

console.log(`\n${fail===0 ? '✅ 全部通过' : '❌ 有失败'} — pass=${pass} fail=${fail}`);
process.exit(fail===0 ? 0 : 1);
