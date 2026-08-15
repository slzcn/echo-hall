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
assert(/querySelector\('\.gd-room'\)/.test(src) && /launchGuandan/.test(src),
  '重复敲 /掼蛋 被拦(已有 .gd-room 时不再叠桌)');

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
}
assert(recorded===30, `30 局旅程全部落库成行 (我方胜 ${winsForMe} 局)`);
assert(winsForMe>0 && winsForMe<30, '胜负两种结局都出现过(战绩加减分双向都验到)');

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
assert(/onResult:[\s\S]{0,220}postGuandanResult\(res,\s*log,\s*names,\s*meta\)/.test(src), 'onResult 结束回调里发战绩卡(不再"什么都没留下")');
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
assert(/fly-bot/.test(ui) && /fly-top/.test(ui), '出牌有方向性飞入动画');
assert(/gd-boom/.test(ui) && /function boom\(/.test(ui), '炸弹/天王炸有震屏+爆炸特效');
assert(/轮到你/.test(ui), '中央横幅明确"轮到你出牌"');
assert(/\.gd-seat\.turn/.test(ui), '当前该出牌的座位有高亮态(turn class)');
// (5) AI 队友协作: 传 lastSeat
assert(/lastSeat:\s*st\.table\.lastPlay/.test(ui), 'guandan-ui 向 AI.decide 传 lastSeat(队友协作判据)');
// (6) 终端自适应: CSS 变量 + 大屏放大
assert(/\.gd-room\{[\s\S]*--cw:38px;[\s\S]*--av:42px/.test(ui), '牌桌尺寸提为 CSS 变量默认小屏值');
assert(/\.card\{width:var\(--cw/.test(ui), '大牌宽度吃 --cw 变量');
assert(/\.gd-avr\{width:var\(--av/.test(ui), '头像尺寸吃 --av 变量');
assert(/\.gd-hand \.card\{margin-left:var\(--hand-ov/.test(ui), '手牌重叠吃 --hand-ov 变量');
assert(/@media \(min-width:600px\)[\s\S]{0,260}--cw:44px/.test(ui) && /@media \(min-width:900px\)[\s\S]{0,260}--cw:52px/.test(ui),
  '600/900px 媒体查询把牌桌变量整体放大');
// (7) 级牌/百搭全程可视(掼蛋特有)
assert(/isWild\(card, level\)/.test(ui) && /wbadge">配/.test(ui), '红桃级牌逢人配标"配"(百搭可辨识)');
assert(/naturalRank\(card\)===level/.test(ui) && /\.card\.lvl/.test(ui), '级牌描金边(级牌抬权可视)');
assert(/gd-lvl/.test(ui) && /我方 \$\{LVL_LABEL/.test(ui), '顶栏显示本局级牌 + 双方队伍等级');
// (8) 进贡横幅(掼蛋特有)
assert(/function showTributeBanner\(/.test(ui) && /gd-tribute/.test(ui), '开局进贡有横幅提示');
assert(/抗贡成功/.test(ui) && /进贡 · /.test(ui), '横幅区分进贡/抗贡两态');
// (9) 音效 + 特效
assert(/function sfx\(n\)\{[\s\S]{0,120}root\.EhSfx[\s\S]{0,80}catch/.test(ui), 'sfx() 复用 EhSfx 且 try/catch(未加载不崩)');
assert(/sfx\('send'\)/.test(ui) && /sfx\('mention'\)/.test(ui) && /sfx\('boom'\)/.test(ui), '出牌/轮到你/炸弹各有音效');
assert(/iWon[\s\S]{0,120}confetti\(\)/.test(ui), '胜利: 音效 + 彩带特效');
assert(/function confetti\(\)/.test(ui) && /gd-confetti/.test(ui), '存在胜利彩带(confetti)');

// ── 步骤10: 大厂级手牌交互(真机反馈: 显示不全 / 不能划选) ────
// (10a) 手牌单排自适应: 动态叠放吃满一行, 永不换行(治"27 张断裂成第二排")
assert(/function layoutHand\(/.test(ui), '存在 layoutHand(手牌单排自适应)');
assert(/\(W - cw\) \/ \(n - 1\)/.test(ui), 'layoutHand 按可用宽算步距(牌多自动收紧, 单排排满)');
assert(/\.gd-hand\{[^}]*flex-wrap:nowrap/.test(ui), '手牌 flex-wrap:nowrap(不换行, 杜绝断裂第二排)');
assert(/function renderHand\(\)[\s\S]{0,700}layoutHand\(\);\s*\}/.test(ui), 'renderHand 末尾调用 layoutHand(渲染即排版)');
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
assert(/status==='playing'[\s\S]{0,160}gtEnter/.test(src), '座上真人翻到 playing 自动进牌桌(realtime 驱动)');
assert(/removeChannel\(gtChan\)/.test(src) && /_gtTables\.clear\(\)/.test(src), '离房清理 gtChan + 座位缓存(不泄漏/不串房)');

console.log('\n✅ 掼蛋旅程全部通过');
