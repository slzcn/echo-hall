#!/usr/bin/env node
'use strict';
/**
 * journey-guandan-play.js — 掼蛋完整用户旅程回归
 *
 * 用户旅程:
 *   1. 玩家在房间里敲 /掼蛋 → handleSlash 认得(不当普通消息发出去)
 *   2. 入室牌桌起局 → 4 席 2 队(0&2 我方 / 1&3 对方), 3 家 AI 用房里灵魂命名, 玩家坐 0 席
 *   3. 出牌轮转(级牌抬权/红桃级牌逢人配/接风) → 打到 3 家出完必分完整名次
 *   4. 结算落一行战绩: 含 seed + 完整 transition log(moves) → 可服务端复核/回看
 *   5. 战绩行 my_delta 与引擎结算一致; 名次/升级/双下自洽
 *   6. 再来一局延续对局: 上局名次触发进贡/还贡/抗贡, 赢队升级带入下一副
 *
 * 关键断言(反 anti-pattern「只测功能点不测旅程」):
 *   · 命令必须被 SLASH_CMDS 收录且 handleSlash 路由(否则玩家敲了没反应)
 *   · 记录行的 seed 能重放出同一个 result(否则回看/复核是假的)
 *   · 战绩卡编码→解码闭环字段序一致(否则卡渲染错乱)
 *   · UI 契约锁(入室化/倒计时/动效/轮次/级牌百搭/进贡横幅)防体验回退
 */
const fs = require('fs');
const path = require('path');
const Engine = require('../js/games/guandan-engine.js');
const AI = require('../js/games/guandan-ai.js');
const Rules = require('../js/games/guandan-rules.js');
const Net = require('../js/games/guandan-net.js');
const Deck = require('../js/games/deck.js');

function assert(ok, msg){ if(!ok) throw new Error('FAIL: '+msg); console.log('✓ '+msg); }

const APP_JS = path.join(__dirname, '..', 'js', 'app.js');
const src = fs.readFileSync(APP_JS, 'utf8');

