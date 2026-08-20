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
const Net = require('../js/games/ddz-net.js');
const Deck = require('../js/games/deck.js');

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
// 防重复开桌 + F1 融合: launchDoudizhu 在 open 之前走 _restoreActiveGameIfAny()。
// 已有牌桌时不叠桌 —— 若牌桌是折叠态(活牌桌片)则展开回同一局, 否则提示先收工;
// 二者都 return 掉, 绝不叠两张桌 + 两套定时器。这比旧的"静默拦掉"更顺(丝滑回桌)。
assert(/function _restoreActiveGameIfAny\(\)/.test(src), '存在 _restoreActiveGameIfAny(已有牌桌时的统一处置)');
assert(/querySelector\('\.ddz-room, \.gd-room, \.pk-room'\)/.test(src), '_restoreActiveGameIfAny 认得已开的斗地主/掼蛋/德州牌桌(单桌约束)');
assert(/if\(_restoreActiveGameIfAny\(\)\) return;/.test(src), '重复敲 /斗地主 被拦(已有牌桌 → 展开或提示, 不再叠桌)');
assert(/isMinimized\(\)[\s\S]{0,60}\.restore\(\)/.test(src), '已有牌桌若为折叠态则展开回同一局(不销毁重开)');

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

  // ── 收局残局(对标腾讯"亮残牌"): result.reveal = 各家终局剩牌 id; 赢家出完为空, 输家=其剩牌 ──
  const rev = st.result.reveal;
  if(!rev) throw new Error('result 缺 reveal(残局数据) @'+seed);
  const ALL = {}; Deck.standardDeck().forEach(c=>ALL[c.id]=c);
  for(const p of st.players){
    const ids = rev[p.seat]||[];
    if(ids.length !== p.hand.length) throw new Error(`残局 reveal[${p.seat}] 张数(${ids.length})≠该家剩牌(${p.hand.length}) @`+seed);
    if(ids.some(id=>!ALL[id])) throw new Error(`残局 reveal[${p.seat}] 含非法牌 id @`+seed);
  }
  if((rev[st.result.winnerSeat]||[]).length !== 0) throw new Error('赢家残牌应为空(已出完) @'+seed);
}
assert(recorded===20, `20 局旅程全部落库成行 (我方胜 ${winsForMe} 局)`);
assert(winsForMe>0 && winsForMe<20, '胜负两种结局都出现过(战绩加减分双向都验到)');

// ── 反证: 若把 my_delta 记成恒正, 上面输局的断言会红 ──────────
console.log('✓ 反证覆盖:输局 my_delta 必为负(记分方向不能写死)');

// ── 收局残局 · 联机脱敏命门: reveal 只在终局的 result 里, 对局中快照永不下发 ──────────
{
  const st = playFull(100);
  // 终局快照: sanitizeResult 透传 reveal(guest 也能在结算看残局)
  const overSnap = Net.snapshot(st, 1);
  assert(overSnap.result && overSnap.result.reveal, '终局脱敏快照 result 携带 reveal(guest 结算可见残局)');
  assert(Net.assertNoLeak(overSnap).ok, '终局快照仍不外泄 手牌/seed/log(reveal 在 result 内, 不触发泄漏门)');
  // 对局中快照(全新局, 未结算): result=null → 无残牌下发, 无从推别家手牌
  const midSt = Engine.createGame({ seed:100, isAI:[false,true,true], names:['你','灵魂A','灵魂B'] });
  const midSnap = Net.snapshot(midSt, 1);
  assert(midSnap.result === null, '对局中快照 result=null(残牌绝不在牌局进行时下发)');
  assert(Net.assertNoLeak(midSnap).ok, '对局中快照不外泄任何手牌(残牌命门守住)');
}
console.log('✓ 收局残局数据流 + 脱敏命门(reveal 仅终局可见, 局中零外泄)');

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

