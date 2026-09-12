// ============================================================
// journey-exempt: pure perf optimization for poker table (resize rAF throttle + render sig guards, no behavior change)
// poker-ui.js — 德州扑克绒面牌桌 UI（入室牌桌 · 椭圆桌位 · 底池/公共牌 · 全局意识 AI 陪玩）
// ------------------------------------------------------------
// 依赖(浏览器全局): EHPokerEngine / EHPokerAI （evaluate/deck 由引擎内部注入）
// 对外: window.EHPokerGame.open({ names, avatars, isAI, mySeat, seed, startStack, sb, bb, chat, onBeat, onResult, mount })
//   · 纯前端: 真人坐 mySeat, 其余席位由「全局意识」AI(5 灵魂性格)驱动。引擎跑浏览器。
//   · 牌桌挂进 #hall(入室牌桌, 非全屏): 房间"变成"牌桌, 返回即回聊天(折叠成活牌桌片, 牌局不销毁)。
//   · 椭圆桌: 我固定坐底, 对手沿上弧分布; 中央底池 + 公共牌; 各家身前显本街投入筹码。
//   · 逐街(翻/转/河)自动发公共牌带翻牌动画; 到自己行动亮倒计时环, 超时自动过牌/弃牌。
//   · 操作: 弃牌 / 过牌 / 跟注 / 下注·加注(滑杆 + ½池/池/全下快捷)。摊牌翻底牌 + 报成手牌型。
//   · 一手打完带结算(赢池/输光), "再来一局"延续筹码 + 轮庄; 有人筹码归零则出局, 不足两人自动重新带入。
//   · onResult(result, log, meta) 交给聊天室写战绩 + 直播播报。
// ------------------------------------------------------------
// 真人联机(host 权威, 见 poker-net.js): 同一份 open() 三种角色 ——
//   · local(默认): 真人坐 mySeat, 其余 AI, 引擎全在本机;
//   · host: opts.remoteSeats 交给远程真人(不由 AI 代打, host 侧兜底超时代打); 每步 opts.onSync(state,handNo)
//     让 app.js 产出脱敏快照广播 + 写各家底牌; 收到远程动作调 applyMove(seat,move) 经引擎权威校验;
//   · guest(opts.mode='guest'): 不跑引擎, applySnapshot(snap) 收公共快照 + feedHand(cards) 收自己底牌,
//     渲染伪状态; 自己出牌走 opts.onAction(move) 发回 host, 绝不本地改权威态。
// ============================================================
(function(root){
  'use strict';
  const Engine = root.EHPokerEngine, AI = root.EHPokerAI, Eval = root.EHPokerEval;

  const HUMAN_ACT_MS = 20000;
  // 灵魂"思考→出手"时长: 2.2~7s 人类般节奏(旧 0.9~1.8s 太快, 环刚亮就消失像"从1s起")。
  //   这是真正出手的时刻; 座位倒计时环另按满格 ACT_MS 显示(见 armTurn turnDur), 到点前出手→环随回合切换重置。
  const AI_MIN_MS = 2200, AI_JIT_MS = 4800;
  const STREET_PAUSE_MS = 650;   // 一街下注结束 → 发下一街前的停顿(让筹码归池动画走完)

  // journey-exempt: 单机德州每日输光上限为新增独立功能(localStorage 计数+封盘页), 需连输 5 局才触发,
  //   现有 journey harness 无法在一趟内造出 5 次真人输光; 防重入守卫(res._bustCounted)是纯幂等保护, 无跨会话旅程。
  // ── 单机德州每日输光上限(主人要求): 一天最多输光 5 次, 到顶当天不能再玩, 次日自动重置。
  //   只约束"单机陪玩"(isLocalSolo): 练习桌无限补带太廉价, 加个每日心跳让输赢有分量。
  //   联机/客人局不受限(真人对局由房主掌控, 破产另有离桌语义)。存 localStorage, 按本地日期归零。
  const PK_DAILY_MAX = 5;
  const PK_DAILY_KEY = 'eh_pk_daily_bust';
  function pkToday(){ const d=new Date(); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
  function pkBustsToday(){
    try{ const o=JSON.parse(localStorage.getItem(PK_DAILY_KEY)||'null');
      if(o && o.date===pkToday() && typeof o.n==='number') return o.n; }catch(_){}
    return 0;
  }
  function pkAddBust(){
    const n = pkBustsToday()+1;
    try{ localStorage.setItem(PK_DAILY_KEY, JSON.stringify({date:pkToday(), n})); }catch(_){}
    return n;
  }
  function pkLimitReached(){ return pkBustsToday() >= PK_DAILY_MAX; }

  const CSS_ID = 'pk-ui-css';
  function injectCSS(){
    if (document.getElementById(CSS_ID)) return;
    const s = document.createElement('style'); s.id = CSS_ID;
    s.textContent = `
.pk-room{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;overflow:hidden;
  background:linear-gradient(180deg,var(--bg2,#0d1524),var(--bg,#070a12));border-radius:inherit;
  animation:pkRoomIn .22s cubic-bezier(.2,.9,.3,1);
  --cw:34px;--ch:48px;--cn:12px;--cs:10px;--cc:18px;--bcw:38px;--bch:54px;
  --av:44px;--avf:20px;--seatw:78px;--chip:11px;--maxw:none}
@media (min-width:600px) and (min-height:620px){
  .pk-room{--cw:40px;--ch:56px;--cn:14px;--cs:11px;--cc:21px;--bcw:44px;--bch:62px;
    --av:52px;--avf:24px;--seatw:96px;--chip:12px;--maxw:620px}}
@media (min-width:900px) and (min-height:700px){
  .pk-room{--cw:46px;--ch:64px;--cn:16px;--cs:12px;--cc:25px;--bcw:52px;--bch:73px;
    --av:60px;--avf:28px;--seatw:120px;--chip:13px;--maxw:780px}}
@media (min-width:1000px) and (min-height:760px){
  .pk-room{--cw:52px;--ch:73px;--cn:18px;--cs:13px;--cc:29px;--bcw:58px;--bch:82px;
    --av:74px;--avf:34px;--seatw:140px;--chip:14px;--maxw:860px}
  .pk-felt{justify-content:center}}
/* 横屏(手机侧持/⟳ 旋转态, 由 JS 挂 .is-land): 又宽又矮, 收紧上下留白, 操作区压扁不再顶出屏 —— 座位弧另在 positionSeats 里放宽横向半径 */
.pk-room.is-land{--av:38px;--avf:18px;--seatw:74px;--cw:32px;--ch:38px;--cn:11px;--cs:9px;--cc:17px;--bcw:30px;--bch:42px}
.pk-room.is-land .pk-bar{padding-top:calc(4px + env(safe-area-inset-top,0px));padding-bottom:4px}
.pk-room.is-land .pk-felt{overflow:visible}
.pk-room.is-land .pk-table{top:4px;bottom:4px}
.pk-room.is-land .pk-me{padding:2px max(16px,env(safe-area-inset-right,0px)) 0 max(16px,env(safe-area-inset-left,0px));gap:12px}
/* 横屏动作栏: 左右内边距兜 safe-area(刘海横屏在两侧) —— 否则最外侧按钮会缩进刘海/圆角被切角 */
.pk-room.is-land .pk-acts{gap:5px;padding:5px max(14px,env(safe-area-inset-right,0px)) calc(6px + env(safe-area-inset-bottom,0px)) max(14px,env(safe-area-inset-left,0px))}
.pk-room.is-land .pk-raise input[type=range]{height:18px}
.pk-room.is-land .pk-b{padding:9px 0;font-size:14px}
.pk-room.is-land .pk-qbtn{padding:4px 0}
/* ── 横屏矮 felt(高~200px)防挤压专项: 6-max 椭圆 + 桌心 + 我的大底牌纵向本会互叠, 这里把各块压扁/横排/挪位 ── */
/* 桌心: 仍走列布局(池组在上·公共牌横排在下, 标准德州), 但压紧 + 去"轮到谁"文字(交给底部提示条)。
   ★不可改 flex-direction:row —— 全下出多个边池 pill 时会把横排宽度吃光, 公共牌(flex-wrap:wrap)被挤到
     右侧空间不足→竖向叠成一列铺满屏(实测崩)。故边池改横排省纵向、公共牌强制 nowrap 永不竖叠。 */
.pk-room.is-land .pk-center{top:58%;gap:3px;width:auto;max-width:90%}
.pk-room.is-land .pk-msg{display:none}
.pk-room.is-land .pk-pot{font-size:11px;padding:2px 8px}
.pk-room.is-land .pk-pots{flex-direction:row;flex-wrap:wrap;justify-content:center;gap:4px;margin:0;width:auto}
.pk-room.is-land .pk-board{flex-wrap:nowrap}
/* 对手: 底牌背隐去(悬头像下会压桌心公共牌; 弃牌仍以灰显表达), 名/筹码贴紧收短整列高度 */
.pk-room.is-land .pk-seat:not(.pk-me-seat){gap:1px}
.pk-room.is-land .pk-seat:not(.pk-me-seat) .pk-mini-hole{display:none}
/* 摊牌牌型标签(.pk-mini-hn "一对/两对/三条")横屏也隐去: 它给对手列多加 ~11px, 矮 felt 里把顶席顶进
   标题栏、侧位相邻两席挤触(2~4px); 摊底牌本就随 .pk-mini-hole 隐了, 标签成孤儿, 赢家牌型另有中央公告。 */
.pk-room.is-land .pk-seat:not(.pk-me-seat) .pk-mini-hn{display:none}
/* 本桌累计盈亏徽标(.pk-net "本桌 ±N")对手席横屏隐去: 第2手起每席多这一行(~11px), 是跨手撑高对手列、
   把顶席顶进标题栏/侧位互叠的真凶(单手测不到)。逐席净额结算面板 .pk-nets 里全有; 我的横向座位 net 内联不撑高, 保留。 */
.pk-room.is-land .pk-seat:not(.pk-me-seat) .pk-net{display:none}
/* 我的座位: 横向排(头像|名/筹码|正面底牌 一排), 列高 ~134→~54px, 坐桌底不再顶穿到桌心/动作栏 */
.pk-room.is-land .pk-me-seat{flex-direction:row;align-items:center;gap:9px;width:auto}
.pk-room.is-land .pk-me-seat .nm{max-width:76px}
.pk-room.is-land .pk-my-hole{margin-top:0}
/* 竖屏美化(手机窄屏): 原 .pk-table 用 top/bottom:9px 撑满整列高度, 椭圆被抻成长蛋——
   上弧座位+公共牌全堆在顶部, 下半个绿肚皮空(因"我"坐在 felt 下方的 pk-me 条, 桌底本无人)。
   这里把桌面收成一个比例匀称的椭圆并竖直居中(操作钮仍钉底、"我"贴其上), 座位/公共牌走 %
   定位随桌高等比缩放, 不再被拉长。.pk-room 前缀提特异性以压过后面定义的基础 .pk-table 规则。 */
@media (max-width:599px){
  /* height 用 min(理想椭圆高, felt高-上下留白): 短屏(小机 + 灵动岛顶栏吃掉 ~107px)时 felt 变矮,
     原来的定高 clamp 会撑破 felt 顶把上弧座位顶到标题栏底下(=主人反馈的"牌桌顶部遮挡")。
     min 兜底后桌面永不超出 felt, 居中留出上下等距空隙, 顶座位始终在栏下方有呼吸位。 */
  .pk-room .pk-table{top:50%;bottom:auto;height:min(clamp(360px,58vh,500px),calc(100% - 20px));transform:translateY(-50%)}
}
@keyframes pkRoomIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.pk-bar{display:flex;align-items:center;gap:10px;flex-shrink:0;border-bottom:1px solid var(--line,rgba(0,229,212,.24));
  padding:calc(11px + env(safe-area-inset-top,0px)) max(15px,env(safe-area-inset-right,0px)) 11px max(15px,env(safe-area-inset-left,0px))}
.pk-title{font-weight:800;letter-spacing:.06em;color:var(--ink,#eaf6ff);font-size:15px;display:flex;align-items:center;gap:8px;white-space:nowrap;flex-shrink:0}
.pk-title .dot{width:8px;height:8px;border-radius:50%;background:var(--accent,#00e5d4);box-shadow:var(--glow-cyan)}
/* 盲注牌: 不做胶囊, 当"印在绒台上的字"——低透明白 + 一道暗压印阴影, 像真牌桌把盲注刻在台面上, 只当角落背景信息不抢戏。
   钉在 felt 左上角, 竖横屏该角都空(座位在 15%~29% / 10%~38% 处), 不压座位/公共牌。z-index 压到 0 让卡牌/座位盖在其上。 */
.pk-blinds{position:absolute;top:8px;left:max(12px,env(safe-area-inset-left,0px));z-index:0;font-size:12px;letter-spacing:.1em;color:rgba(234,246,255,.32);font-weight:800;white-space:nowrap;pointer-events:none;text-shadow:0 1px 0 rgba(0,0,0,.4)}
html[data-mode="day"] .pk-blinds{color:rgba(4,54,50,.34);text-shadow:0 1px 0 rgba(255,255,255,.5)}
.pk-room.is-land .pk-blinds{top:6px;font-size:11px}
/* 顶栏功能钮组(三游戏统一·磨砂玻璃圆钮): 音乐/横屏圆钮 + 返回胶囊, 悬浮青光, 按压回弹; 横屏态 ⟳ 亮青 */
.pk-mus,.pk-rot{width:36px;height:36px;border-radius:50%;flex-shrink:0;cursor:pointer;
  display:flex;align-items:center;justify-content:center;font-size:15px;color:var(--sub,#86cbc6);
  border:1px solid var(--line,rgba(0,229,212,.24));
  background:linear-gradient(160deg,rgba(255,255,255,.06),rgba(0,0,0,.18));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 2px 6px rgba(0,0,0,.28);
  transition:transform .14s cubic-bezier(.2,.85,.3,1),color .14s,border-color .14s,box-shadow .14s}
.pk-mus{margin-left:auto}
.pk-mus:hover,.pk-rot:hover{color:var(--ink,#eaf6ff);border-color:var(--accent,#00e5d4);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 4px 12px rgba(0,0,0,.32),0 0 14px rgba(0,229,212,.35)}
.pk-mus:active,.pk-rot:active,.pk-x:active{transform:scale(.9)}
.pk-mus.muted{color:var(--dim,#498d88);opacity:.8}
.pk-rot.on{color:var(--accent,#00e5d4);border-color:var(--accent,#00e5d4);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 0 14px rgba(0,229,212,.5)}
.pk-x{height:36px;padding:0 14px;border-radius:999px;flex-shrink:0;cursor:pointer;
  display:flex;align-items:center;gap:5px;font-size:13px;font-weight:600;color:var(--sub,#86cbc6);
  border:1px solid var(--line,rgba(0,229,212,.24));
  background:linear-gradient(160deg,rgba(255,255,255,.06),rgba(0,0,0,.18));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 2px 6px rgba(0,0,0,.28);
  transition:transform .14s cubic-bezier(.2,.85,.3,1),color .14s,border-color .14s,box-shadow .14s}
.pk-x:hover{color:#ff8a94;border-color:rgba(255,93,108,.55);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 4px 12px rgba(0,0,0,.32),0 0 14px rgba(255,93,108,.3)}
/* 窄屏(手机 <380px)顶栏防溢出: 收紧间距/边距 + 「✕ 返回」收成纯图标, 给盲注 chip 让位, 杜绝返回钮被挤出屏 */
@media (max-width:379px){
  .pk-bar{gap:6px;padding-left:max(10px,env(safe-area-inset-left,0px));padding-right:max(10px,env(safe-area-inset-right,0px))}
  .pk-title{font-size:14px}
  .pk-x{padding:0 9px}
  .pk-x .pk-xlbl{display:none}
}
/* 牌桌绒面 */
.pk-felt{flex:1;position:relative;display:flex;flex-direction:column;min-height:0;max-width:var(--maxw,none);width:100%;margin:0 auto;box-sizing:border-box;overflow:hidden}
.pk-felt.shake{animation:pkShake .42s cubic-bezier(.36,.07,.19,.97)}
@keyframes pkShake{10%,90%{transform:translateX(-1px)}30%,50%,70%{transform:translateX(-3px)}40%,60%{transform:translateX(3px)}}
.pk-table{position:absolute;left:3%;right:3%;top:9px;bottom:9px}
/* 绒面椭圆: 三游戏统一"真牌桌"材质(绿绒 radial + 实心暗边 + 青描边), 形状各随布局。★与斗地主/掼蛋 .*-center::before 同一套配方 */
/* 夜间: 更饱和的翡翠绒 —— 亮心 → 深绿绒 → 暗青边缘晕影, 叠一层极淡青雾光, 桌面从"灰蛋"变"真绿呢台面"。 */
.pk-table::before{content:'';position:absolute;left:4%;right:4%;top:6%;bottom:6%;border-radius:50%/46%;
  background:radial-gradient(ellipse 66% 58% at 50% 40%,rgba(20,160,142,.46),rgba(9,92,86,.5) 52%,rgba(4,34,36,.72) 100%);
  border:2px solid rgba(0,229,212,.22);
  box-shadow:inset 0 3px 42px rgba(0,0,0,.5),inset 0 0 70px rgba(0,229,212,.06),0 0 30px rgba(0,229,212,.09)}
/* 内圈亮唇边: 台面边缘的一道细高光, 让椭圆有"绒台+围边"的立体层次(对标真实牌桌的皮质围边) */
.pk-table::after{content:'';position:absolute;left:4%;right:4%;top:6%;bottom:6%;border-radius:50%/46%;pointer-events:none;
  box-shadow:inset 0 0 0 1px rgba(0,229,212,.14),inset 0 1px 0 rgba(255,255,255,.06)}
/* 日间: 深绿绒在浅底上会成"灰蛋", 换清透薄荷绒(亮心→淡翡翠边)+ 青描边, 桌面清透不压眼且明显是"绿台" */
html[data-mode="day"] .pk-table::before{
  background:radial-gradient(ellipse 66% 58% at 50% 40%,rgba(150,232,214,.62),rgba(0,168,154,.24) 54%,rgba(0,120,110,.16) 100%);
  border-color:rgba(0,127,118,.3);box-shadow:inset 0 2px 26px rgba(0,80,74,.1),0 10px 30px rgba(0,127,118,.1)}
html[data-mode="day"] .pk-table::after{box-shadow:inset 0 0 0 1px rgba(255,255,255,.5),inset 0 1px 0 rgba(255,255,255,.7)}
/* 中央: 底池 + 公共牌
 * ★上移到 40%(椭圆几何中心 CY≈46 之上): "我"已摆上椭圆底部(270°), 底部两侧翼席(210°/-30°)落在 ~63%,
 *   旧的 top:52% 让底池/公共牌/提示与这两个下翼席的头像糊在一起(主人反馈"中间区域被遮挡")——见探针实测。
 *   而顶席(90°)到中心之间是大片空绒面。上移后底池+公共牌独占这块上中方空白, 下翼席让开, 层次分明。
 *   (下注筹码现按席摆各家身前 ccy=CY+(cy-CY)*0.62, 不再中心汇聚, 故不复"糊在一起"的老问题。) */
.pk-center{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:3;width:88%}
.pk-pot{font-size:13px;color:var(--amber,#ffc24d);font-weight:800;letter-spacing:.03em;display:flex;align-items:center;gap:6px;
  background:rgba(4,10,14,.5);border:1px solid rgba(255,194,77,.35);border-radius:999px;padding:3px 12px;white-space:nowrap}
.pk-pot .pc{width:11px;height:11px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe08a,#e0a020);box-shadow:0 1px 2px rgba(0,0,0,.4)}
.pk-board{display:flex;gap:5px;min-height:var(--ch,48px);align-items:center;justify-content:center;flex-wrap:wrap}
.pk-board .card.flip-in{animation:pkFlip .34s cubic-bezier(.2,.9,.3,1) both}
@keyframes pkFlip{from{transform:rotateY(90deg) scale(.8);opacity:0}to{transform:none;opacity:1}}
.pk-msg{font-size:12px;color:var(--sub);min-height:14px;text-align:center}
.pk-msg.mine{color:var(--ink);font-weight:800;text-shadow:0 0 8px rgba(0,229,212,.75);border-radius:999px;background:linear-gradient(90deg,rgba(0,229,212,.26),rgba(0,229,212,.05));animation:pkTurnPulse 1.05s ease-in-out infinite}
/* 轮到自己行动: 提示条化作发光脉冲胶囊(halo+微缩放, 纯 box-shadow/transform 不改盒模型→不引入跳动) */
@keyframes pkTurnPulse{0%,100%{box-shadow:inset 0 0 0 1px rgba(0,229,212,.35),0 0 6px rgba(0,229,212,.3);transform:scale(1)}50%{box-shadow:inset 0 0 0 1px rgba(0,229,212,.7),0 0 16px 3px rgba(0,229,212,.55);transform:scale(1.04)}}
/* 座位(对手, 绝对定位于上弧) */
.pk-seat{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:2px;width:var(--seatw,78px);z-index:4}
.pk-seat.folded{opacity:.4;filter:grayscale(.7)}
.pk-avr{width:var(--av,44px);height:var(--av,44px);border-radius:50%;display:grid;place-items:center;padding:3px;box-sizing:border-box;position:relative;transition:background .15s}
.pk-seat.turn .pk-avr{background:conic-gradient(from -90deg,var(--accent,#00e5d4) calc(var(--p,360)*1deg),var(--line,rgba(0,229,212,.18)) 0)}
.pk-avr .av{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:var(--avf,20px);background:var(--panel-solid,#132a29);border:1.5px solid var(--line2);position:relative}
/* 行动席发光改脉冲(对齐 ddz/掼蛋): 静态发光扫一眼抓不住"轮到谁", 脉冲把眼睛拉过去 */
.pk-seat.turn .pk-avr .av{box-shadow:0 0 14px var(--accent,rgba(0,229,212,.6));animation:pkSeatTurn 1.1s ease-in-out infinite}
@keyframes pkSeatTurn{0%,100%{box-shadow:0 0 10px 1px var(--accent,rgba(0,229,212,.5))}50%{box-shadow:0 0 20px 5px var(--accent,rgba(0,229,212,.9))}}
/* 回合秒数徽标: 只在当前行动席(含对手)头像右下角亮, 让"轮到谁、还剩几秒"看得见 */
.pk-sec{position:absolute;right:-4px;bottom:-4px;min-width:16px;height:16px;padding:0 3px;box-sizing:border-box;border-radius:8px;background:var(--panel-solid,#132a29);border:1px solid var(--amber,#ffc24d);color:var(--amber,#ffc24d);font-size:9px;font-weight:800;line-height:14px;text-align:center;font-variant-numeric:tabular-nums;display:none;z-index:5}
.pk-seat.turn .pk-sec{display:block}
.pk-sec.urgent{border-color:var(--magenta,#ff2d8e);color:var(--magenta,#ff2d8e);animation:pkBlink .6s steps(2,start) infinite}
@keyframes pkBlink{50%{opacity:.35}}
/* 本机 AI(灵魂)无硬死线: 显"思考中"💭 脉冲而非误导性数字倒计时(对齐 ddz/掼蛋 + 状态忠实) */
.pk-sec.think{border-color:var(--dim,#498d88);color:var(--sub,#86cbc6);font-size:10px;animation:pkThink 1.15s ease-in-out infinite}
@keyframes pkThink{0%,100%{opacity:.5}50%{opacity:1}}
.pk-seat.win .pk-avr .av{border-color:var(--amber,#ffc24d);box-shadow:0 0 16px var(--amber,rgba(255,194,77,.7))}
.pk-btn-d{position:absolute;right:-6px;bottom:-4px;width:18px;height:18px;border-radius:50%;background:#fff;color:#111;font-size:10px;font-weight:900;display:grid;place-items:center;box-shadow:0 1px 3px rgba(0,0,0,.5);z-index:5}
/* 小盲/大盲席位角标(对标腾讯: 盲位一眼看清)。摆头像左下, 与右下的 D 标错开。SB 蓝、BB 橙。 */
.pk-btn-bl{position:absolute;left:-6px;bottom:-4px;min-width:18px;height:15px;padding:0 3px;box-sizing:border-box;border-radius:7px;font-size:9px;font-weight:900;letter-spacing:.02em;display:grid;place-items:center;box-shadow:0 1px 3px rgba(0,0,0,.45);z-index:5;white-space:nowrap}
.pk-btn-bl.sb{background:#4aa3ff;color:#06233f}
.pk-btn-bl.bb{background:var(--amber,#ffc24d);color:#3a2600}
.pk-btn-bl.inline{position:static;box-shadow:none}
/* 翻后实时成手 chip(对标腾讯牌力提示): 我的底牌+公共牌当前最佳成手名, 常驻名字行 */
.pk-made{font-size:11px;font-weight:800;letter-spacing:.02em;color:var(--accent,#00e5d4);background:rgba(0,229,212,.1);border:1px solid rgba(0,229,212,.28);border-radius:999px;padding:1px 8px;white-space:nowrap}
.pk-seat .nm{font-size:11px;color:var(--sub);max-width:var(--seatw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-seat.turn .nm{color:var(--accent);font-weight:700}
.pk-seat .stk{font-size:11px;color:var(--dim,#498d88);font-variant-numeric:tabular-nums}
.pk-seat .stk b{color:var(--ink)}
.pk-seat.allin .stk b{color:var(--magenta,#ff2d8e)}
/* all-in 高亮: 头像描品红脉冲环 + 醒目 ALL IN 角标(对标德州扑克的全下标识) */
.pk-seat.allin .pk-avr .av{border-color:var(--magenta,#ff2d8e);box-shadow:0 0 14px rgba(255,45,142,.6);animation:pkAllinRing 1.2s ease-in-out infinite}
@keyframes pkAllinRing{0%,100%{box-shadow:0 0 10px rgba(255,45,142,.45)}50%{box-shadow:0 0 18px rgba(255,45,142,.85)}}
.pk-allin-tag{position:absolute;left:50%;top:-10px;transform:translateX(-50%);font-size:9px;font-weight:900;letter-spacing:.08em;
  color:#fff;background:linear-gradient(150deg,#ff4d6d,#e0263e);border:1px solid #ff96a8;border-radius:6px;padding:1px 5px;
  white-space:nowrap;z-index:6;box-shadow:0 2px 8px rgba(255,45,142,.5);animation:pkAllinPulse 1.1s ease-in-out infinite}
@keyframes pkAllinPulse{0%,100%{transform:translateX(-50%) scale(1)}50%{transform:translateX(-50%) scale(1.12)}}
/* 边池拆分: 主池 + 边池并排(有 all-in 分层时显示) */
.pk-potpart{display:inline-flex;align-items:center;padding:1px 7px;border-radius:999px;background:rgba(255,194,77,.1);
  border:1px solid rgba(255,194,77,.26);white-space:nowrap;margin-left:4px}
.pk-potpart.side{color:var(--sub,#8fb6b1);background:rgba(156,133,255,.1);border-color:rgba(156,133,255,.28)}
/* 结算边池明细 */
.pk-pots{display:flex;flex-direction:column;gap:3px;width:100%;margin:2px 0}
.pk-potline{display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 10px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid var(--line,rgba(0,229,212,.14))}
.pk-potline .pl-t{color:var(--sub,#8fb6b1);font-weight:700;min-width:44px}
.pk-potline .pl-a{color:var(--amber,#ffc24d);font-weight:900;font-variant-numeric:tabular-nums}
.pk-potline .pl-w{color:var(--ink,#eaf6ff);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 入座序列: 未到场的灵魂=虚位(虚线头像+呼吸); 刚落座=弹入 */
.pk-seat.arriving{opacity:.5}
.pk-seat.arriving .av{background:transparent;border:1.5px dashed var(--line2,rgba(0,229,212,.4));animation:pkSeatWait 1.2s ease-in-out infinite}
.pk-seat.arriving .stk{color:var(--dim,#498d88);font-style:italic}
@keyframes pkSeatWait{0%,100%{opacity:.45}50%{opacity:.9}}
.pk-seat.pk-justseated{animation:pkSeatPop .42s cubic-bezier(.2,.9,.3,1)}
@keyframes pkSeatPop{from{transform:translate(-50%,-50%) scale(.5);opacity:0}to{transform:translate(-50%,-50%) scale(1);opacity:1}}
.pk-cd{font-size:11px;opacity:.85;font-variant-numeric:tabular-nums}
.pk-mini-hole{display:flex;gap:2px;margin-top:1px;min-height:1px}
.pk-mini-hole .card{margin:0}
/* "我"的桌底座位(pk-me-seat): 底牌正面朝上, 比对手牌背大且带花色可读; 头像点青光 + 名字点青, 一眼认出"这是你" */
.pk-me-seat .pk-avr .av{box-shadow:0 0 0 2px var(--accent,#00e5d4),0 0 12px rgba(0,229,212,.35)}
.pk-me-seat .nm{color:var(--accent,#00e5d4);font-weight:800}
/* "我"的底牌: 放大到可读尺寸, 去掉角标花色(.cs)——30px 小牌上"角标rank+角标花色+居中大花色"三元素挤成一坨(主人反馈"元素都叠一起了");
 *   只留【左上角 rank + 居中大花色】= 干净的标准读法, 两张牌间距也拉开。 */
.pk-my-hole{--cw:38px;--ch:52px;--cn:17px;--cc:24px;gap:7px;margin-top:2px}
.pk-my-hole .card{box-shadow:0 3px 8px rgba(0,0,0,.5)}
.pk-my-hole .card .cn{top:3px;left:5px}
.pk-my-hole .card .cs{display:none}
.pk-say{position:absolute;top:calc(var(--av,44px) + 2px);font-size:11px;color:var(--ink);background:var(--panel-solid,#132a29);border:1px solid var(--line);border-radius:10px;padding:3px 8px;max-width:140px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:8;white-space:nowrap}
.pk-say.show{opacity:1}
/* 身前投入筹码(朝中央) */
.pk-commit{position:absolute;transform:translate(-50%,-50%);z-index:3;display:flex;align-items:center;gap:4px;
  font-size:11px;font-weight:800;color:var(--ink);background:rgba(4,10,14,.6);border:1px solid rgba(255,194,77,.4);border-radius:999px;padding:1px 8px;white-space:nowrap;font-variant-numeric:tabular-nums}
.pk-commit .pc{width:9px;height:9px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe08a,#e0a020)}
.pk-commit.zero{display:none}
/* 飞行筹码(街结束身前筹码扫入底池 / 结算底池归赢家) —— 对标大厂"筹码归池/推池"手感 */
.pk-flychip{position:absolute;transform:translate(-50%,-50%);z-index:6;pointer-events:none;will-change:transform,opacity}
.pk-flychip .pc{display:block;width:12px;height:12px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe08a,#e0a020);box-shadow:0 1px 3px rgba(0,0,0,.5),0 0 4px rgba(255,194,77,.4)}
.pk-flychip.collect{animation:pkChipFly .42s cubic-bezier(.45,.05,.4,1) forwards}
.pk-flychip.payout{animation:pkChipFly .5s cubic-bezier(.3,.6,.35,1) forwards}
@keyframes pkChipFly{
  0%{opacity:0;transform:translate(-50%,-50%) scale(.5)}
  18%{opacity:1;transform:translate(-50%,-50%) scale(1)}
  100%{opacity:.15;transform:translate(calc(-50% + var(--dx,0px)),calc(-50% + var(--dy,0px))) scale(.7)}
}
.pk-pot.bump{animation:pkPotBump .42s ease}
@keyframes pkPotBump{0%,100%{transform:scale(1)}38%{transform:scale(1.22);text-shadow:0 0 10px rgba(255,194,77,.7)}}
/* 结算浮层带推池动画时: 前 ~330ms 保持透明, 让底池筹码在可见绒面上飞向赢家, 之后再淡入盖住 */
.pk-over.payout-in{animation:pkOverPayoutIn .58s ease both}
@keyframes pkOverPayoutIn{0%,56%{opacity:0}100%{opacity:1}}
/* 桌面赢家横幅(单机常规手替代结算弹窗): 居中一行, 弹入停留→随自动发牌淡出。z 低于卡牌高亮, 不挡摊牌牌面。
   ★top 从 14% 下移到 26%: 14% 正压顶部中央席(对手数为奇数时 deg=90 那席落在 cx50%/cy14%),
   摊牌时横幅与该席头像/名字/气泡重叠(实测重叠~11px)。26% 落在"顶席气泡(~18%)"与"公共牌区(~40%)"之间的空档, 两不相撞。 */
.pk-winline{position:absolute;left:50%;top:26%;transform:translateX(-50%);z-index:8;pointer-events:none;
  font-size:14px;font-weight:900;letter-spacing:.03em;color:var(--ink,#eaf6ff);white-space:nowrap;
  padding:7px 18px;border-radius:999px;background:linear-gradient(180deg,rgba(19,42,41,.92),rgba(6,12,18,.9));
  border:1px solid var(--line2,rgba(0,229,212,.4));box-shadow:0 6px 22px rgba(0,0,0,.5),0 0 18px rgba(0,229,212,.18);
  backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:pkWinIn .34s cubic-bezier(.2,.9,.3,1) both}
.pk-winline.win{color:var(--amber,#ffc24d);border-color:rgba(255,194,77,.5);box-shadow:0 6px 22px rgba(0,0,0,.5),0 0 22px rgba(255,194,77,.28)}
.pk-winline.out{animation:pkWinOut .24s ease forwards}
html[data-mode="day"] .pk-winline{color:var(--ink,#0c312e);background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(234,244,244,.92));border-color:var(--line2,rgba(0,127,118,.42));box-shadow:0 6px 20px rgba(0,127,118,.16),0 0 14px rgba(0,127,118,.1)}
html[data-mode="day"] .pk-winline.win{color:var(--amber,#C8892E);border-color:rgba(200,137,46,.55);box-shadow:0 6px 20px rgba(0,127,118,.16),0 0 18px rgba(200,137,46,.22)}
@keyframes pkWinIn{from{opacity:0;transform:translateX(-50%) translateY(-8px) scale(.9)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
@keyframes pkWinOut{to{opacity:0;transform:translateX(-50%) translateY(-6px) scale(.96)}}
/* 卡牌 */
.card{width:var(--cw,34px);height:var(--ch,48px);border-radius:6px;background:#fff;position:relative;flex:none;
  box-shadow:0 2px 5px rgba(0,0,0,.4);border:1px solid rgba(0,0,0,.08);user-select:none;font-family:"SF Pro Rounded","SF Pro Display",-apple-system,"PingFang SC","Helvetica Neue",Arial,sans-serif}
.card.red{color:#e0263e}.card.blk{color:#1a1e28}
.card .cn{position:absolute;top:2px;left:3px;font-size:var(--cn,12px);font-weight:800;line-height:1}
.card .cs{position:absolute;top:15px;left:4px;font-size:var(--cs,10px);line-height:1}
.card .cc{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:var(--cc,18px);opacity:.92}
.card.mini{width:16px;height:22px;border-radius:3px}.card.mini .cn{font-size:8px;top:1px;left:2px}.card.mini .cs{display:none}.card.mini .cc{display:none}
.card.big{width:var(--bcw,38px);height:var(--bch,54px)}.card.big .cn{font-size:calc(var(--cn,12px) + 3px)}.card.big .cc{font-size:calc(var(--cc,18px) + 5px)}.card.big .cs{top:19px}
/* 正面统一: 桌上牌向"我的底牌"看齐 —— 只留角标 rank + 中央大花色, 隐去角标小花色(cs)。
   原先公共牌/亮牌是 rank+小花色+中央花色三标记堆一起(角标处尤挤), 且与早已隐 cs 的我的底牌不一致 →
   隐去 cs 后全场正面同一套"rank 角标 + 花色浮雕水印", 既统一又不拥挤(主人报: 风格不一致 / 正面拥挤)。 */
.pk-room .card .cs{display:none}
/* 盖着的牌(对手底牌)统一走 table-shared.css 的"同副牌·白纸青花背" —— 此处不再各画一套深色背, 免"两种牌背"分叉。 */
/* 公共牌未发的位置: 主人要求"这五张的背面用发给玩家那种" → 直接沿用 table-shared 的白纸青花背(与对手盖牌同一副),
   不再画成虚线空槽; 仅整体略降透明(dim)表示"还没翻到", 翻牌时逐张 flip-in 亮出正面。
   (不再自绘背景/边框/::after, 让共享的 .pk-room .card.back 白底+青花面板透出。) */
.pk-room .pk-board .card.back.dim{opacity:.6}
.card.dim{opacity:.5}
/* 我的座位条 */
.pk-me{display:flex;align-items:center;gap:12px;padding:4px 16px 0;flex-shrink:0}
.pk-me .pk-hole{display:flex;gap:6px}
.pk-me .pk-hole .card.justdealt{animation:pkDeal .34s ease both}
@keyframes pkDeal{from{transform:translateY(30px) scale(.7);opacity:0}to{transform:none;opacity:1}}
/* 发牌动画: 新一手每张底牌"从桌心上方飞落"入座, 按真实发牌序(SB 起绕圈发两轮)错峰 → 补齐"发牌过程"(主人: 每局缺发牌过程/动画)。
   对手是牌背、我是正面, 同一套落座动画; 由 runDealAnim() 逐张挂 animation-delay。一次性(both), 本手内重渲不再触发(dealAnim 门控)。 */
.pk-seat .pk-mini-hole .card.pk-dealing{animation:pkDealIn .32s cubic-bezier(.2,.85,.3,1) both}
@keyframes pkDealIn{from{opacity:0;transform:translateY(-40px) scale(.42) rotate(-7deg)}55%{opacity:1}to{opacity:1;transform:none}}
.pk-me .pk-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.pk-me .pk-nmrow{display:flex;align-items:center;gap:7px}
.pk-me .pk-nm{font-size:14px;font-weight:800;color:var(--ink);max-width:40vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-me .pk-nm.turn{color:var(--accent)}
.pk-me .pk-stk{font-size:13px;color:var(--amber);font-weight:800;font-variant-numeric:tabular-nums}
.pk-me .pk-hint{font-size:11px;color:var(--sub);min-height:14px}
.pk-me .pk-hint b{color:var(--accent)}
.pk-me .pk-clk{font-variant-numeric:tabular-nums;color:var(--amber);font-weight:800;margin-left:6px}
.pk-me .pk-clk.urgent{color:var(--magenta,#ff2d8e);animation:pkBlink .6s steps(2,start) infinite}
@keyframes pkBlink{50%{opacity:.35}}
/* 操作区 */
.pk-acts{display:flex;flex-direction:column;gap:8px;padding:8px 14px calc(11px + env(safe-area-inset-bottom,0px));flex-shrink:0}
.pk-raise{display:flex;align-items:center;gap:9px}
.pk-raise.hidden{display:none}
/* ★.reserved: 隐藏但【保留高度】(visibility 非 display) —— 操作条骨架恒定, 滑杆/快捷不显示时也占位, 按钮行不上下跳(主人反馈"按钮别跳来跳去") */
.pk-raise.reserved,.pk-quick.reserved{visibility:hidden}
/* 加注滑杆: 自定义细轨 + 圆钮(原生 accent-color 在日间浅底会渲成刺眼黑条——主人反馈)。
 *   已投入部分用 --accent 填充(syncAmt 写 --fill 百分比), 未填充走中性灰轨, 日/夜都干净。 */
.pk-raise input[type=range]{-webkit-appearance:none;appearance:none;flex:1;height:32px;background:transparent;cursor:pointer;margin:0}
.pk-raise input[type=range]::-webkit-slider-runnable-track{height:8px;border-radius:999px;border:1px solid var(--line2);
  background:linear-gradient(90deg,var(--accent,#00e5d4) var(--fill,0%),var(--sl-track,rgba(127,127,127,.22)) var(--fill,0%))}
.pk-raise input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:22px;height:22px;margin-top:-8px;border-radius:50%;
  background:var(--accent,#00e5d4);border:2px solid var(--panel-solid,#fff);box-shadow:0 1px 5px rgba(0,0,0,.35)}
.pk-raise input[type=range]::-moz-range-track{height:8px;border-radius:999px;border:1px solid var(--line2);background:var(--sl-track,rgba(127,127,127,.22))}
.pk-raise input[type=range]::-moz-range-progress{height:8px;border-radius:999px;background:var(--accent,#00e5d4)}
.pk-raise input[type=range]::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:var(--accent,#00e5d4);border:2px solid var(--panel-solid,#fff);box-shadow:0 1px 5px rgba(0,0,0,.35)}
.pk-raise .pk-amt{min-width:58px;text-align:center;font-size:14px;font-weight:800;color:var(--amber);font-variant-numeric:tabular-nums}
.pk-quick{display:flex;gap:6px}
.pk-qbtn{flex:1;min-height:38px;padding:6px 0;border-radius:9px;font-size:11px;font-weight:700;border:1px solid var(--line2);background:var(--panel);color:var(--sub);cursor:pointer}
.pk-qbtn:active{transform:scale(.95)}
.pk-row{display:flex;gap:9px;justify-content:center}
/* ★恒定高度 + flex 垂直居中: 单行(弃牌/预选)与两行(跟注 114/加注 至 404)按钮一律 min-height:54px 同高,
 *   状态在"预选条(单行)↔我的回合(两行)↔骨架"之间切换时按钮行不再忽高忽低跳动(主人反馈"按钮高度不一样,来回跳跃")。
 *   长文字靠 flex-center + nowrap 居中不溢出; 主标题字号用 clamp 随按钮宽自适应, 保证"文字长也定宽美观"。 */
.pk-b{flex:1;min-width:0;max-width:150px;min-height:54px;padding:6px 6px;border-radius:12px;font-weight:800;
  font-size:clamp(13px,3.7vw,15px);line-height:1.16;cursor:pointer;white-space:nowrap;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
  border:1px solid var(--line2);background:var(--panel);color:var(--ink);letter-spacing:.03em;transition:.14s}
.pk-b:active{transform:scale(.96)}
.pk-b:disabled{opacity:.35;cursor:not-allowed;box-shadow:none}
/* 弃牌: 描边式次要键(原 sub 色裸字在日间浅底几乎看不清——主人反馈)。ink 字读得清, 700 字重+透明底比彩色主键安静。 */
.pk-b.fold{color:var(--ink);background:transparent;border-color:var(--line2);font-weight:700}
.pk-b.call{background:var(--accent);color:var(--btn-ink,#04060c);border-color:var(--accent);box-shadow:var(--glow-cyan)}
/* 过牌(不下注的被动动作): 不该顶满彩色主键(日间暗调 accent 会糊成脏橄榄——主人反馈)。走 accent 描边淡底, 干净且语义"温和"; 跟注/下注(真花钱)才留亮色主键。 */
.pk-b.call.check{background:var(--panel);color:var(--accent);border-color:var(--line2);box-shadow:none}
.pk-b.raise{background:var(--amber,#ffc24d);color:#04060c;border-color:var(--amber);box-shadow:0 0 12px rgba(255,194,77,.5)}
.pk-b.raise.allin{background:var(--magenta,#ff2d8e);border-color:var(--magenta,#ff2d8e);color:#fff;box-shadow:var(--glow-mag,0 0 12px rgba(255,45,142,.6))}
/* 全下二次确认态: 第一次点"全下"进此态(需再点一次才真梭哈), 白描边+脉冲提示"这步会梭全部筹码, 别误触" */
.pk-b.raise.confirm{background:var(--magenta,#ff2d8e);border-color:#fff;color:#fff;animation:pkConfirmPulse .6s ease-in-out infinite alternate}
@keyframes pkConfirmPulse{from{box-shadow:0 0 0 2px rgba(255,255,255,.5),0 0 10px rgba(255,45,142,.5)}to{box-shadow:0 0 0 3px rgba(255,255,255,.98),0 0 20px rgba(255,45,142,.85)}}
.pk-b .bt{font-size:11px;line-height:14px;font-weight:700;opacity:.85;display:block}
/* 预选(pre-action)条: 提示行 + 三键(默认暗态, 选中 .on 高亮) */
/* ★提示行高度对齐骨架的快捷注行(.pk-quick=38px): 骨架(等待态)与预选条(轮我前)是同为"非我回合"的
 *   两种中间行——骨架用快捷注行、预选条用这条提示行。二者高差 20px 曾让 .pk-acts 在 发牌(seating→preflop)
 *   之间忽高忽低, 而 felt(flex:1)吸收高差 → 桌面(竖屏钉在 felt 48% 处)随之上下滑 → "发牌跳动"真凶。
 *   统一到 38px 后, 骨架/预选条/我的回合三态 .pk-acts 恒 163px, felt 高不变, 牌桌纹丝不动。 */
.pk-prehint{font-size:11px;color:var(--sub);text-align:center;letter-spacing:.06em;opacity:.85;
  min-height:38px;display:flex;align-items:center;justify-content:center}
.pk-preb{font-size:13px;padding:10px 0}
.pk-preb:not(.on){background:var(--panel);color:var(--sub);border-color:var(--line2);box-shadow:none}
.pk-preb.on.fold{background:rgba(255,255,255,.06);color:var(--ink);border-color:var(--line2);box-shadow:inset 0 0 0 1.5px var(--sub)}
.pk-preb.on:not(.fold):not(.call){background:rgba(0,229,212,.14);color:var(--ink);border-color:var(--accent);box-shadow:0 0 10px rgba(0,229,212,.3)}
.pk-preb.on.call{background:var(--accent);color:var(--btn-ink,#04060c);border-color:var(--accent);box-shadow:var(--glow-cyan)}
/* 结算 */
/* 结算浮层可滚动(输光/多池高结算超出 felt 高度时, justify-content:center 会把卡片上下两头一起挤出 overflow:hidden 的 felt,
   底部"再来一局/收工"被裁掉 → 主人"德州输光后没法继续玩"的真因)。改用 overflow-y:auto 容器 + 卡片 margin:auto:
   内容矮时垂直居中, 内容高时可滚动且首尾都够得着(flex 里唯一不裁切的居中写法, 优于 justify-content:center)。 */
.pk-over{position:absolute;inset:0;z-index:9;display:flex;flex-direction:column;align-items:center;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;
  background:radial-gradient(ellipse at 50% 40%,rgba(6,14,20,.72),rgba(3,5,10,.9));backdrop-filter:blur(5px);animation:pkRoomIn .2s;padding:16px;box-sizing:border-box;text-align:center}
.pk-over-card{margin:auto;display:flex;flex-direction:column;align-items:center;gap:12px;width:min(340px,92%);box-sizing:border-box;
  padding:22px 20px 18px;border-radius:20px;animation:pkOverCard .28s cubic-bezier(.2,.9,.3,1) both;
  background:linear-gradient(180deg,rgba(19,42,41,.66),rgba(6,12,18,.72));border:1px solid var(--line2,rgba(0,229,212,.4));
  box-shadow:0 16px 44px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.06)}
.pk-over.win .pk-over-card{border-color:rgba(255,194,77,.5);box-shadow:0 16px 44px rgba(0,0,0,.55),0 0 34px rgba(255,194,77,.14),inset 0 1px 0 rgba(255,255,255,.06)}
@keyframes pkOverCard{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
.pk-over-card .pk-row{width:100%}
/* 结算标题: 三游戏统一 27px/.07em/900; 胜=金(--amber)负=品红(--magenta), 与🏆桌面横幅同一套胜负色语言 */
.pk-over h2{font-size:27px;margin:0;letter-spacing:.07em;font-weight:900}
.pk-over.win h2{color:var(--amber,#ffc24d);text-shadow:0 0 18px rgba(255,194,77,.6)}
.pk-over.lose h2{color:var(--magenta,#ff2d8e);text-shadow:var(--glow-mag)}
.pk-over .pk-delta{font-size:18px;font-weight:900;font-variant-numeric:tabular-nums}
.pk-over .pk-delta.up{color:var(--accent)}.pk-over .pk-delta.down{color:var(--magenta,#ff2d8e)}
.pk-over .pk-daily{font-size:12px;font-weight:700;letter-spacing:.02em;color:var(--sub,#8fb6b1)}
.pk-over .pk-daily.cap{color:var(--magenta,#ff2d8e)}
/* 摊牌行改对齐网格: 标记/名字/底牌/牌型四列跨行对齐(旧的逐行居中会因赢家多个🏆而参差不齐)。 */
.pk-over .pk-showbox{width:100%;display:flex;justify-content:center;border-top:1px solid var(--line,rgba(0,229,212,.24));padding-top:14px;margin-top:2px}
.pk-over .pk-showrows{display:inline-grid;grid-template-columns:16px auto auto auto;gap:10px 12px;align-items:center;font-size:12px;color:var(--sub);max-width:100%}
.pk-over .pk-showrows .mk{text-align:center;font-size:13px}
.pk-over .pk-showrows .nm{justify-self:start;white-space:nowrap;font-weight:600}
.pk-over .pk-showrows .nm.won{color:var(--ink)}
.pk-over .pk-showrows .cd{display:inline-flex;gap:3px;justify-self:center}
.pk-over .pk-showrows .hn{justify-self:end;color:var(--amber);font-weight:700;font-size:11.5px}
.pk-over .pk-showrows .pk-foldwin{grid-column:1/-1;text-align:center;color:var(--ink)}
/* 成手高亮: 赢家最优 5 张(公共牌+底牌)镶金框, 一眼看清靠哪几张赢 */
.card.pk-win-card{box-shadow:0 0 0 2px var(--amber,#f5c451),0 0 10px rgba(245,196,81,.7);z-index:2}
/* 摊牌台面各家成手牌型小标 */
.pk-mini-hn{font-size:9.5px;line-height:1;color:var(--amber,#f5c451);font-weight:700;text-align:center;margin-top:2px;white-space:nowrap}
.pk-toast{position:absolute;top:34%;left:50%;transform:translate(-50%,-50%);background:var(--panel-solid);border:1px solid var(--line2);color:var(--ink);padding:8px 16px;border-radius:12px;font-size:13px;opacity:0;transition:opacity .2s;z-index:10;pointer-events:none;text-align:center;max-width:80%}
.pk-toast.show{opacity:1}
.pk-confetti{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:11}
.pk-confetti i{position:absolute;top:-8%;font-size:20px;animation:pkFall linear forwards;will-change:transform,opacity}
@keyframes pkFall{0%{transform:translateY(0) rotate(0);opacity:0}12%{opacity:1}100%{transform:translateY(115%) rotate(var(--r,540deg));opacity:0}}
/* 折叠活牌桌片(PiP) — 与 gd/ddz 同款 */
.pk-room.pk-collapsing{transition:transform .24s cubic-bezier(.4,0,1,1),opacity .24s;transform-origin:100% 100%;transform:scale(.14) translate(60%,64%);opacity:0;pointer-events:none}
.pk-room.pk-expanding{animation:pkExpand .28s cubic-bezier(.2,.9,.3,1)}
@keyframes pkExpand{from{transform-origin:100% 100%;transform:scale(.14) translate(60%,64%);opacity:0}to{transform:none;opacity:1}}
.pk-chip{position:absolute;right:14px;bottom:calc(env(safe-area-inset-bottom,0px) + 96px);z-index:18;
  display:flex;align-items:center;gap:9px;max-width:min(74vw,264px);padding:8px 12px 8px 11px;cursor:pointer;
  background:linear-gradient(135deg,var(--panel-solid,#132a29),var(--bg2,#0d1524));
  border:1px solid var(--line2,rgba(0,229,212,.4));border-radius:16px;color:var(--ink,#eaf6ff);
  box-shadow:0 10px 28px rgba(0,0,0,.5);animation:pkChipIn .26s cubic-bezier(.2,.9,.3,1);-webkit-tap-highlight-color:transparent;user-select:none}
@keyframes pkChipIn{from{opacity:0;transform:translateY(10px) scale(.88)}to{opacity:1;transform:none}}
.pk-chip .ck-ic{font-size:21px;line-height:1;position:relative;flex:none}
.pk-chip .ck-tx{display:flex;flex-direction:column;min-width:0;line-height:1.28}
.pk-chip .ck-t{font-size:12px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk-chip .ck-s{font-size:11px;color:var(--sub,#86cbc6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk-chip .ck-x{margin-left:1px;flex:none;width:22px;height:22px;border-radius:50%;border:1px solid var(--line,rgba(0,229,212,.24));display:grid;place-items:center;font-size:12px;color:var(--sub,#86cbc6)}
.pk-chip.turn{border-color:var(--accent,#00e5d4);box-shadow:0 10px 28px rgba(0,0,0,.5),0 0 16px var(--accent,rgba(0,229,212,.55))}
.pk-chip.turn .ck-ic::after{content:'';position:absolute;inset:-7px;border-radius:50%;border:2px solid var(--accent,#00e5d4);animation:pkChipPulse 1.05s ease-out infinite;pointer-events:none}
@keyframes pkChipPulse{0%{transform:scale(.65);opacity:.9}100%{transform:scale(1.55);opacity:0}}
.pk-chip.over{border-color:var(--amber,#ffc24d)}.pk-chip.over .ck-s{color:var(--amber,#ffc24d)}
.pk-conn{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-right:6px;letter-spacing:.03em;vertical-align:1px}
.pk-conn.online{background:rgba(0,229,212,.12);color:var(--accent,#00e5d4);border:1px solid rgba(0,229,212,.35)}
.pk-conn.reconnecting{background:rgba(255,194,77,.14);color:var(--amber,#ffc24d);border:1px solid rgba(255,194,77,.4);animation:pkConnBlink 1s ease-in-out infinite}
.pk-conn.host_offline{background:rgba(255,93,108,.16);color:#ff5d6c;border:1px solid rgba(255,93,108,.45)}
@keyframes pkConnBlink{0%,100%{opacity:.62}50%{opacity:1}}
.pk-chip.hidden-alert{border-color:#ff5d6c!important;box-shadow:0 10px 28px rgba(0,0,0,.5),0 0 20px rgba(255,93,108,.7)!important;filter:brightness(1.12)}
/* ── 本桌累计净盈亏(相对买入 buy-in 的净额): 座位小徽标 + 我的座位条 + 结算逐席列 ── */
.pk-seat .pk-net{font-size:9.5px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;margin-top:1px;letter-spacing:.02em}
.pk-net.up{color:var(--accent,#00e5d4)}
.pk-net.down{color:var(--magenta,#ff2d8e)}
.pk-net.zero{color:var(--dim,#498d88)}
.pk-me .pk-net{font-size:12px;font-weight:800;font-variant-numeric:tabular-nums;margin-left:1px}
/* 结算面板: 本桌累计净盈亏逐席一行(名字左, 净额右) */
.pk-nets{width:100%;display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--line,rgba(0,229,212,.24));padding-top:12px;margin-top:2px}
.pk-nets-t{font-size:11px;color:var(--sub,#8fb6b1);font-weight:700;letter-spacing:.04em;margin-bottom:3px}
.pk-netline{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;padding:1px 4px}
.pk-netline .nl-n{color:var(--sub,#8fb6b1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-netline .nl-v{font-weight:900;font-variant-numeric:tabular-nums;flex:none}
.pk-netline .nl-v.up{color:var(--accent,#00e5d4)}
.pk-netline .nl-v.down{color:var(--magenta,#ff2d8e)}
.pk-netline .nl-v.zero{color:var(--dim,#498d88)}
/* 结算减负: 默认只显 结果+赢家一行+按钮; 摊牌/边池/净盈亏收进「本手详情」折叠(主人反馈"页面太复杂逻辑不清") */
.pk-over .pk-champ{font-size:13.5px;font-weight:800;color:var(--amber,#ffc24d);letter-spacing:.02em;line-height:1.4}
.pk-over .pk-more{width:100%;border-top:1px solid var(--line,rgba(0,229,212,.24));padding-top:4px;text-align:left}
.pk-over .pk-more>summary{font-size:12px;color:var(--sub,#8fb6b1);cursor:pointer;list-style:none;padding:5px 2px;font-weight:700;letter-spacing:.03em;user-select:none;text-align:center}
.pk-over .pk-more>summary::-webkit-details-marker{display:none}
.pk-over .pk-more>summary::after{content:' ▾';opacity:.7}
.pk-over .pk-more[open]>summary::after{content:' ▴'}
.pk-over .pk-more[open]>summary{margin-bottom:8px}
.pk-over .pk-more .pk-showbox{border-top:none;padding-top:0;margin-top:0}
.pk-over .pk-more .pk-nets{border-top:none;padding-top:10px}
.pk-over .pk-more .pk-pots{margin-top:8px}
.pk-over .pk-offnote{width:100%;font-size:12.5px;font-weight:700;color:#ff5d6c;padding:2px 0 6px;letter-spacing:.02em}

/* ── 招募态桌面化(对齐斗地主/掼蛋"思路"): 空桌=一张亮着的真牌桌, 空位虚线可点环坐, 桌心一枚居中发光的招募牌章。
   德州原本连空位/邀请菜单/请离钮都没样式(裸态), 这里一并补齐。全部门控在 [data-phase="lobby"], 打牌态不受影响。 ── */
.pk-room[data-phase="lobby"] .pk-pot{display:none}      /* 招募态无底池 → 藏掉空药丸(不然桌心浮一枚空琥珀圈) */
.pk-room[data-phase="lobby"] .pk-board{display:none}    /* 招募态无公共牌 → 收起免占位 */
/* 空位: 虚线头像 + 可点(与斗地主/掼蛋空位同款视觉) */
.pk-lobby-empty{cursor:pointer}
.pk-lobby-empty .av{background:transparent;border-style:dashed;color:var(--accent,#00e5d4);font-weight:700}
.pk-lobby-empty:hover .av{box-shadow:0 0 12px var(--accent,rgba(0,229,212,.5))}
.pk-seat .stk.pk-lob{color:var(--sub,#86cbc6);font-weight:600}
.pk-lobby-filled .stk.pk-lob .role{color:var(--accent,#00e5d4)}
/* 打牌态空位(机器人输光离场后): 虚线＋号可点邀请, 与 lobby 空位同款; locked=非 host 不可点(仅示意) */
.pk-vacant{cursor:pointer;opacity:.92}
.pk-vacant .av{background:transparent;border-style:dashed;color:var(--accent,#00e5d4);font-weight:700}
.pk-vacant:hover .av{box-shadow:0 0 12px var(--accent,rgba(0,229,212,.5))}
.pk-vacant.locked{cursor:default;opacity:.55}
.pk-seat .stk.pk-vac{color:var(--sub,#86cbc6);font-weight:600;font-size:11px}
/* 请离钮(host 点已入座者旁的 ×) */
.pk-lob-kick{position:absolute;top:-4px;right:0;width:18px;height:18px;line-height:16px;text-align:center;
  border-radius:50%;border:1px solid var(--line);background:var(--panel-solid,#132a29);color:var(--dim,#498d88);
  font-size:11px;cursor:pointer;padding:0;z-index:6}
.pk-lob-kick:hover{color:var(--magenta,#ff2d8e);border-color:var(--magenta,#ff2d8e)}
/* 招募态桌心留白: "我"已坐正下方、招募提示交给底部 pk-me 条 → 藏掉桌心 msg 胶囊(免与底部文案重复、免压住围坐的座位圈) */
.pk-room[data-phase="lobby"] .pk-msg{display:none}
/* 日间: 深色绒面椭圆在浅底上会糊成"灰蛋", 招募态换极浅绿绒渐变 + 柔外晕(与斗地主/掼蛋日间同治) */
html[data-mode="day"] .pk-room[data-phase="lobby"] .pk-table::before{
  background:radial-gradient(ellipse at 50% 42%,rgba(255,255,255,.55),rgba(0,127,118,.05) 60%,transparent 82%);
  border-color:rgba(0,127,118,.16);box-shadow:inset 0 0 46px rgba(0,127,118,.06),0 8px 30px rgba(0,127,118,.06)}
/* 邀请入座菜单(招募态点空位弹出): 与掼蛋 .gd-invite-menu 同款 */
.pk-invite-menu{position:absolute;z-index:40;width:180px;max-height:60%;overflow:auto;padding:6px;
  background:var(--panel-solid,#132a29);border:1px solid var(--line2,rgba(0,229,212,.4));border-radius:12px;
  box-shadow:0 8px 26px rgba(0,0,0,.5)}
.pk-invite-menu .im-ttl{font-size:11px;font-weight:800;color:var(--accent,#00e5d4);padding:4px 8px 6px;letter-spacing:.04em}
.pk-invite-menu .im-sep{font-size:10px;color:var(--dim,#498d88);padding:6px 8px 2px}
.pk-invite-menu .im-empty{font-size:11px;color:var(--dim,#498d88);padding:6px 8px}
.pk-invite-menu .im-item{display:block;width:100%;text-align:left;background:transparent;border:0;border-radius:8px;
  padding:8px 10px;color:var(--ink,#eaf6ff);font-size:13px;cursor:pointer}
.pk-invite-menu .im-item:hover{background:rgba(0,229,212,.12)}

`;
    document.head.appendChild(s);
  }

  function cardEl(card, opts){
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'card' + (opts.mini?' mini':'') + (opts.big?' big':'') + (opts.dim?' dim':'');
    if (opts.back){ el.classList.add('back'); return el; }
    const red = (card.suit==='♥'||card.suit==='♦');
    el.classList.add(red?'red':'blk');
    el.innerHTML = `<div class="cn">${card.label}</div><div class="cs">${card.suit}</div><div class="cc">${card.suit}</div>`;
    el.dataset.id = card.id;
    return el;
  }

  function open(opts){
    opts = opts || {};
    if (!Engine || !AI){ console.warn('[pk] engine not loaded'); return null; }
    injectCSS();
    try{ if(root.EhGameBgm) root.EhGameBgm.enter('poker'); }catch(_){}   // 进桌切德州 BGM

    const names   = opts.names   || ['你','阿岩','小凶','疯哥'];
    const avatars = opts.avatars || ['🙂','🗿','🔥','🤪'];
    const n = names.length;
    const mySeat = (typeof opts.mySeat==='number') ? opts.mySeat : 0;
    const isAI = opts.isAI || names.map((_, i) => i !== mySeat);
    // 每个 AI 席位的打法性格(灵魂原型→打法; 无则按座位轮 5 路)。名册可逐手重组(见 updateRoster),
    // 故 souls/personaBySeat 用 let, 由 personaFor 统一计算。names/avatars/isAI 是数组, 就地改元素即可。
    let souls = opts.souls || [];
    function personaFor(seat){
      if (seat === mySeat || !isAI[seat]) return null;
      const soul = souls[seat] && souls[seat].archetype;
      if (soul) return AI.personaForSoul(soul).key;
      return AI.PERSONA_KEYS[seat % AI.PERSONA_KEYS.length];
    }
    let personaBySeat = names.map((_, seat) => personaFor(seat));
    let ids = opts.ids ? opts.ids.slice() : null;     // 逐手可变(新真人坐下→其席位换成真 uid)

    // ── 联机角色 ──
    const mode = opts.mode || 'local';
    const isGuest = mode === 'guest';
    let remoteSeats = opts.remoteSeats || [];         // host 模式: 由远程真人驱动的席位(可逐手重组)
    const isRemote = (seat) => remoteSeats.indexOf(seat) >= 0;
    const onSync   = (typeof opts.onSync   === 'function') ? opts.onSync   : null;  // host: 每步产出快照广播
    const onAction = (typeof opts.onAction === 'function') ? opts.onAction : null;  // guest: 动作发回 host
    // 单机陪玩(我一人 + 灵魂 AI): 才启用"灵魂逐个入座""真人破产本场终结/再来一局"这套单人体验。
    // 注意"自动开下一手"不再是单机独占 —— 见结算 footer: 只要不是 guest, host(单机/联机)都自动连打,
    // 且不设手动"下一手"按钮, 到点自动发牌(真人一起玩时那种每手必点的门最难受)。想停手点"收工"。
    const isLocalSolo = (mode === 'local' && remoteSeats.length === 0 && !isGuest);
    // ── 多次超时 → 自动离座旁观(主人诉求) ──
    //   真人连续 N 次「超时被代打」(而非主动操作)判定挂机: 自动离座, 该席转本机灵魂/AI 托管,
    //   本人转旁观(仍看牌、无操作)。积分靠 onResult 逐手已入库, 被判入座的每手都已计, 离座不丢分。
    //   host 侧对远程真人席同理: 连续超时到阈值 → 该席即刻转 AI 驱动并请 app 落库(换灵魂/离座),
    //   防一人掉线空等卡死全桌。主动操作(含预选执行)即把该席计数清零。
    const MAX_MISS = (typeof opts.maxMiss==='number' && opts.maxMiss>0) ? opts.maxMiss : 3;
    const onSeatIdle = (typeof opts.onSeatIdle==='function') ? opts.onSeatIdle : null;
    const missStreak = {};                 // seat -> 连续超时次数
    let spectating = false;                // 本人(mySeat)是否已离座旁观
    function resetMiss(seat){ if(missStreak[seat]) missStreak[seat]=0; }
    function bumpMiss(seat){
      if (isGuest) return;                 // guest 无权威, 自身超时由 host 侧(onRemoteTimeout)计
      // 只盯"本该真人推进却没推进"的席: 我(未旁观) 或 仍在场的远程真人席(未转 AI)
      if (seat===mySeat ? spectating : (isAI[seat] || !isRemote(seat))) return;
      missStreak[seat] = (missStreak[seat]||0) + 1;
      if (missStreak[seat] >= MAX_MISS) idleOut(seat);
    }
    function idleOut(seat){
      missStreak[seat] = 0;
      const nm = (st.players[seat] && st.players[seat].name) || names[seat] || ('席'+seat);
      isAI[seat] = true;                             // 该席即刻转本机托管(AI 驱动), 不再空等真人
      const ri = remoteSeats.indexOf(seat); if(ri>=0) remoteSeats.splice(ri,1);
      personaBySeat[seat] = personaFor(seat);
      if (seat===mySeat){ spectating = true; preAct = null;
        toast('连续超时 '+MAX_MISS+' 次 · 已离座旁观 · 灵魂接手你的座位', 3200); }
      else { toast(nm+' 连续超时 · 已离座, 灵魂接手'); }
      try{ emitBeat({ type:'idle', actor:nm, text:'💤 '+nm+' 挂机离座, 灵魂接手' }); }catch(_){}
      if (onSeatIdle){ try{ onSeatIdle(seat, { uid: ids?ids[seat]:null, mine: seat===mySeat }); }catch(e){ _ehCatch('poker.onSeatIdle', e); } }
      try{ renderActs(true); }catch(_){}
    }
    // ── 招募态(lobby): 与斗地主/掼蛋同构 —— 开桌先落真牌桌页(本文件), 6 席里空位可点邀灵魂/真人,
    //   host 满意点「开始 ▶」→ startDeal 就地转正局(同一 room 不重挂)。招募态不产快照(无牌可泄, 见 renderAll onSync 守卫)。
    const lobbyMode = !!opts.lobby;
    const isHostLobby = !!opts.isHost;
    let lobbyCtx = opts.lobbyCtx || null;                // { souls:[{auth_uid,name,emoji}], actions:{seatSoul,kick,fillSouls,inviteHumans,start} }
    let lobbySeats = Array.isArray(opts.lobbySeats) ? opts.lobbySeats : [];
    const PokerNet = root.EHPokerNet;
    let myHole = [];       // guest: 自己的两张底牌(牌对象), 由 feedHand 注入
    let lastSnap = null;   // guest: 最近一张公共快照

    const sb = opts.sb || 5, bb = opts.bb || 10;
    const ACT_MS = (typeof opts.actMs==='number' && opts.actMs>0) ? opts.actMs : HUMAN_ACT_MS;   // 真人思考时长(可调, 测试可压小)
    const START = opts.startStack || 1000;
    // 跨桌钱包: 我这席的买入可带上一桌的余额进场(opts.myStack), 其余席各自新买入 START。
    //   每次结算/重开后经 opts.onWallet(我的最新筹码)回传 app.js 落地, 下张桌再带着走。
    const MY_START = (typeof opts.myStack === 'number' && opts.myStack > 0) ? Math.round(opts.myStack) : START;
    let stacks = names.map((_, i) => i === mySeat ? MY_START : START);
    // 本桌累计净盈亏(相对买入): buyin[seat]=该席至今累计买入(每破产补带一次 +START); netSettled=上一手结算后的净额(stack-buyin)。
    // 净额只在 showOver 结算时刷新, 故座位徽标不随手内下注抖动(展示"进本手时的本桌战绩")。
    // 持久化: 键随牌桌 id(opts.scoreKey), 重进/刷新同一张桌不清零; 桌真正散了由 app.gtClose 清键。
    const SCOREKEY = opts.scoreKey || null;
    const _psav = (()=>{ if(!SCOREKEY) return null; try{ return JSON.parse(localStorage.getItem(SCOREKEY)||'null'); }catch(_){ return null; } })();
    const _okArr = a => Array.isArray(a) && a.length===names.length && a.every(x=>typeof x==='number');
    const buyin = (_psav && _okArr(_psav.buyin)) ? _psav.buyin.slice() : names.map((_, i) => i === mySeat ? MY_START : START);
    let netSettled = (_psav && _okArr(_psav.net)) ? _psav.net.slice() : names.map(() => 0);
    function saveScore(){ if(!SCOREKEY) return; try{ localStorage.setItem(SCOREKEY, JSON.stringify({buyin, net:netSettled})); }catch(e){ _ehCatch('poker.saveScore', e); } }
    // 把我这席的最新筹码回传给 app.js 落地(跨桌钱包)。结算/重开后调, 空防护。
    function emitWallet(){ if(typeof opts.onWallet!=='function') return; try{ const p = st && st.players && st.players[mySeat]; opts.onWallet(p ? Math.max(0, Math.round(p.stack)) : 0); }catch(e){ _ehCatch('poker.onWallet', e); } }
    let button = (typeof opts.button==='number') ? opts.button : (n - 1) % n;  // 首手庄家在我上家, 我不当第一个庄

    function aliveSeats(){ return stacks.map((v,i)=> v>0?i:-1).filter(i=>i>=0); }

    // ── 机器人输光离场 + 手动邀请补位(主人诉求) ──────────────────────────────
    //   对手(机器人/灵魂)把筹码输光 → 不再无限自动补带, 而是【离场】: 座位空出、标 vacated,
    //   台面画成"＋ 点击邀请"空位, 房主可随时邀机器人/灵魂/真人补位。我这席与远程真人席不在此列。
    //   vacatedUid 记离场时占席的 uid: 防名册(realtime)在 DB 腾空前把同一位灵魂重新灌回"复活"。
    let vacated    = names.map(()=>false);
    let vacatedUid = names.map(()=>null);
    const onSeatVacate = (typeof opts.onSeatVacate==='function') ? opts.onSeatVacate : null;
    const canInvite = !isGuest;                       // host/单机才有权威邀请补位
    const BOT_POOL = [
      {name:'阿岩',e:'🗿'},{name:'小凶',e:'🔥'},{name:'疯哥',e:'🤪'},{name:'冷面',e:'🥶'},
      {name:'老练',e:'🧊'},{name:'莽夫',e:'😤'},{name:'狐狸',e:'🦊'},{name:'铁头',e:'🐗'},
    ];
    function pickBotIdentity(seat){
      const used = new Set(names.map((nm,i)=> i!==seat ? nm : null).filter(Boolean));
      const free = BOT_POOL.filter(b=>!used.has(b.name));
      const b = free.length ? free[Math.floor(Math.random()*free.length)] : BOT_POOL[seat % BOT_POOL.length];
      return b;
    }
    // 本地邀请一个机器人补位(纯本机, 无需 DB): 席位下一手起加入, 全新买入 START。
    //   resume: 停摆桌邀满即续打(默认 true); 批量补位时传 false, 由调用方填完再统一续打, 免逐个触发。
    function inviteBot(seat, resume){
      if (resume === undefined) resume = true;
      if (seat===mySeat || isRemote(seat)) return;
      const b = pickBotIdentity(seat);
      names[seat]=b.name; avatars[seat]=b.e; isAI[seat]=true;
      if (ids) ids[seat]=null; souls[seat]=null;
      stacks[seat]=START; buyin[seat]=(buyin[seat]||0)+START; netSettled[seat]=0;
      vacated[seat]=false; vacatedUid[seat]=null;
      personaBySeat[seat]=personaFor(seat);
      saveScore();
      try{ closeInviteMenu(); }catch(_){}
      sfx('click');
      try{ emitBeat({ type:'join', actor:b.name, text:'🪑 '+b.name+' 入座补位' }); }catch(_){}
      // 牌桌因对手离光而停摆(结算态且无自动续手在跑): 邀满 2 人即刻续打; 否则只提示"下一手加入"。
      if (resume && st.phase==='over' && !overTimer && aliveSeats().length>=2){
        toast(b.name+' 入座 · 开新一手'); try{ if(curOver&&curOver.parentNode) curOver.remove(); }catch(_){}
        try{ hideWinBanner(); }catch(_){}
        nextHand();
      } else {
        toast(b.name+' 入座 · 下一手加入');
        if (!inHand()){ renderOpponents(true); positionSeats(); }
      }
    }
    // 是否正处于一手进行中(发牌后、未结算): 邀请/离场只在手与手之间真正落地, 绝不打断本手。
    function inHand(){ return st && st.phase && st.phase!=='over' && st.phase!=='lobby' && st.toAct!==-1; }

    function newHand(seedOverride){
      // 破产处理: 我这席——单机 0 由 showOver 判本场终结(走不到这里)、联机沿用补带; 远程真人席沿用补带。
      //   对手机器人/灵魂输光 → 【离场腾席】(不补带), 标 vacated + 通知 app 腾 DB 座, 空位待邀请补位。
      stacks = stacks.map((v, seat) => {
        if (v > 0) return v;
        if (seat === mySeat) return isLocalSolo ? v : START;
        if (isRemote(seat)) { buyin[seat]+=START; return START; }
        if (!vacated[seat]){
          vacated[seat] = true; vacatedUid[seat] = (ids && ids[seat]) || null;
          if (onSeatVacate){ try{ onSeatVacate(seat, { uid: vacatedUid[seat] }); }catch(e){ _ehCatch('poker.onSeatVacate', e); } }
          try{ emitBeat({ type:'leave', actor: names[seat], text:'🪑 '+names[seat]+' 输光筹码, 离开牌桌' }); }catch(_){}
        }
        return 0;
      });
      let _bg=0; while (stacks[button] <= 0 && _bg++ < n) button = (button+1)%n;   // 庄家落在有筹码的人身上
      let seed; try{ seed = crypto.getRandomValues(new Uint32Array(1))[0]; }catch(_){ seed = Math.floor(Math.random()*4294967296); }
      return Engine.createGame({ seed: seedOverride!=null?seedOverride:(opts.seed!=null && handNo===0?opts.seed:seed),
        names, isAI, stacks: stacks.slice(), sb, bb, button, ids: ids || undefined });
    }
    let handNo = 0;
    // guest 开局尚无快照 → 先给一个"等发牌"占位态; host/local 直接发一手
    function waitingState(phase){
      return { variant:'nlhe', phase:phase||'waiting', street:'preflop', n, button:0, sb, bb,
        currentBet:0, minRaise:bb, aggressor:null, toAct:-1, pot:0, board:[], result:null,
        players: names.map((nm,seat)=>({ seat, name:nm||('席'+seat), isAI:!!isAI[seat],
          stack:START, start:START, hole:[], folded:false, allin:false, committed:0, street:0, acted:false })) };
    }
    // 招募占位局: 未发牌, 6 席按 lobbySeats 显示占用/空位; host 点空位邀灵魂/真人, 满意 startDeal 就地转正局。
    //   字段与 waitingState 对齐(渲染读空防护), 每席多带 kind/dbSeat 供空位判定/请离寻址。
    function lobbyState(seats){
      const arr = (Array.isArray(seats)?seats:[]).slice().sort((a,b)=>a.seat-b.seat);
      return { variant:'nlhe', phase:'lobby', street:'preflop', n, button:0, sb, bb,
        currentBet:0, minRaise:bb, aggressor:null, toAct:-1, pot:0, board:[], result:null,
        players: names.map((nm,seat)=>{
          const s = arr[seat] || { seat, kind:'empty' };
          const kind = s.kind || 'empty';
          return { seat, dbSeat:(typeof s.seat==='number'?s.seat:seat), kind,
            name: kind==='empty' ? '' : (s.name||nm||('席'+seat)), emoji: s.emoji||null,
            isAI: kind!=='human', stack:START, start:START, hole:[], folded:false, allin:false, committed:0, street:0, acted:false };
        }) };
    }
    // guest: 等房主发牌; host 招募态: 落 lobby; 其余(含单机): 直接发第一手, 立即上桌。
    //   ★去掉"入座序列"中间态(灵魂逐个上桌 ~3-4s): 主人反馈开始游戏/再来一局要立即进牌桌, 别有中间页/加载过程。
    //   保留 introSeating 变量(恒 false)以兼容下方 render 的 pending 分支(现均短路不生效)。
    let introSeating = false;
    let arrived = introSeating ? new Set([mySeat]) : null, lastSeated = -1;
    let st = isGuest ? waitingState() : (lobbyMode ? lobbyState(lobbySeats) : (introSeating ? waitingState('seating') : newHand()));

    function sfx(nm){ try{ if(root.EhSfx && root.EhSfx.play) root.EhSfx.play(nm); }catch(_){} }
    // 操作语音: 每席按名/机分配稳定音色, 让弃牌/过/跟/加注/全下都出声(对标腾讯德州报牌)
    function whoOf(seat){ if(typeof seat!=='number' || !st || !st.players || !st.players[seat]) return null;
      const ai=!!isAI[seat], nm=st.players[seat].name; return { name:nm, key:nm, isSoul:ai, isHuman:!ai }; }
    function sayOp(seat, text){ try{ if(text && root.EhSfx && root.EhSfx.say) root.EhSfx.say(text, whoOf(seat)); }catch(_){} }
    function vibrate(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(_){} }
    sfx('arrive'); if(!lobbyMode) sfx('deal');

    let aiTimer=null, ringRAF=null, streetTimer=null, overTimer=null, turnStart=0, turnDur=0, turnAiAct=0, turnSeatActive=-1, turnStreetActive='';
    let animPhase=null, lastPotShown=-1;   // 筹码归池动画: 追踪街推进 / 底池增额
    let _winBanner=null;                    // 桌面赢家横幅(单机常规手替代结算弹窗, 见 showWinBanner)
    let lastBoardLen = 0, lastMyTurn=false, dealAnim=true;
    let lastBoardSig='', lastMeSig='';   // 增量护栏签名(公共牌区 / 我的底牌条)

    const mountEl = opts.mount || document.getElementById('hall') || document.body;
    const room = document.createElement('div'); room.className='pk-room';
    room.innerHTML = `
      <div class="pk-bar">
        <div class="pk-title"><span class="dot"></span>德州扑克</div>
        <button class="pk-mus" id="pkMus" aria-label="背景音乐开关">🎵</button>
        <button class="pk-rot" id="pkRot" aria-label="横竖屏切换" title="横屏/竖屏">⟳</button>
        <button class="pk-x" id="pkX" aria-label="返回聊天">✕<span class="pk-xlbl"> 返回</span></button>
      </div>
      <div class="pk-felt" id="pkFelt">
        <div class="pk-blinds" id="pkBlinds"></div>
        <div class="pk-table" id="pkTable">
          <div class="pk-center">
            <div class="pk-pot" id="pkPot"></div>
            <div class="pk-board" id="pkBoard"></div>
            <div class="pk-msg" id="pkMsg"></div>
          </div>
        </div>
      </div>
      <div class="pk-me" id="pkMe"></div>
      <div class="pk-acts" id="pkActs"></div>
      <div class="pk-toast" id="pkToast"></div>`;
    mountEl.appendChild(room);

    // 游戏内聊天已下线: 牌桌不再挂聊天坞/弹幕, 点"✕ 返回"回聊天室看消息(减少牌桌干扰、专注对局)
    const dock = null;

    const $ = sel => room.querySelector(sel);
    const els = { felt:$('#pkFelt'), table:$('#pkTable'), board:$('#pkBoard'), pot:$('#pkPot'),
      msg:$('#pkMsg'), me:$('#pkMe'), acts:$('#pkActs'), blinds:$('#pkBlinds'), toast:$('#pkToast') };

    function toast(m, ms){ els.toast.textContent=m; els.toast.classList.add('show');
      clearTimeout(toast._t); toast._t=setTimeout(()=>els.toast.classList.remove('show'), ms||1300); }
    function say(seat, msg){
      // 延一帧再写气泡: afterAction 里 say() 常在同步 renderAll() 之前调用, 而 renderOpponents
      // 会整段 remove/重建 .pk-seat 节点, 直接写会被当帧重建吞掉(气泡从不显示)。rAF 到点时
      // renderAll 已完成, 查到的是新座位节点, 气泡才真正上屏。
      requestAnimationFrame(()=>{
        const b = room.querySelector(`.pk-seat[data-seat="${seat}"] .pk-say`);
        if(!b) return; b.textContent=msg; b.classList.add('show'); setTimeout(()=>b.classList.remove('show'),1600);
      });
    }

    // ── 直播 + 灵魂入戏 ──
    const QUIP = {
      raise:['加注，跟不跟？','这把我来主导','给你点压力','押上筹码'],
      allin:['全下！接不接','梭哈了','要么翻倍要么回家','我不装了'],
      call:['跟一个','看看你有什么','陪你玩玩','不能让你偷池'],
      fold:['这手算了','让给你','弃了弃了','下把再战'],
      win:['筹码归我 😎','读牌成功','谢谢款待','技术活'],
    };
    // 联机连接状态: online / reconnecting / host_offline —— 由 app.js 通过返回值 setConn(kind) 灌入
    let connState = 'online';
    let curOver = null;   // 当前挂着的结算浮层(供 setConn 在房主掉线时把客人的"等下一手"换成"可离开", 别对着灰按钮干等)
    function connLabel(k){ return ({online:'● 在线', reconnecting:'⟳ 重连中', host_offline:'⚠ 房主离线'})[k] || ''; }
    function setConn(kind){
      if(!kind) kind='online';
      if(kind===connState) return;
      connState = kind;
      renderMsg(); renderActs(); updateChip();
      // 结算浮层挂着时房主掉线: 客人别对着灰"下一手自动开始…"干等 —— 换成"房主离线·可离开", 并把收工按钮变主行动。
      if(kind==='host_offline' && isGuest && curOver && curOver.parentNode){
        const wait=curOver.querySelector('#pkWait');
        if(wait){
          const note=document.createElement('div'); note.className='pk-offnote'; note.textContent='⚠ 房主已离线 · 本桌即将解散';
          wait.replaceWith(note);
          const done=curOver.querySelector('#pkDone'); if(done){ done.textContent='离开牌桌'; done.classList.add('call'); }
        }
      }
      if(kind==='host_offline'){ try{ vibrate([40,80,40]); }catch(_){ } }
    }
    function emitBeat(b){ if(typeof opts.onBeat==='function'){ try{ opts.onBeat(Object.assign({ game:'nlhe' }, b)); }catch(_){} } }
    function beatQuip(seat, kind){
      if(!(isAI[seat])) return null;
      const q = rand(QUIP[kind]||[]); if(!q) return null; say(seat, q); return q;
    }

    function clearTimers(){ if(aiTimer){clearTimeout(aiTimer);aiTimer=null;} if(ringRAF){cancelAnimationFrame(ringRAF);ringRAF=null;} if(streetTimer){clearTimeout(streetTimer);streetTimer=null;} if(overTimer){clearTimeout(overTimer);clearInterval(overTimer);overTimer=null;} try{ hideWinBanner(); }catch(_){} }
    // resize rAF 节流: 旋转/移动端地址栏收放会连发数十个 resize, 每个都全桌重排 —— 合并到每帧一次。
    let _rzRAF=0;
    const onResize = ()=>{ if(_rzRAF) return; _rzRAF=requestAnimationFrame(()=>{ _rzRAF=0; positionSeats(); }); };
    let _exited=false;
    function close(){ minimized=false; try{ if(root.EhGameBgm) root.EhGameBgm.exit(); }catch(_){} try{ closeInviteMenu(); }catch(_){} clearTimers(); if(_rzRAF){ cancelAnimationFrame(_rzRAF); _rzRAF=0; } window.removeEventListener('resize', onResize); if(root.EHTableOrient) root.EHTableOrient.clear(room); if(dock) dock.destroy(); if(chip){ chip.remove(); chip=null; } room.remove();
      if(!_exited){ _exited=true; if(typeof opts.onExit==='function'){ try{ opts.onExit(); }catch(_){} } } }

    // ── 折叠 / 展开(返回聊天但牌局继续) ──
    let minimized=false, chip=null;
    function chipStatus(){
      if (st.phase==='lobby'){ const nn=st.players.filter(p=>p.kind!=='empty').length;
        return { t:'德州扑克', s:'🪑 招募中 · '+nn+'/'+n+' 席', cls:'' }; }
      if (st.phase==='over'){ const won=(st.result.winnersBySeat||[]).includes(mySeat);
        return { t:'德州扑克', s:(won?'🏁 你赢下这手 · 点看结算':'🏁 本手结束 · 点看结算'), cls:'over' }; }
      const mine=st.toAct===mySeat, my=st.players[mySeat];
      return { t:'德州扑克 · 底池'+st.pot, s:(mine?'⚡ 轮到你行动':('等 '+(st.players[st.toAct]?st.players[st.toAct].name:'…')+' 行动'))+' · 你 '+(my?my.stack:'?'),
        cls: mine?'turn':'' };
    }
    function updateChip(){ if(!minimized||!chip) return; const i=chipStatus();
      const mine=(st.toAct===mySeat && st.phase!=='over' && st.phase!=='waiting');
      let cls='pk-chip'+(i.cls?(' '+i.cls):'');
      if(mine && document.hidden) cls += ' hidden-alert';
      chip.className=cls;
      const tag = connState!=='online' ? (' ['+connLabel(connState).replace(/^[● ⟳ ⚠]+/,'').trim()+']') : '';
      chip.querySelector('.ck-t').textContent=i.t + tag;
      chip.querySelector('.ck-s').textContent=i.s;
    }
    function minimize(){
      if (minimized) return; minimized=true;
      if (root.EHTableOrient) root.EHTableOrient.clear(room); if (rotBtn) rotBtn.classList.remove('on');
      room.classList.remove('pk-expanding'); room.classList.add('pk-collapsing');
      setTimeout(()=>{ if(minimized) room.style.display='none'; }, 240);
      if (!chip){
        chip=document.createElement('div'); chip.className='pk-chip';
        chip.innerHTML=`<span class="ck-ic">🎰</span><span class="ck-tx"><b class="ck-t">德州扑克</b><span class="ck-s"></span></span><span class="ck-x">↗</span>`;
        chip.addEventListener('click', restore);
        mountEl.appendChild(chip);
      } else chip.style.display='';
      renderAll(); sfx('click');
    }
    function restore(){
      if (!minimized) return; minimized=false;
      if (chip) chip.style.display='none';
      room.style.display=''; room.classList.remove('pk-collapsing');
      void room.offsetWidth; room.classList.add('pk-expanding');
      setTimeout(()=>room.classList.remove('pk-expanding'), 300);
      renderAll(); positionSeats(); sfx('click');
    }
    // 「✕ 返回」: 牌局进行中一律折叠保活(主人: 本手没结束就返回, 再进要接着玩, 不是新开一桌);
    //   有远程真人靠本机 host 当裁判时也必须折叠(close 会杀全桌); 只有 lobby / 本手已结束才真散桌离场。
    $('#pkX').addEventListener('click', ()=>{
      const handLive = st.phase!=='lobby' && st.phase!=='over';
      if (remoteSeats.length>0 || isGuest || handLive) minimize(); else close();
    });
    const rotBtn = $('#pkRot');
    if (rotBtn) rotBtn.addEventListener('click', ()=>{
      const on = root.EHTableOrient ? root.EHTableOrient.toggle(room) : false;
      rotBtn.classList.toggle('on', on); sfx('click');
      if (!minimized) positionSeats();
    });
    // 牌桌内声音开关: 大厅 🎵 按钮被牌桌浮层盖住, 这里点开三档静音面板(BGM/音效/语音各自独立开关)
    const musBtn = $('#pkMus');
    function paintMus(){ if(!musBtn) return; const P=root.EhAudioPrefs; const any = P?P.anyOn():(!root.EH_BGM||root.EH_BGM.on()); musBtn.textContent = any?'🎵':'🔇'; musBtn.classList.toggle('muted', !any); }
    if (musBtn) musBtn.addEventListener('click', ()=>{ if(root.EhAudioMenu) root.EhAudioMenu.toggle(musBtn, paintMus); else { try{ if(root.EH_BGM) root.EH_BGM.set(!root.EH_BGM.on()); }catch(_){} paintMus(); } sfx('click'); });
    paintMus();
    window.addEventListener('resize', onResize);

    // ── 座位渲染: 我固定坐底(在 pk-me 条), 对手沿椭圆上弧分布 ──
    function displayOrder(){                // 从我起, 顺时针一圈的座位号
      const out=[]; for(let i=0;i<n;i++) out.push((mySeat+i)%n); return out;
    }
    // 本桌净盈亏不再常驻座位(主人: 座位上的输赢钱数是冗余噪声, 去掉更简洁)——
    //   累计净额仍在结算面板「本手详情」的逐席 .pk-nets 里可查(netSettled 照常维护)。
    // 小盲/大盲席位(与 poker-engine deal 同口径: 2 人时庄=小盲/对家=大盲; 3+ 人时庄+1=小盲、庄+2=大盲)。
    //   lobby/入座态不显; 结算态仍显(便于回看本手盲位)。返回角标 HTML。
    function blindSeats(){
      if (typeof st.button!=='number' || st.phase==='lobby') return {};
      // 优先用引擎权威盲位(deal 时按在座席轮转算好, 落进 state/快照)——纯取模不跳空席/离座会把 SB/BB 标错位。
      if (typeof st.sbSeat==='number' && typeof st.bbSeat==='number') return { sb:st.sbSeat, bb:st.bbSeat };
      // 兜底(旧快照无 sbSeat 字段时): 按引擎口径重算 —— 跳过 sitOut/空席, 用【在座数】判单挑而非 n。
      const seated = s => st.players[s] && !st.players[s].sitOut && st.players[s].kind!=='empty';
      const nextSeated = from => { for(let i=0;i<n;i++){ const s=(from+i)%n; if(seated(s)) return s; } return -1; };
      const b = seated(st.button) ? st.button : nextSeated(st.button);
      if (b<0) return {};
      const cnt = st.players.filter((_,s)=>seated(s)).length;
      if (cnt<2) return {};
      if (cnt===2) return { sb:b, bb:nextSeated((b+1)%n) };
      const sb = nextSeated((b+1)%n);
      return { sb, bb:nextSeated((sb+1)%n) };
    }
    function blindBadge(seat){
      const bl=blindSeats();
      if (seat===bl.sb) return '<span class="pk-btn-bl sb">SB</span>';
      if (seat===bl.bb) return '<span class="pk-btn-bl bb">BB</span>';
      return '';
    }
    // ── 招募态座位(椭圆上弧, 与打牌态同 .pk-seat 结构故 positionSeats 直接复用): 空位→「＋ 点击邀请」, 占用→头像/名/角色 + host 可请离(非 0 席) ──
    function lobbySeatHTML(seat){
      const p = st.players[seat];
      if (p.kind==='empty'){
        return `<div class="pk-seat pk-lobby-empty" data-seat="${seat}" data-invite="${p.dbSeat}" style="--p:360">
          <div class="pk-avr"><div class="av">＋</div></div>
          <div class="nm">空位</div><div class="stk pk-lob">点击邀请</div></div>`;
      }
      const isMe = seat===mySeat;
      // clone=灵魂分身(本机 AI 顶灵魂身份代打的副本)→ 标「分身」, 别冒充真人「玩家」(状态忠实)
      const roleTxt = p.kind==='soul' ? '灵魂' : (p.kind==='clone' ? '分身' : (isMe ? '你' : '玩家'));
      const canKick = isHostLobby && !isMe && p.dbSeat!==0;
      return `<div class="pk-seat pk-lobby-filled" data-seat="${seat}" style="--p:360">
        <div class="pk-avr"><div class="av">${p.emoji||avatars[seat]||'🙂'}</div></div>
        <div class="nm">${escapeHtml(p.name||'—')}</div>
        <div class="stk pk-lob"><span class="role">${roleTxt}</span></div>
        ${canKick?`<button class="pk-lob-kick" data-kick="${p.dbSeat}" title="请离">✕</button>`:''}
      </div>`;
    }
    // 招募态: 空位点击邀请 / host 请离(与斗地主 bindLobbySeats 同构)
    function bindLobbySeats(){
      room.querySelectorAll('.pk-lobby-empty[data-invite]').forEach(el=>{
        el.onclick=()=>openInviteMenu(+el.dataset.invite, el);
      });
      room.querySelectorAll('.pk-lob-kick[data-kick]').forEach(b=>{
        b.onclick=(e)=>{ e.stopPropagation(); if(lobbyCtx&&lobbyCtx.actions&&lobbyCtx.actions.kick) lobbyCtx.actions.kick(+b.dataset.kick); };
      });
    }
    function _imAway(e){
      const m=room.querySelector('.pk-invite-menu');
      if(m && !m.contains(e.target) && !(e.target.closest && e.target.closest('.pk-lobby-empty,.pk-vacant'))) closeInviteMenu();
    }
    function closeInviteMenu(){ const m=room.querySelector('.pk-invite-menu'); if(m) m.remove(); document.removeEventListener('click', _imAway, true); }
    function openInviteMenu(dbSeat, anchorEl){
      closeInviteMenu();
      const acts = (lobbyCtx && lobbyCtx.actions) || null;
      const souls = ((lobbyCtx && lobbyCtx.souls)||[]).filter(s=>s&&s.auth_uid);
      const menu=document.createElement('div'); menu.className='pk-invite-menu';
      let html='<div class="im-ttl">邀请入座</div>';
      html+='<button class="im-item" data-bot="1">🤖 邀请机器人</button>';   // 纯本机, 无需 DB, 下一手加入
      if(acts && acts.inviteHumans) html+='<button class="im-item" data-invite-human="1">👥 邀请真人来坐</button>';
      if(acts && acts.seatSoul){
        html += souls.length ? '<div class="im-sep">灵魂</div>' : '<div class="im-empty">房里暂无灵魂</div>';
        souls.forEach(s=>{ html+=`<button class="im-item" data-soul="${escapeHtml(s.auth_uid)}">${escapeHtml((s.emoji||'👤')+s.name)}</button>`; });
      }
      menu.innerHTML=html;
      room.appendChild(menu);
      const rr=room.getBoundingClientRect(), ar=anchorEl.getBoundingClientRect();
      menu.style.left=Math.min(Math.max(8, ar.left-rr.left+ar.width/2-90), Math.max(8, rr.width-188))+'px';
      menu.style.top=Math.min(ar.bottom-rr.top+6, rr.height-60)+'px';
      const bot=menu.querySelector('[data-bot]'); if(bot) bot.onclick=()=>{ inviteBot(dbSeat); };   // inviteBot 内会 closeInviteMenu
      menu.querySelectorAll('[data-soul]').forEach(b=> b.onclick=()=>{ if(acts&&acts.seatSoul) acts.seatSoul(dbSeat, b.dataset.soul); closeInviteMenu(); });
      const ih=menu.querySelector('[data-invite-human]'); if(ih) ih.onclick=()=>{ if(acts&&acts.inviteHumans) acts.inviteHumans(); closeInviteMenu(); };
      sfx('click');
      setTimeout(()=>document.addEventListener('click', _imAway, true), 0);
    }
    function seatHTML(seat){
      if (st.phase==='lobby') return lobbySeatHTML(seat);
      const p=st.players[seat];
      // 机器人输光离场后的空位: 画成"＋ 点击邀请"(host/单机可点邀机器人/灵魂/真人补位)。
      if (seat!==mySeat && vacated[seat]){
        const clickable = canInvite;
        return `<div class="pk-seat pk-vacant${clickable?'':' locked'}" data-seat="${seat}"${clickable?` data-invite="${seat}"`:''} style="--p:360">
          <div class="pk-avr"><div class="av">＋</div></div>
          <div class="nm">空位</div>
          <div class="stk pk-vac">${clickable?'点击邀请':'空位'}</div>
          <div class="pk-mini-hole"></div><div class="pk-say"></div></div>`;
      }
      // 已受邀但本手尚未发牌(引擎坐席仍 sitOut): 画成"入座中·下一手"占位, 不参与本手。
      if (seat!==mySeat && p && p.sitOut && stacks[seat]>0){
        return `<div class="pk-seat arriving" data-seat="${seat}" style="--p:360">
          <div class="pk-avr"><div class="av">${avatars[seat]||'🙂'}</div></div>
          <div class="nm">${escapeHtml(names[seat]||'牌手')}</div>
          <div class="stk">下一手入座</div></div>`;
      }
      const showdown = (st.phase==='over' && st.result && st.result.wentToShowdown && st.result.reveal && st.result.reveal[seat]);
      const won = (st.phase==='over' && (st.result.winnersBySeat||[]).includes(seat));
      let hole='';
      if (showdown){
        const rv=st.result.reveal[seat]; const b5=best5Set(seat);
        const cs = rv.hole.map(id=>{ const el=cardEl(idCard(id),{mini:false}); if(b5&&b5.has(id)) el.classList.add('pk-win-card'); return el.outerHTML; }).join('');
        // 摊牌台面直接标各家成手牌型(同花顺/葫芦…), 不必等结算面板 —— 一眼看清谁靠什么赢
        hole = `<div class="pk-mini-hole">${cs}</div><div class="pk-mini-hn">${escapeHtml(rv.hand||'')}</div>`;
      } else if (seat===mySeat){
        // "我"也坐在椭圆底部(主人诉求"把自己放桌里, 不单独拿出来") → 自己的底牌正面朝上、带花色可读(不走 mini, mini 会藏花色)。
        //   弃牌后底牌不撤、继续朝上显示, 由座位 .folded 类整体灰掉(opacity+grayscale) —— 主人诉求"自己弃牌牌可继续显示, 灰掉即可"。
        const cs = (p.hole||[]).map(c=>cardEl(c,{}).outerHTML).join('');
        hole = `<div class="pk-mini-hole pk-my-hole">${cs}</div>`;
      } else if (!p.folded){
        hole = `<div class="pk-mini-hole">${cardEl(null,{back:true,mini:true}).outerHTML}${cardEl(null,{back:true,mini:true}).outerHTML}</div>`;
      } else {
        hole = `<div class="pk-mini-hole"></div>`;
      }
      const dbtn = seat===st.button ? `<span class="pk-btn-d">D</span>` : '';
      const blbtn = blindBadge(seat);
      return `<div class="pk-seat${seat===mySeat?' pk-me-seat':''}${st.toAct===seat&&st.phase!=='over'?' turn':''}${p.folded?' folded':''}${p.allin?' allin':''}${won?' win':''}" data-seat="${seat}" style="--p:360">
        <div class="pk-avr"><div class="av">${avatars[seat]||'🤖'}</div>${dbtn}${blbtn}${p.allin&&!p.folded?'<span class="pk-allin-tag">ALL IN</span>':''}<span class="pk-sec"></span></div>
        <div class="nm">${escapeHtml(p.name)}</div>
        <div class="stk">${p.allin?'全下':'💰'} <b>${p.allin?'':p.stack}</b></div>
        ${hole}
        <div class="pk-say"></div>
      </div>`;
    }
    // 入座阶段: 尚未到场的灵魂座位画成"待入座"虚位
    function seatEmptyHTML(seat){
      return `<div class="pk-seat arriving" data-seat="${seat}" style="--p:360">
        <div class="pk-avr"><div class="av">···</div></div>
        <div class="nm">${escapeHtml(st.players[seat].name)}</div>
        <div class="stk">入座中…</div></div>`;
    }
    let _lastOppSig='';
    function renderOpponents(force){
      // 对手包统一签名: 座位顺序 + 每人(进座状态/弃牌/全下/筹码肌胉/本街投入/回合长相) + 现任 turn + 横屏态。
      // 联机时对手行动中或签名跟手上负担都相同 → 整段重建花钱白花。
      const order = displayOrder();
      const land = root.EHTableOrient ? root.EHTableOrient.reflect(room) : false;
      const parts = order.slice(1).map(seat=>{
        const p=st.players[seat]||{};
        if (st.phase==='lobby') return seat+':'+(p.kind||'empty')+':'+(p.name||'');   // 招募态签名跟座位占用走(灵魂入座/请离要重绘)
        const pending = introSeating && arrived && !arrived.has(seat);
        return seat+':'+(pending?'P':(p.folded?'F':'')+(p.allin?'A':'')+':'+(p.stack||0)+':'+(p.street||0));
      }).join('|');
      // "我"也画上椭圆底部座位, 故底牌进签名(新发牌/摊牌换牌要重建我的座位面); 弃牌/筹码已在 parts 里没我 → 单列我
      const mp = st.players[mySeat]||{};
      const myHoleSig = (mp.hole||[]).map(c=>c?(c.suit+''+c.rank):'x').join('')+':'+(mp.folded?'F':'')+(mp.allin?'A':'')+':'+(mp.stack||0)+':'+(mp.street||0);
      const sig = order.join(',')+'#'+parts+'#ME'+myHoleSig+'#T'+st.toAct+'#'+(land?'L':'P')+'#'+(lastSeated||'')+'#'+st.phase;
      if(!force && sig===_lastOppSig) return;
      _lastOppSig=sig;
      // 移除旧座位节点(保留 pk-table 内的 center)
      els.table.querySelectorAll('.pk-seat, .pk-commit').forEach(e=>e.remove());
      // 全席(含我 d=0)都画上椭圆: 我在正下方 270°, 对手绕上弧 —— 一桌人围坐, 不再把"我"单独拎到桌外条
      const startD = 0;
      for (let d=startD; d<order.length; d++){
        const seat = order[d];
        const wrap = document.createElement('div');
        const pending = introSeating && arrived && !arrived.has(seat);
        wrap.innerHTML = pending ? seatEmptyHTML(seat) : seatHTML(seat);
        const seatEl = wrap.firstElementChild;
        if (introSeating && arrived && seat===lastSeated) seatEl.classList.add('pk-justseated');
        els.table.appendChild(seatEl);
        if (pending || st.phase==='lobby') continue;   // 虚位/招募态空位不摆投入筹码
        // 身前投入(本街) 筹码牌
        const commit = document.createElement('div');
        commit.className='pk-commit'+(st.players[seat].street>0?'':' zero');
        commit.dataset.seat=seat;
        commit.innerHTML=`<span class="pc"></span>${st.players[seat].street}`;
        els.table.appendChild(commit);
      }
      positionSeats();
      if (st.phase==='lobby'){ bindLobbySeats(); }
      else {
        // 打牌态空位(机器人离场后): 点击 → 邀请补位菜单(机器人/灵魂/真人)
        els.table.querySelectorAll('.pk-vacant[data-invite]').forEach(el=>{
          el.onclick=()=>openInviteMenu(+el.dataset.invite, el);
        });
        // 新一手: 底牌已发且尚未渲过发牌动画(dealAnim 仅在开手为真, renderMe 后置否) → 逐张错峰飞入。
        //   放在 positionSeats 之后: 座位已就位, 动画只作用于每张牌自身 transform, 不影响布局。
        if (dealAnim && (st.players[mySeat].hole||[]).length>0) runDealAnim();
      }
    }
    // 按真实发牌顺序给底牌挂错峰落座动画: 从庄家下家(SB)起绕圈, 发两轮(每人先落第1张、再落第2张)。
    function runDealAnim(){
      const N=st.players.length, btn=st.button||0, STEP=55;
      const seq=[]; for(let i=1;i<=N;i++){ const s=(btn+i)%N; const p=st.players[s]; if(p && !p.folded && (p.hole||[]).length>0) seq.push(s); }
      const len=seq.length||1;
      seq.forEach((s,j)=>{
        const seatEl=els.table.querySelector(`.pk-seat[data-seat="${s}"]`); if(!seatEl) return;
        seatEl.querySelectorAll('.pk-mini-hole .card').forEach((c,k)=>{
          c.style.animationDelay=((k*len+j)*STEP)+'ms'; c.classList.add('pk-dealing');
        });
      });
    }
    function positionSeats(){
      const land = root.EHTableOrient ? root.EHTableOrient.reflect(room) : false;  // 横屏态标记(open/resize/旋转都会过这里)
      const order = displayOrder();
      const lob = st.phase==='lobby';
      const N = order.length;                     // 总席数(含我)
      const m = N - 1;                             // 对手数
      // 招募态 & 打牌态一致: 把"我"也摆上椭圆(坐正下方 270°), 对手绕上弧均分 —— 一桌人围坐感,
      //   不再"我孤零零一个人在桌外条上"(主人反馈"把自己也放到牌桌里, 不用单独拿出来")。
      //   招募态: 全 n 席等分整椭圆(我在 270°)。打牌态: 我固定 270°, 对手沿"绕开底部我位缺口"的宽弧
      //   (210°左下 → 90°顶 → -30°右下)均分, 底牌正面就在我这张桌底座位上。
      // 横屏: 桌面又宽又矮 → 横向半径放大铺开、竖向半径压扁; 椭圆竖直居中(CY 偏上)让底部我位不溢出。
      const RX = land ? 46 : 40, RY = land ? 41 : 32;
      const CY = lob ? 50 : (land ? 59 : 46);
      const start = 0;                             // 全席含我(d=0, 270°底部), 招募/打牌一致
      for (let d=start; d<N; d++){
        const seat=order[d];
        const seatEl = els.table.querySelector(`.pk-seat[data-seat="${seat}"]`);
        const commitEl = els.table.querySelector(`.pk-commit[data-seat="${seat}"]`);
        if(!seatEl) continue;
        let deg;
        if (d===0) deg = 270;                                    // 我: 正下方(仅招募态摆上桌)
        else if (lob) deg = 270 - d*(360/N);                     // 招募态: 全 n 席等分整椭圆(我在 270°)
        else deg = (m===1) ? 90 : (210 - 240*(d-1)/(m-1));       // 打牌态: 对手在 210°→-30° 宽弧均分(绕开底部我位)
        const t = deg * Math.PI/180;
        const cx = 50 + RX*Math.cos(t);
        // 横屏我的座位已改横向(矮), 压到桌底(86%)腾出桌心竖向空间给底池/公共牌; 竖屏/招募态仍走椭圆几何
        let cy = CY - RY*Math.sin(t);
        if (land && !lob && d===0) cy = 86;
        seatEl.style.left = cx+'%'; seatEl.style.top = cy+'%';
        if (commitEl){   // 投入筹码摆在座位与中心之间, 偏座位一侧(0.62)→下注贴各家身前, 不再往桌心堆(配合底池下移到 52%)
          if (d===0){
            // 我(桌底)座位列很高(含正面大底牌), flex 居中把头像顶到列首; 老 0.62 公式把筹码摆到头像上被自己遮住(主人反馈)。
            //   摆到头像正上方又会撞中央行动提示 → 改贴【头像右侧·同高】的空档felt: 既不被大头像盖, 也不压中央提示。
            //   用实测头像矩形定位(座位是 translate 居中、列高不定, 按 offset 算不准); 拿不到时兜底老公式。
            const avrEl = seatEl.querySelector('.pk-avr');
            const tr = els.table.getBoundingClientRect();
            if (avrEl && tr.width && tr.height){
              const ar = avrEl.getBoundingClientRect();
              // chip 是 translate(-50%) 居中: 中心 x = 头像右缘 + chip半宽 + 8px 间隙 → 整块清出头像, 不叠青环。
              const cw = commitEl.offsetWidth||34;
              commitEl.style.left = ((ar.right - tr.left + cw/2 + 8)/tr.width*100)+'%';
              commitEl.style.top  = (((ar.top+ar.bottom)/2 - tr.top)/tr.height*100)+'%';
            } else {
              const ccx0 = 50 + (cx-50)*0.62, ccy0 = CY + (cy-CY)*0.62;
              commitEl.style.left = ccx0+'%'; commitEl.style.top = ccy0+'%';
            }
          } else {
            // 投入筹码摆各家身前(座位→桌心方向内移)。竖屏公共牌行又宽又居中(cx≈24~76 / cy≈30~47),
            //   侧席按比例插值会正落在牌行/底池上(主人反馈"下注位置遮挡其他元素")→ 落点若进中央牌区,
            //   就沿竖向推出牌带(上半席推到牌行上方 cy28, 下半席推到下方 cy49), 保证不压公共牌/底池。
            const f = land ? 0.44 : 0.6;
            let ccx = 50 + (cx-50)*f, ccy = CY + (cy-CY)*f;
            if (!land && ccx>22 && ccx<78 && ccy>30 && ccy<47) ccy = (cy < CY ? 28 : 49);
            commitEl.style.left = ccx+'%'; commitEl.style.top = ccy+'%';
          }
        }
      }
    }

    function renderBoard(){
      if (st.phase==='lobby'){ els.board.innerHTML=''; lastBoardSig=''; lastBoardLen=0; return; }   // 招募态无公共牌
      // 增量护栏: 公共牌 id 序 + 摊牌高亮态 全未变 → 跳过整段重建。
      //   街与街之间(等各家行动, 每秒一次重绘)公共牌是静止的, 不必反复 innerHTML 重建 5 张 DOM。
      //   发新牌(board 变长)/进入摊牌(highlight 态变)都会改签名 → 照常重建, 逐张翻牌与金框高亮不受影响。
      const showHi = st.phase==='over' && st.result && st.result.wentToShowdown;
      const sig = st.board.map(c=>c.suit+c.rank).join(',')+'|'+(showHi?'hi':'')+'|'
        + (st.result&&st.result.winnersBySeat?st.result.winnersBySeat.join(','):'');
      if (sig === lastBoardSig) return;
      lastBoardSig = sig;
      const grew = st.board.length > lastBoardLen;
      els.board.innerHTML='';
      st.board.forEach((c,i)=>{
        const el = cardEl(c,{});
        if (grew && i>=lastBoardLen){
          el.classList.add('flip-in');
          // 逐张错峰翻开(对标真实发牌员一张张亮翻牌): flop 3 张不再齐刷刷同时翻,
          // 每张比上一张晚 110ms; pkFlip 用 both 填充, 未到点的牌保持 rotateY(90deg) 隐着不闪现。
          el.style.animationDelay = ((i - lastBoardLen) * 110) + 'ms';
        }
        els.board.appendChild(el);
      });
      // 未发的公共牌用暗牌背占位(共 5 张)
      for(let i=st.board.length;i<5;i++){ const b=cardEl(null,{back:true}); b.classList.add('dim'); els.board.appendChild(b); }
      if (grew){ sfx('cardplay'); lastBoardLen = st.board.length; }
      // 摊牌: 金框高亮赢家成手用到的公共牌(含平分池的多个赢家取并集), "靠哪几张赢"一目了然
      if (st.phase==='over' && st.result && st.result.wentToShowdown){
        const hi=new Set(); (st.result.winnersBySeat||[]).forEach(s=>{ const b=best5Set(s); if(b) b.forEach(id=>hi.add(id)); });
        if (hi.size) els.board.querySelectorAll('.card').forEach(el=>{ if(el.dataset.id && hi.has(el.dataset.id)) el.classList.add('pk-win-card'); });
      }
    }
    function renderPot(){
      if (st.phase==='lobby'){ const nn=st.players.filter(p=>p.kind!=='empty').length;
        els.blinds.textContent='🪑 招募中 · '+nn+'/'+n+' 席'; els.pot.innerHTML=''; return; }
      els.blinds.textContent = `盲注 ${st.sb}/${st.bb}`;   // "第N手"去掉: 单机连打无对局意义, 徒增元素
      // 台面底池: 常态只显【总底池】一枚居中药丸(st.pot ≡ 各家 committed 之和, 见 engine.syncPot)。
      //   旧版一旦有人全下, 就把 主池+每个边池 铺成一整排 pill —— 多次全下(4+ 边池)时那排 pill 横贯桌面、
      //   挤爆两侧对手牌与公共牌区(主人反馈"太紧凑·有点乱")。边池明细只在【结算面板 .pk-pots】展开,
      //   那里才真正需要"谁赢哪一池"的拆分; 打牌途中玩家只关心总池大小(算池底赔率), 一枚总池干净又忠实。
      els.pot.innerHTML = `<span class="pc"></span>底池 ${st.pot}`;
      // 底池增额时数字跳动(与筹码归池同拍); 新一手底池清零不跳
      if (lastPotShown>=0 && st.pot>lastPotShown){
        els.pot.classList.remove('bump'); void els.pot.offsetWidth; els.pot.classList.add('bump');
      }
      lastPotShown = st.pot;
    }
    // ── 飞行筹码 ──────────────────────────────────────────────
    //   街结束→身前投入筹码扫入中央底池; 结算→底池推向赢家。纯展示层, 不碰引擎/快照。
    //   目标点/起点都换算到 els.table 本地坐标(px), 用 CSS 变量 --dx/--dy 驱动 transform。
    const COLLECT_STREETS = { flop:1, turn:1, river:1, showdown:1, over:1 };
    function tableRect(){ return els.table.getBoundingClientRect(); }
    function potCenter(tr){                       // 底池标签中心(相对 table)
      const pr = els.pot.getBoundingClientRect();
      return { x: pr.left - tr.left + pr.width/2, y: pr.top - tr.top + pr.height/2 };
    }
    function flyChip(tr, sx, sy, tx, ty, kind, delay){
      const fx=document.createElement('div');
      fx.className='pk-flychip '+kind;
      fx.innerHTML='<span class="pc"></span>';
      fx.style.left=sx+'px'; fx.style.top=sy+'px';
      fx.style.setProperty('--dx',(tx-sx)+'px');
      fx.style.setProperty('--dy',(ty-sy)+'px');
      if(delay) fx.style.animationDelay=delay+'ms';
      els.table.appendChild(fx);
      setTimeout(()=>fx.remove(), 560+(delay||0));
    }
    // 街结束: 把当前(旧)身前筹码 DOM 位置捕获后, 生成飞向底池的筹码 —— 必须在 renderOpponents 重建座位【之前】调
    function collectChipsFx(){
      const chips = els.table.querySelectorAll('.pk-commit:not(.zero)');
      if (!chips.length) return;
      sfx('chip');                       // 筹码扫入底池: 一记叠码声(与出牌拍击区分)
      const tr = tableRect(); const pot = potCenter(tr);
      chips.forEach((src,i)=>{
        const r = src.getBoundingClientRect();
        const sx = r.left - tr.left + r.width/2, sy = r.top - tr.top + r.height/2;
        flyChip(tr, sx, sy, pot.x, pot.y, 'collect', i*22);
      });
    }
    function maybeCollectChips(){
      const from = animPhase; animPhase = st.phase;
      if (!(from==='preflop'||from==='flop'||from==='turn'||from==='river')) return;  // 只在下注街结束时扫
      if (st.phase===from || !COLLECT_STREETS[st.phase]) return;
      collectChipsFx();
    }
    // 结算: 底池推向赢家(赢家席位, 我方=底部). winners = 座位号数组
    function payoutChipsFx(winners){
      if (!winners || !winners.length) return;
      const tr = tableRect(); const pot = potCenter(tr);
      winners.forEach(seat=>{
        let tx, ty;
        const seatEl = els.table.querySelector(`.pk-seat[data-seat="${seat}"]`);
        if (seatEl){ const r=seatEl.getBoundingClientRect(); tx=r.left-tr.left+r.width/2; ty=r.top-tr.top+r.height/2; }
        else { tx = tr.width*0.5; ty = tr.height*0.92; }   // 我(mySeat)固定坐底
        for(let i=0;i<5;i++) flyChip(tr, pot.x, pot.y, tx, ty, 'payout', i*60);
      });
    }
    // ── 桌面赢家横幅 ──────────────────────────────────────────
    //   单机常规手不再弹结算面板: 摊牌牌面已随 phase='over' 铺在各席, 这里补一行顶部横幅
    //   (谁靠什么赢多少) + 推池筹码飞(payoutChipsFx), 停 ~2.3s 后自动发下一手(见 showOver)。
    function showWinBanner(html, win){
      hideWinBanner();
      const b=document.createElement('div');
      b.className='pk-winline'+(win?' win':'');
      b.innerHTML=html;
      els.felt.appendChild(b);
      _winBanner=b;
    }
    function hideWinBanner(){
      if(!_winBanner) return;
      const el=_winBanner; _winBanner=null;
      el.classList.add('out'); setTimeout(()=>{ if(el.parentNode) el.remove(); }, 260);
    }
    function streetName(){ return ({preflop:'翻牌前',flop:'翻牌',turn:'转牌',river:'河牌',showdown:'摊牌',over:'结算'})[st.phase]||''; }
    function connPill(){ return connState==='online' ? '' : ('<span class="pk-conn '+connState+'">'+connLabel(connState)+'</span>'); }
    function renderMsg(){
      const cp = connPill();
      if (st.phase==='lobby'){ els.msg.className='pk-msg'; els.msg.innerHTML=cp+'🪑 招募中 · 点空位邀灵魂或真人入座'; return; }
      if (st.phase==='seating'){ els.msg.className='pk-msg'; els.msg.innerHTML=cp+'🪑 灵魂陆续入座…'; return; }
      if (st.phase==='waiting'){ els.msg.className='pk-msg'; els.msg.innerHTML=cp+'🎴 等房主发牌…'; return; }
      if (st.phase==='over'){ els.msg.className='pk-msg'; els.msg.innerHTML=cp; return; }
      const seat=st.toAct;
      if (seat===mySeat){ els.msg.className='pk-msg mine'; els.msg.innerHTML=cp+'🫵 轮到你 · '+streetName(); }
      else { els.msg.className='pk-msg'; els.msg.innerHTML=cp+(st.players[seat]?escapeHtml(st.players[seat].name):'…')+' 思考中… · '+streetName(); }
    }

    function renderMe(){
      if (st.phase==='lobby'){
        // "我"已画在椭圆底部座位(见 positionSeats 招募态), 这里的 pk-me 条不再重复头像,
        //   只留一行居中房主提示, 与 pk-acts 的「开始」按钮上下呼应。
        els.me.innerHTML = `
          <div class="pk-info" style="flex:1;text-align:center">
            <div class="pk-hint">🪑 招募中 · 点空位邀灵魂或真人入座，齐了点「开始」发牌</div>
          </div>`;
        lastMeSig=''; return;
      }
      const p=st.players[mySeat];
      const mine = st.toAct===mySeat && st.phase!=='over';
      const showdown = (st.phase==='over' && st.result && st.result.wentToShowdown && st.result.reveal && st.result.reveal[mySeat]);
      const holeCards = (showdown ? st.result.reveal[mySeat].hole.map(idCard) : p.hole);
      // 增量护栏: 底牌条只在 阶段/是否轮我/摊牌/弃全下/筹码/庄位/需跟额/发牌帧/底牌 变化时重建。
      //   等别家行动时(每秒重绘)这些全不变 → 跳过, 免 innerHTML 重建 + 免每帧读牌算 hint。任一变化改签名照常重建。
      let callAmt=-1;
      if (mine){ try{ callAmt = Engine.legalActions(st, mySeat).callAmount; }catch(e){ _ehCatch('poker.legalActions', e); } }
      const myBlind = blindBadge(mySeat);
      // 翻后实时成手(对标腾讯"你现在是: 两对"): 公共牌≥3 张且未弃牌时, 用我的底牌+公共牌算当前最佳成手名。
      let madeStr='';
      if (!p.folded && Eval && Eval.evaluate && Array.isArray(st.board) && st.board.length>=3
          && holeCards.length===2 && holeCards[0] && holeCards[1]){
        try { madeStr = Eval.evaluate(holeCards.concat(st.board)).name; }
        catch(e){ _ehCatch('poker.madeHand', e); }
      }
      const boardSig = Array.isArray(st.board) ? st.board.map(c=>c.id).join('') : '';
      const meSig = st.phase+'|'+(mine?1:0)+'|'+(showdown?1:0)+'|'+(p.folded?1:0)+'|'+(p.allin?1:0)+'|'+p.stack
        +'|'+(st.button===mySeat?1:0)+'|'+myBlind+'|'+callAmt+'|'+(dealAnim?1:0)+'|'+boardSig+'|'+madeStr
        +'|'+holeCards.map(c=>c?(c.suit+''+c.rank):'x').join(',')
        +'|'+(st.result&&st.result.winnersBySeat?st.result.winnersBySeat.join(','):'');
      if (meSig === lastMeSig) return;
      lastMeSig = meSig;
      let hint='';
      if (st.phase==='seating'){ hint='🪑 等灵魂入座后开牌…'; }
      else if (st.phase==='waiting'){ hint='🎴 等房主发牌…'; }
      else if (st.phase==='over'){
        const won=(st.result.winnersBySeat||[]).includes(mySeat);
        hint = won ? '🏆 这手你赢了' : (p.folded?'你已弃牌':'本手结束');
      } else if (p.folded){ hint='你已弃牌 · 观战本手'; }
      else if (p.allin){ hint='你已全下 · 等摊牌'; }
      else if (mine){
        const la=Engine.legalActions(st, mySeat);
        hint = la.toCall>0 ? `需跟注 <b>${la.callAmount}</b>` : '可过牌或下注';
        // 单机练习桌: 给真人和 AI 同等的数值辅助 —— 蒙特卡洛胜率 + 底池赔率(要赢多少才不亏)。
        //   只用【我自己的底牌+公共牌】算(我本就知道的信息, 不碰别家底牌), 不违脱敏命门; 仅单机开, 联机不显。
        if (isLocalSolo && AI && AI.equityMC && holeCards.length===2 && holeCards[0] && holeCards[1]){
          try{
            const nOpp = Math.max(1, st.players.filter(x=>x.seat!==mySeat && !x.folded).length);
            const eq = AI.equityMC(holeCards, Array.isArray(st.board)?st.board:[], nOpp, secureRand, 120);
            hint += ` · 胜率 <b>${Math.round(eq*100)}%</b>`;
            if (la.toCall>0){ const odds=la.toCall/((st.pot||0)+la.toCall); hint += ` · 需赢 ${Math.round(odds*100)}%`; }
          }catch(e){ _ehCatch('poker.equityHint', e); }
        }
      } else { hint='等待其他玩家行动'; }
      // "我"的头像/名字/筹码/底牌(正面)已画在椭圆底部座位(见 seatHTML 的 pk-me-seat 分支), 倒计时走座位环。
      //   这条桌外 pk-me 只留一行操作提示(需跟注/可过牌/胜率/当前成手), 紧贴下方操作按钮, 不再重复展示我的信息。
      els.me.innerHTML = `
        <div class="pk-info" style="flex:1;text-align:center">
          <div class="pk-hint">${hint}${madeStr?` · 当前 <b>${escapeHtml(madeStr)}</b>`:''}</div>
        </div>`;
      dealAnim=false;
    }

    // ── 操作区 ──
    let raiseTo = 0;
    let awaitingHost = false;
    // 预选(pre-action): 不是我回合时先勾好意向, 轮到我自动执行并按实况复核。
    //   仅单机陪玩(isLocalSolo)开放 —— 联机需回传同步, 不在本批范围。
    //   'checkfold'=过牌/弃牌(总执行) · 'check'=只过牌(有人下注则作废) · 'callany'=跟任意注(无注则过牌)。
    let preAct = null;   // null | 'checkfold' | 'check' | 'callany'
    // 操作条禁用骨架: 与激活态【同高同结构】——三键禁用 + 滑杆/快捷占位隐藏。中键文案随状态变(等待/已弃牌/已全下/离线/已提交)。
    function actsSkeleton(callLbl){
      return `
        <div class="pk-raise reserved"><input type="range" disabled><span class="pk-amt"></span></div>
        <div class="pk-quick reserved"><button class="pk-qbtn" disabled>最小</button><button class="pk-qbtn" disabled>½池</button><button class="pk-qbtn" disabled>⅔池</button><button class="pk-qbtn" disabled>底池</button><button class="pk-qbtn" disabled>全下</button></div>
        <div class="pk-row">
          <button class="pk-b fold" disabled>弃牌</button>
          <button class="pk-b call" disabled>${callLbl}</button>
          <button class="pk-b raise" disabled>加注</button>
        </div>`;
    }
    // 招募态操作区: 一键邀请(灵魂补位) / 邀真人 / 开始 ▶ —— 就在打牌页操作按钮位置(与斗地主同构)
    function renderLobbyCtrl(){
      if (!isHostLobby || !lobbyCtx || !lobbyCtx.actions){ els.acts.innerHTML=''; return; }
      const a = lobbyCtx.actions;
      const empties = st.players.filter(p=>p.kind==='empty').length;
      const hasSouls = ((lobbyCtx.souls||[]).length>0);
      const btns=[];
      // 「一键邀请」「邀真人」去掉(主人诉求): 空位可点座位邀灵魂/真人, 「开始」本就先补满灵魂再发牌, 两钮纯冗余。
      btns.push('<button class="pk-b call" data-lob="start">开始 ▶</button>');
      els.acts.innerHTML = `<div class="pk-row pk-lobacts">${btns.join('')}</div>`;
      const map={ fill:a.fillSouls, invite:a.inviteHumans, start:a.start };
      els.acts.querySelectorAll('[data-lob]').forEach(b=> b.onclick=()=>{ const f=map[b.dataset.lob]; if(typeof f==='function'){ closeInviteMenu(); f(); } });
    }
    let _lastActsSig='';
    function renderActs(force){
      if (st.phase==='lobby'){ _lastActsSig='lobby'; renderLobbyCtrl(); return; }
      const p=st.players[mySeat];
      // 已离座旁观: 恒显"旁观中"占位条, 无任何操作(我的回合已交 AI 托管)
      if (spectating){
        if(!force && _lastActsSig==='spectate') return;
        _lastActsSig='spectate';
        els.acts.innerHTML = actsSkeleton('🔭 旁观中 · 已离座');
        return;
      }
      const offline = isGuest && connState!=='online';
      const mine = !offline && !awaitingHost && st.toAct===mySeat && (st.phase==='preflop'||st.phase==='flop'||st.phase==='turn'||st.phase==='river');
      // 非本人行动态: 渲染同高禁用骨架(而非清空塌陷), 三键常驻不跳版
      if (!mine){
        // 预选条: 单机陪玩, 我还在这一手(未弃/未全下)且当前轮到别家 → 让我先勾意向, 到点自动执行。
        const canPre = isLocalSolo && !offline && !awaitingHost && p && !p.folded && !p.allin
          && (st.phase==='preflop'||st.phase==='flop'||st.phase==='turn'||st.phase==='river')
          && st.toAct>=0 && st.toAct!==mySeat && p.stack>0;
        if (canPre){
          const sig='pre:'+(preAct||'-');
          if(!force && sig===_lastActsSig) return;
          _lastActsSig=sig;
          renderPreActBar();
          return;
        }
        let callLbl='等待行动';
        if (offline) callLbl = (connState==='host_offline'?'房主离线':'连接中…');
        else if(awaitingHost) callLbl='已提交 · 等待裁决';
        else if (st.phase==='seating') callLbl='等灵魂入座';
        else if (st.phase==='waiting') callLbl='等房主发牌';
        else if (st.phase==='showdown'||st.phase==='over') callLbl='本手结束';
        else if (p && p.folded) callLbl='已弃牌 · 观战';
        else if (p && p.allin) callLbl='已全下 · 等摊牌';
        // 签名护栏: 非我回合 skeleton 文案不变就不重建(等对手时每秒一次的 renderAll 不再白白重建操作区)
        const sig='wait:'+callLbl;
        if(!force && sig===_lastActsSig) return;
        _lastActsSig=sig;
        els.acts.innerHTML = actsSkeleton(callLbl);
        return;
      }
      // 我的回合: 总重建(含 slider/快捷键链路, 且每次重建重新绑事件) —— 这一枝本就低频, 不护栏
      _lastActsSig='mine:'+st.phase+':'+st.toAct+':'+raiseTo;
      const la=Engine.legalActions(st, mySeat);
      const canRaiseLike = la.canBet || la.canRaise;
      const min=la.minRaiseTo, max=la.maxRaiseTo;
      if (raiseTo<min || raiseTo>max) raiseTo = Math.min(Math.max(min, Math.round((st.pot||bb))), max);
      // 无金额的按钮(过牌)不再塞占位 .bt(&nbsp; 会占一行 14px 把文案顶离垂直中心)——
      //   按钮本身 min-height:54px + justify-content:center, 单行文案自然上下居中(主人反馈: 没下注额度时文案要居中)。
      const callTxt = la.canCheck ? '过牌' : `跟注 <span class="bt">${la.callAmount}</span>`;
      const raiseLabel = la.canBet ? '下注' : '加注';
      const isAllinAmt = raiseTo>=max;
      els.acts.innerHTML = `
        <div class="pk-raise${canRaiseLike?'':' reserved'}">
          <input type="range" id="pkSlider" min="${min}" max="${max}" step="1" value="${raiseTo}">
          <span class="pk-amt" id="pkAmt">${raiseTo}</span>
        </div>
        <div class="pk-quick${canRaiseLike?'':' reserved'}">
          <button class="pk-qbtn" data-q="min">最小</button>
          <button class="pk-qbtn" data-q="half">½池</button>
          <button class="pk-qbtn" data-q="twothird">⅔池</button>
          <button class="pk-qbtn" data-q="pot">底池</button>
          <button class="pk-qbtn" data-q="allin">全下</button>
        </div>
        <div class="pk-row">
          <button class="pk-b fold" id="pkFold" ${la.canFold?'':'disabled'}>弃牌</button>
          <button class="pk-b call${la.canCheck?' check':''}" id="pkCall">${callTxt}</button>
          <button class="pk-b raise ${isAllinAmt?'allin':''}" id="pkRaise" ${canRaiseLike?'':'disabled'}>${isAllinAmt?'全下':raiseLabel} <span class="bt">${isAllinAmt?raiseTo:('至 '+raiseTo)}</span></button>
        </div>`;
      const slider=$('#pkSlider'), amt=$('#pkAmt'), rb=$('#pkRaise');
      // syncAmt 只做廉价 textContent 写(拖动每秒触发数十次): 不再每 tick 整段重建 rb.innerHTML,
      //   只在"是否全下"真正翻转时改前导词 + .allin 类; 金额走 .bt 子节点 textContent。拖动丝滑不掉帧。
      let lastAllin = isAllinAmt;
      let allinArmed = false;   // 全下二次确认: true=已点过一次"全下", 再点才真梭哈
      let allinConfirmT = null;
      function disarmAllin(){ allinArmed=false; if(allinConfirmT){ clearTimeout(allinConfirmT); allinConfirmT=null; } if(rb) rb.classList.remove('confirm'); }
      function syncAmt(){
        if(amt) amt.textContent=raiseTo;
        if(slider) slider.style.setProperty('--fill', (max>min ? ((raiseTo-min)/(max-min)*100) : 0)+'%');   // 滑杆已投入部分填色
        if(rb){
          const ai=raiseTo>=max;
          if(!allinArmed){ const bt=rb.querySelector('.bt'); if(bt) bt.textContent = ai? String(raiseTo) : ('至 '+raiseTo); }
          if(ai!==lastAllin){ lastAllin=ai; rb.classList.toggle('allin',ai);
            if(!ai){ disarmAllin(); }   // 拖离全下额: 撤销待确认态
            if(!allinArmed && rb.firstChild && rb.firstChild.nodeType===3) rb.firstChild.nodeValue = (ai?'全下':raiseLabel)+' '; }
        }
      }
      // 音效只在拖动结束(change)响一次, 不再每个 input tick 打一发("机关枪"音)。
      if(slider){
        syncAmt();   // 初始填色到位(否则首帧 --fill 缺省 0%)
        slider.addEventListener('input', ()=>{ raiseTo=parseInt(slider.value,10)||min; syncAmt(); });
        slider.addEventListener('change', ()=>{ sfx('cardsel'); });
      }
      room.querySelectorAll('.pk-qbtn').forEach(b=> b.addEventListener('click', ()=>{
        const q=b.dataset.q; const pot=Math.max(st.pot,bb);
        // 快捷档均按"加注到"语义(当前注 + 底池比例); 最小=引擎给的 minRaiseTo, 全下=max。
        let to = q==='min'? min : q==='half'? st.currentBet+Math.round(pot*0.5) : q==='twothird'? st.currentBet+Math.round(pot*2/3) : q==='pot'? st.currentBet+pot : max;
        raiseTo=Math.min(Math.max(to,min),max); if(slider) slider.value=raiseTo; syncAmt(); sfx('cardsel');
      }));
      $('#pkFold').addEventListener('click', ()=>humanAct('fold'));
      $('#pkCall').addEventListener('click', ()=>humanAct(la.canCheck?'check':'call'));
      if(rb) rb.addEventListener('click', ()=>{
        // 全下(把全部筹码梭进去)要二次确认防误触: 第一次点亮"确认全下", 3.5s 内再点才执行, 逾时/拖离自动撤销。
        if(raiseTo>=max && !allinArmed){
          allinArmed=true; rb.classList.add('confirm');
          if(rb.firstChild && rb.firstChild.nodeType===3) rb.firstChild.nodeValue='确认全下 ';
          const bt=rb.querySelector('.bt'); if(bt) bt.textContent='再点一次';
          sfx('click'); vibrate(14);
          if(allinConfirmT) clearTimeout(allinConfirmT);
          allinConfirmT=setTimeout(()=>{ allinArmed=false; allinConfirmT=null; if(rb){ rb.classList.remove('confirm'); syncAmt(); } }, 3500);
          return;
        }
        disarmAllin();
        humanAct(la.canBet?'bet':'raise', raiseTo);
      });
    }

    // 预选条: 与骨架同高(占位滑杆行 + 提示行 + 三键行), 三键为可点开关(再点取消)。
    function renderPreActBar(){
      const on = preAct;
      const btn = (key,label,cls)=>`<button class="pk-b pk-preb${on===key?' on':''}${cls?' '+cls:''}" data-pre="${key}">${label}</button>`;
      els.acts.innerHTML = `
        <div class="pk-raise reserved"><input type="range" disabled><span class="pk-amt"></span></div>
        <div class="pk-prehint">🕒 预选 · 轮到你自动执行</div>
        <div class="pk-row pk-prerow">
          ${btn('checkfold','过牌/弃牌','fold')}
          ${btn('check','过牌')}
          ${btn('callany','跟任意注','call')}
        </div>`;
      els.acts.querySelectorAll('[data-pre]').forEach(b=> b.addEventListener('click', ()=>{
        const k=b.dataset.pre;
        preAct = (preAct===k) ? null : k;   // 再点同一个 = 取消预选
        sfx('cardsel');
        renderActs(true);
      }));
    }
    // 轮到我: 按【当前】合法动作复核已勾预选并执行, 或因实况变化作废。返回 true=已代打(状态已推进)。
    function consumePreAction(){
      const pa = preAct; preAct = null;
      if (!pa) return false;
      if (st.toAct!==mySeat || awaitingHost) return false;
      const la = Engine.legalActions(st, mySeat);
      // ★la.toAct 是布尔(见 poker-engine legalActions: 返回 {toAct:true}), 不是座位号。
      //   旧写法 `la.toAct!==mySeat` = `true!==0` 恒真 → 所有预选被静默丢弃(过牌/弃牌/跟任意注全不执行,
      //   主人反馈"预选过牌/弃牌后别人加注不自动弃牌"的真因)。这里只需判"我此刻确实可行动"。
      if (!la || !la.toAct) return false;
      if (pa==='checkfold'){ humanAct(la.canCheck?'check':'fold'); return true; }
      if (pa==='check'){ if (la.canCheck){ humanAct('check'); return true; } toast('有人下注 · 预选「过牌」已取消'); return false; }
      if (pa==='callany'){ humanAct(la.canCheck?'check':'call'); return true; }
      return false;
    }

    function humanAct(action, amount, auto){
      if (st.toAct!==mySeat || awaitingHost) return;
      if (!auto) resetMiss(mySeat);   // 主动操作(点按/预选执行) → 清零挂机计数; 超时自动代打(auto)不清
      if (isGuest){
        if(onAction){
          try{ onAction({ action, amount }); }
          catch(e){ _ehCatch('poker.humanAct.onAction', e); toast('提交失败 · 请重试'); return; }
        }
        awaitingHost=true;
        els.acts.innerHTML=actsSkeleton('已提交'); els.msg.className='pk-msg mine'; els.msg.textContent='✅ 已提交 · 等待其他玩家…';
        return;
      }
      try{ var r=Engine.applyAction(st, mySeat, action, amount); }
      catch(e){ toast(actErr(e.message)); return; }
      afterAction(mySeat, action, amount, r);
    }

    // 底层权威落子(不碰挂机计数): onRemoteTimeout 的兜底代打走这里, 不清零远程席的超时累计。
    function _rawApply(seat, move){
      if(isGuest) return false;                // 客人无权威, 不本地应用
      if(!move || st.toAct!==seat) return false;
      try{ var r=Engine.applyAction(st, seat, move.action, move.amount); }catch(e){ return false; }
      afterAction(seat, move.action, move.amount, r);
      return true;
    }
    // host 权威应用【远程真人主动动作】 / 测试驱动任意席; 主动落子 → 清零该席挂机计数。
    function applyMove(seat, move){
      resetMiss(seat);
      return _rawApply(seat, move);
    }

    function aiStep(seat){
      if (isGuest) return;                     // 客人从不本地跑 AI
      if (st.toAct!==seat || st.phase==='over') return;
      let d; try{ d=AI.decide(st, seat, { persona: personaBySeat[seat] || 'tag', samples: 120 }); }catch(e){ d=null; }
      if(!d){ // 兜底: 能过就过, 否则弃
        const la=Engine.legalActions(st,seat); d = la.canCheck?{action:'check'}:{action:'fold'};
      }
      let r; try{ r=Engine.applyAction(st, seat, d.action, d.amount); }
      catch(e){ const la=Engine.legalActions(st,seat); try{ r=Engine.applyAction(st,seat, la.canCheck?'check':'fold'); d={action:la.canCheck?'check':'fold'}; }catch(_){ return; } }
      afterAction(seat, d.action, d.amount, r);
    }

    function afterAction(seat, action, amount, r){
      // 音效 + 台词
      sayOp(seat, ({ fold:'弃牌', check:'过', call:'跟注', bet:'下注', raise:'加注', allin:'全下' })[action] || '');
      if (action==='fold'){ if(seat!==mySeat){ sfx('pass'); beatQuip(seat,'fold'); } else sfx('pass'); }
      else if (action==='check'){ sfx('click'); }
      else if (action==='call'){ sfx('chip'); if(seat!==mySeat) beatQuip(seat,'call'); }
      else if (action==='allin'){ sfx('boom'); boomFx(); const nm=st.players[seat].name;
        emitBeat({ type:'allin', actor:nm, big:true, text:`💥 ${nm} 全下！`, quip: beatQuip(seat,'allin') }); }
      else { sfx('chip'); if(seat!==mySeat){ const nm=st.players[seat].name;
        emitBeat({ type:'raise', actor:nm, text:`↑ ${nm} ${action==='bet'?'下注':'加注'}到 ${amount}`, quip: beatQuip(seat,'raise') }); } }

      if (r && r.over){ renderAll(); setTimeout(()=>showOver(), r.result.wentToShowdown?450:200); return; }
      renderAll();
    }

    function boomFx(){
      vibrate([12,40,20]);
      els.felt.classList.remove('shake'); void els.felt.offsetWidth; els.felt.classList.add('shake');
    }
    function confetti(){
      const box=document.createElement('div'); box.className='pk-confetti';
      const EM=['🎉','💰','✨','🎊','⭐','🪙'];
      for(let i=0;i<16;i++){ const s=document.createElement('i');
        s.textContent=EM[Math.floor(secureRand()*EM.length)];
        s.style.left=(secureRand()*100)+'%'; s.style.animationDuration=(1.1+secureRand()*0.8)+'s';
        s.style.animationDelay=(secureRand()*0.3)+'s'; s.style.setProperty('--r',(360+Math.floor(secureRand()*540))+'deg');
        box.appendChild(s); }
      els.felt.appendChild(box); setTimeout(()=>box.remove(),2300);
    }

    // 分级高光: 摊牌牌型越大演出越隆重(同花顺/四条/通吃=名场面 · 葫芦/同花/顺子=大牌型 · 其余=轻彩带)
    function pkCelebrate(champTakeAll){
      const res=st.result;
      const PAL=['🎉','💰','✨','🎊','⭐','🪙'];
      let tier=1, label='', sub='';
      if (champTakeAll){ tier=3; label='通吃全场！'; }
      else if (res){
        const rv=(res.wentToShowdown && res.reveal && res.reveal[mySeat]) ? res.reveal[mySeat] : null;
        if (rv){ const c=rv.cat;
          if (c===8){ tier=3; label=/皇家/.test(rv.hand)?'皇家同花顺！':'同花顺！'; }
          else if (c===7){ tier=3; label='四条！'; }
          else if (c===6){ tier=2; label='葫芦！'; }
          else if (c===5){ tier=2; label='同花！'; }
          else if (c===4){ tier=2; label='顺子！'; }
        }
      }
      if (window.EHTableFx) EHTableFx.celebrate(els.felt, { tier, palette:PAL, label, sub }); else confetti();
    }

    // ── 回合驱动: 亮环倒计时 + AI/自动 ──
    function armTurn(onExpire){
      clearTimers();
      if (st.phase==='lobby' || st.phase==='over' || st.phase==='waiting' || st.phase==='seating') { turnSeatActive=-1; turnStreetActive=''; return; }
      // 摊牌/结算之外, 无人需行动的中间态不该发生(引擎自动跑完); 安全兜底
      const seat=st.toAct;
      if (seat<0 || !st.players[seat]) { turnSeatActive=-1; return; }
      const mine = seat===mySeat && !spectating;   // 旁观后我这席(isAI 已置真)按 AI 席自动推进, 不再算"我的回合"
      // 轮到我且有预选: 先按实况复核执行/作废。执行成功则状态已推进(afterAction→renderAll→armTurn 重入), 中止本次。
      if (mine && preAct){ if (consumePreAction()) return; }
      if (mine && !lastMyTurn){ sfx('yourturn'); vibrate(18); }
      lastMyTurn=mine;
      // 谁来推进这一步: 我(本地/relay) · AI(本机决策) · 远程真人(等回传, host 侧兜底代打) · guest 观战他人(静态)
      const remote = isRemote(seat);
      const aiSeat = !mine && !remote && !isGuest && isAI[seat];
      // 倒计时只在【回合真正切换】(座位或街变)时重置起点; 同回合重渲(收快照/每帧重绘)保持原起点继续走, 否则对手环被打回满格→"倒计时乱跳"。
      const turnChanged = (seat!==turnSeatActive) || (st.street!==turnStreetActive);
      turnSeatActive = seat; turnStreetActive = st.street;
      if (turnChanged){
        // ★灵魂/AI 席倒计时环与真人同一满格时钟(从 ACT_MS≈满格起走, 不再 1s 闪现)——主人: 灵魂倒计时要从 20s 开始不是从 1s。
        //   环只是展示; 灵魂真正出手在 turnAiAct(人类般 2~7s)到点触发, 通常在环走完前就行动, 环随回合切换自然重置。
        turnDur = mine     ? ACT_MS
                : isGuest  ? ACT_MS               // guest 看别人回合: 纯展示, 给人类时长让环正常走(原为 0 → 徽标从不更新/空白)
                : aiSeat   ? ACT_MS               // 灵魂席: 满格环(与真人一致), 出手时刻另见 turnAiAct
                : remote   ? (ACT_MS + 6000)       // host 兜底比对端稍长, 留网络冗余; 久不动就代打
                : 0;
        turnAiAct = aiSeat ? (AI_MIN_MS + Math.floor(secureRand()*AI_JIT_MS)) : 0;   // 灵魂"思考→出手"真实时长(独立于展示环)
        turnStart = Date.now();
      }
      // 我也坐椭圆了 → 我方回合也在自己座位上走圆环+秒数徽标(与对手一致), 不再依赖桌外 #pkClk(已移除)
      const seatEl = els.table.querySelector(`.pk-seat[data-seat="${seat}"]`);
      const clk = mine ? $('#pkClk') : null;       // #pkClk 已从 pk-me 移除, 此处恒 null, 下方 if(mine&&clk) 自然跳过
      const secEl = seatEl && seatEl.querySelector('.pk-sec');   // 行动席头像秒数徽标(含我)
      // 数字倒计时只给【有真死线】的席位(我 / host 视角下的远程真人): 到点真会被托管, 数字才有意义。
      //   本机 AI(灵魂)没有硬死线, 秒数从 2 跳 0 像坏了 → 头像只亮"思考中"💭 脉冲, 不显误导性倒计时(对齐 ddz/掼蛋)。
      const digitSeat = mine || remote;
      if (secEl && !digitSeat){ secEl.textContent='💭'; secEl.classList.add('think'); secEl.classList.remove('urgent'); }
      if (turnDur<=0) return;
      // ★折叠(minimized)态: 房 display:none, 环不可见 —— 不再起 rAF 每帧对隐藏节点写 --p(后台自动连打时
      //   会一直空转耗电)。只挂一个到点定时器: host 兜底代打远程超时 / 我方超时(onExpire, 折叠时为 null 即不动)。
      //   AI 席由下方 aiTimer 独立推进, 与可见与否无关。streetTimer 是空闲的已跟踪定时器, 借它承载, close 时随 clearTimers 清。
      if (minimized){
        if (mine || remote){
          const remainMs=Math.max(0,turnDur-(Date.now()-turnStart));
          streetTimer=setTimeout(()=>{ streetTimer=null;
            if(mine){ if(typeof onExpire==='function') onExpire(); }
            else if(remote){ onRemoteTimeout(seat); }
          }, remainMs);
        }
        if(aiSeat){ const remainMs=Math.max(0,turnAiAct-(Date.now()-turnStart)); aiTimer=setTimeout(()=>aiStep(seat), remainMs); }
        return;
      }
      // ★灵魂/AI(及 guest 观战)席: 头像亮"思考中"💭, 环也走消减动画 —— 与"我的"一致(主人: 别人的思考圈缺倒计时动画, 自己的有)。
      //   环时长取该席【真实出手时刻】而非虚假硬死线, 忠实非误导: AI 席 = turnAiAct(思考 2~7s, 环走到 0 正好出手);
      //   guest 观战他人 = turnDur(展示对家人类时钟)。只走环、不显数字秒(AI 无硬死线, 数字会从 2 跳 0 像坏了), 头像保留 💭。
      if (!digitSeat){
        if (aiSeat){ aiTimer = setTimeout(()=>aiStep(seat), Math.max(0, turnAiAct-(Date.now()-turnStart))); }
        const ringDur = aiSeat ? turnAiAct : turnDur;
        if (ringDur>0 && seatEl){
          let lastDegN=-1;
          const tickRing=()=>{
            const remain=Math.max(0, ringDur-(Date.now()-turnStart));
            const deg=Math.round((ringDur?remain/ringDur:0)*360);
            if(deg!==lastDegN){ seatEl.style.setProperty('--p',deg); lastDegN=deg; }
            if(remain<=0){ ringRAF=null; return; }
            ringRAF=requestAnimationFrame(tickRing);
          };
          tickRing();
        } else if (seatEl){ seatEl.style.setProperty('--p', 360); }
        return;
      }
      // 降频: 每帧只在整度数/整秒变化时才写 DOM(conic 环 1° 步进视觉等价), 免每秒几十次无谓重绘回流。
      let lastDeg=-1, lastSec=-1;
      const tick=()=>{
        const remain=Math.max(0,turnDur-(Date.now()-turnStart));
        const frac=turnDur?(remain/turnDur):0;
        const deg=Math.round(frac*360);
        if(seatEl && deg!==lastDeg){ seatEl.style.setProperty('--p',deg); lastDeg=deg; }
        const sec=Math.ceil(remain/1000);
        if(sec!==lastSec){
          if(secEl && digitSeat){ secEl.textContent=sec; secEl.classList.toggle('urgent',sec<=5); secEl.classList.remove('think'); }
          if(mine && clk){ clk.textContent=sec+'s'; clk.classList.toggle('urgent',sec<=5); }
          lastSec=sec;
        }
        if(remain<=0){ ringRAF=null;
          if(mine){ if(typeof onExpire==='function') onExpire(); }
          else if(remote){ onRemoteTimeout(seat); }
          return; }
        ringRAF=requestAnimationFrame(tick);
      };
      tick();
      if(aiSeat){ const remainMs=Math.max(0,turnAiAct-(Date.now()-turnStart)); aiTimer=setTimeout(()=>aiStep(seat), remainMs); }   // 同回合重渲用剩余思考时间, 否则 AI 行动被反复推迟
    }
    // host 侧: 远程真人久不响应 → 用引擎权威替其过牌/弃牌, 防一人掉线卡死全桌
    function onRemoteTimeout(seat){
      if (isGuest || st.toAct!==seat || st.phase==='over') return;
      bumpMiss(seat);   // 累计该远程席超时(达阈值→idleOut 转 AI); 先计再兜底代打本回合
      const la=Engine.legalActions(st, seat);
      _rawApply(seat, { action: la.canCheck?'check':'fold' });
    }
    function onHumanTimeout(){
      if (st.toAct!==mySeat || st.phase==='over' || spectating) return;
      const la=Engine.legalActions(st, mySeat);
      if (la.canCheck){ toast('超时 · 自动过牌'); humanAct('check', undefined, true); }
      else { toast('超时 · 自动弃牌'); humanAct('fold', undefined, true); }
      bumpMiss(mySeat);   // 累计我的超时(达阈值→idleOut 离座旁观)
    }

    // 摊牌时该席最优 5 张成手牌的 id 集合(高亮用)。数据只取自 st.result(公开 reveal+board),
    // 绝不读局中快照/别家底牌 —— 守脱敏命门。Eval 未加载或非摊牌局返回 null(静默不高亮)。
    function best5Set(seat){
      const res=st.result;
      if(!res||!res.wentToShowdown||!res.reveal||!res.reveal[seat]||!res.board||!Eval||!Eval.bestFive) return null;
      try { return new Set(Eval.bestFive(res.reveal[seat].hole.concat(res.board).map(idCard)).map(c=>c.id)); }
      catch(_){ return null; }
    }

    function showOver(){
      clearTimers();
      const res=st.result;
      // 本桌累计净盈亏: 结算刷新各席净额(此刻 p.stack 已是收池后的最终筹码)。座位徽标下一手起读它。
      st.players.forEach(p=> netSettled[p.seat] = p.stack - (buyin[p.seat]||START));
      saveScore();   // 存本桌累计净盈亏防重进清零
      const won=(res.winnersBySeat||[]).includes(mySeat);
      const my=st.players[mySeat];
      const delta = my.stack - my.start;

      // ── 单机常规手: 去掉结算弹窗, 直接在牌桌上"演赢筹码 + 自动发下一手" ──
      //   (主人: 多个弹窗太复杂, 直接在牌桌上完成下一局; 用动画表示赢走筹码, 再直接进发牌动画)
      //   仅单机(isLocalSolo)且非本场终结(未输光/未通吃)走此路; 破产/通吃/联机仍用下方完整面板。
      {
        const myNow = my.stack;
        const soulsAlive = st.players.filter(p=> p.seat!==mySeat && p.stack>0).length;
        const iBustNow   = isLocalSolo && myNow<=0;
        const iWonAllNow = isLocalSolo && soulsAlive===0 && myNow>0;
        if (isLocalSolo && !iBustNow && !iWonAllNow){
          const champSeat = (res.winnersBySeat||[])[0];
          const champName = (champSeat!=null && st.players[champSeat]) ? st.players[champSeat].name : '赢家';
          const champCount = (res.winnersBySeat||[]).length;
          const potTotal = (res.pots||[]).reduce((a,pt)=>a+pt.amount,0);
          const handName = (res.wentToShowdown && res.reveal && champSeat!=null && res.reveal[champSeat]) ? res.reveal[champSeat].hand : '';
          const line = champCount>1
            ? `🏆 ${champCount} 家平分 ${potTotal}`
            : `🏆 ${escapeHtml(champName)} 赢下 ${potTotal}${handName?(' · '+handName):''}`;
          showWinBanner(line, won);
          if ((res.winnersBySeat||[]).length) payoutChipsFx(res.winnersBySeat);
          if(won){ sfx('sparkle'); setTimeout(()=>sfx('bloom'),160); vibrate([20,60,30]); pkCelebrate(false); }
          else if(delta<0){ sfx('void'); vibrate(60); }
          emitBeat({ type:'over', actor:champName, big:true,
            text: `🏁 ${champName} 赢下 ${potTotal} 底池${handName?(' · '+handName):''}`,
            quip: beatQuip(champSeat, 'win') });
          if(typeof opts.onResult==='function'){ try{
            const potWon0=(res.pots||[]).filter(pt=>(pt.winners||[]).includes(mySeat)).reduce((a,pt)=>a+Math.floor(pt.amount/(pt.winners.length||1)),0);
            opts.onResult(res, st.log, { mySeat, potWon:potWon0, delta, handName, myStack:my.stack });
          }catch(e){ _ehCatch('poker.onResult', e); } }
          emitWallet();
          if (minimized) updateChip();
          // 自动发下一手(可被 clearTimers/close 清): 停 ~2.3s 看清摊牌牌面 + 推池筹码飞, 到点淡出横幅→nextHand
          if(overTimer){ clearTimeout(overTimer); clearInterval(overTimer); overTimer=null; }
          overTimer = setTimeout(()=>{ overTimer=null; hideWinBanner(); nextHand(); }, 2300);
          return;
        }
      }

      const over=document.createElement('div'); over.className='pk-over '+(delta>0?'win':'lose');
      let rowsHtml='';
      if (res.wentToShowdown && res.reveal){
        const order = displayOrder();
        rowsHtml = order.filter(s=>res.reveal[s]).map(seat=>{
          const rv=res.reveal[seat]; const w=(res.winnersBySeat||[]).includes(seat);
          const b5=best5Set(seat);
          const cards=rv.hole.map(id=>{ const el=cardEl(idCard(id),{mini:false}); if(b5&&b5.has(id)) el.classList.add('pk-win-card'); return el.outerHTML; }).join('');
          const nm=st.players[seat].name;
          return `<span class="mk">${w?'🏆':''}</span>`
            +`<span class="nm${w?' won':''}">${escapeHtml(nm)}${seat===mySeat&&nm!=='你'?'（你）':''}</span>`
            +`<span class="cd">${cards}</span>`
            +`<span class="hn">${rv.hand}</span>`;
        }).join('');
      } else {
        const w=res.winnersBySeat&&res.winnersBySeat[0];
        rowsHtml = `<span class="pk-foldwin">🏆 ${escapeHtml(st.players[w]?st.players[w].name:'赢家')} 收下底池（其余弃牌）</span>`;
      }
      const potWon = (res.pots||[]).filter(pt=>(pt.winners||[]).includes(mySeat)).reduce((a,pt)=> a + Math.floor(pt.amount/(pt.winners.length||1)), 0);
      // 边池拆分明细(有 all-in 分层时): 逐池列 归属赢家 + 金额(对标德州扑克摊牌结算)
      const potsHtml = (res.pots && res.pots.length>1)
        ? `<div class="pk-pots">${res.pots.map((pt,i)=>{
            const ws = (pt.winners||[]).map(s=>escapeHtml(st.players[s]?st.players[s].name:'')).join('、');
            return `<div class="pk-potline"><span class="pl-t">${i===0?'主池':'边池'+i}</span><span class="pl-a">${pt.amount}</span><span class="pl-w">${ws?('→ '+ws):''}</span></div>`;
          }).join('')}</div>`
        : '';

      // ── 本场终结判定(仅单机): 真人输光=本场负; 灵魂全空=通吃(本场胜) ──
      const myStackNow = my.stack;
      const soulsAliveNow = st.players.filter(p=> p.seat!==mySeat && p.stack>0).length;
      const iBust   = isLocalSolo && myStackNow<=0;
      const iWonAll = isLocalSolo && soulsAliveNow===0 && myStackNow>0;
      const matchOver = iBust || iWonAll;
      // 联机破产离桌: guest(非房主)输光即离桌 —— 不再被无限补码, 位子空出可被别人再坐。
      //   房主是本机裁判/庄家, 保持在桌不判离(否则一崩全桌散); host 自身补码沿用旧逻辑。
      const iLeaveNow = isGuest && myStackNow<=0;
      if (matchOver) over.className = 'pk-over ' + (iBust?'lose':'win');
      else if (iLeaveNow) over.className = 'pk-over lose';

      // 单机真人输光: 计入今日输光次数(res._bustCounted 保证每手只计一次, 防 showOver 重入重复计),
      //   到每日上限(PK_DAILY_MAX)则不再给"再来一局", 只能收工, 当天封盘。
      let bustLimit = false;
      if (iBust){
        if (!res._bustCounted){ res._bustCounted = true; pkAddBust(); }
        bustLimit = pkBustsToday() >= PK_DAILY_MAX;
      }
      const dailyLine = iBust
        ? `<div class="pk-daily ${bustLimit?'cap':''}">${bustLimit
            ? `今日已输光 ${PK_DAILY_MAX} 次 · 明天再战`
            : `今日第 ${pkBustsToday()}/${PK_DAILY_MAX} 次输光`}</div>`
        : '';

      // 标题/结算数字
      const busted = iBust || iLeaveNow;
      const h2 = (matchOver||iLeaveNow)
        ? (busted ? '💀 你把筹码输光了' : '👑 通吃全场！')
        : (delta>0?'🎉 赢下这手':(delta<0?'💸 输了这手':'🤝 打平'));
      const subLine = (matchOver||iLeaveNow)
        ? `<div class="pk-delta ${busted?'down':'up'}">${iLeaveNow?'离桌 · ':'本场结束 · '}最终 ${myStackNow} 筹码</div>`
        : `<div class="pk-delta ${delta>=0?'up':'down'}">${delta>=0?'+':''}${delta} 筹码</div>`;

      // 底部按钮: 破产离桌(guest 输光)→ 只给"离桌"; guest 常规→等房主; 本场终结(单机)→"再来一局";
      //   其余(单机 & 联机 host)全自动开下一手, 只显示倒计时(非可点), 到点自动发牌, 想停手点"收工"。
      let footer;
      if (iLeaveNow){
        footer = `<button class="pk-b call" id="pkLeave">离桌</button>`;
      } else if (isGuest){
        // 客人: 常态下一手由房主引擎自动连发(非手动门); 但房主已离线时别显灰"自动开始"让人干等 —— 直接给"离开牌桌"。
        footer = (connState==='host_offline')
          ? `<div class="pk-offnote">⚠ 房主已离线 · 本桌即将解散</div><button class="pk-b call" id="pkDone">离开牌桌</button>`
          : `<button class="pk-b" id="pkDone">收工</button><button class="pk-b" id="pkWait" disabled>下一手自动开始…</button>`;
      } else if (matchOver){
        // 通吃全场(对手都被我打光离场): 除"再来一局"外, 给"邀请对手继续"——补位新对手, 带着当前筹码接着打。
        footer = (iBust && bustLimit)
          ? `<button class="pk-b call" id="pkDone">收工</button>`
          : (iWonAll
              ? `<button class="pk-b" id="pkDone">收工</button><button class="pk-b" id="pkRestart">重开一桌</button><button class="pk-b call" id="pkInviteOn">邀请对手继续</button>`
              : `<button class="pk-b" id="pkDone">收工</button><button class="pk-b call" id="pkRestart">再来一局</button>`);
      } else {
        footer = `<button class="pk-b" id="pkDone">收工</button><button class="pk-b" id="pkAuto" disabled>下一手 <span id="pkCd" class="pk-cd"></span></button>`;
      }
      // 赢家一行(常显): 谁靠什么赢下多少 —— 一眼看清结果, 不必展开摊牌逐行去数。
      const champSeat0 = (res.winnersBySeat||[])[0];
      const champCount = (res.winnersBySeat||[]).length;
      const potTotalAll = (res.pots||[]).reduce((a,pt)=>a+pt.amount,0);
      const champNm = (champSeat0!=null && st.players[champSeat0]) ? st.players[champSeat0].name : '赢家';
      const champHnd = (res.wentToShowdown && res.reveal && champSeat0!=null && res.reveal[champSeat0]) ? res.reveal[champSeat0].hand : '';
      const champLine = champCount>1
        ? `🏆 ${champCount} 家平分 ${potTotalAll}`
        : `🏆 ${escapeHtml(champNm)} 赢下 ${potTotalAll}${champHnd?(' · '+champHnd):''}`;
      // 详情(默认折叠): 摊牌逐行(仅摊牌局) + 边池明细 + 本桌累计净盈亏 —— 想细看再点开, 默认不糊一屏。
      const showdownBox = (res.wentToShowdown && res.reveal)
        ? `<div class="pk-showbox"><div class="pk-showrows">${rowsHtml}</div></div>` : '';
      const netsHtml = `<div class="pk-nets"><div class="pk-nets-t">本桌净盈亏（相对买入）</div>${
            displayOrder().map(seat=>{
              const v=netSettled[seat]||0; const cls=v>0?'up':(v<0?'down':'zero');
              const nm=st.players[seat].name;
              return `<div class="pk-netline"><span class="nl-n">${escapeHtml(nm)}${seat===mySeat&&nm!=='你'?'（你）':''}</span><span class="nl-v ${cls}">${v>=0?'+':''}${v}</span></div>`;
            }).join('')
          }</div>`;
      over.innerHTML=`
        <div class="pk-over-card">
          <h2>${h2}</h2>
          ${subLine}
          ${dailyLine}
          <div class="pk-champ">${champLine}</div>
          <details class="pk-more">
            <summary>本手详情</summary>
            ${showdownBox}
            ${potsHtml}
            ${netsHtml}
          </details>
          <div class="pk-row" style="margin-top:2px">${footer}</div>
        </div>`;
      // 推池动画: 底池飞向赢家席位(我方=底部), 浮层延后淡入让筹码在绒面上先跑完
      if ((res.winnersBySeat||[]).length){ over.classList.add('payout-in'); payoutChipsFx(res.winnersBySeat); }
      els.felt.appendChild(over);
      curOver = over;   // 供 setConn 在房主掉线时改写本浮层的客人按钮(离场用 parentNode 判活, 无需处处清空)
      if(iWonAll || won){ sfx('sparkle'); setTimeout(()=>sfx('bloom'),200); vibrate([20,60,30]); pkCelebrate(iWonAll); }
      else if(busted){ sfx('void'); vibrate([90,60,90]); }
      else if(delta<0){ sfx('void'); vibrate(90); }

      // host(单机/联机)常规: 倒计时结束全自动开下一手(无手动按钮; "收工"可停)。
      //   联机有其他真人时给多一点时间读结算(5s), 纯单机 3s。破产离桌不自动进下一手。
      // autoT 提升为 room 级 overTimer(见 clearTimers): 若 close() 在结算倒计时中被外部调用(app.js gtClose),
      //   本地 autoT 曾残留继续 nextHand() 打到已 detach 的 DOM 上、永远重排 —— 现在 clearTimers 会一并清掉。
      function stopAuto(){ if(overTimer){ clearInterval(overTimer); overTimer=null; } }
      stopAuto();
      if (!isGuest && !matchOver){
        // 多局连打提速: 结算只停够看清赢家(联机 4s 让多名真人读摊牌 / 单机 3s 读净盈亏+摊牌), 到点即自动发下一手。
        let left = (remoteSeats.length>0) ? 4 : 3;
        const cd=over.querySelector('#pkCd'); if(cd) cd.textContent='('+left+'s)';
        overTimer=setInterval(()=>{
          left--;
          if(left<=0){ stopAuto(); if(over.parentNode){ over.remove(); nextHand(); } return; }
          const c=over.querySelector('#pkCd'); if(c) c.textContent='('+left+'s)';
        }, 1000);
      }
      const restartBtn = over.querySelector('#pkRestart');
      if (restartBtn) restartBtn.addEventListener('click', ()=>{ stopAuto(); over.remove(); resetMatch(); });
      // 通吃后"邀请对手继续": 空席全部补上机器人, 带着当前筹码接着打(不重置我的战果)。
      const invOnBtn = over.querySelector('#pkInviteOn');
      if (invOnBtn) invOnBtn.addEventListener('click', ()=>{ stopAuto();
        st.players.forEach(p=> { if(!p.sitOut) stacks[p.seat]=p.stack; });   // 固化本手结果(我的筹码)
        for (let s=0;s<n;s++){ if (s!==mySeat && !isRemote(s) && stacks[s]<=0){ vacated[s]=true; inviteBot(s, false); } }  // 先全部补位, 不逐个续打
        if (curOver && curOver.parentNode) curOver.remove();
        try{ hideWinBanner(); }catch(_){}
        if (aliveSeats().length>=2) nextHand();                  // 填完统一开新一手
      });
      // 破产离桌: 通知 app.js 把我的席位腾空(gtLeave), 再拆本地牌桌。
      const leaveBtn = over.querySelector('#pkLeave');
      if (leaveBtn) leaveBtn.addEventListener('click', ()=>{ stopAuto();
        if(typeof opts.onBust==='function'){ try{ opts.onBust(); }catch(e){ _ehCatch('poker.onBust', e); } } close(); });
      const doneBtn = over.querySelector('#pkDone');
      if (doneBtn) doneBtn.addEventListener('click', ()=>{ stopAuto(); close(); });

      // 直播战报 + 结果回调
      const champSeat = (res.winnersBySeat||[])[0];
      const champName = st.players[champSeat] ? st.players[champSeat].name : '赢家';
      const potTotal = (res.pots||[]).reduce((a,pt)=>a+pt.amount,0);
      const handName = res.wentToShowdown && res.reveal && champSeat!=null && res.reveal[champSeat] ? res.reveal[champSeat].hand : '';
      emitBeat({ type:'over', actor:champName, big:true,
        text: `🏁 ${champName} 赢下 ${potTotal} 底池${handName?(' · '+handName):''}`,
        quip: beatQuip(champSeat, 'win') });
      if(typeof opts.onResult==='function'){ try{ opts.onResult(res, st.log, { mySeat, potWon, delta, handName, myStack:my.stack }); }catch(e){ _ehCatch('poker.onResult', e); } }
      emitWallet();
      if (minimized) updateChip();
    }

    // ── 逐手重组牌手(host 权威): 中途有人坐下空位/离座 → 下一手边界应用, 绝不打断本手 ──
    //   我这席(mySeat)永远固定不动; 空位/AI/灵魂席由本机 AI 顶位, 有真人坐下则换真人 + 全新买入 START。
    //   引擎座位数(n)固定不变(德州 seat_count 恒定), 只切换每席"真人 remote / 本机 AI"的驱动方, 座号不错位。
    let pendingRoster = null;
    function updateRoster(A){
      if (isGuest || !A || !Array.isArray(A.names) || A.names.length !== n) return;
      pendingRoster = A;
    }
    function applyPendingRoster(){
      const A = pendingRoster; pendingRoster = null;
      if (!A) return;
      for (let s=0; s<n; s++){
        if (s === mySeat) continue;                 // 我这席不受名册改动影响
        const wasHuman = !isAI[s], nowHuman = !A.isAI[s];
        const newUid = A.ids ? (A.ids[s] || null) : null;
        const realOccupant = !!newUid;              // 真人 uid / 指定灵魂 auth_uid(空位·AI 占位 id 为 null)
        names[s]   = A.names[s];
        avatars[s] = A.avatars[s];
        isAI[s]    = A.isAI[s];
        if (ids) ids[s] = newUid;
        if (A.souls) souls[s] = A.souls[s];
        // 空缺席被【真正的新占位】填上(换了个人/灵魂): 全新买入, 净盈亏归零, 解除 vacated。
        //   newUid !== vacatedUid: 防 DB 尚未腾空前, 名册仍带着刚离场那位 → 被误当"新人"复活。
        const fillingVacant = vacated[s] && realOccupant && newUid !== vacatedUid[s];
        if (fillingVacant || (!wasHuman && nowHuman)){
          stacks[s] = START; buyin[s] = START; netSettled[s] = 0;
          vacated[s] = false; vacatedUid[s] = null; saveScore();
        } else if (vacated[s] && !realOccupant){
          vacatedUid[s] = null;                     // DB 已把该席腾空 → 之后同一位灵魂也可被重新邀请
        }
      }
      personaBySeat = names.map((_, seat) => personaFor(seat));
      remoteSeats.length = 0; (A.remoteSeats || []).forEach(x => remoteSeats.push(x));
    }

    // 主人诉求: 点"返回"后不再无限后台连打 —— 到"下一局开始"这一刻就离场。
    //   有其他真人在桌 → 只是退出(离桌, 别人继续); 纯灵魂/AI 桌 → 结束整局。
    //   离桌 vs 散桌的实际落地由 app.js 注入的 onExit 按角色兜底(host→gtClose 散桌 / guest→本地清场离场),
    //   角色天然编码"有无真人": 你是客人 ⟺ 桌上有房主(真人)→ onExit 离场; 你是独自带灵魂的房主 → onExit 散桌。
    function leaveAfterReturn(){ close(); }

    function nextHand(){
      // 折叠(返回)态下不开新局: 当前这手已打完, 到此离场(见 leaveAfterReturn)
      if (minimized){ leaveAfterReturn(); return; }
      // ★无真人在玩就自动散桌(主人诉求): 我连续挂机被判离座旁观(spectating)后, 若桌上再无其他远程真人席,
      //   这桌只剩灵魂自娱自乐, 继续连打无意义(还空耗心跳/资源)。到"下一局"这一刻结束整局并解散。
      //   host solo: close→onExit→gtClose 置 closed 散桌; 有其他真人(remoteSeats 非空)照常连打, 不误伤。
      if (spectating && remoteSeats.length===0){
        try{ toast('你已离座 · 无真人在玩 · 牌桌自动解散', 3000); }catch(_){}
        try{ emitBeat({ type:'over', big:true, text:'🪑 无人在玩 · 牌桌自动解散' }); }catch(_){}
        close();
        return;
      }
      // 写回筹码 → (应用中途加入/离座名册变化) → 开新一手
      //   只同步"本手在座(非 sitOut)"席的结果: 空缺席/刚受邀补位席未参与本手, 其筹码以 stacks 为准(0=空 / START=新补位), 不被 st.players 的 0 覆盖。
      st.players.forEach(p=> { if (!p.sitOut) stacks[p.seat]=p.stack; });
      applyPendingRoster();
      // 对手都离场了(在座不足 2 人): 不强发牌, 停在结算态 —— 台面空位可点邀请补位, 邀满 2 人自动续打(见 inviteBot)。
      if (aliveSeats().length < 2){
        try{ toast('桌上没有对手了 · 点空位＋邀请补位', 3200); }catch(_){}
        renderOpponents(true); positionSeats();
        return;
      }
      button = (button+1)%n;
      handNo++;
      st = newHand();
      lastBoardLen=0; dealAnim=true; lastMyTurn=false; raiseTo=0; preAct=null; animPhase='preflop'; lastPotShown=-1; lastBoardSig=''; lastMeSig='';
      sfx('deal');
      renderAll(); positionSeats();
    }

    // 单机: 本场结束(真人输光)后从头再来 —— 全员重新带入 START, 从第一手开始
    function resetMatch(){
      stacks = names.map(()=>START);
      for(let i=0;i<n;i++){ buyin[i]=START; netSettled[i]=0; vacated[i]=false; vacatedUid[i]=null; }   // 本场重来: 买入基准/净盈亏归零, 离场标记清空
      saveScore();
      button = (typeof opts.button==='number') ? opts.button : (n - 1) % n;
      handNo = 0;
      st = newHand();
      emitWallet();   // 本场重来 = 重新补带 START, 钱包同步落地(否则破产后再来的 START 不落库, 关桌又回 0)
      lastBoardLen=0; dealAnim=true; lastMyTurn=false; raiseTo=0; preAct=null; animPhase='preflop'; lastPotShown=-1; lastBoardSig=''; lastMeSig='';
      sfx('deal');
      renderAll(); positionSeats();
    }

    // ── 招募态(就地牌桌 lobby): host 中途改席位 → 就地重渲空位; 点开始 → startDeal 就地转正局(同一 room 不重挂) ──
    function setLobby(seats, ctx){
      if (st.phase!=='lobby') return;
      if (ctx) lobbyCtx = ctx;
      if (Array.isArray(seats)) lobbySeats = seats;
      st = lobbyState(lobbySeats);
      renderOpponents(true); renderMe(); renderMsg(); renderPot(); renderActs(true);
      positionSeats();
    }
    function startDeal(A, seed){
      if (st.phase!=='lobby') return;
      try{ closeInviteMenu(); }catch(_){}
      // 名册就地全量生效(与 applyPendingRoster 同语义, 但这是首发, 全员重置买入)
      if (A && Array.isArray(A.names) && A.names.length===n){
        for (let s=0;s<n;s++){
          names[s]=A.names[s]; avatars[s]=A.avatars[s]; isAI[s]=A.isAI[s];
          if (ids) ids[s]=(A.ids?A.ids[s]||null:null);
          if (A.souls) souls[s]=A.souls[s];
        }
        remoteSeats.length=0; (A.remoteSeats||[]).forEach(x=>remoteSeats.push(x));
        personaBySeat = names.map((_, seat)=>personaFor(seat));
      }
      // 全新一桌: 筹码/买入/净盈亏/手数/庄位/离场标记全部重置
      stacks = names.map(()=>START);
      for(let i=0;i<n;i++){ buyin[i]=START; netSettled[i]=0; vacated[i]=false; vacatedUid[i]=null; }
      handNo = 0; button = 0; pendingRoster = null;
      lastBoardLen=0; dealAnim=true; lastMyTurn=false; raiseTo=0; preAct=null; animPhase='preflop'; lastPotShown=-1; lastBoardSig=''; lastMeSig=''; myHole=[];
      st = newHand(seed);
      sfx('deal');
      renderAll(); positionSeats();
    }

    // 单机开局: 我先坐下, 灵魂逐个入座, 到齐后发第一手 —— 消除"一开局灵魂就全在"的假感
    function runSeatingIntro(){
      const order = displayOrder();
      const soulSeats = order.slice(1);          // 除我以外, 按上弧顺序陆续到场
      arrived = new Set([mySeat]);
      lastSeated = -1;
      renderOpponents();                          // 先画一圈虚位
      const HELLO = ['来了','上桌','入座','等你很久了','开打吧','手气不错今天','谁怕谁'];
      let i = 0;
      const step = ()=>{
        if (!room.isConnected){ return; }         // 已关闭
        if (i >= soulSeats.length){ setTimeout(beginFirstHand, 460); return; }
        const seat = soulSeats[i++];
        arrived.add(seat); lastSeated = seat;
        sfx('arrive'); vibrate(10);
        renderOpponents();
        say(seat, rand(HELLO));
        setTimeout(step, 600);
      };
      setTimeout(step, 420);
    }
    function beginFirstHand(){
      if (!room.isConnected) return;
      introSeating = false; arrived = null; lastSeated = -1;
      st = newHand();
      lastBoardLen=0; dealAnim=true; lastMyTurn=false; raiseTo=0; preAct=null; animPhase='preflop'; lastPotShown=-1; lastBoardSig=''; lastMeSig='';
      sfx('deal');
      renderAll(); positionSeats();
    }

    function renderAll(){
      room.dataset.phase = st.phase;   // 招募态桌面化的 CSS 钩子: [data-phase="lobby"] 命中一整套空桌样式(打牌态无此属性→不受影响)
      maybeCollectChips();   // 街结束→筹码归池(须在 renderOpponents 重建座位/清 commit 之前捕获旧位置)
      renderPot(); renderBoard(); renderOpponents(); renderMe(); renderMsg(); renderActs();
      armTurn(minimized ? null : onHumanTimeout);
      if (minimized) updateChip();
      // 招募态不产快照(无牌可发/可泄, 与斗地主/掼蛋同构: lobby 不广播, startDeal 转正局后才走 onSync)
      if (onSync && !isGuest && st.phase!=='lobby'){ try{ onSync(st, handNo); }catch(e){ _ehCatch('poker.onSync', e); } }   // host: 每次状态变更 → 产快照广播 + 写底牌
    }

    // ── guest 端: 收公共快照 / 收自己底牌 → 组伪状态渲染(全程不碰引擎权威) ──
    function feedHand(cards){
      myHole = (cards||[]).map(c => (typeof c==='string') ? idCard(c)
        : (c && c.rank!=null ? Engine.pokerCard(c.rank, c.suit) : null)).filter(Boolean);
      if (isGuest && lastSnap) rebuildFromSnap(lastSnap);
    }
    function rebuildFromSnap(snap){
      if (!PokerNet){ console.warn('[pk] net not loaded'); return; }
      st = PokerNet.pseudoState(snap, mySeat, myHole);
      renderAll();
    }
    function applySnapshot(snap){
      if (!isGuest || !snap) return;
      awaitingHost=false;
      const prevHand = handNo;
      lastSnap = snap; handNo = snap.handNo || 0;
      if (snap.handNo !== prevHand){          // 新一手: 清结算层 + 重置动画; 底牌等 feedHand 补
        // 客人在"返回"(折叠)态下等到房主开出新一手 → 到此离场(房主/其余真人继续), 不再随房主无限连打。
        if (minimized){ close(); return; }
        const ov=els.felt.querySelector('.pk-over'); if(ov) ov.remove();
        lastBoardLen=0; dealAnim=true; lastMyTurn=false; raiseTo=0; preAct=null; animPhase='preflop'; lastPotShown=-1; lastBoardSig=''; lastMeSig=''; myHole=[];
      }
      rebuildFromSnap(snap);
      if (snap.phase==='over' && !els.felt.querySelector('.pk-over')) showOver();
    }
    function resync(){ if (onSync && !isGuest){ try{ onSync(st, handNo); }catch(e){ _ehCatch('poker.resync', e); } } }  // host: 应新客人之请重播当前态

    // id → card (供摊牌/对手明牌重建)
    const SUIT_OF = { s:'♠', h:'♥', c:'♣', d:'♦' };
    function idCard(id){ const suit=SUIT_OF[id[0]]; const rank=parseInt(id.slice(1),10); return Engine.pokerCard(rank, suit); }

    // 每日封盘页: 单机今日已输光满 PK_DAILY_MAX 次, 开桌即挡在牌前, 只能收工, 不发牌。
    function showDailyCap(){
      clearTimers();
      const over=document.createElement('div'); over.className='pk-over lose';
      over.innerHTML=`
        <div class="pk-over-card">
          <h2>🛑 今日德州已封盘</h2>
          <div class="pk-delta down">今天已经输光 ${PK_DAILY_MAX} 次 · 明天再来</div>
          <div class="pk-daily cap">单机练习每天最多输光 ${PK_DAILY_MAX} 次，手气次日归零</div>
          <div class="pk-row" style="margin-top:2px"><button class="pk-b call" id="pkDone">收工</button></div>
        </div>`;
      els.felt.appendChild(over);
      sfx('void'); vibrate([90,60,90]);
      const doneBtn = over.querySelector('#pkDone');
      if (doneBtn) doneBtn.addEventListener('click', ()=>{ close(); });
    }

    renderAll();
    // 首帧对手位置需等布局稳定
    requestAnimationFrame(positionSeats);
    // 单机今日输光已达上限: 不入座不发牌, 直接封盘页(收工)。否则正常走入座序列。
    if (isLocalSolo && !lobbyMode && pkLimitReached()){
      introSeating = false;
      showDailyCap();
    } else if (introSeating) runSeatingIntro();
    return { close, minimize, restore, isMinimized:()=>minimized, state:()=>st,
      applyMove, resync, applySnapshot, feedHand, updateRoster, mySeat:()=>mySeat,
      setConn, connState:()=>connState,
      isSpectating:()=>spectating, enterSpectator:()=>{ if(!spectating) idleOut(mySeat); },
      _forceTimeout:()=>onHumanTimeout(),   // 测试驱动: 触发一次我方超时代打+计数
      _bustSeat:(seat)=>{ if(st.players[seat]){ st.players[seat].stack=0; } stacks[seat]=0; },  // 测试: 把某席筹码清零(模拟输光)
      _nextHand:()=>nextHand(),              // 测试: 推进到下一手(触发离场/补位落地)
      _isVacant:(seat)=>!!vacated[seat],     // 测试: 该席是否已离场空缺
      _stackOf:(seat)=>stacks[seat],         // 测试: 读某席筹码
      _fakeWinAllOver:()=>{                   // 测试: 伪造"通吃全场"结算(对手清零弃牌 + 我收池), 触发真实 showOver 面板
        st.players.forEach((p,i)=>{ if(i!==mySeat){ p.stack=0; p.folded=true; } });
        st.result={ winnersBySeat:[mySeat], pots:[{amount:st.pot||0, winners:[mySeat]}], wentToShowdown:false };
        st.phase='over'; showOver();
      },
      _foldMe:()=>{ if(st.players[mySeat]){ st.players[mySeat].folded=true; } renderOpponents(true); },  // 测试: 我方弃牌(验底牌灰显不撤)
      missOf:s=>missStreak[s]||0,
      isLobby:()=>st.phase==='lobby', setLobby, startDeal,
      onRoomMsg:m=>{ if(dock) dock.onRoomMsg(m); } };
  }

  function rand(a){ return a[Math.floor(secureRand()*a.length)]; }
  function secureRand(){ try{ const x=new Uint32Array(1); crypto.getRandomValues(x); return x[0]/4294967296; }catch(_){ return Math.random(); } }
  function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function actErr(code){
    return ({ not_your_turn:'还没轮到你', cannot_check:'现在不能过牌，需跟注', raise_too_small:'加注太小',
      raise_below_min:'不足最小加注', bet_below_min:'低于最小下注', over_stack:'超过你的筹码',
      nothing_to_call:'无需跟注', cannot_act:'你已出局本手' })[code] || '这步不合法';
  }

  root.EHPokerGame = { open };
})(window);
