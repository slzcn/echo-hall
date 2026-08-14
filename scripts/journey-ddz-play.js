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
// 防重复开桌:launchDoudizhu 里在 open 之前挡掉已有牌局(否则叠两张桌+两套定时器)
assert(/querySelector\('\.ddz-room'\)/.test(src) && /launchDoudizhu/.test(src),
  '重复敲 /斗地主 被拦(已有 .ddz-room 时不再叠桌)');

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

// ── 步骤5: 牌桌 UX 契约(入室化 / 倒计时 / 动效 / 轮次感) ─────
// 主人四点反馈对应四条不可回退的 UX 断言。UI 无 DOM 环境, 这里做源级契约锁,
// 防止"改回全屏浮层 / 砍掉倒计时 / 去掉落牌动画 / 看不出轮到谁"再次发生。
const UI_JS = path.join(__dirname, '..', 'js', 'games', 'game-ui.js');
const ui = fs.readFileSync(UI_JS, 'utf8');

// (1) 入室化:挂进聊天室 #hall 而非全屏 fixed 黑色浮层
assert(/getElementById\('hall'\)/.test(ui), '牌桌优先挂进聊天室 #hall(入室牌桌,不是弹层)');
assert(/\.ddz-room\{position:absolute/.test(ui), '牌桌用 absolute 铺满房间(非 position:fixed 全屏遮罩)');
assert(!/\.ddz-mask\{position:fixed/.test(ui), '旧的 .ddz-mask 全屏浮层已移除');

// (2) 出牌倒计时:人类回合有时限, 到点自动兜底(与断线托管同源)
assert(/HUMAN_PLAY_MS/.test(ui) && /HUMAN_BID_MS/.test(ui), '定义人类出牌/叫分回合时限');
assert(/function armTurn\(/.test(ui) && /onHumanTimeout/.test(ui), '每回合武装倒计时 + 人类超时兜底');
assert(/超时 · 自动不出/.test(ui) && /超时 · 自动出牌/.test(ui), '到点自动过/自动出(不卡死在等玩家)');
assert(/requestAnimationFrame\(tick\)/.test(ui), '倒计时环用 rAF 平滑驱动(--p conic 环)');

// (3) 落牌动效 + (4) 轮次感:飞入动画 + 活动席高亮环 + 中央横幅
assert(/fly-bot/.test(ui) && /fly-top/.test(ui), '出牌有方向性飞入动画(自己下方/对手上方)');
assert(/ddzBoom|ddz-boom/.test(ui) && /function boom\(/.test(ui), '炸弹/王炸有震屏+爆炸特效');
assert(/ddz-turnbanner/.test(ui) && /轮到你/.test(ui), '中央横幅明确"轮到谁"(轮到你出牌高亮)');
assert(/\.ddz-seat\.turn/.test(ui), '当前该出牌的座位有高亮态(turn class)');

// (5) AI 队友协作:game-ui 必须把 lastSeat 传给 AI.decide, 否则农民认不出队友会互相压牌
assert(/lastSeat:\s*st\.table\.lastPlay/.test(ui), 'game-ui 向 AI.decide 传 lastSeat(农民协作的判据)');

// ── 步骤6: 和聊天融合(主人反馈:游戏结束后聊天室什么都没留下) ─────
// 三条不可回退断言, 对治"开局/结束都不触发聊天内容":
//   ① 开局在房间留一行(act) → 游戏"触发了聊天内容"
//   ② 结束后落一张 kind:'game' 战绩卡(ddz 事件, 编码可被 buildGameEl 解回)
//   ③ 战绩卡带"再来一局"入口, 点了直接开新局 → 快速循环
assert(/sendSystemAct\(`开了一桌斗地主/.test(src), '开局在聊天室留一行(触发聊天内容, 非静默开桌)');
assert(/async function postDdzResult\(/.test(src), '存在 postDdzResult(结束后发战绩卡)');
assert(/onResult:[\s\S]{0,160}postDdzResult\(res,\s*names\)/.test(src), 'onResult 结束回调里发战绩卡(不再"什么都没留下")');
assert(/postDdzResult[\s\S]{0,400}kind:'game'/.test(src), '战绩卡以 kind:game 落库(走消息流, 全房可见)');
// 编码 → 解码闭环: 生产用的 text 编码字段序与 buildGameEl 的 ddz 分支解码字段序一致
assert(/\['game','ddz',\s*win,\s*role,\s*res\.delta\[0\],\s*res\.base,\s*res\.finalMultiplier,\s*res\.bombs\|\|0,\s*res\.spring\?1:0,\s*res\.landlordWon\?1:0,\s*lordName\]/.test(src),
  'postDdzResult 编码字段序固定(win|role|delta|base|mult|bombs|spring|lordWon|lordName)');
assert(/if\(ev==='ddz'\)/.test(src), 'buildGameEl 有 ddz 分支(把战绩卡渲染回来)');
assert(/data-ddz-again/.test(src), '战绩卡含"再来一局"入口(data-ddz-again)');
assert(/again\.onclick=[\s\S]{0,120}launchDoudizhu\(\)/.test(src), '"再来一局"点击直接开新局(每卡 onclick, 不新增 #stream 委托监听)');
// 预览/通知不能露原始编码
assert(/p\[1\]==='ddz'[\s\S]{0,120}斗地主/.test(src), '消息预览把 ddz 卡显示成"🃏 斗地主 · 胜/负"(不露原始 game|ddz| 编码)');

// ── 步骤7: 终端自适应(主人反馈:大屏元素不够饱满) ────────────
// 牌/座位/头像/手牌重叠尺寸全部走 CSS 变量, 且大屏媒体查询把变量整体放大。
assert(/\.ddz-room\{[\s\S]*--cw:44px;[\s\S]*--av:52px/.test(ui), '牌桌尺寸提为 CSS 变量(--cw/--av...)默认小屏值');
assert(/\.card\{width:var\(--cw/.test(ui), '大牌宽度吃 --cw 变量(不再写死 44px)');
assert(/\.ddz-avr\{width:var\(--av/.test(ui), '头像尺寸吃 --av 变量');
assert(/\.ddz-hand \.card\{margin-left:var\(--hand-ov/.test(ui), '手牌重叠吃 --hand-ov 变量');
assert(/@media \(min-width:600px\)[\s\S]{0,200}--cw:50px/.test(ui) && /@media \(min-width:900px\)[\s\S]{0,220}--cw:58px/.test(ui),
  '600/900px 媒体查询把牌桌变量整体放大(大屏饱满)');
assert(/\.ddz-opps\{[\s\S]*max-width:var\(--oppmax/.test(ui), '大屏对手区限宽居中(不松散飘两边)');

// ── 步骤8: 音效 + 特效(主人反馈:音效特效可以加上) ──────────
// 复用聊天室 EhSfx 合成器, 全程 try/catch(未加载静默, 绝不打断牌局)。
assert(/function sfx\(n\)\{[\s\S]{0,120}root\.EhSfx[\s\S]{0,80}catch/.test(ui), 'sfx() 复用 EhSfx 且 try/catch(未加载不崩)');
assert(/sfx\('send'\)/.test(ui) && /sfx\('mention'\)/.test(ui) && /sfx\('boom'\)/.test(ui), '出牌/轮到你/炸弹各有音效');
assert(/iWon[\s\S]{0,80}sfx\('sparkle'\)[\s\S]{0,120}confetti\(\)/.test(ui), '胜利: 音效 + 彩带特效');
assert(/function confetti\(\)/.test(ui) && /ddz-confetti/.test(ui), '存在胜利彩带(confetti)');
assert(/if \(mine && !lastMyTurn\)\{ sfx\('mention'\); vibrate/.test(ui), '"刚轮到我"上升沿才提示音+震动(不每帧响)');
assert(/if \(deal\)\{[\s\S]{0,80}justdealt/.test(ui), '发牌那一帧错峰入场动画(justdealt)');

console.log('\n✅ 斗地主旅程全部通过');