// (6) 收局体验(对标腾讯斗地主): 结算亮残牌 + 丝滑接下一局(反回退"只显示剩N张""再来一局瞬拆硬切")
assert(/ddz-remains/.test(ui) && /res\.reveal/.test(ui), '结算面板渲染残局(读 result.reveal 亮各家剩牌)');
assert(/\.ddz-over\.out\{animation:ddzOverOut/.test(ui) && /over\.classList\.add\('out'\)/.test(ui),
  '再来一局先淡出下沉(.ddz-over.out 过渡)再重建, 不瞬拆硬切');
assert(/over\.addEventListener\('animationend'/.test(ui) && /setTimeout\(once,\s*\d+\)/.test(ui),
  '过渡用 animationend 推进 + setTimeout 兜底(动画被打断也不卡在结算页)');
assert(/if\s*\(over\._leaving\)\s*return/.test(ui), '再来一局按钮防连点(过渡中重复点被吞, 不重复建局)');
// ddz-net 把 reveal 透传给 guest(联机结算也能看残局), 但只在 result 里 → 不破坏脱敏命门
assert(/reveal:\s*res\.reveal\s*\?/.test(fs.readFileSync(path.join(__dirname,'..','js','games','ddz-net.js'),'utf8')),
  'ddz-net.sanitizeResult 透传 reveal(联机 guest 结算可见残局)');

// ── 步骤6: 和聊天融合(主人反馈:游戏结束后聊天室什么都没留下) ─────
// 三条不可回退断言, 对治"开局/结束都不触发聊天内容":
//   ① 开局不再静默/单机, 而是走 eh_gt_open 建【联机牌桌】并把牌桌卡发进聊天室(全房可见可加入)
//   ② 结束后落一张 kind:'game' 战绩卡(ddz 事件, 编码可被 buildGameEl 解回)
//   ③ 战绩卡带"再来一局"入口, 点了直接开新局 → 快速循环
assert(/async function launchDoudizhu\(\)[\s\S]{0,400}rpc\('eh_gt_open'/.test(src), '/斗地主 开桌走 eh_gt_open(建联机牌桌, 非本地单机)');
assert(/launchDoudizhu\(\)[\s\S]{0,600}EHTable\.encode\(row\.id,'ddz'\)[\s\S]{0,200}kind:'game'/.test(src), '开桌把牌桌卡(kind:game, game|gt)发进聊天室(全房可见)');
assert(/rpc\('eh_gt_set_msg'/.test(src), '回填牌桌卡消息 id(eh_gt_set_msg, 供定位刷新)');
assert(/async function postDdzResult\(/.test(src), '存在 postDdzResult(结束后发战绩卡)');
assert(/onResult:[\s\S]{0,260}postDdzResult\(res,\s*(?:A\.)?names\)/.test(src), 'onResult 结束回调里发战绩卡(不再"什么都没留下")');
assert(/async function postDdzResult\([\s\S]{0,700}kind:'game'/.test(src), '战绩卡以 kind:game 落库(走消息流, 全房可见)');
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
assert(/sfx\('cardplay'\)/.test(ui) && /sfx\('yourturn'\)/.test(ui) && /sfx\('boom'\)/.test(ui) && /sfx\('deal'\)/.test(ui) && /sfx\('pass'\)/.test(ui) && /sfx\('landlord'\)/.test(ui), '牌桌专属音效: 出牌拍击/轮到你/炸弹/发牌/过牌/地主揭晓各有音');
assert(/iWon[\s\S]{0,80}sfx\('sparkle'\)[\s\S]{0,120}confetti\(\)/.test(ui), '胜利: 音效 + 彩带特效');
assert(/function confetti\(\)/.test(ui) && /ddz-confetti/.test(ui), '存在胜利彩带(confetti)');
assert(/if \(mine && !lastMyTurn\)\{ sfx\('yourturn'\); vibrate/.test(ui), '"刚轮到我"上升沿才提示音+震动(不每帧响)');
assert(/if \(deal\)\{[\s\S]{0,80}justdealt/.test(ui), '发牌那一帧错峰入场动画(justdealt)');

// ── 步骤9: 座位参数化(联机地基: 真人可坐非 0 席, DOM 槽位绕 mySeat 旋转) ──
// 治"联机把别人座位画在我的位置/手牌数对不上人"。单机 mySeat=0 时旋转恰为 [1,2], 行为不变。
assert(/opts\.mySeat/.test(ui), 'mySeat 可由 opts 传入(联机真人坐非 0 席)');
assert(/OPP_SEATS\s*=\s*\[\(mySeat\+1\)%3,\s*\(mySeat\+2\)%3\]/.test(ui), '对手槽位绕 mySeat 相对旋转((me+1)/(me+2))');
assert(/els\.opps\.innerHTML = OPP_SEATS\.map/.test(ui), 'renderSeats 用旋转后对手槽(非写死[1,2])');
assert(/isAI:\s*gameIsAI/.test(ui), 'createGame 吃 opts.isAI(host 按座位实况标人/机, 含重发/再来一局)');

// ── 步骤10: 斗地主不设手动理牌(与掼蛋不同) ──
// 斗地主手牌少(≤20 张单排)、发牌即按大小排好、点选直接, 手动码牌是掼蛋(27 张两排)才需要的。
// 主人反馈"斗地主不需要理牌": 移除 #ddzSort 按钮与拖排模式, handOrder 恒走 Deck.sortHand。
assert(!/id="ddzSort"/.test(ui), '斗地主已移除理牌按钮 #ddzSort(不需要手动码牌)');
assert(!/arrangeMode/.test(ui) && !/customOrder/.test(ui), '斗地主已移除手动理牌态(arrangeMode/customOrder)');
assert(!/function startReorder\(/.test(ui) && !/function endReorder\(/.test(ui), '斗地主已移除拖排三段(startReorder/endReorder)');
assert(/function handOrder\(\)/.test(ui) && /Deck\.sortHand\(hand\)/.test(ui), 'handOrder 恒走 Deck.sortHand 自动理牌(与引擎发牌同序)');

// ── 步骤11: 手牌单排自适应(治开局 17~20 张两侧溢出屏外点不到) ──
// 斗地主原用固定 --hand-ov 叠放, 17 张在 390px 上首尾牌跑到屏幕外。对齐掼蛋 layoutHand 动态收紧。
assert(/function layoutHand\(/.test(ui), '存在 layoutHand(手牌单排自适应, 与掼蛋同源)');
assert(/\(W - cw\) \/ \(n - 1\)/.test(ui), 'layoutHand 按可用宽算步距(牌多自动收紧, 永不溢出)');
assert(/\.ddz-hand\{[^}]*flex-wrap:nowrap/.test(ui), '手牌 flex-wrap:nowrap(不换行, 单排)');
assert(/els\.hand\.appendChild\(el\);\s*\}\);\s*layoutHand\(\);/.test(ui), 'renderHand 末尾调用 layoutHand(渲染即排版)');
assert(/addEventListener\('resize', onResize\)/.test(ui) && /removeEventListener\('resize', onResize\)/.test(ui),
  'resize 重排手牌且关桌解绑(转屏自适应, 不泄漏监听)');

// ── 步骤12: 滑动选牌(主人反馈"不能滑动选牌") ──
// 斗地主原只逐张 click 单选, 现改与掼蛋同源的指针涂抹: 点=单选, 拖过整段=连选。
// 反回退: 逐张 click 选牌写法必须消失(否则又变回点一张才选一张、划不动)。
assert(/touch-action:none/.test(ui) && /\.ddz-hand\{[^}]*touch-action:none/.test(ui), '手牌 .ddz-hand touch-action:none(划选不被页面滚动打断)');
assert(/function paintTo\(/.test(ui) && /applyPaintIdx/.test(ui), '涂抹选牌: 按索引区间填充(拖过整段连选, 快拖不漏牌)');
assert(/els\.hand\.addEventListener\('pointerdown'/.test(ui) && /els\.hand\.addEventListener\('pointermove'/.test(ui), '手牌区绑 pointerdown/move 划选(挂容器一次, 不逐张)');
assert(!/el\.addEventListener\('click'[\s\S]{0,120}selected\.(add|delete)/.test(ui), '旧逐张 click 单选写法已移除(改指针涂抹, 治划不动)');
assert(/function handCardAt\([\s\S]{0,200}getBoundingClientRect/.test(ui) && !/function handCardAt\([\s\S]{0,80}elementFromPoint/.test(ui),
  'handCardAt 按 x 命中露出的那张(不用 elementFromPoint, 治叠放漏掉最左那张)');
assert(/el\.dataset\.idx = idx/.test(ui), '每张牌带 data-idx(划选连选补齐整段的依据)');

// ── #61 三家一致: 一副打完 onResult 不再标 done ──────────────
// 反回退: 曾在 onResult 里 set_state done, 导致「再来一局」(本机 newDeal 就地续桌)后 DB 却是 done →
// 唯一活桌索引被释放(可重复开桌) + 刷新/重连的 guest 翻到 done 进不来。改为只在房主收工 onExit 时 gtClose。
const GTL_DDZ = (src.match(/function gtLaunchDdz\(row\)\{[\s\S]*?\n\}/) || [''])[0];
assert(!/p_status:\s*'done'/.test(GTL_DDZ), 'gtLaunchDdz onResult 不再标 done(对齐德州 #58, 治重复开桌/刷新进不来)');
assert(/onExit:\(\)=>\{[^}]*gtClose\(row\.id\)/.test(GTL_DDZ), 'gtLaunchDdz 只在房主收工 onExit 时 gtClose 散桌(桌子随再来一局一直活着)');
// #61 座位越权加固: host 收到的 'act' 只认远程真人席; 伪造 host/AI/灵魂席动作被 remoteSeats 白名单拒
assert(/A\.remoteSeats\.indexOf\(payload\.seat\)<0\) return/.test(GTL_DDZ), 'gtLaunchDdz act 处理按 remoteSeats 白名单挡越权席(不代 host/AI/灵魂席出牌)');

console.log('\n✅ 斗地主旅程全部通过');