// ── 步骤1: 命令已接入 ───────────────────────────────────────
assert(/\{c:'\/掼蛋'/.test(src), 'SLASH_CMDS 收录 /掼蛋(菜单可见)');
assert(/cmd==='\/掼蛋'/.test(src), "handleSlash 路由 /掼蛋 → launchGuandan");
assert(/async function launchGuandan\(\)/.test(src), 'launchGuandan 存在');
assert(/async function recordGuandanResult\(/.test(src), 'recordGuandanResult 存在(全记落库)');
assert(/game:'guandan'[\s\S]{0,600}moves:\s*log/.test(src), '掼蛋战绩写入 eh_game_results 且含 moves(回看数据源)');
assert(src.indexOf("cmd==='/掼蛋'") < src.lastIndexOf('return false'), '/掼蛋 分支在 return false 之前(不会被当普通消息)');
// 防重复开桌 + F1 融合: 开桌前走 _restoreActiveGameIfAny() —— 已有牌桌时不叠桌,
// 折叠态则展开回同一局, 否则提示先收工; 单桌约束斗地主/掼蛋共用一个守卫。
assert(/function _restoreActiveGameIfAny\(\)/.test(src), '存在 _restoreActiveGameIfAny(已有牌桌时的统一处置)');
assert(/querySelector\('\.ddz-room, \.gd-room, \.pk-room'\)/.test(src), '_restoreActiveGameIfAny 认得已开的斗地主/掼蛋/德州牌桌(单桌约束)');
assert(/if\(_restoreActiveGameIfAny\(\)\) return;/.test(src), '重复敲 /掼蛋 被拦(已有牌桌 → 展开或提示, 不再叠桌)');

// ── 步骤2-5: 起局 → 打到底 → 落一行战绩 ─────────────────────
function buildRow(res, log, names, souls){
  const soulUids = (souls||[]).map(s=>s&&s.user_id).filter(Boolean);
  const players = [0,1,2,3].map(seat=>({
    seat, name:names[seat], is_ai: seat!==0,
    uid: seat===0 ? 'me-uid' : (soulUids[seat-1]||null),
    team: seat%2,
  }));
  return {
    game:'guandan', seed: log[0] && log[0].seed || null,
    players,
    winner_seats: res.finishOrder.filter(s=> (s%2)===res.winnerTeam),
    loser_seats:  res.finishOrder.filter(s=> (s%2)!==res.winnerTeam),
    score:res.advance, spring:false, bombs:res.bombs,
    my_seat:0, my_delta:res.delta[0], my_won:res.winnerTeam===0,
    is_ai: players.map(p=>p.is_ai), is_ranked:false, moves:log,
  };
}

function playFull(seed, level, teamLevels, prevResult){
  let st = Engine.createGame({ seed, level, teamLevels,
    isAI:[false,true,true,true], names:['你','灵魂下','灵魂对','灵魂上'], prevResult });
  let g=0;
  while(st.phase==='play'){
    if(g++>3000) throw new Error('play loop @'+seed);
    const s=st.turn;
    const tgt=(st.table.lastPlay && st.table.lastPlay.seat!==s)?st.table.lastPlay.parse:null;
    const mv=AI.decide({ seat:s, hand:st.players[s].hand, tableParse:tgt,
      lastSeat: st.table.lastPlay?st.table.lastPlay.seat:null,
      handsLeft: st.players.map(p=>p.hand.length), level: st.level });
    try{
      if(mv.action==='pass') Engine.applyPass(st,s);
      else Engine.applyPlay(st,s,mv.cards);
    }catch(e){
      try{ Engine.applyPass(st,s); }
      catch(_){ Engine.applyPlay(st,s,AI.chooseLead(st.players[s].hand,st.level)); }
    }
  }
  return st;
}

const ALL = {}; Deck.doubleDeck().forEach(c=>ALL[c.id]=c);
let recorded=0, winsForMe=0;
for(let seed=100; seed<130; seed++){
  const st = playFull(seed, 2, [2,2]);
  const names=['你','灵魂下','灵魂对','灵魂上'];
  const souls=[{user_id:'soul-1',name:'灵魂下'},{user_id:'soul-2',name:'灵魂对'},{user_id:'soul-3',name:'灵魂上'}];
  const row = buildRow(st.result, st.log, names, souls);
  recorded++;

  if(!(row.seed!=null)) throw new Error('seed missing @'+seed);
  if(!(Array.isArray(row.moves)&&row.moves.length>3)) throw new Error('moves too short @'+seed);
  if(!(row.is_ai[0]===false && row.is_ai[1]===true && row.is_ai[2]===true && row.is_ai[3]===true)) throw new Error('is_ai wrong @'+seed);
  if(row.my_won && row.my_delta<=0) throw new Error('赢了但加分<=0 @'+seed);
  if(!row.my_won && row.my_delta>=0) throw new Error('输了但没扣分 @'+seed);
  if(row.winner_seats.length!==2 || row.loser_seats.length!==2) throw new Error('每队 2 人自洽 @'+seed);
  if(row.my_won) winsForMe++;

  // seed+moves 重放 → 与记录行完全一致(回看/复核为真)
  const rp = Engine.replay(st.log);
  if(rp.result.delta[0] !== row.my_delta) throw new Error('重放 my_delta 不一致 @'+seed);
  if(JSON.stringify(rp.result.finishOrder)!==JSON.stringify(st.result.finishOrder)) throw new Error('重放名次不一致 @'+seed);
  if(rp.result.advance!==st.result.advance) throw new Error('重放升级量不一致 @'+seed);

  // ── 收局残局(对标腾讯"亮残牌"): result.reveal = 各家终局剩牌 id。掼蛋只末游非空, 头/二/三游已出完 ──
  const rev = st.result.reveal;
  if(!rev) throw new Error('result 缺 reveal(残局数据) @'+seed);
  for(const p of st.players){
    const ids = rev[p.seat]||[];
    if(ids.length !== p.hand.length) throw new Error(`残局 reveal[${p.seat}] 张数(${ids.length})≠该家剩牌(${p.hand.length}) @`+seed);
    if(ids.some(id=>!ALL[id])) throw new Error(`残局 reveal[${p.seat}] 含非法牌 id @`+seed);
  }
  // 出完的家残牌空, 未出完的非空。双下即终局 → 前2名(同队)出完、后2名(败方)留牌; 常规 → 前3名出完、末游留牌。
  const expectEmpty = st.result.doubleDown ? 2 : 3;
  const emptied = st.players.filter(p=>(rev[p.seat]||[]).length===0).length;
  if(emptied !== expectEmpty) throw new Error(`出完家数(${emptied})≠终局期望(${expectEmpty}, dd=${st.result.doubleDown}) @`+seed);
  st.result.finishOrder.forEach((s,i)=>{
    const empty=(rev[s]||[]).length===0;
    if(i<expectEmpty && !empty) throw new Error(`第${i+1}名(席${s})应已出完(残牌为空) @`+seed);
    if(i>=expectEmpty && empty) throw new Error(`第${i+1}名(席${s})应未出完(留牌) @`+seed);
  });
}
assert(recorded===30, `30 局旅程全部落库成行 (我方胜 ${winsForMe} 局)`);
assert(winsForMe>0 && winsForMe<30, '胜负两种结局都出现过(战绩加减分双向都验到)');

// ── 收局残局 · 联机脱敏命门: reveal 只在终局 result 里, 对局中快照永不下发 ──────────
{
  const st = playFull(100, 2, [2,2]);
  const overSnap = Net.snapshot(st, 1);
  assert(overSnap.result && overSnap.result.reveal, '终局脱敏快照 result 携带 reveal(guest 结算可见末游残牌)');
  assert(Net.assertNoLeak(overSnap).ok, '终局快照仍不外泄 手牌/seed/log(reveal 在 result 内, 不触发泄漏门)');
  const midSt = Engine.createGame({ seed:100, isAI:[false,true,true,true], names:['你','灵魂下','灵魂对','灵魂上'] });
  const midSnap = Net.snapshot(midSt, 1);
  assert(midSnap.result === null, '对局中快照 result=null(残牌绝不在牌局进行时下发)');
  assert(Net.assertNoLeak(midSnap).ok, '对局中快照不外泄任何手牌(残牌命门守住)');
}
console.log('✓ 收局残局数据流 + 脱敏命门(reveal 仅终局可见, 局中零外泄)');

// ── 步骤6: 再来一局延续对局(进贡/升级带入下一副) ───────────
let sawTribute=false, sawLevelUp=false, chainGames=0;
{
  let level=2, teamLevels=[2,2], prev=null;
  for(let seed=300; seed<316; seed++){
    const st = playFull(seed, level, teamLevels, prev);
    const res = st.result;
    chainGames++;
    // 进贡流程被触发(第二副起有上局结果)
    if(prev){
      if(st.tribute===null) throw new Error('有上局结果却没进贡流程 @'+seed);
      sawTribute=true;
      // 进贡+还贡后仍守恒: 各家 27 张、总 108
      const total = st.players.reduce((n,p)=>n+p.hand.length,0);
      // 注: 打完后手牌已出光, 这里只能验起手守恒 → 用重放起局态验
      const rp = Engine.replay(st.log);
      // 重放能复现终局即证明进贡转移被 log 完整记录
      if(JSON.stringify(rp.result.finishOrder)!==JSON.stringify(res.finishOrder)) throw new Error('含进贡的重放不一致 @'+seed);
    }
    // 升级带入: 赢队等级应 = min(14, before+advance)
    if(res.teamLevelsAfter[res.winnerTeam] > res.teamLevelsBefore[res.winnerTeam]) sawLevelUp=true;
    // 下一副延续态
    if(res.matchWon){ level=2; teamLevels=[2,2]; prev=null; }
    else { teamLevels=res.teamLevelsAfter.slice(); level=teamLevels[res.nextDealerTeam];
      prev={ finishOrder:res.finishOrder.slice(), winnerTeam:res.winnerTeam }; }
  }
}
assert(chainGames===16, `连续对局链 16 副全部推进(延续升级/进贡)`);
assert(sawTribute, '第二副起进贡流程被触发(进贡/还贡/抗贡)');
assert(sawLevelUp, '赢队等级随名次上升(升级带入下一副)');

// ── 步骤7: 起手守恒(进贡后各家仍 27 张、总 108) ─────────────
{
  const prev = { finishOrder:[0,2,1,3], winnerTeam:0 };  // 双下
  const st = Engine.createGame({ seed:99, level:2, teamLevels:[2,2], dealerTeam:0,
    isAI:[false,true,true,true], prevResult: prev });
  assert(st.tribute!==null, '有上局结果 → 起局即触发进贡');
  if(!st.tribute.refused){
    assert(st.players.every(p=>p.hand.length===27), '进贡+还贡后各家仍 27 张(守恒)');
    assert(st.players.reduce((n,p)=>n+p.hand.length,0)===108, '进贡后总牌数仍 108');
  }
}

// ── 步骤8: 和聊天融合(开桌=牌桌卡入室 + 结束战绩卡 + 再来一局) ───────
// 开桌不再静默/只留一行, 而是开一张【联机牌桌】并把牌桌卡发进聊天室, 全房可见可加入。
assert(/rpc\('eh_gt_open'/.test(src), '/掼蛋 开桌走 eh_gt_open(建联机牌桌, 非本地单机)');
assert(/kind:'game'[\s\S]{0,80}buildMsgEl/.test(src) || /text[\s\S]{0,60}EHTable\.encode\(row\.id/.test(src),
  '开桌把牌桌卡(kind:game, game|gt)发进聊天室(全房可见)');
assert(/rpc\('eh_gt_set_msg'/.test(src), '回填牌桌卡消息 id(eh_gt_set_msg, 供定位刷新)');
assert(/async function postGuandanResult\(/.test(src), '存在 postGuandanResult(结束后发战绩卡)');
assert(/onResult:[\s\S]{0,260}postGuandanResult\(res,\s*log,\s*(?:A\.)?names,\s*meta\)/.test(src), 'onResult 结束回调里发战绩卡(不再"什么都没留下")');
assert(/postGuandanResult[\s\S]{0,700}kind:'game'/.test(src), '战绩卡以 kind:game 落库(走消息流, 全房可见)');
// 编码 → 解码闭环: 生产 text 编码字段序与 buildGameEl 的 gd 分支解码字段序一致
assert(/\['game','gd',\s*win,\s*res\.advance,\s*fromLvl,\s*toLvl,\s*res\.doubleDown\?1:0,\s*res\.matchWon\?1:0,\s*myRankIdx,\s*res\.bombs\|\|0,\s*mateName\]/.test(src),
  'postGuandanResult 编码字段序固定(win|advance|fromLvl|toLvl|doubleDown|matchWon|myRankIdx|bombs|mateName)');
assert(/if\(ev==='gd'\)/.test(src), 'buildGameEl 有 gd 分支(把战绩卡渲染回来)');
assert(/data-gd-again/.test(src), '战绩卡含"再来一局"入口(data-gd-again)');
assert(/again\.onclick=[\s\S]{0,120}launchGuandan\(\)/.test(src), '"再来一局"点击直接开新局');
assert(/p\[1\]==='gd'[\s\S]{0,120}掼蛋/.test(src), '消息预览把 gd 卡显示成"🎴 掼蛋 · 胜/负"(不露原始 game|gd| 编码)');

// ── 步骤9: 牌桌 UX 契约(入室化/倒计时/动效/轮次/级牌百搭/进贡) ─
const UI_JS = path.join(__dirname, '..', 'js', 'games', 'guandan-ui.js');
const ui = fs.readFileSync(UI_JS, 'utf8');

// (1) 入室化
assert(/getElementById\('hall'\)/.test(ui), '牌桌优先挂进聊天室 #hall(入室牌桌)');
assert(/\.gd-room\{position:absolute/.test(ui), '牌桌用 absolute 铺满房间(非全屏遮罩)');
// (2) 倒计时兜底
assert(/HUMAN_PLAY_MS/.test(ui), '定义人类出牌回合时限');
assert(/function armTurn\(/.test(ui) && /onHumanTimeout/.test(ui), '每回合武装倒计时 + 人类超时兜底');
assert(/超时 · 自动不出/.test(ui) && /超时 · 自动出牌/.test(ui), '到点自动过/自动出(不卡死)');
assert(/requestAnimationFrame\(tick\)/.test(ui), '倒计时环用 rAF 平滑驱动');
// (3) 动效 + (4) 轮次感
assert(/function flyPlayToCenter\(/.test(ui) && /gd-fly-card/.test(ui) && /\.land\{animation:gdLand/.test(ui),
  '出牌从出牌人头像掷向桌心(幽灵牌飞入 + 牌堆 land 延后淡入)');
assert(/gd-boom/.test(ui) && /function boom\(/.test(ui), '炸弹/天王炸有震屏+爆炸特效');
assert(/轮到你/.test(ui), '中央横幅明确"轮到你出牌"');
assert(/\.gd-seat\.turn/.test(ui), '当前该出牌的座位有高亮态(turn class)');
// (5) AI 队友协作: 传 lastSeat
assert(/lastSeat:\s*st\.table\.lastPlay/.test(ui), 'guandan-ui 向 AI.decide 传 lastSeat(队友协作判据)');
// (6) 终端自适应: CSS 变量 + 大屏放大
assert(/\.gd-room\{[\s\S]*--cw:38px;[\s\S]*--av:42px/.test(ui), '牌桌尺寸提为 CSS 变量默认小屏值');
assert(/\.card\{width:var\(--cw/.test(ui), '大牌宽度吃 --cw 变量');
assert(/\.gd-avr\{width:var\(--av/.test(ui), '头像尺寸吃 --av 变量');
assert(/\.gd-hand-row \.card\{margin-left:var\(--hand-ov/.test(ui), '手牌重叠吃 --hand-ov 变量(两排各自叠放)');
assert(/@media \(min-width:600px\)[\s\S]{0,260}--cw:44px/.test(ui) && /@media \(min-width:900px\)[\s\S]{0,260}--cw:52px/.test(ui),
  '600/900px 媒体查询把牌桌变量整体放大');
// (7) 级牌/百搭全程可视(掼蛋特有)
assert(/isWild\(card, level\)/.test(ui) && /wbadge">配/.test(ui), '红桃级牌逢人配标"配"(百搭可辨识)');
assert(/naturalRank\(card\)===level/.test(ui) && /\.card\.lvl/.test(ui), '级牌描金边(级牌抬权可视)');
assert(/gd-lvl/.test(ui) && /我方 <b>\$\{LVL_LABEL/.test(ui), '顶栏显示本局级牌 + 双方队伍等级');
assert(/lv-now[^"]*">🎯 打 \$\{LVL_LABEL/.test(ui) && /gdLvlBump/.test(ui), '当前打几做成醒目金牌 + 升级跳动(对标大厂级牌位)');
// (8) 进贡横幅(掼蛋特有)
assert(/function showTributeBanner\(/.test(ui) && /gd-tribute/.test(ui), '开局进贡有横幅提示');
assert(/抗贡成功/.test(ui) && /进贡 · /.test(ui), '横幅区分进贡/抗贡两态');
assert(/function flyTributeCard\(/.test(ui) && /gd-fly-card/.test(ui), '进贡贡牌从进贡席飞向收贡席(对标欢乐掼蛋进贡桥段)');
// (8b) 还贡可视化(Batch2): 横幅同摆进贡+还贡两条, 还贡牌飞回原主 —— 进贡→还贡闭环看得见
assert(/还贡/.test(ui) && /t\.back/.test(ui), '进贡横幅含还贡行(t.back 存在则赢家还一张回输家)');
assert(/flyTributeCard\(t\.to,\s*t\.from,\s*findCardById\(t\.back\)/.test(ui), '还贡牌从收贡席飞回进贡席(闭环动效)');
assert(/back:\(x\.back==null\?null:x\.back\)/.test(fs.readFileSync(path.join(__dirname,'..','js','games','guandan-net.js'),'utf8')),
  'guandan-net.sanitizeTribute 透传 back(联机 guest 也能看还贡)');
// (8c) 接风提示(Batch2, 掼蛋特有规则): 引擎收圈带出 controller/jiefeng; UI 仅在队友接出时轻横幅"XX 接风"
const gdEng = fs.readFileSync(path.join(__dirname,'..','js','games','guandan-engine.js'),'utf8');
assert(/return \{ ok:true, trickEnd:true, leader, controller, jiefeng \}/.test(gdEng),
  'applyPass 收圈返回带 controller/jiefeng(controller 走完时 lastPlay 已清, 随返回带出供 UI 播报)');
assert(/function jiefengBanner\(/.test(ui) && /gd-jiefeng/.test(ui), '存在接风横幅(队友接出下一手时轻提示, 不震屏)');
assert(/r\.trickEnd && r\.jiefeng[\s\S]{0,80}jiefengBanner/.test(ui),
  'afterMove 仅真·接风(jiefeng)时提示且在 renderAll 之后(普通赢圈不打扰, 且不被整段重建吞掉)');
// (8d) 台面牌型标注(Batch2): 落牌区直接标这手的牌型名(免玩家自己数牌辨型)
assert(/typeLabel\(lp\.parse\)/.test(ui), '台面落牌标注牌型(renderTable 读 lp.parse → typeLabel)');
// (8e) 在场气泡时序(Batch2): say() 延一帧写, 躲过 renderSeats 整段重建(与斗地主/德州同源修法)
assert(/function say\(seat, msg\)\{[\s\S]*?requestAnimationFrame\(/.test(ui),
  'say() 延一帧写气泡(不出/报单气泡躲过 renderSeats 重建, 真正上屏)');
// (9) 音效 + 特效
assert(/function sfx\(n\)\{[\s\S]{0,120}root\.EhSfx[\s\S]{0,80}catch/.test(ui), 'sfx() 复用 EhSfx 且 try/catch(未加载不崩)');
assert(/sfx\('cardplay'\)/.test(ui) && /sfx\('yourturn'\)/.test(ui) && /sfx\('boom'\)/.test(ui) && /sfx\('deal'\)/.test(ui) && /sfx\('pass'\)/.test(ui), '牌桌专属音效: 出牌拍击/轮到你/炸弹/发牌/过牌各有音');
assert(/iWon\)\{[\s\S]{0,200}sfx\('sparkle'\)[\s\S]{0,120}confetti\(\)/.test(ui), '胜利: 音效 + 彩带特效');
assert(/function confetti\(\)/.test(ui) && /gd-confetti/.test(ui), '存在胜利彩带(confetti)');
// (9b) 收局体验(对标腾讯): 结算亮末游残牌 + 丝滑接下一副(反回退"只显示名次""打下一副瞬拆硬切")
assert(/gd-remains/.test(ui) && /res\.reveal/.test(ui), '结算面板渲染残局(读 result.reveal 亮末游剩牌)');
assert(/\.gd-over\.out\{animation:gdOverOut/.test(ui) && /over\.classList\.add\('out'\)/.test(ui),
  '打下一副先淡出下沉(.gd-over.out 过渡)再重建, 不瞬拆硬切');
assert(/over\.addEventListener\('animationend'/.test(ui) && /setTimeout\(once,\s*\d+\)/.test(ui),
  '过渡用 animationend 推进 + setTimeout 兜底(动画被打断也不卡在战报页)');
assert(/if\s*\(over\._leaving\)\s*return/.test(ui), '打下一副按钮防连点(过渡中重复点被吞, 不重复开副)');
assert(/reveal:\s*res\.reveal\s*\?/.test(fs.readFileSync(path.join(__dirname,'..','js','games','guandan-net.js'),'utf8')),
  'guandan-net.sanitizeResult 透传 reveal(联机 guest 结算可见残局)');

// ── 步骤10: 大厂级手牌交互(真机反馈: 显示不全 / 不能划选) ────
// (10a) 手牌自适应: 每排动态叠放吃满一行、行内永不换行(治"27 张断裂"); 上下两排是玩家手动理牌所分, 非布局失控换行
assert(/function layoutHand\(/.test(ui), '存在 layoutHand(手牌自适应)');
assert(/\(W - cw - nGap \* GAP\) \/ \(n - 1\)/.test(ui), 'layoutRow 按可用宽算步距(扣掉组间留白后牌多自动收紧, 每排排满)');
// (10a+) 智能组牌理牌(对标腾讯欢乐掼蛋分组显示): 短按 #gdSort 在 大小↔组牌 循环; 组间留白让分堆可见
assert(/arrangeGroups/.test(fs.readFileSync(path.join(__dirname,'..','js','games','guandan-ai.js'),'utf8')),
  'guandan-ai 有 arrangeGroups(整手贪心拆成成型牌型组, 纯展示用)');
assert(/sortMode\s*===?\s*'combo'/.test(ui) && /EHGuandanAI\.arrangeGroups/.test(ui),
  'orderedRows 组牌模式走 AI.arrangeGroups 分堆(否则回退大小排)');
assert(/grp-start/.test(ui) && /GAP/.test(ui),
  'layoutRow 给每组首张额外留白 GAP(分堆可见)');
assert(/\.gd-hand-row\{[^}]*flex-wrap:nowrap/.test(ui), '每排 flex-wrap:nowrap(行内不换行, 杜绝布局失控断裂)');
assert(/function renderHand\(\)[\s\S]{0,2200}layoutHand\(\);\s*\}/.test(ui), 'renderHand 末尾调用 layoutHand(渲染即排版)');
// (Batch3) 增量护栏: 手牌结构(id序/回合锁/理牌态/级牌/发牌帧)未变即不重建; 仅选牌变 → 只切 .sel 类(升降走 transform 丝滑)
assert(/const structSig = \(myTurn\?1:0\)[\s\S]{0,260}bot\.map\(c=>c\.id\)\.join/.test(ui) && /if \(structSig === lastHandSig\)/.test(ui),
  'guandan renderHand 按结构签名跳过整段重建(手牌/回合锁/理牌态/级牌/发牌帧 未变则不重建)');
assert(/if \(selSig !== lastSelSig\)[\s\S]{0,240}classList\.toggle\('sel'/.test(ui),
  'guandan 选牌变化只切 .sel 类不整段重建(点牌升降走 CSS transform 丝滑)');
assert(/addEventListener\('resize', onResize\)/.test(ui) && /removeEventListener\('resize', onResize\)/.test(ui),
  'resize 时重排手牌且关桌时解绑(转屏/分屏自适应, 不泄漏监听)');
// (10b) 划选: 指针涂抹式多选(治"不能划过连选")
assert(/pointerdown/.test(ui) && /pointermove/.test(ui) && /pointerup/.test(ui), '手牌绑定 pointer 事件(可拖动)');
assert(/function paintTo\(/.test(ui) && /applyPaintIdx/.test(ui), '涂抹选牌: 按索引区间填充(拖过整段连选, 快拖不漏牌)');
assert(/paintMode = selected\.has\([\s\S]{0,40}\? 'deselect' : 'select'/.test(ui), '按下即按当前态决定涂选/涂消(反复拖动可增可减)');
assert(/\.gd-hand\{[^}]*touch-action:none/.test(ui), '手牌 touch-action:none(拖选不被页面滚动打断)');
assert(/setPointerCapture/.test(ui), '拖选用 setPointerCapture(拖出牌面也不断)');
// (10c) 选牌实时牌型反馈 + 炸弹按钮
assert(/function typeLabel\(/.test(ui) && /同花顺/.test(ui) && /钢板/.test(ui), '选牌牌型中文名映射(单张/对子/顺子/钢板/同花顺/天王炸)');
assert(/boom-ready/.test(ui) && /isBoomType/.test(ui), '出牌按钮: 炸弹类型变红发光(boom-ready)');
assert(/btn\.innerHTML = boom \?[\s\S]{0,120}出 <span class="bt">/.test(ui), '出牌按钮报出牌型("出 · 顺子")');
// (10d) 剩牌告警(残局紧张感)
assert(/p\.hand\.length<=2/.test(ui) && /gd-tag alarm">⚠ 报牌/.test(ui), '任一玩家 ≤2 张时座位报牌告警');
assert(/\.gd-seat\.alarm/.test(ui), '报牌座位有告警高亮态(alarm class)');
// (10e) 牌桌氛围底(治大片空白)
assert(/\.gd-center::before/.test(ui) && /radial-gradient\(ellipse/.test(ui), '中央有牌桌氛围底(空白变桌面)');

// ── 步骤11: 真人联机牌桌(座位大厅 + 实时同步 + host 权威开局) ────────
// 治"真人加入不了/开桌是单机"。座位状态存 eh_game_tables, 一切写走 eh_gt_* RPC, 卡按实时行渲染。
const TN_JS = path.join(__dirname, '..', 'js', 'games', 'table-net.js');
const tn = fs.readFileSync(TN_JS, 'utf8');
// (11a) 牌桌卡模块: 编码/解码闭环 + 座位渲染
assert(/root\.EHTable\s*=/.test(tn), 'table-net 挂出 window.EHTable(牌桌卡模块)');
assert(/function encode\([\s\S]{0,120}'game','gt'/.test(tn), 'EHTable.encode 产出 game|gt|id|game 文本(与 buildGameEl 解码同序)');
assert(/function renderLobby\(/.test(tn) && /gt-seat/.test(tn), '存在 renderLobby 渲染 4 席牌桌卡');
assert(/ctx\.actions\.join\(/.test(tn) && /ctx\.actions\.seatSoul\(/.test(tn) && /ctx\.actions\.start\(/.test(tn),
  '空位有「加入」/host「邀请灵魂」/「开始」动作(接 ctx.actions)');
assert(/\.onclick=/.test(tn) && !/addEventListener\(/.test(tn), '卡内按钮用 .onclick(不叠 addEventListener, 护住密度门)');
// 反回退: 座位区必须单列纵向。曾因 2 列(每列~145px)塞不下 头像+名+灵魂下拉+踢人钮 → host 视角横向溢出 81px 被截。
assert(/\.gt-teams\{[^}]*flex-direction:column/.test(tn), '座位区单列纵向(gt-teams column)——防两列挤爆截断灵魂下拉/长名');
// (11b) app.js 接线: 开桌/座位 RPC + realtime 同步 + host 开局
assert(/'eh_gt_join'/.test(src) && /'eh_gt_leave'/.test(src) && /'eh_gt_seat_soul'/.test(src)
  && /'eh_gt_kick'/.test(src) && /'eh_gt_start'/.test(src) && /'eh_gt_close'/.test(src),
  '座位六动作全接 eh_gt_* RPC(join/leave/seat_soul/kick/start/close)');
assert(/async function setupGameTables\(/.test(src), '进房建 setupGameTables(联机牌桌订阅)');
assert(/channel\('room-gt:'[\s\S]{0,200}table:'eh_game_tables'/.test(src), 'realtime 订阅 eh_game_tables 座位/局态变化');
assert(/function gtRenderCard\(/.test(src) && /data-gt-id/.test(src), '座位变化就地重绘牌桌卡(按 data-gt-id 定位, 不新增监听)');
assert(/if\(ev==='gt'\)/.test(src), "buildGameEl 有 gt 分支(把牌桌卡渲染回来)");
assert(/function gtLaunchLocal\(/.test(src) && /EHGuandanGame\.open/.test(src), 'host 权威: 开始后本机跑引擎开局(gtLaunchLocal)');
assert(/status==='playing'[\s\S]{0,260}gtEnter/.test(src), '座上真人翻到 playing 自动进牌桌(realtime 驱动)');
assert(/removeChannel\((?:gtChan|leavingGtChan)\)/.test(src) && /_gtTables\.clear\(\)/.test(src), '离房清理 gtChan + 座位缓存(不泄漏/不串房)');

// ── 步骤12: 座位参数化(联机地基: 真人可坐非 0 席, DOM 槽位绕 mySeat 旋转) ──
// 治"联机把别人座位画在我的位置/队友判断错位"。单机 mySeat=0 时旋转恰为 1/2/3, 行为不变。
assert(/opts\.mySeat/.test(ui), 'mySeat 可由 opts 传入(联机真人坐非 0 席)');
assert(/SEAT_L\s*=\s*\(mySeat\+1\)%4/.test(ui) && /SEAT_T\s*=\s*\(mySeat\+2\)%4/.test(ui) && /SEAT_R\s*=\s*\(mySeat\+3\)%4/.test(ui),
  '座位槽位绕 mySeat 相对旋转·顺时针(下家+1 落左/队友+2 上/上家+3 落右)');
assert(/seatHTML\(SEAT_T\)/.test(ui) && /seatHTML\(SEAT_L\)/.test(ui) && /seatHTML\(SEAT_R\)/.test(ui),
  'renderSeats 用旋转后槽位(非写死 1/2/3)');
// newDeal 读可变的 seatIsAI(初值 = opts.isAI.slice()); 招募态 startDeal 就地改 seatIsAI 元素 → 换名册后重发牌仍按座位实况标人/机(与斗地主 gameIsAI 同构)。
assert(/let seatIsAI\s*=\s*\(opts\.isAI/.test(ui), 'seatIsAI 初值取自 opts.isAI(host 按座位实况标人/机)');
assert(/isAI:\s*seatIsAI/.test(ui), 'newDeal 吃 seatIsAI(可变副本, startDeal 就地换座后重发牌一致)');

// ── 步骤13: 理牌(一键自动 + 手动拖排 + 上下两排码牌) — 提示体验不输腾讯 ──
// #gdSort 一个按钮: 短按=一键理牌(按级牌大小), 长按=进手动拖排模式自由码牌。
// 掼蛋手牌多(27 张), 主人反馈"要能上下放置": 手动理牌里可把牌拖到上排/下排分成两排码。
assert(/id="gdSort"[\s\S]{0,40}理牌/.test(ui), '手牌区有理牌按钮(#gdSort)');
assert(/function autoSort\(\)/.test(ui) && /function setArrange\(/.test(ui), '一键自动理牌 autoSort + 手动模式切换 setArrange 并存');
assert(/function orderedRows\(\)/.test(ui) && /Rules\.sortHand\(hand,\s*st\.level\)/.test(ui), 'orderedRows: 默认按级牌 Rules.sortHand 自动理牌全在下排(级牌抬权入序)');
assert(/if \(rows\)\{/.test(ui), '手动理牌后按玩家排定的两排 {top,bot} id 顺序摆(rows 优先于自动)');
// 两排渲染: gd-hand 竖排容器内两个 gd-hand-row(上/下), 卡片带全局阅读序 data-idx 供划选连选
assert(/gd-hand-row top/.test(ui) && /gd-hand-row bot/.test(ui), 'renderHand 建上/下两个 gd-hand-row 排');
assert(/\.gd-hand\{[^}]*flex-direction:column/.test(ui), '.gd-hand 竖排布局(容纳上下两排)');
assert(/function layoutRow\(/.test(ui) && /function layoutHand\(\)\{[\s\S]*?for \(const row of els\.hand\.children\) layoutRow/.test(ui),
  '每排各自 layoutRow 动态收紧叠放(两排独立排满不溢出)');
assert(/if\(arrangeMode\)\{ startReorder\(e\); return; \}/.test(ui), '手动模式下 pointerdown 走拖排而非划选(共用手牌指针管道)');
assert(/function startReorder\(/.test(ui) && /function moveReorder\(/.test(ui) && /function endReorder\(/.test(ui),
  '拖排三段: 起拖/移动/落位(复用划选的 pointer 基建)');
// 落位: y 判上/下排(下排上沿为界), x 判排内插入位; 上排空时有虚线投放区提示可分两排
assert(/const target = dropY < boundary \? 'top' : 'bot'/.test(ui), '落位按放下点 y 判上/下排(拖到上方=上排)');
assert(/dropX < r\.left \+ r\.width\/2/.test(ui), '落位按放下点与各牌中线判定排内插入位(所见即所得)');
assert(/\.gd-hand\.arranging \.gd-hand-row\.top:empty\{/.test(ui), '理牌态空上排显示虚线投放区(引导拖牌分成两排)');
assert(/rowAt\(y\)/.test(ui), 'handCardAt 先按 y 命中所在排再按 x 命中露出的那张(两排划选/拖牌都对)');
assert(/setArrange\(!arrangeMode\)/.test(ui), '长按≥350ms 切手动理牌模式(与一键共用一个按钮)');
assert(/rows=null; if\(arrangeMode\) setArrange\(false\);/.test(ui), '再来一局重置理牌态(不带旧两排序进新副)');

// ── #61 三家一致: 一副打完 onResult 不再标 done ──────────────
// 反回退: 曾在 onResult 里 set_state done, 导致「打下一副」(本机 newDeal 就地续桌)后 DB 却是 done →
// 唯一活桌索引被释放(可重复开桌) + 刷新/重连的 guest 翻到 done 进不来。改为只在房主收工 onExit 时 gtClose。
const GTL_GD = (src.match(/function gtLaunchGuandan\(row\)\{[\s\S]*?\n\}/) || [''])[0];
assert(!/p_status:\s*'done'/.test(GTL_GD), 'gtLaunchGuandan onResult 不再标 done(对齐德州 #58, 治重复开桌/刷新进不来)');
assert(/onExit:\(\)=>\{[^}]*gtClose\(row\.id\)/.test(GTL_GD), 'gtLaunchGuandan 只在房主收工 onExit 时 gtClose 散桌(桌子随打下一副一直活着)');
// #61 座位越权加固: host 收到的 'act' 只认远程真人席; 伪造 host/AI/灵魂席动作被 remoteSeats 白名单拒
assert(/A\.remoteSeats\.indexOf\(payload\.seat\)<0\) return/.test(GTL_GD), 'gtLaunchGuandan act 处理按 remoteSeats 白名单挡越权席(不代 host/AI/灵魂席出牌)');

console.log('\n✅ 掼蛋旅程全部通过');
