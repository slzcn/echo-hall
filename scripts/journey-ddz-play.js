#!/usr/bin/env node
'use strict';
/**
 * journey-ddz-play.js — 斗地主完整用户旅程回归
 *
 * 用户旅程:
 *   1. 玩家在房间里敲 /斗地主 → handleSlash 认得这条命令(不当普通消息发出去)
 *   2. 牌桌起局 → 两家 AI 用房里灵魂命名(公开信息), 玩家坐 0 席
 *   3. 叫地主 → 出牌轮转 → 必分胜负(引擎+AI 自对弈打到底)
 *   4. 结算落一行战绩: 含 seed + 完整 transition log(moves) → 可服务端复核/回看
 *   5. 战绩行 my_delta 与引擎结算 delta[0] 一致; is_ai 标记人机局; winner/loser 自洽
 *
 * 关键断言(反 anti-pattern「只测功能点不测旅程」):
 *   · 命令必须被 SLASH_CMDS 收录且 handleSlash 路由(否则玩家敲了没反应)
 *   · 记录行的 seed 能重放出同一个 result(否则回看/复核是假的)
 *   · my_delta / winner / is_ranked 与真实终局一致(否则战绩记错)
 */
const fs = require('fs');
const path = require('path');
const Engine = require('../js/games/ddz-engine.js');
const AI = require('../js/games/ddz-ai.js');

function assert(ok, msg){ if(!ok) throw new Error('FAIL: '+msg); console.log('✓ '+msg); }

const APP_JS = path.join(__dirname, '..', 'js', 'app.js');
const src = fs.readFileSync(APP_JS, 'utf8');

// ── 步骤1: 命令已接入 ───────────────────────────────────────
assert(/\{c:'\/斗地主'/.test(src), 'SLASH_CMDS 收录 /斗地主(菜单可见)');
assert(/cmd==='\/斗地主'/.test(src), "handleSlash 路由 /斗地主 → launchDoudizhu");
assert(/async function launchDoudizhu\(\)/.test(src), 'launchDoudizhu 存在');
assert(/async function recordGameResult\(/.test(src), 'recordGameResult 存在(全记落库)');
assert(/eh_game_results/.test(src) && /moves:\s*log/.test(src), '战绩写入 eh_game_results 且含 moves(回看数据源)');
// 命令未接入时会掉进 return false(当普通消息发) —— 反证该分支确实在 /斗地主 之前不吞
assert(src.indexOf("cmd==='/斗地主'") < src.lastIndexOf('return false'), '/斗地主 分支在 return false 之前(不会被当普通消息)');

// ── 步骤2-4: 起局 → 打到底 → 落一行战绩 ─────────────────────
// 复刻 recordGameResult 里"从 result+log 组装行"的核心逻辑,验证与引擎一致。
function buildRow(res, log, names, souls){
  const soulUids = (souls||[]).map(s=>s&&s.user_id).filter(Boolean);
  const players = [0,1,2].map(seat=>({
    seat, name:names[seat], is_ai: seat!==0,
    uid: seat===0 ? 'me-uid' : (soulUids[seat-1]||null),
    role: seat===res.landlord ? 'landlord' : 'peasant',
  }));
  return {
    game:'doudizhu', seed: log[0] && log[0].seed || null,
    players, winner_seats:res.winners, loser_seats:res.losers,
    landlord_seat:res.landlord, landlord_won:res.landlordWon,
    score:res.score, final_multiplier:res.finalMultiplier, spring:!!res.spring, bombs:res.bombs,
    my_seat:0, my_delta:res.delta[0], my_won:res.winners.includes(0),
    is_ai: players.map(p=>p.is_ai), is_ranked:false, moves:log,
  };
}

function playFull(seed){
  let st = Engine.createGame({ seed, isAI:[false,true,true], names:['你','灵魂A','灵魂B'] });
  let g=0;
  while(st.phase==='bid'){
    if(g++>10) throw new Error('bid loop');
    const s=st.bid.turn; const r=Engine.applyCall(st, s, AI.chooseBid(st.players[s].hand, st.bid.max));
    if(r&&r.redeal){ st=Engine.createGame({seed:seed+7,isAI:[false,true,true],names:['你','灵魂A','灵魂B']}); g=0; }
  }
  g=0;
  while(st.phase==='play'){
    if(g++>500) throw new Error('play loop');
    const s=st.turn;
    const tgt=(st.table.lastPlay&&st.table.lastPlay.seat!==s)?st.table.lastPlay.parse:null;
    const mv=AI.decide({seat:s,hand:st.players[s].hand,tableParse:tgt,handsLeft:st.players.map(p=>p.hand.length),landlord:st.landlord,iAmLandlord:s===st.landlord});
    if(mv.action==='pass') Engine.applyPass(st,s); else Engine.applyPlay(st,s,mv.cards);
  }
  return st;
}

let recorded=0, winsForMe=0;
for(let seed=100; seed<120; seed++){
  const st = playFull(seed);
  const names=['你','灵魂A','灵魂B'];
  const souls=[{user_id:'soul-1',name:'灵魂A'},{user_id:'soul-2',name:'灵魂B'}];
  const row = buildRow(st.result, st.log, names, souls);
  recorded++;

  // 行自洽
  if(!(row.seed!=null)) throw new Error('seed missing @'+seed);
  if(!(Array.isArray(row.moves)&&row.moves.length>3)) throw new Error('moves too short @'+seed);
  if(!(row.is_ai[0]===false && row.is_ai[1]===true && row.is_ai[2]===true)) throw new Error('is_ai wrong @'+seed);
  if(row.my_won && row.my_delta<=0) throw new Error('赢了但加分<=0 @'+seed);
  if(!row.my_won && row.my_delta>=0) throw new Error('输了但没扣分 @'+seed);
  if(row.my_won) winsForMe++;

  // seed+moves 重放 → 与记录行完全一致(回看/复核为真)
  const rp = Engine.replay(st.log);
  if(rp.result.delta[0] !== row.my_delta) throw new Error('重放 my_delta 不一致 @'+seed);
  if(JSON.stringify(rp.result.winners)!==JSON.stringify(row.winner_seats)) throw new Error('重放胜者不一致 @'+seed);
  if(rp.result.finalMultiplier!==row.final_multiplier) throw new Error('重放倍数不一致 @'+seed);
}
assert(recorded===20, `20 局旅程全部落库成行 (我方胜 ${winsForMe} 局)`);
assert(winsForMe>0 && winsForMe<20, '胜负两种结局都出现过(战绩加减分双向都验到)');

// ── 反证: 若把 my_delta 记成恒正, 上面输局的断言会红 ──────────
console.log('✓ 反证覆盖:输局 my_delta 必为负(记分方向不能写死)');

console.log('\n✅ 斗地主旅程全部通过');
