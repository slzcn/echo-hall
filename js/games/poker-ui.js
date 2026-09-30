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

  const HUMAN_ACT_MS = 10000;
  // 灵魂"思考→出手"时长: 2.2~7s 人类般节奏(旧 0.9~1.8s 太快, 环刚亮就消失像"从1s起")。
  //   这是真正出手的时刻; 座位倒计时环另按满格 ACT_MS 显示(见 armTurn turnDur), 到点前出手→环随回合切换重置。
  const AI_MIN_MS = 2200, AI_JIT_MS = 4800;
  const STREET_PAUSE_MS = 650;   // 一街下注结束 → 发下一街前的停顿(让筹码归池动画走完)

  // journey-exempt: 每日对局次数门禁读写 localStorage(eh_daily_plays_v1), 与 score.js 同源;
  //   静态断言见 journey-chip-authenticity.js, 无法在一趟旅程内连打 5 局真人对局。
  // ── 每日对局上限(主人要求): 一天最多进房玩 5 次, 到顶当天不能再开/进桌, 次日自动重置。
  //   计数源在 js/modules/score.js(eh_daily_plays_v1); startDeal 落一次, app.js 入口也门禁。
  const PK_DAILY_MAX = 5;
  const _daily = () => (root.EH_DAILY_PLAYS || null);
  function pkPlaysToday(){ const d=_daily(); return (d && typeof d.plays==='function') ? d.plays('nlhe') : 0; }
  function pkAddPlay(){ const d=_daily(); return (d && typeof d.bump==='function') ? d.bump('nlhe') : 0; }
  function pkLimitReached(){ const d=_daily(); return !!(d && typeof d.reached==='function' && d.reached('nlhe')); }

  const CSS_ID = 'pk-ui-css';
  function injectCSS(){
    if (document.getElementById(CSS_ID)) return;
    // journey-exempt: 牌桌 CSS 竖屏贴底/横屏紧凑 — 契约由 scripts/test-pk-layout-contract.js + journey-pk-ios-layout.js 覆盖
    const s = document.createElement('style'); s.id = CSS_ID;
    s.textContent = `
.pk-room{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;overflow:hidden;
  background:linear-gradient(180deg,var(--bg2,var(--bg2)),var(--bg,#070a12));border-radius:inherit;
  animation:pkRoomIn .22s cubic-bezier(.2,.9,.3,1);
  --cw:34px;--ch:48px;--cn:12px;--cs:10px;--cc:18px;--bcw:38px;--bch:54px;--banner:15px;
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
.pk-room.is-land .pk-me{padding:2px max(16px,env(safe-area-inset-left,0px)) calc(2px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));gap:10px;justify-content:center}
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
.pk-room.is-land .pk-board{flex-wrap:nowrap;height:64px;min-height:64px;overflow:hidden;align-items:center}
/* 对手: 底牌背隐去(悬头像下会压桌心公共牌; 弃牌仍以灰显表达), 名/筹码贴紧收短整列高度 */
.pk-room.is-land .pk-seat:not(.pk-me-seat){gap:1px}
.pk-room.is-land .pk-seat:not(.pk-me-seat) .pk-mini-hole{display:none}
/* 摊牌牌型标签(.pk-mini-hn "一对/两对/三条")横屏也隐去: 它给对手列多加 ~11px, 矮 felt 里把顶席顶进
   标题栏、侧位相邻两席挤触(2~4px); 摊底牌本就随 .pk-mini-hole 隐了, 标签成孤儿, 赢家牌型另有中央公告。 */
.pk-room.is-land .pk-seat:not(.pk-me-seat) .pk-mini-hn{display:none}
/* 本桌累计盈亏徽标(.pk-net "本桌 ±N")对手席横屏隐去: 第2手起每席多这一行(~11px), 是跨手撑高对手列、
   把顶席顶进标题栏/侧位互叠的真凶(单手测不到)。逐席净额结算面板 .pk-nets 里全有; 我的横向座位 net 内联不撑高, 保留。 */
.pk-room.is-land .pk-seat:not(.pk-me-seat) .pk-net{display:none}
.pk-room:not(.is-land) .pk-seat:not(.pk-me-seat) .pk-net{display:none}
/* 我的座位: 横向排(头像|名/筹码|正面底牌 一排), 列高 ~134→~54px, 坐桌底不再顶穿到桌心/动作栏 */
.pk-room.is-land .pk-me-seat{flex-direction:row;align-items:center;gap:9px;width:auto}
.pk-room.is-land .pk-me-seat .nm{max-width:76px}
.pk-room.is-land .pk-my-hole{margin-top:0}
/* 竖屏(iOS 手机): 桌面椭圆【贴底铺满 felt】—— 主人反馈"竖屏没占满底部空间"。
   旧写法 top:50% + 固定 58vh 椭圆居中 → felt 下半空一大块绿皮。
   现: bottom 贴 felt 底, 高度尽量吃满(min(容器高-边距, 620)), 座位弧仍按 % 随高缩放;
   我的座位条 + 操作区钉在 felt 下方, safe-area 由 table-shared 补齐。 */
@media (max-width:599px){
  .pk-room:not(.is-land) .pk-felt{ justify-content: flex-end; }
  .pk-room:not(.is-land) .pk-table{
    top: auto !important;
    bottom: 0 !important;
    transform: none !important;
    height: min(calc(100% - 6px), 620px);
  }
  .pk-room:not(.is-land) .pk-me{ padding-top: 2px; }
}
/* 横屏乱版修复: 结构锁不再给对手席 88px 硬高; 桌心/操作区沿用既有 is-land 压扁规则 */
.pk-room.is-land .pk-felt{ overflow: hidden; }
.pk-room.is-land .pk-table{ top: 6px !important; bottom: 6px !important; height: auto !important; transform: none !important; }
.pk-room.is-land .pk-center{ top: 52%; }
.pk-room.is-land .pk-me-seat{ flex-direction: row; align-items: center; gap: 8px; width: auto; }
/* ⟳ 旋转态(eh-rot)时房间盒被 JS 置换宽高: 再强制一版紧凑变量, 防 iOS 上媒体查询未命中时仍用竖屏大号牌 */
.pk-room.eh-rot{ --av:36px;--avf:16px;--seatw:70px;--cw:30px;--ch:36px;--cn:10px;--cs:8px;--cc:16px;--bcw:28px;--bch:40px; }
.pk-room.eh-rot .pk-acts{ min-height: 0 !important; }
.pk-room.eh-rot .pk-me{ min-height: 0 !important; }
@keyframes pkRoomIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.pk-bar{display:flex;align-items:center;gap:10px;flex-shrink:0;border-bottom:1px solid var(--line,color-mix(in srgb, var(--accent) 24%, transparent));
  padding:calc(11px + env(safe-area-inset-top,0px)) max(15px,env(safe-area-inset-right,0px)) 11px max(15px,env(safe-area-inset-left,0px))}
.pk-title{font-weight:800;letter-spacing:.06em;color:var(--ink);font-size:15px;display:flex;align-items:center;gap:8px;white-space:nowrap;flex-shrink:0}
.pk-title .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:var(--glow-cyan)}
/* 盲注牌: 放在牌桌内、自己头像正上方居中，像印在绒台上的桌规，不再占左上角。
   用低对比度青绿叠层融入绒面；绝对定位只改自身位置，不参与牌桌布局。 */
.pk-blinds{position:absolute;top:55%;bottom:auto;left:50%;z-index:6;transform:translateX(-50%);font-size:12px;letter-spacing:.1em;color:rgba(163,220,207,.34);font-weight:800;white-space:nowrap;pointer-events:none;text-shadow:0 1px 0 rgba(0,24,24,.42)}
html[data-mode="day"] .pk-blinds{color:rgba(0,92,82,.34);text-shadow:0 1px 0 rgba(255,255,255,.35)}
.pk-room.is-land .pk-blinds{bottom:auto;top:4px;left:50%;transform:translateX(-50%);font-size:11px}  /* 横屏: 桌顶居中, 避开公共牌/头像 */
@media (max-height: 760px){
  .pk-blinds{top:52%;font-size:11px}  /* 矮屏: 抬高避开本人座位(CY下移后同步抬高) */
}
/* 操作区固定骨架: 滑杆、快捷键、提示/快捷行、按钮行都固定高度, 状态切换不改变 felt 高度。 */
.pk-acts{height:161px;min-height:161px;flex:0 0 161px;box-sizing:border-box}
.pk-acts>.pk-raise{height:32px;min-height:32px;flex:none;box-sizing:border-box}
.pk-acts>.pk-quick,.pk-acts>.pk-prehint{height:40px;min-height:40px;flex:0 0 40px;box-sizing:border-box}
.pk-acts>.pk-row{height:54px;min-height:54px;flex:none;box-sizing:border-box}
.pk-room.is-land .pk-acts{height:145px;min-height:145px;flex-basis:145px}
.pk-acts>.pk-row>.pk-b{height:54px;min-height:54px;box-sizing:border-box}
/* 顶栏功能钮组(三游戏统一·磨砂玻璃圆钮): 音乐/横屏/返回 三颗同尺寸圆钮 + 同族线性 SVG 图标(等大等粗单色),
   悬浮青光按压回弹; 横屏态 ⟳ 亮青, 返回保留红调。告别 emoji/字符/文字混搭致大小不一。 */
.pk-mus,.pk-x{width:36px;height:36px;border-radius:50%;flex-shrink:0;cursor:pointer;padding:0;
  display:flex;align-items:center;justify-content:center;color:var(--sub);
  border:1px solid var(--line,color-mix(in srgb, var(--accent) 24%, transparent));
  background:linear-gradient(160deg,rgba(255,255,255,.06),rgba(0,0,0,.18));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 2px 6px rgba(0,0,0,.28);
  transition:transform .14s cubic-bezier(.2,.85,.3,1),color .14s,border-color .14s,box-shadow .14s}
.pk-mus{margin-left:auto}
.pk-ico{width:18px;height:18px;display:block}
.pk-mus:hover{color:var(--ink);border-color:var(--accent);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 4px 12px rgba(0,0,0,.32),0 0 14px color-mix(in srgb, var(--accent) 35%, transparent)}
.pk-mus:active:active,.pk-x:active{transform:scale(.9)}
.pk-mus.muted{color:var(--dim);opacity:.8}
.pk-rot.on{color:var(--accent);border-color:var(--accent);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 0 14px color-mix(in srgb, var(--accent) 50%, transparent)}
.pk-x:hover{color:var(--magenta);border-color:color-mix(in srgb,var(--magenta) 55%,transparent);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 4px 12px rgba(0,0,0,.32),0 0 14px color-mix(in srgb, var(--magenta) 30%, transparent)}
/* 窄屏(手机 <380px)顶栏防溢出: 收紧间距/边距, 给盲注 chip 让位(三钮已纯图标, 无需收字) */
@media (max-width:379px){
  .pk-bar{gap:6px;padding-left:max(10px,env(safe-area-inset-left,0px));padding-right:max(10px,env(safe-area-inset-right,0px))}
  .pk-title{font-size:14px}
}
/* 牌桌绒面 */
.pk-felt{flex:1;position:relative;display:flex;flex-direction:column;min-height:0;max-width:var(--maxw,none);width:100%;margin:0 auto;box-sizing:border-box;overflow:hidden}
.pk-felt.shake{animation:pkShake .42s cubic-bezier(.36,.07,.19,.97)}
@keyframes pkShake{10%,90%{transform:translateX(-1px)}30%,50%,70%{transform:translateX(-3px)}40%,60%{transform:translateX(3px)}}
.pk-table{position:absolute;left:3%;right:3%;top:9px;bottom:9px}
/* 绒面椭圆: 三游戏统一"真牌桌"材质(绿绒 radial + 实心暗边 + 青描边), 形状各随布局。★与斗地主/掼蛋 .*-center::before 同一套配方 */
/* 夜间: 更饱和的翡翠绒 —— 亮心 → 深绿绒 → 暗青边缘晕影, 叠一层极淡青雾光, 桌面从"灰蛋"变"真绿呢台面"。 */
.pk-table::before{content:'';position:absolute;left:4%;right:4%;top:6%;bottom:6%;border-radius:50%/46%;
  background:radial-gradient(ellipse 66% 58% at 50% 40%,color-mix(in srgb,var(--accent) 46%,transparent),color-mix(in srgb,var(--accent) 30%,var(--bg)) 52%,color-mix(in srgb,var(--accent) 14%,var(--bg2)) 100%);
  border:2px solid color-mix(in srgb,var(--accent) 24%,transparent);
  box-shadow:inset 0 3px 42px rgba(0,0,0,.5),inset 0 0 70px color-mix(in srgb, var(--accent) 6%, transparent),0 0 30px color-mix(in srgb, var(--accent) 9%, transparent)}
/* 内圈亮唇边: 台面边缘的一道细高光, 让椭圆有"绒台+围边"的立体层次(对标真实牌桌的皮质围边) */
.pk-table::after{content:'';position:absolute;left:4%;right:4%;top:6%;bottom:6%;border-radius:50%/46%;pointer-events:none;
  box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--accent) 14%, transparent),inset 0 1px 0 rgba(255,255,255,.06)}
/* 日间: 深绿绒在浅底上会成"灰蛋", 换清透薄荷绒(亮心→淡翡翠边)+ 青描边, 桌面清透不压眼且明显是"绿台" */
html[data-mode="day"] .pk-table::before{
  background:radial-gradient(ellipse 66% 58% at 50% 40%,color-mix(in srgb,var(--accent) 38%,#fff),color-mix(in srgb,var(--accent) 18%,#fff) 54%,color-mix(in srgb,var(--accent) 10%,var(--bg)) 100%);
  border:2px solid color-mix(in srgb,var(--accent) 24%,transparent);box-shadow:inset 0 2px 26px rgba(0,80,74,.1),0 10px 30px color-mix(in srgb, var(--accent) 10%, transparent)}
html[data-mode="day"] .pk-table::after{box-shadow:inset 0 0 0 1px rgba(255,255,255,.5),inset 0 1px 0 rgba(255,255,255,.7)}
/* 中央: 底池 + 公共牌
 * ★上移到 40%(椭圆几何中心 CY≈46 之上): "我"已摆上椭圆底部(270°), 底部两侧翼席(210°/-30°)落在 ~63%,
 *   旧的 top:52% 让底池/公共牌/提示与这两个下翼席的头像糊在一起(主人反馈"中间区域被遮挡")——见探针实测。
 *   而顶席(90°)到中心之间是大片空绒面。上移后底池+公共牌独占这块上中方空白, 下翼席让开, 层次分明。
 *   (下注筹码现按席摆各家身前 ccy=CY+(cy-CY)*0.62, 不再中心汇聚, 故不复"糊在一起"的老问题。) */
.pk-center{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:5;width:88%}
.pk-pot{font-size:13px;color:var(--amber);font-weight:800;letter-spacing:.03em;display:flex;align-items:center;gap:6px;
  background:rgba(4,10,14,.5);border:1px solid color-mix(in srgb, var(--amber) 35%, transparent);border-radius:999px;padding:3px 12px;white-space:nowrap}
.pk-pot .pc{width:11px;height:11px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe08a,#e0a020);box-shadow:0 1px 2px rgba(0,0,0,.4)}
.pk-board{display:flex;gap:5px;min-height:var(--ch,48px);align-items:center;justify-content:center;flex-wrap:wrap}
.pk-board .card.flip-in{animation:pkFlip .34s cubic-bezier(.2,.9,.3,1) both}
@keyframes pkFlip{from{transform:rotateY(90deg) scale(.8);opacity:0}to{transform:none;opacity:1}}
.pk-msg{font-size:var(--banner,13px);color:var(--sub);min-height:16px;text-align:center}
.pk-msg.mine{color:var(--ink);font-weight:800;text-shadow:0 0 8px color-mix(in srgb, var(--accent) 75%, transparent);border-radius:999px;background:linear-gradient(90deg,color-mix(in srgb, var(--accent) 26%, transparent),color-mix(in srgb, var(--accent) 5%, transparent));animation:pkTurnPulse 1.05s ease-in-out infinite}
/* 轮到自己行动: 提示条化作发光脉冲胶囊(halo+微缩放, 纯 box-shadow/transform 不改盒模型→不引入跳动) */
@keyframes pkTurnPulse{0%,100%{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 35%,transparent),0 0 6px color-mix(in srgb,var(--accent) 30%,transparent)}50%{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 70%,transparent),0 0 16px 3px color-mix(in srgb,var(--accent) 55%,transparent)}}
/* 座位(对手, 绝对定位于上弧) */
.pk-seat{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:2px;width:var(--seatw,78px);z-index:4}
/* 弃牌: 只把"人"(头像/名/筹码)灰掉表示出局, 底牌【保留花色】只压暗——主人: 弃了同花也得看得出,
   全灰(grayscale)红黑不分就分不清花色了。忠实表现"已弃但仍可辨认弃了什么"。 */
.pk-seat.folded .pk-avr,.pk-seat.folded .nm,.pk-seat.folded .stk{opacity:.4;filter:grayscale(.7)}
.pk-seat.folded .card{opacity:.72;filter:none}
.pk-avr{width:var(--av,44px);height:var(--av,44px);border-radius:50%;display:grid;place-items:center;padding:3px;box-sizing:border-box;position:relative;transition:background .15s}
.pk-seat.turn .pk-avr{background:conic-gradient(from -90deg,var(--accent) calc(var(--p,360)*1deg),var(--line,color-mix(in srgb, var(--accent) 18%, transparent)) 0)}
.pk-avr .av{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:var(--avf,20px);background:var(--panel-solid,var(--panel-solid));border:1.5px solid var(--line2);position:relative}
/* 行动席发光改脉冲(对齐 ddz/掼蛋): 静态发光扫一眼抓不住"轮到谁", 脉冲把眼睛拉过去 */
.pk-seat.turn .pk-avr .av{box-shadow:0 0 14px var(--accent,color-mix(in srgb, var(--accent) 60%, transparent));animation:pkSeatTurn 1.1s ease-in-out infinite}
@keyframes pkSeatTurn{0%,100%{box-shadow:0 0 10px 1px var(--accent,color-mix(in srgb, var(--accent) 50%, transparent))}50%{box-shadow:0 0 20px 5px var(--accent,color-mix(in srgb, var(--accent) 90%, transparent))}}
/* 回合秒数徽标: 只在当前行动席(含对手)头像右下角亮, 让"轮到谁、还剩几秒"看得见 */
.pk-sec{position:absolute;right:-4px;bottom:-4px;min-width:16px;height:16px;padding:0 3px;box-sizing:border-box;border-radius:8px;background:var(--panel-solid,var(--panel-solid));border:1px solid var(--amber);color:var(--amber);font-size:9px;font-weight:800;line-height:14px;text-align:center;font-variant-numeric:tabular-nums;display:none;z-index:5}
.pk-seat.turn .pk-sec{display:block}
.pk-sec.urgent{border-color:var(--magenta);color:var(--magenta);animation:pkBlink .6s steps(2,start) infinite}
@keyframes pkBlink{50%{opacity:.35}}
/* 本机 AI(灵魂)无硬死线: 显"思考中"💭 脉冲而非误导性数字倒计时(对齐 ddz/掼蛋 + 状态忠实) */
.pk-sec.think{border-color:var(--dim);color:var(--sub);font-size:10px;animation:pkThink 1.15s ease-in-out infinite}
@keyframes pkThink{0%,100%{opacity:.5}50%{opacity:1}}
.pk-seat.win .pk-avr .av{border-color:var(--amber);box-shadow:0 0 16px var(--amber,color-mix(in srgb, var(--amber) 70%, transparent))}
.pk-btn-d{position:absolute;right:-6px;bottom:-4px;width:18px;height:18px;border-radius:50%;background:#fff;color:#111;font-size:10px;font-weight:900;display:grid;place-items:center;box-shadow:0 1px 3px rgba(0,0,0,.5);z-index:5}
/* 小盲/大盲席位角标(对标腾讯: 盲位一眼看清)。摆头像左下, 与右下的 D 标错开。SB 蓝、BB 橙。 */
.pk-btn-bl{position:absolute;left:-6px;bottom:-4px;min-width:18px;height:15px;padding:0 3px;box-sizing:border-box;border-radius:7px;font-size:9px;font-weight:900;letter-spacing:.02em;display:grid;place-items:center;box-shadow:0 1px 3px rgba(0,0,0,.45);z-index:5;white-space:nowrap}
.pk-btn-bl.sb{background:#4aa3ff;color:#06233f}
.pk-btn-bl.bb{background:var(--amber);color:#3a2600}
.pk-btn-bl.inline{position:static;box-shadow:none}
/* 翻后实时成手 chip(对标腾讯牌力提示): 我的底牌+公共牌当前最佳成手名, 常驻名字行 */
.pk-made{font-size:11px;font-weight:800;letter-spacing:.02em;color:var(--accent);background:color-mix(in srgb, var(--accent) 10%, transparent);border:1px solid color-mix(in srgb, var(--accent) 28%, transparent);border-radius:999px;padding:1px 8px;white-space:nowrap}
.pk-seat .nm{font-size:11px;color:var(--sub);max-width:var(--seatw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-seat.turn .nm{color:var(--accent);font-weight:700}
.pk-seat .stk{font-size:11px;color:var(--dim);font-variant-numeric:tabular-nums}
.pk-seat .stk b{color:var(--ink)}
.pk-seat.allin .stk b{color:var(--magenta)}
/* all-in 高亮: 头像描品红脉冲环 + 醒目 ALL IN 角标(对标德州扑克的全下标识) */
.pk-seat.allin .pk-avr .av{border-color:var(--magenta);box-shadow:0 0 14px color-mix(in srgb, var(--magenta) 60%, transparent);animation:pkAllinRing 1.2s ease-in-out infinite}
@keyframes pkAllinRing{0%,100%{box-shadow:0 0 10px color-mix(in srgb, var(--magenta) 45%, transparent)}50%{box-shadow:0 0 18px color-mix(in srgb, var(--magenta) 85%, transparent)}}
.pk-allin-tag{position:absolute;left:50%;top:-10px;transform:translateX(-50%);font-size:9px;font-weight:900;letter-spacing:.08em;
  color:#fff;background:linear-gradient(150deg,#ff4d6d,var(--magenta));border:1px solid var(--magenta);border-radius:6px;padding:1px 5px;
  white-space:nowrap;z-index:6;box-shadow:0 2px 8px color-mix(in srgb, var(--magenta) 50%, transparent);animation:pkAllinPulse 1.1s ease-in-out infinite}
@keyframes pkAllinPulse{0%,100%{transform:translateX(-50%) scale(1)}50%{transform:translateX(-50%) scale(1.12)}}
/* 边池拆分: 主池 + 边池并排(有 all-in 分层时显示) */
.pk-potpart{display:inline-flex;align-items:center;padding:1px 7px;border-radius:999px;background:color-mix(in srgb, var(--amber) 10%, transparent);
  border:1px solid color-mix(in srgb, var(--amber) 26%, transparent);white-space:nowrap;margin-left:4px}
.pk-potpart.side{color:var(--sub,#8fb6b1);background:color-mix(in srgb, var(--violet) 10%, transparent);border-color:color-mix(in srgb, var(--violet) 28%, transparent)}
/* 结算边池明细 */
.pk-pots{display:flex;flex-direction:column;gap:3px;width:100%;margin:2px 0}
.pk-potline{display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 10px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid var(--line,color-mix(in srgb, var(--accent) 14%, transparent))}
.pk-potline .pl-t{color:var(--sub,#8fb6b1);font-weight:700;min-width:44px}
.pk-potline .pl-a{color:var(--amber);font-weight:900;font-variant-numeric:tabular-nums}
.pk-potline .pl-w{color:var(--ink);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 入座序列: 未到场的灵魂=虚位(虚线头像+呼吸); 刚落座=弹入 */
.pk-seat.arriving{opacity:.5}
.pk-seat.arriving .av{background:transparent;border:1.5px dashed var(--line2,color-mix(in srgb, var(--accent) 40%, transparent));animation:pkSeatWait 1.2s ease-in-out infinite}
.pk-seat.arriving .stk{color:var(--dim);font-style:italic}
@keyframes pkSeatWait{0%,100%{opacity:.45}50%{opacity:.9}}
.pk-seat.pk-justseated{animation:pkSeatPop .42s cubic-bezier(.2,.9,.3,1)}
@keyframes pkSeatPop{from{transform:translate(-50%,-50%) scale(.5);opacity:0}to{transform:translate(-50%,-50%) scale(1);opacity:1}}
.pk-cd{font-size:11px;opacity:.85;font-variant-numeric:tabular-nums}
.pk-mini-hole{display:flex;gap:2px;margin-top:1px;min-height:1px}
.pk-mini-hole .card{margin:0}
/* "我"的桌底座位(pk-me-seat): 底牌正面朝上, 比对手牌背大且带花色可读; 头像点青光 + 名字点青, 一眼认出"这是你" */
.pk-me-seat .pk-avr .av{box-shadow:0 0 0 2px var(--accent),0 0 12px color-mix(in srgb, var(--accent) 35%, transparent)}
.pk-me-seat .nm{color:var(--accent);font-weight:800}
/* "我"的底牌: 放大到可读尺寸, 去掉角标花色(.cs)——30px 小牌上"角标rank+角标花色+居中大花色"三元素挤成一坨(主人反馈"元素都叠一起了");
 *   只留【左上角 rank + 居中大花色】= 干净的标准读法, 两张牌间距也拉开。 */
.pk-my-hole{--cw:38px;--ch:52px;--cn:17px;--cc:24px;gap:7px;margin-top:2px}
.pk-my-hole .card{box-shadow:0 3px 8px rgba(0,0,0,.5)}
.pk-my-hole .card .cn{top:3px;left:5px}
.pk-my-hole .card .cs{display:none}
.pk-say{position:absolute;top:calc(var(--av,44px) + 2px);left:50%;transform:translateX(-50%);font-size:11px;color:var(--ink);background:var(--panel-solid,var(--panel-solid));border:1px solid var(--line);border-radius:10px;padding:3px 8px;max-width:140px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk-seat[data-side="left"] .pk-say{left:0;transform:none}
.pk-seat[data-side="right"] .pk-say{right:0;left:auto;transform:none}
.pk-say.show{opacity:1}
/* 身前投入筹码(朝中央) */
.pk-commit{position:absolute;transform:translate(-50%,-50%);z-index:3;display:flex;align-items:center;gap:4px;
  font-size:11px;font-weight:800;color:var(--ink);background:rgba(4,10,14,.6);border:1px solid color-mix(in srgb, var(--amber) 40%, transparent);border-radius:999px;padding:1px 8px;white-space:nowrap;font-variant-numeric:tabular-nums}
.pk-commit .pc{width:9px;height:9px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe08a,#e0a020)}
.pk-commit.zero{display:none}
/* 飞行筹码(街结束身前筹码扫入底池 / 结算底池归赢家) —— 对标大厂"筹码归池/推池"手感 */
.pk-flychip{position:absolute;transform:translate(-50%,-50%);z-index:6;pointer-events:none;will-change:transform,opacity}
.pk-flychip .pc{display:block;width:12px;height:12px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe08a,#e0a020);box-shadow:0 1px 3px rgba(0,0,0,.5),0 0 4px color-mix(in srgb, var(--amber) 40%, transparent)}
.pk-flychip.collect{animation:pkChipFly .42s cubic-bezier(.45,.05,.4,1) forwards}
.pk-flychip.payout{animation:pkChipFly .5s cubic-bezier(.3,.6,.35,1) forwards}
@keyframes pkChipFly{
  0%{opacity:0;transform:translate(-50%,-50%) scale(.5)}
  18%{opacity:1;transform:translate(-50%,-50%) scale(1)}
  100%{opacity:.15;transform:translate(calc(-50% + var(--dx,0px)),calc(-50% + var(--dy,0px))) scale(.7)}
}
.pk-pot.bump{animation:pkPotBump .42s ease}
@keyframes pkPotBump{0%,100%{transform:scale(1)}38%{transform:scale(1.22);text-shadow:0 0 10px color-mix(in srgb, var(--amber) 70%, transparent)}}
/* 结算浮层带推池动画时: 前 ~330ms 保持透明, 让底池筹码在可见绒面上飞向赢家, 之后再淡入盖住 */
.pk-over.payout-in{animation:pkOverPayoutIn .58s ease both}
@keyframes pkOverPayoutIn{0%,56%{opacity:0}100%{opacity:1}}
/* 桌面赢家横幅(单机常规手替代结算弹窗): 居中一行, 弹入停留→随自动发牌淡出。z 低于卡牌高亮, 不挡摊牌牌面。
   ★top 从 14% 下移到 26%: 14% 正压顶部中央席(对手数为奇数时 deg=90 那席落在 cx50%/cy14%),
   摊牌时横幅与该席头像/名字/气泡重叠(实测重叠~11px)。26% 落在"顶席气泡(~18%)"与"公共牌区(~40%)"之间的空档, 两不相撞。 */
.pk-winline{position:absolute;left:50%;top:26%;transform:translateX(-50%);z-index:8;pointer-events:none;
  font-size:14px;font-weight:900;letter-spacing:.03em;color:var(--ink);white-space:nowrap;
  padding:7px 18px;border-radius:999px;background:linear-gradient(180deg,rgba(19,42,41,.92),rgba(6,12,18,.9));
  border:1px solid var(--line2,color-mix(in srgb, var(--accent) 40%, transparent));box-shadow:0 6px 22px rgba(0,0,0,.5),0 0 18px color-mix(in srgb, var(--accent) 18%, transparent);
  backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:pkWinIn .34s cubic-bezier(.2,.9,.3,1) both}
.pk-winline.win{color:var(--amber);border-color:color-mix(in srgb, var(--amber) 50%, transparent);box-shadow:0 6px 22px rgba(0,0,0,.5),0 0 22px color-mix(in srgb, var(--amber) 28%, transparent)}
.pk-winline.out{animation:pkWinOut .24s ease forwards}
html[data-mode="day"] .pk-winline{color:var(--ink,#0c312e);background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(234,244,244,.92));border-color:var(--line2,color-mix(in srgb, var(--accent) 42%, transparent));box-shadow:0 6px 20px color-mix(in srgb, var(--accent) 16%, transparent),0 0 14px color-mix(in srgb, var(--accent) 10%, transparent)}
html[data-mode="day"] .pk-winline.win{color:var(--amber,#C8892E);border-color:rgba(200,137,46,.55);box-shadow:0 6px 20px color-mix(in srgb, var(--accent) 16%, transparent),0 0 18px rgba(200,137,46,.22)}
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
.pk-me{display:flex;align-items:center;justify-content:center;gap:12px;padding:4px 16px 0;flex-shrink:0}  /* 居中 */
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
.pk-spectate-tag{font-size:11px;color:var(--sub);margin-right:8px;white-space:nowrap}
/* 旁观态: 收掉 pk-me; 操作区保持与打牌态同高(三键常驻), 不闪不跳 */
.pk-room.pk-spectating .pk-me{display:none}
.pk-spectate-bar{display:flex;align-items:center;justify-content:center;width:100%}
.pk-spectate-pill{display:inline-flex;align-items:center;gap:18px;padding:7px 8px 7px 18px;border-radius:999px;background:var(--panel-solid);border:1px solid var(--line2);box-shadow:0 2px 10px rgba(0,0,0,.3)}
.pk-spectate-pill .pk-spectate-tag{font-size:13px;color:var(--sub);white-space:nowrap;font-weight:600;margin:0}
/* "坐下"按钮: 低饱和度(不再是刺眼亮绿/亮青), 与界面主色融合 —— accent 20% 混 panel 底 + 描边 */
.pk-spectate-pill .pk-b.spectate-sit{background:color-mix(in srgb,var(--accent) 20%,var(--panel-solid));color:var(--ink);border:1px solid color-mix(in srgb,var(--accent) 38%,transparent);box-shadow:none;font-weight:700;padding:8px 22px;border-radius:999px;cursor:pointer}
.pk-spectate-pill .pk-b.spectate-sit:active{filter:brightness(1.12)}
.pk-me .pk-clk{font-variant-numeric:tabular-nums;color:var(--amber);font-weight:800;margin-left:6px}
.pk-me .pk-clk.urgent{color:var(--magenta);animation:pkBlink .6s steps(2,start) infinite}
@keyframes pkBlink{50%{opacity:.35}}
/* 操作区 */
.pk-acts{display:flex;flex-direction:column;gap:8px;padding:8px 14px calc(6px + env(safe-area-inset-bottom,0px));flex-shrink:0}
.pk-raise{display:flex;align-items:center;gap:9px}
.pk-raise.hidden{display:none}
/* ★.reserved: 灰掉但保留高度 —— 操作条骨架恒定, 滑杆/快捷非我回合时灰掉显示(不可点击), 按钮行不上下跳(主人反馈"按钮别跳来跳去") */
.pk-raise.reserved,.pk-quick.reserved{opacity:.25;pointer-events:none}
/* 加注滑杆: 自定义细轨 + 圆钮(原生 accent-color 在日间浅底会渲成刺眼黑条——主人反馈)。
 *   已投入部分用 --accent 填充(syncAmt 写 --fill 百分比), 未填充走中性灰轨, 日/夜都干净。 */
.pk-raise input[type=range]{-webkit-appearance:none;appearance:none;flex:1;height:32px;background:transparent;cursor:pointer;margin:0}
.pk-raise input[type=range]::-webkit-slider-runnable-track{height:8px;border-radius:999px;border:1px solid var(--line2);
  background:linear-gradient(90deg,var(--accent) var(--fill,0%),var(--sl-track,rgba(127,127,127,.22)) var(--fill,0%))}
.pk-raise input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:22px;height:22px;margin-top:-8px;border-radius:50%;
  background:var(--accent);border:2px solid var(--panel-solid,#fff);box-shadow:0 1px 5px rgba(0,0,0,.35)}
.pk-raise input[type=range]::-moz-range-track{height:8px;border-radius:999px;border:1px solid var(--line2);background:var(--sl-track,rgba(127,127,127,.22))}
.pk-raise input[type=range]::-moz-range-progress{height:8px;border-radius:999px;background:var(--accent)}
.pk-raise input[type=range]::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:var(--accent);border:2px solid var(--panel-solid,#fff);box-shadow:0 1px 5px rgba(0,0,0,.35)}
.pk-raise .pk-amt{min-width:58px;text-align:center;font-size:14px;font-weight:800;color:var(--amber);font-variant-numeric:tabular-nums}
.pk-quick{display:flex;gap:6px}
.pk-qbtn{flex:1;min-height:38px;padding:6px 0;border-radius:9px;font-size:11px;font-weight:700;border:1px solid var(--line2);background:var(--panel);color:var(--sub);cursor:pointer}
.pk-qbtn:active{transform:scale(.95)}
.pk-qbtn:not(:disabled):hover{filter:brightness(1.15)}
.pk-row{display:flex;gap:9px;justify-content:center}
/* ★恒定高度 + flex 垂直居中: 单行(弃牌/预选)与两行(跟注 114/加注 至 404)按钮一律 min-height:54px 同高,
 *   状态在"预选条(单行)↔我的回合(两行)↔骨架"之间切换时按钮行不再忽高忽低跳动(主人反馈"按钮高度不一样,来回跳跃")。
 *   长文字靠 flex-center + nowrap 居中不溢出; 主标题字号用 clamp 随按钮宽自适应, 保证"文字长也定宽美观"。 */
.pk-b{flex:1;min-width:0;max-width:150px;min-height:54px;padding:6px 6px;border-radius:12px;font-weight:800;
  font-size:clamp(13px,3.7vw,15px);line-height:1.16;cursor:pointer;white-space:nowrap;overflow:hidden;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
  border:1px solid var(--line2);background:var(--panel);color:var(--ink);letter-spacing:.03em;transition:.14s}
.pk-b:active{transform:scale(.96)}
.pk-b:disabled{opacity:.35;cursor:not-allowed;box-shadow:none}
/* ★fix: 操作按钮补 hover 反馈(桌面端/平板): 轻微提亮+微缩, 与顶栏圆钮 hover 行为一致 */
.pk-b:not(:disabled):hover{filter:brightness(1.12)}
.pk-b:not(:disabled):hover:active{transform:scale(.96)}
/* 弃牌: 描边式次要键(原 sub 色裸字在日间浅底几乎看不清——主人反馈)。ink 字读得清, 700 字重+透明底比彩色主键安静。 */
.pk-b.fold{color:var(--ink);background:transparent;border-color:var(--line2);font-weight:700}
.pk-b.call{background:var(--accent);color:var(--btn-ink,#04060c);border-color:var(--accent);box-shadow:var(--glow-cyan)}
/* 过牌(不下注的被动动作): 不该顶满彩色主键(日间暗调 accent 会糊成脏橄榄——主人反馈)。走 accent 描边淡底, 干净且语义"温和"; 跟注/下注(真花钱)才留亮色主键。 */
.pk-b.call.check{background:transparent;color:var(--ink);border-color:var(--line2);box-shadow:none;font-weight:700}
.pk-b.raise{background:var(--amber);color:#04060c;border-color:var(--amber);box-shadow:0 0 12px color-mix(in srgb, var(--amber) 50%, transparent)}
.pk-b.raise.allin{background:var(--magenta);border-color:var(--magenta);color:#fff;box-shadow:var(--glow-mag,0 0 12px color-mix(in srgb, var(--magenta) 60%, transparent))}
/* 全下二次确认态: 第一次点"全下"进此态(需再点一次才真梭哈), 白描边+脉冲提示"这步会梭全部筹码, 别误触" */
.pk-b.raise.confirm{background:var(--magenta);border-color:#fff;color:#fff;animation:pkConfirmPulse .6s ease-in-out infinite alternate}
@keyframes pkConfirmPulse{from{box-shadow:0 0 0 2px rgba(255,255,255,.5),0 0 10px color-mix(in srgb, var(--magenta) 50%, transparent)}to{box-shadow:0 0 0 3px rgba(255,255,255,.98),0 0 20px color-mix(in srgb, var(--magenta) 85%, transparent)}}
.pk-b .bt{font-size:11px;line-height:14px;font-weight:700;opacity:.85;display:block}
/* 占位/旁观/等待态整行状态条: 不再把长文案("🔭 旁观中 · 已让座"/"已提交 · 等待确认")硬塞进 1/3 宽的中键
 *   (nowrap 撑破按钮=主人反馈"按钮文案超了")。改成占满一行的虚线提示条: 语义忠实(它本就不是可点按钮),
 *   文案可换行居中、任意长度都不溢出。与三键骨架【同高 54px】, 状态切换不跳版。 */
.pk-waitbar{flex:1;min-height:54px;display:flex;align-items:center;justify-content:center;text-align:center;
  border-radius:12px;border:1px dashed var(--line2);background:var(--panel);color:var(--sub);
  font-weight:700;font-size:13px;line-height:1.3;padding:6px 14px;letter-spacing:.02em}
/* 预选(pre-action)条: 提示行 + 三键(默认暗态, 选中 .on 高亮) */
/* ★提示行高度对齐骨架的快捷注行(.pk-quick=38px): 骨架(等待态)与预选条(轮我前)是同为"非我回合"的
 *   两种中间行——骨架用快捷注行、预选条用这条提示行。二者高差 20px 曾让 .pk-acts 在 发牌(seating→preflop)
 *   之间忽高忽低, 而 felt(flex:1)吸收高差 → 桌面(竖屏钉在 felt 48% 处)随之上下滑 → "发牌跳动"真凶。
 *   统一到 38px 后, 骨架/预选条/我的回合三态 .pk-acts 恒 163px, felt 高不变, 牌桌纹丝不动。 */
.pk-prehint{font-size:11px;color:var(--sub);text-align:center;letter-spacing:.06em;opacity:.85;
  min-height:38px;display:flex;align-items:center;justify-content:center}
.pk-preb{font-size:13px;padding:10px 0}
.pk-preb:not(.on){background:var(--panel);color:var(--sub);border-color:var(--line2);box-shadow:none}
.pk-preb.queued.fold{background:rgba(255,255,255,.06);color:var(--ink);border-color:var(--line2);box-shadow:inset 0 0 0 1.5px var(--sub)}
.pk-preb.queued:not(.fold):not(.call){background:color-mix(in srgb, var(--accent) 14%, transparent);color:var(--ink);border-color:var(--accent);box-shadow:0 0 10px color-mix(in srgb, var(--accent) 30%, transparent)}
.pk-preb.queued.call{background:var(--accent);color:var(--btn-ink,#04060c);border-color:var(--accent);box-shadow:var(--glow-cyan)}
/* 结算 */
/* 结算浮层可滚动(输光/多池高结算超出 felt 高度时, justify-content:center 会把卡片上下两头一起挤出 overflow:hidden 的 felt,
   底部"再来一局/收工"被裁掉 → 主人"德州输光后没法继续玩"的真因)。改用 overflow-y:auto 容器 + 卡片 margin:auto:
   内容矮时垂直居中, 内容高时可滚动且首尾都够得着(flex 里唯一不裁切的居中写法, 优于 justify-content:center)。 */
.pk-over{position:absolute;inset:0;z-index:9;display:flex;flex-direction:column;align-items:center;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;
  background:radial-gradient(ellipse at 50% 40%,rgba(6,14,20,.72),rgba(3,5,10,.9));backdrop-filter:blur(5px);animation:pkRoomIn .2s;padding:16px;box-sizing:border-box;text-align:center}
.pk-over-card{margin:auto;display:flex;flex-direction:column;align-items:center;gap:12px;width:min(340px,92%);box-sizing:border-box;
  padding:22px 20px 18px;border-radius:20px;animation:pkOverCard .28s cubic-bezier(.2,.9,.3,1) both;
  background:linear-gradient(180deg,rgba(19,42,41,.66),rgba(6,12,18,.72));border:1px solid var(--line2,color-mix(in srgb, var(--accent) 40%, transparent));
  box-shadow:0 16px 44px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.06)}
.pk-over.win .pk-over-card{border-color:color-mix(in srgb, var(--amber) 50%, transparent);box-shadow:0 16px 44px rgba(0,0,0,.55),0 0 34px color-mix(in srgb, var(--amber) 14%, transparent),inset 0 1px 0 rgba(255,255,255,.06)}
@keyframes pkOverCard{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
.pk-over-card .pk-row{width:100%}
/* 结算标题: 三游戏统一 27px/.07em/900; 胜=金(--amber)负=品红(--magenta), 与🏆桌面横幅同一套胜负色语言 */
.pk-over h2{font-size:27px;margin:0;letter-spacing:.07em;font-weight:900}
.pk-over.win h2{color:var(--amber);text-shadow:0 0 18px color-mix(in srgb, var(--amber) 60%, transparent)}
.pk-over.lose h2{color:var(--magenta);text-shadow:var(--glow-mag)}
.pk-over .pk-delta{font-size:18px;font-weight:900;font-variant-numeric:tabular-nums}
.pk-over .pk-delta.up{color:var(--accent)}.pk-over .pk-delta.down{color:var(--magenta)}
.pk-over .pk-daily{font-size:12px;font-weight:700;letter-spacing:.02em;color:var(--sub,#8fb6b1)}
.pk-over .pk-daily.cap{color:var(--magenta)}
/* 摊牌行改对齐网格: 标记/名字/底牌/牌型四列跨行对齐(旧的逐行居中会因赢家多个🏆而参差不齐)。 */
.pk-over .pk-showbox{width:100%;display:flex;justify-content:center;border-top:1px solid var(--line,color-mix(in srgb, var(--accent) 24%, transparent));padding-top:14px;margin-top:2px}
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
  background:var(--panel-solid);
  border:1px solid var(--line2);border-radius:16px;color:var(--ink);
  box-shadow:0 10px 28px rgba(0,0,0,.5);animation:pkChipIn .26s cubic-bezier(.2,.9,.3,1);-webkit-tap-highlight-color:transparent;user-select:none}
@keyframes pkChipIn{from{opacity:0;transform:translateY(10px) scale(.88)}to{opacity:1;transform:none}}
.pk-chip .ck-ic{font-size:21px;line-height:1;position:relative;flex:none}
.pk-chip .ck-tx{display:flex;flex-direction:column;min-width:0;line-height:1.28}
.pk-chip .ck-t{font-size:12px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk-chip .ck-s{font-size:11px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk-chip .ck-x{margin-left:1px;flex:none;width:22px;height:22px;border-radius:50%;border:1px solid var(--line,color-mix(in srgb, var(--accent) 24%, transparent));display:grid;place-items:center;font-size:12px;color:var(--sub)}
.pk-chip.turn{border-color:var(--accent);box-shadow:0 10px 28px rgba(0,0,0,.5),0 0 16px var(--accent,color-mix(in srgb, var(--accent) 55%, transparent))}
.pk-chip.turn .ck-ic::after{content:'';position:absolute;inset:-7px;border-radius:50%;border:2px solid var(--accent);animation:pkChipPulse 1.05s ease-out infinite;pointer-events:none}
@keyframes pkChipPulse{0%{transform:scale(.65);opacity:.9}100%{transform:scale(1.55);opacity:0}}
.pk-chip.over{border-color:var(--amber)}.pk-chip.over .ck-s{color:var(--amber)}
.pk-conn{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-right:6px;letter-spacing:.03em;vertical-align:1px}
.pk-conn.online{background:color-mix(in srgb, var(--accent) 12%, transparent);color:var(--accent);border:1px solid color-mix(in srgb, var(--accent) 35%, transparent)}
.pk-conn.reconnecting{background:color-mix(in srgb, var(--amber) 14%, transparent);color:var(--amber);border:1px solid color-mix(in srgb, var(--amber) 40%, transparent);animation:pkConnBlink 1s ease-in-out infinite}
.pk-conn.host_offline{background:color-mix(in srgb,var(--magenta) 16%,transparent);color:var(--magenta);border:1px solid color-mix(in srgb,var(--magenta) 45%,transparent)}
.pk-seat.offline .pk-avr{position:relative}
.pk-offline-tag{position:absolute;top:-4px;right:-4px;background:#666;color:#fff;font-size:10px;padding:1px 4px;border-radius:4px;white-space:nowrap;z-index:5;pointer-events:none}
@keyframes pkConnBlink{0%,100%{opacity:.62}50%{opacity:1}}
.pk-chip.hidden-alert{border-color:var(--magenta)!important;box-shadow:0 10px 28px color-mix(in srgb,var(--ink) 22%,transparent),0 0 20px color-mix(in srgb,var(--magenta) 70%,transparent)!important}
/* ── 本桌累计净盈亏(相对买入 buy-in 的净额): 座位小徽标 + 我的座位条 + 结算逐席列 ── */
.pk-seat .pk-net{font-size:9.5px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;margin-top:1px;letter-spacing:.02em}
.pk-net.up{color:var(--accent)}
.pk-net.down{color:var(--magenta)}
.pk-net.zero{color:var(--dim)}
.pk-me .pk-net{font-size:12px;font-weight:800;font-variant-numeric:tabular-nums;margin-left:1px}
/* 结算面板: 本桌累计净盈亏逐席一行(名字左, 净额右) */
.pk-nets{width:100%;display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--line,color-mix(in srgb, var(--accent) 24%, transparent));padding-top:12px;margin-top:2px}
.pk-nets-t{font-size:11px;color:var(--sub,#8fb6b1);font-weight:700;letter-spacing:.04em;margin-bottom:3px}
.pk-netline{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;padding:1px 4px}
.pk-netline .nl-n{color:var(--sub,#8fb6b1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-netline .nl-v{font-weight:900;font-variant-numeric:tabular-nums;flex:none}
.pk-netline .nl-v.up{color:var(--accent)}
.pk-netline .nl-v.down{color:var(--magenta)}
.pk-netline .nl-v.zero{color:var(--dim)}
/* 结算减负: 默认只显 结果+赢家一行+按钮; 摊牌/边池/净盈亏收进「本手详情」折叠(主人反馈"页面太复杂逻辑不清") */
.pk-over .pk-champ{font-size:13.5px;font-weight:800;color:var(--amber);letter-spacing:.02em;line-height:1.4}
.pk-over .pk-more{width:100%;border-top:1px solid var(--line,color-mix(in srgb, var(--accent) 24%, transparent));padding-top:4px;text-align:left}
.pk-over .pk-more>summary{font-size:12px;color:var(--sub,#8fb6b1);cursor:pointer;list-style:none;padding:5px 2px;font-weight:700;letter-spacing:.03em;user-select:none;text-align:center}
.pk-over .pk-more>summary::-webkit-details-marker{display:none}
.pk-over .pk-more>summary::after{content:' ▾';opacity:.7}
.pk-over .pk-more[open]>summary::after{content:' ▴'}
.pk-over .pk-more[open]>summary{margin-bottom:8px}
.pk-over .pk-more .pk-showbox{border-top:none;padding-top:0;margin-top:0}
.pk-over .pk-more .pk-nets{border-top:none;padding-top:10px}
.pk-over .pk-more .pk-pots{margin-top:8px}
.pk-over .pk-offnote{width:100%;font-size:12.5px;font-weight:700;color:var(--magenta);padding:2px 0 6px;letter-spacing:.02em}

/* ── 招募态桌面化(对齐斗地主/掼蛋"思路"): 空桌=一张亮着的真牌桌, 空位虚线可点环坐, 桌心一枚居中发光的招募牌章。
   德州原本连空位/邀请菜单/请离钮都没样式(裸态), 这里一并补齐。全部门控在 [data-phase="lobby"], 打牌态不受影响。 ── */
.pk-room[data-phase="lobby"] .pk-pot{display:none}      /* 招募态无底池 → 藏掉空药丸(不然桌心浮一枚空琥珀圈) */
.pk-room[data-phase="lobby"] .pk-board{display:none}    /* 招募态无公共牌 → 收起免占位 */
/* 空位: 虚线头像 + 可点(与斗地主/掼蛋空位同款视觉) */
.pk-lobby-empty{cursor:pointer}
.pk-lobby-empty .av{background:transparent;border-style:dashed;color:var(--accent);font-weight:700}
.pk-lobby-empty:hover .av{box-shadow:0 0 12px var(--accent,color-mix(in srgb, var(--accent) 50%, transparent))}
.pk-seat .stk.pk-lob{color:var(--sub);font-weight:600}
.pk-lobby-filled .stk.pk-lob .role{color:var(--accent)}
/* 打牌态空位(机器人输光离场后): 虚线＋号可点邀请, 与 lobby 空位同款; locked=非 host 不可点(仅示意) */
.pk-vacant{cursor:pointer;opacity:.92}
.pk-vacant .av{background:transparent;border-style:dashed;color:var(--accent);font-weight:700}
.pk-vacant:hover .av{box-shadow:0 0 12px var(--accent,color-mix(in srgb, var(--accent) 50%, transparent))}
.pk-vacant.locked{cursor:default;opacity:.55}
.pk-seat .stk.pk-vac{color:var(--sub);font-weight:600;font-size:11px}
/* 请离钮(host 点已入座者旁的 ×) */
.pk-lob-kick{position:absolute;top:-4px;right:0;width:18px;height:18px;line-height:16px;text-align:center;
  border-radius:50%;border:1px solid var(--line);background:var(--panel-solid,var(--panel-solid));color:var(--dim);
  font-size:11px;cursor:pointer;padding:0;z-index:6}
.pk-lob-kick:hover{color:var(--magenta);border-color:var(--magenta)}
/* 招募态桌心留白: "我"已坐正下方、招募提示交给底部 pk-me 条 → 藏掉桌心 msg 胶囊(免与底部文案重复、免压住围坐的座位圈) */
.pk-room[data-phase="lobby"] .pk-msg{display:none}
/* 日间: 深色绒面椭圆在浅底上会糊成"灰蛋", 招募态换极浅绿绒渐变 + 柔外晕(与斗地主/掼蛋日间同治) */
html[data-mode="day"] .pk-room[data-phase="lobby"] .pk-table::before{
  background:radial-gradient(ellipse at 50% 42%,rgba(255,255,255,.55),color-mix(in srgb, var(--accent) 5%, transparent) 60%,transparent 82%);
  border-color:color-mix(in srgb, var(--accent) 16%, transparent);box-shadow:inset 0 0 46px color-mix(in srgb, var(--accent) 6%, transparent),0 8px 30px color-mix(in srgb, var(--accent) 6%, transparent)}
/* 邀请入座菜单(招募态点空位弹出): 与掼蛋 .gd-invite-menu 同款 */
.pk-invite-menu{position:absolute;z-index:40;width:220px;max-height:60%;overflow:auto;padding:6px;
  background:var(--panel-solid,var(--panel-solid));border:1px solid var(--line2,color-mix(in srgb, var(--accent) 40%, transparent));border-radius:12px;
  box-shadow:0 8px 26px rgba(0,0,0,.5)}
.pk-invite-menu .im-ttl{font-size:11px;font-weight:800;color:var(--accent);padding:4px 8px 6px;letter-spacing:.04em}
.pk-invite-menu .im-sep{font-size:10px;color:var(--dim);padding:6px 8px 2px}
.pk-invite-menu .im-empty{font-size:11px;color:var(--dim);padding:6px 8px}
.pk-invite-menu .im-item{display:block;width:100%;text-align:left;background:transparent;border:0;border-radius:8px;
  padding:8px 10px;color:var(--ink);font-size:13px;cursor:pointer}
.pk-invite-menu .im-item:hover{background:color-mix(in srgb, var(--accent) 12%, transparent)}

`;
    document.head.appendChild(s);
  }

  function cardEl(card, opts){
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'card' + (opts.mini?' mini':'') + (opts.big?' big':'') + (opts.dim?' dim':'');
    if (opts.back){ el.classList.add('back'); return el; }
    // 占位牌(guest 本地推进时从占位牌堆抽出, label/suit 缺失): 渲染为背面, 等权威快照覆盖后显示真面
    if (!card.label || card.suit === '?'){ el.classList.add('back'); return el; }
    const red = (card.suit==='♥'||card.suit==='♦');
    el.classList.add(red?'red':'blk');
    el.innerHTML = `<div class="cn">${card.label || card.rank || '?'}</div><div class="cs">${card.suit}</div><div class="cc">${card.suit}</div>`;
    el.dataset.id = card.id;
    return el;
  }

  function open(opts){

    function bindTap(el, fn){
      if(!el) return;
      let done=false;
      const fire=(e)=>{ if(done) return; done=true; try{ fn(e); }catch(err){ try{ _ehCatch('bindTap', err); }catch(_){} }
        try{ el.blur(); }catch(_){} };   // 点完去焦点, 不留"选中"视觉
      el.addEventListener('pointerup', (e)=>{ if(e.button!=null && e.button!==0) return; fire(e); });
      el.addEventListener('click', (e)=>{ /* 兜底(键盘/个别环境) */ fire(e); });
      el.addEventListener('pointerdown', ()=>{ done=false; });
    }

    opts = opts || {};
    if (!Engine || !AI){ console.warn('[pk] engine not loaded'); return null; }
    // journey-exempt: 座位几何缓存/招募椭圆 — journey-games-xdevice + journey-terminal-layout
    injectCSS();
    try{ if(root.EhGameBgm) root.EhGameBgm.enter('poker'); }catch(_){}   // 进桌切德州 BGM

    const names   = opts.names   || ['你','阿岩','小凶','疯哥'];
    const avatars = opts.avatars || ['🙂','🗿','🔥','🤪'];
    const n = names.length;
    let mySeat = (typeof opts.mySeat==='number') ? opts.mySeat : 0;   // let: 旁观让座后置 -1, 坐空位可改
    const strategyMatchId = String(opts.matchId || opts.gameId || opts.scoreKey || ('poker-local-'+Date.now()+'-'+Math.random().toString(36).slice(2)));
    let strategyHandState = null, strategyHandId = 0;
    function strategyFor(seat, tableParse){
      if(!root.EHStrategy) return null;
      // 引擎换局即清理旧请求；牌桌仍在，但上一手建议不可跨局沿用。
      if(strategyHandState!==st){ root.EHStrategy.clear(strategyMatchId); strategyHandState=st; strategyHandId++; }
      const input={seat, hand:st.players[seat].hole, board:st.board,
        opponents:st.players.filter((p,i)=>i!==seat&&!p.folded&&!p.sitOut).length,
        pot:st.pot, currentBet:st.currentBet, toCall:Math.max(0,st.currentBet-st.players[seat].street), street:st.street, phase:st.phase};
      input.matchId=strategyMatchId; input.handId=strategyHandId;
      return root.EHStrategy.advise('poker', input, Object.assign({},root.__EH_STRATEGY_OPTIONS||{},
        {endpoint:root.__EH_STRATEGY_ENDPOINT,token:root.__EH_ACCESS_TOKEN||''}));
    }
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
    const MAX_MISS = (typeof opts.maxMiss==='number' && opts.maxMiss>0) ? opts.maxMiss : 2;  // 主人: 两轮没响应→自动离座旁观
    const onSeatIdle = (typeof opts.onSeatIdle==='function') ? opts.onSeatIdle : null;
    const onSeatResume = (typeof opts.onSeatResume==='function') ? opts.onSeatResume : null;  // 联机: 玩家手动接管 → 通知 app 重新入座(单机无此回调)
    // 旁观者点空位/底部"坐下": guest 满座旁观无引擎权威, 走 app 级抢位(DB join + 重入); 未提供时退回本地 resumeSeat(host/单机)
    const onGrabSeat = (typeof opts.onGrabSeat==='function') ? opts.onGrabSeat : null;
    const missStreak = {};                 // seat -> 连续超时次数
    let _handsIdle = 0;                    // 连续整局无本人响应局数(>=2 自动离座)
    let _actedThisHand = false;            // 本手我是否有过有效操作
    let spectating = false;                // 本人(mySeat)是否已离座旁观
    function resetMiss(seat){ if(missStreak[seat]) missStreak[seat]=0; if(seat===mySeat){ _actedThisHand=true; _handsIdle=0; } }
    function doEnterSpectator(){
      // ★旁观 = 起身让座(不是 AI 代打/托管): 腾空座位、留在房间, 想玩点空位再坐
      if (spectating) return;
        spectating = true;
        missStreak[mySeat] = 0;
        isAI[mySeat] = false;          // 不交 AI —— 德州无代打/托管
        if (personaBySeat) personaBySeat[mySeat] = null;
        preAct = null;
        const nm = (st.players[mySeat] && st.players[mySeat].name) || names[mySeat] || '我';
        // 腾出座位: 本地置空 + 通知 app 腾 DB 座(别人可坐 / 空位可再坐)
        const vacatedUid = (ids && ids[mySeat]) || null;
        try{
          if (st.players[mySeat]){ st.players[mySeat].kind='empty'; st.players[mySeat].folded=true; }
          names[mySeat]='空位'; avatars[mySeat]='＋';
          if (ids) ids[mySeat]=null;
          if (souls) souls[mySeat]=null;
          stacks[mySeat]=0;
        }catch(_){}
        selfVacatedUid = vacatedUid;
        try{ emitBeat({ type:'leave', actor:nm, text:'🪑 '+nm+' 起身旁观 · 座位已让出' }); }catch(_){}
        if (onSeatIdle){ try{ onSeatIdle(mySeat, { uid: null, mine:true, vacate:true }); }catch(_){} }
        // 旁观者 mySeat 不再占席: 渲染上按「无我席」走, 空位可点加入
        mySeat = -1;
        try{ renderActs(true); renderMsg(); renderMe(); renderOpponents(true); positionSeats(); }catch(_){}
    }
    function _clearAutoTrusteeOnNewDeal(){
      // 两局整局无本人操作 → 起身旁观(与斗地主/掼蛋同契约); 有过动作即清零。
      //   单机练习桌(isLocalSolo)只代打不离座 —— 超时把席交 AI, 绝不把本人踢进旁观。
      if(!_actedThisHand) _handsIdle++; else _handsIdle=0;
      if(_handsIdle>=2 && !spectating && !isLocalSolo){
        try{ doEnterSpectator(); }catch(_){}
      }
      _actedThisHand=false;
    }
    function bumpMiss(seat){
      if (isGuest) return;
      if (seat===mySeat ? spectating : (isAI[seat] || !isRemote(seat))) return;
      missStreak[seat] = (missStreak[seat]||0) + 1;
      if (missStreak[seat] >= MAX_MISS) idleOut(seat);
    }
    function idleOut(seat){
      missStreak[seat] = 0;
      const nm = (st.players[seat] && st.players[seat].name) || names[seat] || ('席'+seat);
      if (seat===mySeat){
        // 我的超时 = 起身旁观(让座), 不是 AI 代打
        doEnterSpectator();
        return;
      }
      // 别席超时: 该席交本机 AI 打完本手(不是托管功能, 是不让牌局卡死), 下一手可被补位
      isAI[seat] = true;
      const ri = remoteSeats.indexOf(seat); if(ri>=0) remoteSeats.splice(ri,1);
      if (personaBySeat) personaBySeat[seat] = personaFor(seat);
      toast(nm+' 连续超时 · 已离座');
      try{ emitBeat({ type:'idle', actor:nm, text:'💤 '+nm+' 挂机离座, 灵魂接手' }); }catch(_){}
      if (onSeatIdle){ try{ onSeatIdle(seat, { uid: ids?ids[seat]:null, mine: seat===mySeat }); }catch(e){ _ehCatch('poker.onSeatIdle', e); } }
      try{ renderActs(true); if(seat===mySeat){ renderMsg(); renderMe(); } }catch(_){}
    }
// 手动取消旁观、拿回自己的座位(主人诉求"进自动后应可手动取消恢复")。
    //   德州: idleOut 把我这席置 isAI + 配灵魂人格代打; 接管须逆向(收回 isAI/人格)、归零连超时账、
    //   清可能已排的 AI 代打, 复位回合起点(拿满死线)后 renderAll。联机的 host 重新入座由 onSeatResume 交 app。
    function resumeSeat(target){
      // 旁观后回来 = 坐进一个空位(不是原席复活); 没空位则继续旁观
      if (!spectating) return;
      // 优先点中的目标席(空位/已让座), 不在则退回首个空位
      let seat = (typeof target==='number' && target>=0 && target<n && st.players[target] && (st.players[target].kind==='empty' || !st.players[target].name || names[target]==='空位')) ? target : -1;
      if (seat<0){ for (let i=0;i<n;i++){ if (st.players[i] && (st.players[i].kind==='empty' || !st.players[i].name || names[i]==='空位')){ seat=i; break; } } }
      if (seat<0){ try{ toast('暂时没有空位，等有人离开再坐'); }catch(_){} return; }
      spectating = false;
      selfVacatedUid = null;
      mySeat = seat;
      missStreak[mySeat] = 0;
      isAI[mySeat] = false;
      if (personaBySeat) personaBySeat[mySeat] = null;
      preAct = null;
      if (st.players[mySeat]){ st.players[mySeat].kind='human'; st.players[mySeat].folded=false; st.players[mySeat].name = (opts && opts.name) || '你'; }
      names[mySeat]='你'; avatars[mySeat]=(opts && opts.avatar) || '🙂';
      if (ids) ids[mySeat]=(opts && opts.uid) || ids[mySeat] || myUid;
      stacks[mySeat]=stacks[mySeat]>0?stacks[mySeat]:seatBuyIn(mySeat);
      try{ toast('已入座 · 本手结束后上场', 2000); }catch(_){}
      try{ emitBeat({ type:'resume', actor:nm, text:'🙋 '+nm+' 回来了 · 重新入座' }); }catch(_){}
      if (onSeatResume){ try{ onSeatResume(mySeat, { uid: ids?ids[mySeat]:null }); }catch(e){ _ehCatch('poker.onSeatResume', e); } }
      try{ renderActs(true); renderMsg(); renderMe(); }catch(_){}
    }
    // host 侧: 把超时 idleOut 移出的远程真人席放回 remoteSeats, 停 AI 代打并重武装回合。
    function resumeRemote(seat){
      if (isGuest || typeof seat !== 'number' || seat < 0 || seat === mySeat) return false;
      if (typeof n === 'number' && seat >= n) return false;
      if (remoteSeats.indexOf(seat) < 0) remoteSeats.push(seat);
      missStreak[seat] = 0;
      if (Array.isArray(isAI)) isAI[seat] = false;
      if (personaBySeat) personaBySeat[seat] = null;
      turnSeatActive = -1; turnStreetActive = '';
      try{ clearTimers(); }catch(_){}
      try{ renderAll(); }catch(_){}
      return true;
    }
    // ── 招募态(lobby): 开桌先落真牌桌页(本文件), 6 席里空位可点邀灵魂/真人,
    //   ≥2 真人入座即自动开局(gtCheckAutoStart)→ startDeal 就地转正局(同一 room 不重挂)。招募态不产快照(无牌可泄, 见 renderAll onSync 守卫)。
    const lobbyMode = !!opts.lobby;
    const isHostLobby = !!opts.isHost;
    let lobbyCtx = opts.lobbyCtx || null;                // { souls:[{auth_uid,name,emoji}], actions:{seatSoul,kick,fillSouls,inviteHumans,start} }
    let lobbySeats = Array.isArray(opts.lobbySeats) ? opts.lobbySeats : [];
    // 招募态本机邀请的机器人登记表(seat→{name,emoji}): DB 名册无它, lobbyState 重建时据此补回,
    //   免被 setLobby(名册刷新)抹掉; host 请离时清除。
    const lobbyBots = {};
    const PokerNet = root.EHPokerNet;
    let myHole = [];       // guest: 自己的两张底牌(牌对象), 由 feedHand 注入
    let lastSnap = null;   // guest: 最近一张公共快照
    let lastSnapSeq = undefined; // guest: 最近接受的快照单调 seq

    const sb = opts.sb || 5, bb = opts.bb || 10;
    const ACT_MS = (typeof opts.actMs==='number' && opts.actMs>0) ? opts.actMs : HUMAN_ACT_MS;   // 真人思考时长(可调, 测试可压小)
    const START = opts.startStack || 2000;
    // 跨桌钱包: 我这席的买入可带上一桌的余额进场(opts.myStack), 其余席各自新买入 START。
    //   每次结算/重开后经 opts.onWallet(我的最新筹码)回传 app.js 落地, 下张桌再带着走。
    const MY_START = (typeof opts.myStack === 'number' && opts.myStack > 0) ? Math.round(opts.myStack) : START;
    // 真实筹码: 每席买入优先走 opts.stackFor(灵魂/远程真人按 uid 账本累计), 否则我这席 MY_START、其余 START。
    // journey-exempt: stackFor 由 app.js 注入 — journey-chip-authenticity.js
    function seatBuyIn(i){
      if (typeof opts.stackFor === 'function'){
        try{
          const v = opts.stackFor(i, { ids: ids, isAI: isAI, souls: souls, names: names, mySeat: mySeat });
          if (Number.isFinite(v) && v > 0) return Math.round(v);
        }catch(_){}
      }
      return i === mySeat ? MY_START : START;
    }
    function emitStacks(){
      if (typeof opts.onStacks !== 'function') return;
      try{ opts.onStacks(stacks.slice(), { ids: ids, isAI: isAI, souls: souls, names: names, mySeat: mySeat }); }
      catch(e){ _ehCatch('poker.onStacks', e); }
    }
    let stacks = names.map((_, i) => seatBuyIn(i));
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
    // ── 每局空位概率补位(主人): 离场空席在开下一手前按概率补上 —— 有灵魂优先灵魂, 否则机器人 ──
    //   灵魂/机器人视为同一类「对战补位」; 联机 host 有 lobbyCtx.seatSoul 时优先走 DB 灵魂席。
    const VACANT_FILL_P = 0.48;   // 每空席每局补位概率
    function vacantSeatsForFill(){
      const out=[];
      for (let s=0;s<n;s++){
        if (s===mySeat) continue;
        if (isRemote(s)) continue;   // 远程真人席由真人自己回座, 不自动补
        const vac = vacated[s] || (stacks[s]<=0 && !(st && st.players && st.players[s] && !st.players[s].sitOut && st.players[s].stack>0));
        const sitOutEmpty = st && st.players && st.players[s] && (st.players[s].sitOut || st.players[s].kind==='empty');
        if (vac || sitOutEmpty) out.push(s);
      }
      return out;
    }
    function autoFillVacants(){
      if (isGuest || !st || st.phase==='lobby') return 0;
      const empties = vacantSeatsForFill();
      if (!empties.length) return 0;
      let filled=0;
      empties.forEach(seat=>{
        if (Math.random() > VACANT_FILL_P) return;
        const free = freeSoulsForSeat();
        const acts = (lobbyCtx && lobbyCtx.actions) || null;
        if (free.length && acts && typeof acts.seatSoul==='function'){
          const s = free[0];
          try{
            acts.seatSoul(seat, s.auth_uid);
            // DB 异步生效前本机先占位(灵魂身份), 名册回来后 updateRoster 以 DB 为准
            names[seat]=s.name||'灵魂'; avatars[seat]=s.e||s.emoji||'👤';
            isAI[seat]=true; if(ids) ids[seat]=s.auth_uid;
            if (souls) souls[seat]={ archetype:null, name:s.name, emoji:s.emoji };
            stacks[seat]=seatBuyIn(seat); buyin[seat]=(buyin[seat]||0)+stacks[seat]; netSettled[seat]=0;
            vacated[seat]=false; vacatedUid[seat]=null;
            personaBySeat[seat]=personaFor(seat);
            filled++;
            try{ emitBeat({ type:'join', actor:s.name||'灵魂', text:'🪝 '+(s.name||'灵魂')+' 补位入座' }); }catch(_){}
            toast((s.name||'灵魂')+' 补位 · 等开局', 2000);
          }catch(_){ inviteBot(seat, false); filled++; }
          return;
        }
        inviteBot(seat, false);
        filled++;
      });
      if (filled){
        try{ saveScore(); }catch(_){}
        try{ renderOpponents(true); positionSeats(); }catch(_){}
      }
      return filled;
    }

    // ── 机器人输光离场 + 手动邀请补位(主人诉求) ──────────────────────────────
    //   对手(机器人/灵魂)把筹码输光 → 不再无限自动补带, 而是【离场】: 座位空出、标 vacated,
    //   台面画成"＋ 点击邀请"空位, 引擎持有者可随时邀机器人/灵魂/真人补位。我这席与远程真人席不在此列。
    //   vacatedUid 记离场时占席的 uid: 防名册(realtime)在 DB 腾空前把同一位灵魂重新灌回"复活"。
    let vacated    = names.map(()=>false);
    let vacatedUid = names.map(()=>null);
    const onSeatVacate = (typeof opts.onSeatVacate==='function') ? opts.onSeatVacate : null;
    const canInvite = true;                            // 真人邀请权限一致
    const BOT_POOL = [
      {name:'阿岩',  e:'🗿', archetype:'cool'},      // 冷静→紧
      {name:'小凶',  e:'🔥', archetype:'sharp'},     // 锐利→紧凶
      {name:'疯哥',  e:'🤪', archetype:'wild'},      // 狂放→疯子
      {name:'冷面',  e:'🥶', archetype:'cool'},      // 清冷→紧
      {name:'老练',  e:'🧊', archetype:'sharp'},     // 老练→紧凶
      {name:'莽夫',  e:'😤', archetype:'wild'},      // 莽→疯子
      {name:'狐狸',  e:'🦊', archetype:'playful'},   // 顽皮→松凶
      {name:'铁头',  e:'🐗', archetype:'warm'},      // 暖→跟注站
    ];
    function pickBotIdentity(seat){
      const used = new Set(names.map((nm,i)=> i!==seat ? nm : null).filter(Boolean));
      const free = BOT_POOL.filter(b=>!used.has(b.name));
      const b = free.length ? free[Math.floor(Math.random()*free.length)] : BOT_POOL[seat % BOT_POOL.length];
      return b;
    }
    // 命名统一(主人诉求): 开局/补位兜底名「机器人N」(app.js gtSeatArrays + SQL 的座位号兜底)与手动邀请的花名
    //   (阿岩/狐狸…)本是两套体系, 同桌并存看着乱。这里把【本机 AI 席】的「机器人N」就地规范成同一套花名,
    //   让两条路径命名一致。只动本机 AI 兜底名: 灵魂真名 / 真人名 / 远程席一律不碰(状态忠实, 不改别处身份)。
    //   botIdentityBySeat 缓存每席花名 → 逐手重渲不跳名(同一个"狐狸"不会下一手变"阿岩")。
    const botIdentityBySeat = {};
    function normalizeBotNames(){
      for (let s=0; s<n; s++){
        if (s===mySeat || isRemote(s) || !isAI[s]) continue;
        // 兜底名「机器人N」+ 灵魂克隆「XX·分身/分身N」→ 花名(主人: 参考德州, 不要用分身)。真灵魂/真人名不碰。
        const nm0=names[s]||'';
        if (!/^机器人\d*$/.test(nm0) && !/分身/.test(nm0)) continue;
        let id = botIdentityBySeat[s]; if(!id){ id = pickBotIdentity(s); botIdentityBySeat[s]=id; }
        names[s]=id.name; avatars[s]=id.e;
        if (souls) souls[s]={ archetype: id.archetype||'sharp', name:id.name, emoji:id.e };
      }
    }
    // 本地邀请一个机器人补位(纯本机, 无需 DB): 席位下一手起加入, 全新买入 START。
    //   resume: 停摆桌邀满即续打(默认 true); 批量补位时传 false, 由调用方填完再统一续打, 免逐个触发。
    function inviteBot(seat, resume, walkIn){
      if (resume === undefined) resume = true;
      if (seat===mySeat || isRemote(seat)) return;
      const b = pickBotIdentity(seat);
      names[seat]=b.name; avatars[seat]=b.e; isAI[seat]=true;
      if (ids) ids[seat]=null; souls[seat]={ archetype: b.archetype||'sharp', name:b.name, emoji:b.e };
      stacks[seat]=START; buyin[seat]=(buyin[seat]||0)+START; netSettled[seat]=0;
      vacated[seat]=false; vacatedUid[seat]=null;
      personaBySeat[seat]=personaFor(seat);
      // 招募态: 就地把 st.players[seat] 写成已入座的机器人 + 登记 lobbyBots, 否则座位仍读
      //   kind==='empty' → 一直画"空位·点击邀请"(主人反馈"邀请后不立即入座"), 且 setLobby 刷新会抹掉。
      if (st && st.phase==='lobby'){
        lobbyBots[seat] = { name:b.name, emoji:b.e, archetype:b.archetype };
        if (st.players[seat]){ const p=st.players[seat]; p.kind='bot'; p.name=b.name; p.emoji=b.e; p.isAI=true; p.stack=START; p.start=START; }
      }
      saveScore();
      try{ closeInviteMenu(); }catch(_){}
      sfx('click');
      try{ emitBeat({ type:'join', actor:b.name, text:(walkIn?'🚶 '+b.name+' 走进来坐下':'🪑 '+b.name+' 入座补位') }); }catch(_){}
      // 牌桌因对手离光而停摆(结算态且无自动续手在跑): 邀满 2 人即刻续打; 否则提示"下一手加入"。
      if (resume && st.phase==='over' && !overTimer && aliveSeats().length>=2){
        toast(b.name+' 入座 · 开新一手'); try{ if(curOver&&curOver.parentNode) curOver.remove(); }catch(_){}
        try{ hideWinBanner(); }catch(_){}
        nextHand();
      } else {
        toast((walkIn?'🚶 ':'') + b.name + (st.phase==='lobby' ? (walkIn?' 加入牌桌':' 入座') : ' 入座 · 下一手加入'));
        // 立即刷新座位: 招募态显示机器人已入座; 局中显示"下一手入座"占位(不再停在"空位"死等下次重渲)。
        renderOpponents(true); renderPot(); if (st.phase==='lobby') renderActs(true); positionSeats(); if (minimized) updateChip();
        // 自动开始: 招募态下占用席(真人/灵魂/AI)≥2 → 延迟 800ms 自动发牌
        //   旧版只认「全满」→ 1 真人+1 灵魂永远不开, 且无开始按钮可点
        if (st && st.phase==='lobby' && isHostLobby && lobbyCtx && lobbyCtx.actions && typeof lobbyCtx.actions.start === 'function'){
          const occ = st.players.filter(p => p && p.kind && p.kind !== 'empty').length;
          if (occ >= 2){
            setTimeout(() => {
              const occ2 = st && st.players ? st.players.filter(p => p && p.kind && p.kind !== 'empty').length : 0;
              if (st && st.phase === 'lobby' && occ2 >= 2){
                toast('🎰 满 2 席 · 自动开始！');
                lobbyCtx.actions.start();
              }
            }, 800);
          }
        }
      }
    }
    // 是否正处于一手进行中(发牌后、未结算): 邀请/离场只在手与手之间真正落地, 绝不打断本手。
    function inHand(){ return st && st.phase && st.phase!=='over' && st.phase!=='lobby' && st.toAct!==-1; }

    function newHand(seedOverride){
      // 破产处理: 我这席——单机 0 由 showOver 判本场终结(走不到这里)、联机沿用补带; 远程真人席沿用补带。
      //   对手机器人/灵魂输光 → 【离场腾席】(不补带), 标 vacated + 通知 app 腾 DB 座, 空位待邀请补位。
      markBustedVacant();
      let _bg=0; while (stacks[button] <= 0 && _bg++ < n) button = (button+1)%n;   // 庄家落在有筹码的人身上
      let seed; try{ seed = crypto.getRandomValues(new Uint32Array(1))[0]; }catch(_){ seed = Math.floor(Math.random()*4294967296); }
      return Engine.createGame({ seed: seedOverride!=null?seedOverride:(opts.seed!=null && handNo===0?opts.seed:seed),
        names, isAI, stacks: stacks.slice(), sb, bb, button, ids: ids || undefined });
    }
    // 破产席标离场(幂等)。必须在 autoFillVacants 【之前】跑: 否则补位把 stack<=0 填掉,
    //   newHand 的 vacated 路径永远走不到 → onSeatVacate 不发, DB 座不腾, 联机名册泄漏。
    function markBustedVacant(){
      stacks = stacks.map((v, seat) => {
        if (v > 0) return v;
        if (seat === mySeat) return isLocalSolo ? v : START;
        if (isRemote(seat)) { buyin[seat]+=START; return START; }
        if (!vacated[seat]){
          vacated[seat] = true; vacatedUid[seat] = (ids && ids[seat]) || null;
          if (onSeatVacate){ try{ onSeatVacate(seat, { uid: vacatedUid[seat] }); }catch(e){ _ehCatch('poker.onSeatVacate', e); } }
          try{ emitBeat({ type:'leave', actor: names[seat], text:'🪑 '+names[seat]+' 输光筹码, 返回房间' }); }catch(_){}
        }
        return 0;
      });
    }
    let handNo = 0;
    // guest 开局尚无快照 → 先给一个"等发牌"占位态; host/local 直接发一手
    function waitingState(phase){
      return { variant:'nlhe', phase:phase||'waiting', street:'preflop', n, button:0, sb, bb,
        currentBet:0, minRaise:bb, aggressor:null, toAct:-1, pot:0, board:[], result:null,
        players: names.map((nm,seat)=>({ seat, name:nm||('席'+seat), isAI:!!isAI[seat],
          stack:START, start:START, hole:[], folded:false, allin:false, committed:0, street:0, acted:false })) };
    }
    // 招募占位局: 未发牌, 6 席按 lobbySeats 显示占用/空位; 引擎持有者点空位邀灵魂/真人, 满意 startDeal 就地转正局。
    //   字段与 waitingState 对齐(渲染读空防护), 每席多带 kind/dbSeat 供空位判定/请离寻址。
    function lobbyState(seats){
      const arr = (Array.isArray(seats)?seats:[]).slice().sort((a,b)=>a.seat-b.seat);
      return { variant:'nlhe', phase:'lobby', street:'preflop', n, button:0, sb, bb,
        currentBet:0, minRaise:bb, aggressor:null, toAct:-1, pot:0, board:[], result:null,
        players: names.map((nm,seat)=>{
          const s = arr[seat] || { seat, kind:'empty' };
          const dbSeat = (typeof s.seat==='number'?s.seat:seat);
          let kind = s.kind || 'empty';
          let nm2 = kind==='empty' ? '' : (s.name||nm||('席'+seat));
          let emoji = s.emoji||null;
          // 本机邀请的机器人: 仅当 DB 该席仍空时补回(真人/灵魂真占座时以 DB 为准, 不覆盖)。
          if (kind==='empty' && lobbyBots[seat]){ kind='bot'; nm2=lobbyBots[seat].name; emoji=lobbyBots[seat].emoji; }
          return { seat, dbSeat, kind, name:nm2, emoji,
            isAI: kind!=='human', stack:START, start:START, hole:[], folded:false, allin:false, committed:0, street:0, acted:false };
        }) };
    }
    // guest: 招募中看得到座位/等人入座; 开局后等快照。引擎持有者招募态: 落 lobby; 其余(含单机): 直接发第一手。
    //   ★去掉"入座序列"中间态(灵魂逐个上桌 ~3-4s): 满足自动开局条件即立即进牌桌, 别有中间页/加载过程。
    //   保留 introSeating 变量(恒 false)以兼容下方 render 的 pending 分支(现均短路不生效)。
    let introSeating = false;
    let arrived = introSeating ? new Set([mySeat]) : null, lastSeated = -1;
    normalizeBotNames();   // 开局先把兜底名「机器人N」统一成花名, 再据 names 建初始状态
    let st = isGuest ? (lobbyMode ? lobbyState(lobbySeats) : waitingState())
      : (lobbyMode ? lobbyState(lobbySeats) : (introSeating ? waitingState('seating') : newHand()));
    // ★host 接管恢复: 旧 host 离场后, 新 host(原 guest) 用最后一帧公共快照恢复引擎状态,
    //   而非 newHand() 重新发牌 —— handNo/pot/筹码/board 连续, 不丢牌局。快照无底牌/牌堆,
    //   用 pseudoState 重建(占位牌堆让 applyAction 能走完), 当前街出牌可继续; 下一手 newHand 正常重发。
    if (!isGuest && !lobbyMode && opts.resumeSnap && PokerNet){
      try{
        const _rs = opts.resumeSnap;
        st = PokerNet.pseudoState(_rs, mySeat, myHole);
        if (st && _rs.handNo != null) handNo = _rs.handNo;
        if (st && st._guest) delete st._guest;   // 接管者即新权威, 不再带 guest 标记
        if (Array.isArray(_rs.players) && _rs.players.length === stacks.length){
          stacks = _rs.players.map(function(p){ return (p && typeof p.stack==='number') ? p.stack : START; });
        }
        if (typeof _rs.button === 'number') button = _rs.button;
      }catch(e){ _ehCatch('poker.resumeSnap', e); }
    }

    function sfx(nm){ try{ if(root.EhSfx && root.EhSfx.play) root.EhSfx.play(nm); }catch(_){} }
    // 操作语音: 每席按名/机分配稳定音色, 让弃牌/过/跟/加注/全下都出声(对标腾讯德州报牌)
    function whoOf(seat){ if(typeof seat!=='number' || !st || !st.players || !st.players[seat]) return null;
      const ai=!!isAI[seat], nm=st.players[seat].name; return { name:nm, key:nm, isSoul:ai, isHuman:!ai }; }
    function sayOp(seat, text){ try{ if(text && root.EhSfx && root.EhSfx.say) root.EhSfx.say(text, whoOf(seat)); }catch(_){} }
    function vibrate(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(_){} }
    sfx('arrive'); if(!lobbyMode) sfx('deal');

    let aiTimer=null, ringRAF=null, streetTimer=null, overTimer=null, turnStart=0, turnDur=0, turnAiAct=0, turnSeatActive=-1, turnStreetActive='';
    let pendingAiDecision=null, pendingAiSeat=-1;   // armTurn 定时算好的 AI 决策(思考时长按它定)→ aiStep 复用, 免同回合二次 MC

    // 灵魂台词频率控制: 按性格决定说话概率 + 每座位独立冷却
    const TAUNT_PROB = {
      maniac: 0.7,   // 疯子：70% 概率说话，话多
      lag:    0.45,  // 松凶：45%
      tag:    0.25,  // 紧凶：25%，偶尔说
      rock:   0.10,  // 岩石：10%，沉默寡言
      station:0.20,  // 跟注站：20%
    };
    const TAUNT_COOLDOWN_MS = 25000;  // 同一座位至少 25 秒才能再说
    const _lastTauntAt = {};          // 每座位上次说话时间戳
    let walkInTimer=null, walkInTarget=0;           // 招募态"路人不定时入座": 每桌随机定一个目标人数, 到点有概率来一个新玩家(机器人)
    let animPhase=null, lastPotShown=-1;   // 筹码归池动画: 追踪街推进 / 底池增额
    let _winBanner=null;                    // 桌面赢家横幅(单机常规手替代结算弹窗, 见 showWinBanner)
    let lastBoardLen = 0, lastMyTurn=false, dealAnim=true;
    let lastBoardSig='', lastMeSig='';   // 增量护栏签名(公共牌区 / 我的底牌条)

    const mountEl = opts.mount || document.getElementById('hall') || document.body;
    // 顶栏图标(三游戏统一·图形化): 同族线性 SVG(等大 18px、等粗 1.9), 替 emoji🎵/字符⟳/文字"返回"混搭。与斗地主/掼蛋同款。
    const SVG=(p)=>`<svg class="pk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    const ICO_MUS_ON = SVG('<path d="M9 17V4l10-2v11"/><circle cx="6.5" cy="17" r="2.5"/><circle cx="16.5" cy="13" r="2.5"/>');
    const ICO_MUS_OFF = SVG('<path d="M9 17V4l10-2v11"/><circle cx="6.5" cy="17" r="2.5"/><circle cx="16.5" cy="13" r="2.5"/><line x1="3" y1="2.5" x2="21.5" y2="21"/>');
    const ICO_ROT = SVG('<rect x="4" y="2.5" width="10" height="16" rx="2"/><path d="M17 9.5a5 5 0 0 1 4 4.9V19a2 2 0 0 1-2 2h-6"/><path d="M13.5 18.5l-1.5 2.5 2.6 1"/>');
    const ICO_BACK = SVG('<path d="M19 12H6"/><path d="M11 18l-6-6 6-6"/>');
    const ICO_AUTO = SVG('<rect x="4.5" y="8" width="15" height="11" rx="2.4"/><path d="M12 4.2V8"/><circle cx="12" cy="3.4" r="1.1"/><circle cx="9.2" cy="13" r="1.25" fill="currentColor" stroke="none"/><circle cx="14.8" cy="13" r="1.25" fill="currentColor" stroke="none"/><path d="M9.5 16.4h5"/>');
    const room = document.createElement('div'); room.className='pk-room';
    room.innerHTML = `
      <div class="pk-bar">
        <div class="pk-title"><span class="dot"></span>德州扑克</div>
        <button class="pk-mus" id="pkMus" aria-label="背景音乐开关">${ICO_MUS_ON}</button>
        <button class="pk-skin eh-skin" id="pkSkin" aria-label="换肤" title="换肤">🎨</button>
        <button class="pk-x" id="pkX" aria-label="返回房间" title="返回房间（牌局后台继续）">${ICO_BACK}</button>
      </div>
      <div class="pk-felt" id="pkFelt">
        <div class="pk-table" id="pkTable">
          <div class="pk-blinds" id="pkBlinds"></div>
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
    // 开桌把 #hall 撑满视口: 盖住桌面态 top:12px/左右留边, 露出的页面底色(主人: 顶上红条突兀)
    try{ (mountEl.closest('#hall')||mountEl).classList.add('game-on'); document.documentElement.classList.add('game-on'); }catch(_){}

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
        if(!b) return; b.textContent=msg; b.classList.add('show'); setTimeout(()=>b.classList.remove('show'),5000);
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
    // 联机连接状态: online / reconnecting / host_offline(引擎持有者离线) —— 由 app.js 通过返回值 setConn(kind) 灌入
    let connState = 'online';
    let curOver = null;   // 当前挂着的结算浮层(供 setConn 在房主掉线时把客人的"等下一手"换成"可离开", 别对着灰按钮干等)
    function connLabel(k){ return ({online:'● 在线', reconnecting:'⟳ 重连中', host_offline:'⚠ 对手掉线'})[k] || ''; }
    function setConn(kind){
      if(!kind) kind='online';
      if(kind===connState) return;
      connState = kind;
      renderMsg(); renderActs(); updateChip();
      // 结算浮层挂着时引擎持有者掉线: 客人别对着灰"下一手即将开始…"干等 —— 换成"等待玩家入座·可离开", 并把收工按钮变主行动。
      if(kind==='host_offline' && isGuest && curOver && curOver.parentNode){
        const wait=curOver.querySelector('#pkWait');
        if(wait){
          const note=document.createElement('div'); note.className='pk-offnote'; note.textContent='⚠ 对手掉线';
          wait.replaceWith(note);
          const done=curOver.querySelector('#pkDone'); if(done){ done.textContent='返回房间'; done.classList.add('call'); }
        }
      }
    }
    // ★v38: 断线玩家视觉标记 — setOfflineUids 由 app.js 通过 player_offline 广播灌入
    let offlineUids = new Set();
    function setOfflineUids(uids){
      offlineUids = new Set(uids || []);
      try{ renderOpponents(true); }catch(_){}
    }
    function emitBeat(b){ if(typeof opts.onBeat==='function'){ try{ opts.onBeat(Object.assign({ game:'nlhe' }, b)); }catch(_){} } }
    function beatQuip(seat, kind){
      if(!(isAI[seat])) return null;
      const q = rand(QUIP[kind]||[]); if(!q) return null; say(seat, q); return q;
    }

    function clearTimers(){ if(aiTimer){clearTimeout(aiTimer);aiTimer=null;} if(ringRAF){cancelAnimationFrame(ringRAF);ringRAF=null;} if(streetTimer){clearTimeout(streetTimer);streetTimer=null;} if(overTimer){clearTimeout(overTimer);clearInterval(overTimer);overTimer=null;} try{ hideWinBanner(); }catch(_){} }
    // resize rAF 节流: 旋转/移动端地址栏收放会连发数十个 resize, 每个都全桌重排 —— 合并到每帧一次。
    let _rzRAF=0;
    const onResize = ()=>{ if(_rzRAF) return; _rzRAF=requestAnimationFrame(()=>{ _rzRAF=0; try{ if(root.EHTableOrient) root.EHTableOrient.reflect(room); }catch(_){} positionSeats(); }); };
    const onOrient = ()=>{ setTimeout(onResize, 120); };
    let _exited=false;
    function close(){ minimized=false; try{ if(root.EHStrategy) root.EHStrategy.clear(strategyMatchId); }catch(_){} try{ if(root.EhGameBgm) root.EhGameBgm.exit(); }catch(_){} try{ closeInviteMenu(); }catch(_){} clearTimers(); clearWalkIn(); if(_rzRAF){ cancelAnimationFrame(_rzRAF); _rzRAF=0; } window.removeEventListener('resize', onResize); if(root.EHTableOrient) root.EHTableOrient.clear(room); if(dock) dock.destroy(); if(chip){ chip.remove(); chip=null; } room.remove(); try{ (mountEl.closest('#hall')||mountEl).classList.remove('game-on'); document.documentElement.classList.remove('game-on'); }catch(_){}
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
      if (root.EHTableOrient) root.EHTableOrient.clear(room);       room.classList.remove('pk-expanding'); room.classList.add('pk-collapsing');
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
    { const sk=$('#pkSkin'); if(sk) sk.addEventListener('click',(e)=>{ e.stopPropagation(); try{ if(window.EhThemeMenu) EhThemeMenu.toggle(sk); }catch(_){} }); }
    // 牌桌内声音开关: 大厅 🎵 按钮被牌桌浮层盖住, 这里点开三档静音面板(BGM/音效/语音各自独立开关)
    const musBtn = $('#pkMus');
    function paintMus(){ if(!musBtn) return; const P=root.EhAudioPrefs; const any = P?P.anyOn():(!root.EH_BGM||root.EH_BGM.on()); musBtn.innerHTML = any?ICO_MUS_ON:ICO_MUS_OFF; musBtn.classList.toggle('muted', !any); }
    if (musBtn) bindTap(musBtn, ()=>{ if(root.EhAudioMenu) root.EhAudioMenu.toggle(musBtn, paintMus); else { try{ if(root.EH_BGM) root.EH_BGM.set(!root.EH_BGM.on()); }catch(_){} paintMus(); } sfx('click'); });
    try{ root.addEventListener('eh:audio-prefs', paintMus); }catch(_){}
    paintMus();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrient);

    // ── 座位渲染: 我固定坐底(在 pk-me 条), 对手沿椭圆上弧分布 ──
    function displayOrder(){                // 从我起, 顺时针一圈的座位号
      // 旁观(mySeat<0): 无"我席", 全席按自然序铺开 —— 座位照常渲染, 不再因 -1 使 seatHTML 抛错致全桌消失
      if (mySeat<0){ const out=[]; for(let i=0;i<n;i++) out.push(i); return out; }
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
          <div class="nm">空位</div><div class="stk pk-lob">邀请补位</div></div>`;
      }
      const isMe = seat===mySeat;
      // clone=灵魂分身(本机 AI 顶灵魂身份代打的副本)→ 标「分身」, 别冒充真人「玩家」(状态忠实)
      const roleTxt = p.kind==='soul' ? '灵魂' : (p.kind==='clone' ? '陪练' : (p.kind==='bot' ? '灵魂' : (isMe ? '你' : '玩家')));
      const canKick = !isMe && p.dbSeat!==0;   // 招募态人人可请离
      // 机器人是本机邀请(不在 DB): 请离走本地 uninviteBot; 真人/灵魂请离走 DB kick。
      const kickAttr = p.kind==='bot' ? `data-unbot="${seat}"` : `data-kick="${p.dbSeat}"`;
      return `<div class="pk-seat pk-lobby-filled" data-seat="${seat}" style="--p:360">
        <div class="pk-avr"><div class="av">${p.emoji||avatars[seat]||'🙂'}</div></div>
        <div class="nm">${escapeHtml(p.name||'—')}</div>
        <div class="stk pk-lob"><span class="role">${roleTxt}</span></div>
        ${canKick?`<button class="pk-lob-kick" ${kickAttr} title="请离">✕</button>`:''}
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
      room.querySelectorAll('.pk-lob-kick[data-unbot]').forEach(b=>{
        b.onclick=(e)=>{ e.stopPropagation(); uninviteBot(+b.dataset.unbot); };
      });
    }
    // 招募态: 撤下本机邀请的机器人 → 清登记 + 就地重建 lobby 名册(该席回落"空位")。
    function uninviteBot(seat){
      delete lobbyBots[seat];
      if (st && st.phase==='lobby'){ st = lobbyState(lobbySeats); renderOpponents(true); renderPot(); renderActs(true); positionSeats(); if (minimized) updateChip(); sfx('click'); }
    }
    // ── 招募态"路人不定时入座"(主人: 空位在不手动邀请时, 可不定时来新玩家, 随机、不必每次补满、看牌桌情况) ──
    //   纯本机: 复用 inviteBot 那条【不落 DB】的补位路径。只在 host 招募态跑, 手动邀请照常叠加。
    //   不定时 = 每 5~14s 一跳且到点也只"有概率"来人; 不补满 = 每桌开局随机定一个目标人数[2,n], 到目标就停。
    function lobbyEmptySeats(){
      if (!st || st.phase!=='lobby') return [];
      return st.players.filter(p=>p.kind==='empty').map(p=>p.seat);   // lobbyBots 已在 lobbyState 里落成 kind='bot', 自然不算空
    }
    function walkInTick(){
      walkInTimer=null;
      if (!isHostLobby || !st || st.phase!=='lobby') return;   // 离开招募态即停(startDeal/close 另有清理)
      const empty = lobbyEmptySeats();
      const occupied = n - empty.length;
      if (empty.length && occupied < walkInTarget){
        // 越空越积极, 越接近目标越懒(看牌桌情况); 再叠一层随机 → 不是每次都来, 来得不定时。
        const eager = walkInTarget>0 ? (walkInTarget - occupied)/walkInTarget : 0;   // 缺口占比 0~1
        if (Math.random() < 0.5 + 0.4*eager){
          const seat = empty[Math.floor(Math.random()*empty.length)];
          inviteBot(seat, true, true);   // walkIn=true: 播报/提示用"走进来坐下"而非"补位"
        }
      }
      scheduleWalkIn();   // 到目标后仍守望: 万一有人被请离又空出, 可再来人
    }
    function scheduleWalkIn(){
      if (walkInTimer) return;                                  // 已排程不重复(setLobby 每次刷新都会调到)
      if (!isHostLobby || !st || st.phase!=='lobby') return;
      const gap = 5000 + Math.floor(Math.random()*9000);        // 5~14s 不定时
      walkInTimer = setTimeout(walkInTick, gap);
    }
    function startWalkIns(){
      if (!isHostLobby || !st || st.phase!=='lobby') return;
      if (!walkInTarget){ walkInTarget = 2 + Math.floor(Math.random()*(n-1)); }   // 本桌随机目标人数[2,n], 只定一次 → 常不补满
      scheduleWalkIn();
    }
    function clearWalkIn(){ if(walkInTimer){ clearTimeout(walkInTimer); walkInTimer=null; } walkInTarget=0; }
    function _imAway(e){
      const m=room.querySelector('.pk-invite-menu');
      if(m && !m.contains(e.target) && !(e.target.closest && e.target.closest('.pk-lobby-empty,.pk-vacant'))) closeInviteMenu();
    }
    function closeInviteMenu(){ const m=room.querySelector('.pk-invite-menu'); if(m) m.remove(); document.removeEventListener('click', _imAway, true); }
    // 灵魂/机器人【同一类对战补位】: 有空闲灵魂且 host 通道可用 → 优先灵魂; 否则本机机器人。
    //   主人: "不需要分别对待, 有灵魂在的优先灵魂补位"。局中/招募态共用此入口。
    function freeSoulsForSeat(){
      const acts = (lobbyCtx && lobbyCtx.actions) || null;
      if (!acts || typeof acts.seatSoul !== 'function') return [];
      const all = ((lobbyCtx && lobbyCtx.souls) || []).filter(s => s && s.auth_uid);
      const used = new Set((ids || []).filter(Boolean));
      return all.filter(s => !used.has(s.auth_uid));
    }
    function fillSeat(dbSeat){
      const free = freeSoulsForSeat();
      const acts = (lobbyCtx && lobbyCtx.actions) || null;
      if (free.length && acts && acts.seatSoul){
        const s = free[0];
        try{ acts.seatSoul(dbSeat, s.auth_uid); }catch(e){ inviteBot(dbSeat); return; }
        try{ closeInviteMenu(); }catch(_){}
        sfx('click');
        toast((s.name || '灵魂') + ' 补位 · 下一手入座', 2000);
        return;
      }
      inviteBot(dbSeat);
    }
    function openInviteMenu(dbSeat, anchorEl){
      closeInviteMenu();
      const acts = (lobbyCtx && lobbyCtx.actions) || null;
      const free = freeSoulsForSeat();
      const menu=document.createElement('div'); menu.className='pk-invite-menu';
      let html='<div class="im-ttl">空位</div>';
      // 旁观中: 首选「我来坐」—— 起身后想玩就坐空位
      if (spectating) html += `<button class="im-item" data-sit="1">🪑 我来坐这个位</button>`;
      html += `<button class="im-item" data-fill="1">🤝 邀请灵魂来对战</button>`;
      if(acts && acts.inviteHumans) html+='<button class="im-item" data-invite-human="1">👥 邀请真人来对战</button>';
      menu.innerHTML=html;
      const sitBtn=menu.querySelector('[data-sit]');
      if(sitBtn) sitBtn.onclick=(e)=>{ e.stopPropagation(); closeInviteMenu(); resumeSeat(); };
      room.appendChild(menu);
      const rr=room.getBoundingClientRect(), ar=anchorEl.getBoundingClientRect();
      menu.style.left=Math.min(Math.max(8, ar.left-rr.left+ar.width/2-110), Math.max(8, rr.width-228))+'px';
      (function(){
        const mh = menu.offsetHeight || 120;
        const topAbove = ar.top - rr.top - mh - 6;
        const topBelow = ar.bottom - rr.top + 6;
        menu.style.top = (topAbove >= 8 ? topAbove : Math.min(topBelow, rr.height - mh - 8)) + 'px';
      })();
      const fill=menu.querySelector('[data-fill]'); if(fill) fill.onclick=()=>{ fillSeat(dbSeat); };
      const ih=menu.querySelector('[data-invite-human]'); if(ih) ih.onclick=()=>{ if(acts&&acts.inviteHumans) acts.inviteHumans(); closeInviteMenu(); };
      sfx('click');
      setTimeout(()=>document.addEventListener('click', _imAway, true), 0);
    }
    function seatHTML(seat){
      if (st.phase==='lobby') return lobbySeatHTML(seat);
      const p=st.players[seat];
      // 空位(机器人输光离场 / 旁观让座 / 满座旁观者看到的空椅): 画成"＋ 可坐/可邀"占位 —— 旁观时点空位直接坐下。
      if (seat!==mySeat && (vacated[seat] || (p && p.kind==='empty'))){
        const spect = spectating || mySeat<0;
        const canFill = !isGuest && canInvite;   // ★fix: guest 无 lobbyCtx/邀请权限, 点空位会走 inviteBot 创建仅本地幽灵机器人
        return `<div class="pk-seat pk-vacant${canFill||spect?'':' locked'}" data-seat="${seat}"${(canFill||spect)?` data-invite="${seat}"`:''} style="--p:360">
          <div class="pk-avr"><div class="av">＋</div></div>
          <div class="nm">空位</div>
          <div class="stk pk-vac">${spect?'点击入座':(canFill?'邀请补位':'空位')}</div>
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
        //   弃牌后底牌不撤、继续朝上显示; 座位 .folded 只灰"人"(头像/名/筹码), 底牌保留花色仅压暗 —— 主人: 弃了同花也要看得出花色。
        const cs = (p.hole||[]).map(c=>cardEl(c,{}).outerHTML).join('');
        hole = `<div class="pk-mini-hole pk-my-hole">${cs}</div>`;
      } else if (!p.folded){
        hole = `<div class="pk-mini-hole">${cardEl(null,{back:true,mini:true}).outerHTML}${cardEl(null,{back:true,mini:true}).outerHTML}</div>`;
      } else {
        hole = `<div class="pk-mini-hole"></div>`;
      }
      const dbtn = seat===st.button ? `<span class="pk-btn-d">D</span>` : '';
      const blbtn = blindBadge(seat);
      // ★v38: 断线玩家视觉标记 — 灰色遮罩 + "断线"小标签
      const seatUid = ids ? ids[seat] : null;
      const isOffline = seatUid && offlineUids.has(seatUid);
      return `<div class="pk-seat${seat===mySeat?' pk-me-seat':''}${st.toAct===seat&&st.phase!=='over'?' turn':''}${p.folded?' folded':''}${p.allin?' allin':''}${won?' win':''}${isOffline?' offline':''}" data-seat="${seat}" style="--p:360">
        <div class="pk-avr"${isOffline?' style="filter:grayscale(1) opacity(0.5)':''}"><div class="av">${avatars[seat]||'🤖'}</div>${dbtn}${blbtn}${p.allin&&!p.folded?'<span class="pk-allin-tag">ALL IN</span>':''}${isOffline?'<span class="pk-offline-tag">断线</span>':''}<span class="pk-sec"></span></div>
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
    let _lastOppSig='', _lastOppStruct='', _skipPositionSeats=false;
    function renderOpponents(force){
      _skipPositionSeats=false;   // 入口重置: 只有本帧亮牌路径才重新置位
      // 签名拆两层(2026-09 性能):
      //   结构签名 structSig = 座位序 + 每人(进座/弃牌/全下)+ 我的底牌 + 横屏 + 刚入座 + 相位 + 按钮
      //     —— 变了才【拆节点重建 + positionSeats】(新手/有人弃牌全下/座位变动才会变, 频率低)。
      //   状态签名 stateSig = structSig + toAct + 每人 stack/street —— 只它变(=下注/跟注/过牌的高频动作)
      //     走【原地增量】: 只改 .stk 数字、.pk-commit 文本与 zero、turn 高亮, 不拆节点、不重定位。
      //   此前把 stack/street 并进唯一签名 → 每次下注就整桌 querySelectorAll().remove() 全清重建 + 全量三角定位, 是最重的重渲热点。
      const order = displayOrder();
      const land = root.EHTableOrient ? root.EHTableOrient.reflect(room) : false;
      // 旁观(mySeat<0)无"我席", 全席都进结构签名(含 seat0); 否则跳过 order[0](=我, 由 renderMe 管)
      const structSrc = mySeat<0 ? order.slice(0) : order.slice(1);
      const structParts = structSrc.map(seat=>{
        const p=st.players[seat]||{};
        if (st.phase==='lobby') return seat+':'+(p.kind||'empty')+':'+(p.name||'');   // 招募态签名跟座位占用走(灵魂入座/请离要重绘)
        const pending = introSeating && arrived && !arrived.has(seat);
        return seat+':'+(pending?'P':(p.folded?'F':'')+(p.allin?'A':''));             // 数值(stack/street)不进结构签名
      }).join('|');
      const mp = st.players[mySeat]||{};
      const myStruct = (mp.hole||[]).map(c=>c?(c.suit+''+c.rank):'x').join('')+':'+(mp.folded?'F':'')+(mp.allin?'A':'');
      const structSig = order.join(',')+'#'+structParts+'#ME'+myStruct+'#'+(land?'L':'P')+'#'+(lastSeated||'')+'#'+st.phase+'#B'+(st.button||0);
      const stateSig = structSig+'#T'+st.toAct+'#'+order.map(s=>{const p=st.players[s]||{};return (p.stack||0)+'/'+(p.street||0);}).join(',');
      if(!force && stateSig===_lastOppSig) return;   // 全同 → 免渲
      _lastOppSig=stateSig;
      // 结构没变(只数值/轮次变)→ 原地增量, 不拆节点、不重定位
      if(!force && structSig===_lastOppStruct && st.phase!=='lobby'){ updateSeatsInPlace(order); return; }
      // 原地亮牌: phase 变 over 且 wentToShowdown → 只替换底牌节点, 不重建整桌
      if (st.phase === 'over' && st.result && st.result.wentToShowdown) {
        const prevPhaseOver = _lastOppStruct.includes('#over#') || _lastOppStruct.endsWith('#over');
        if (!prevPhaseOver) {
          // 只更新底牌和 win class, 不拆节点
          for (const seat of order) {
            const seatEl = els.table.querySelector(`.pk-seat[data-seat="${seat}"]`);
            if (!seatEl) continue;
            const won = (st.result.winnersBySeat || []).includes(seat);
            seatEl.classList.toggle('win', won);
            // 替换底牌区
            const rv = st.result.reveal && st.result.reveal[seat];
            if (rv) {
              const b5 = best5Set(seat);
              const cs = rv.hole.map(id => {
                const el = cardEl(idCard(id), { mini: false });
                if (b5 && b5.has(id)) el.classList.add('pk-win-card');
                return el.outerHTML;
              }).join('');
              const holeDiv = seatEl.querySelector('.pk-mini-hole');
              if (holeDiv) {
                holeDiv.innerHTML = cs;
                holeDiv.classList.remove('pk-my-hole');
              }
              // 补牌型标签
              let hnDiv = seatEl.querySelector('.pk-mini-hn');
              if (!hnDiv) {
                hnDiv = document.createElement('div');
                hnDiv.className = 'pk-mini-hn';
                holeDiv && holeDiv.insertAdjacentElement('afterend', hnDiv);
              }
              hnDiv.textContent = rv.hand || '';
            }
          }
          _lastOppStruct = structSig;
          _lastOppSig = stateSig;
          _skipPositionSeats = true;   // 亮牌后跳过 positionSeats, 防止重定位改变间距
          return;
        }
      }
      _lastOppStruct=structSig;
      // 移除旧座位节点(保留 pk-table 内的 center)
      els.table.querySelectorAll('.pk-seat, .pk-commit').forEach(e=>e.remove());
      positionSeats._force = true;   // 节点重建后必须重算几何
      positionSeats._key = '';
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
          const s=+el.dataset.invite;
          el.onclick=()=>{ if (spectating||mySeat<0){ if (onGrabSeat){ onGrabSeat(s); } else { resumeSeat(s); } } else if (!isGuest){ openInviteMenu(s, el); } };   // ★fix: guest 无邀请权限, 不开菜单
        });
        // 新一手: 底牌已发且尚未渲过发牌动画(dealAnim 仅在开手为真, renderMe 后置否) → 逐张错峰飞入。
        //   放在 positionSeats 之后: 座位已就位, 动画只作用于每张牌自身 transform, 不影响布局。
        if (dealAnim && mySeat>=0 && st.players[mySeat] && (st.players[mySeat].hole||[]).length>0) runDealAnim();
      }
    }
    // 原地增量: 结构不变、只是筹码/投入/轮次变时, 改文本与 class, 不拆节点、不重跑 positionSeats(座位角度与金额无关)。
    function updateSeatsInPlace(order){
      for(const seat of order){
        const p=st.players[seat]||{};
        const seatEl = els.table.querySelector(`.pk-seat[data-seat="${seat}"]`);
        if(seatEl){
          seatEl.classList.toggle('turn', st.toAct===seat && st.phase!=='over');   // 轮到谁高亮
          const b = seatEl.querySelector('.stk b');                                // 筹码肌胉(非全下席才有 <b>, 全下是结构变已重建)
          if(b && b.textContent!==String(p.stack)) b.textContent=p.stack;
        }
        const commit = els.table.querySelector(`.pk-commit[data-seat="${seat}"]`);
        if(commit){
          const street = p.street||0;
          commit.classList.toggle('zero', !(street>0));
          if(commit.lastChild && commit.lastChild.nodeType===3){ if(commit.lastChild.nodeValue!==String(street)) commit.lastChild.nodeValue=String(street); }
          else commit.innerHTML=`<span class="pc"></span>${street}`;
        }
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
      if (_skipPositionSeats) { _skipPositionSeats=false; return; }   // 原地亮牌: 跳过重定位, 不改间距
      const land = root.EHTableOrient ? root.EHTableOrient.reflect(room) : false;  // 横屏态标记(open/resize/旋转都会过这里)
      const order = displayOrder();
      const lob = st.phase==='lobby';
      // 几何缓存: 同一桌形(宽高/横竖屏/座位序)只算一次三角 — 每帧/每次 stack 变都跑会强制回流
      const tr = els.table.getBoundingClientRect();
      const geoKey = (land?1:0)+'|'+(lob?1:0)+'|'+Math.round(tr.width)+'x'+Math.round(tr.height)+'|'+order.join(',');
      if (geoKey === positionSeats._key && !positionSeats._force) return;
      positionSeats._key = geoKey; positionSeats._force = false;
      const N = order.length;                     // 总席数(含我)
      const m = N - 1;                             // 对手数
      const noMe = mySeat<0;                       // 旁观: 无"我"席, 全员均分椭圆
      // 招募态 & 打牌态一致: 把"我"也摆上椭圆(坐正下方 270°), 对手绕上弧均分 —— 一桌人围坐感,
      //   不再"我孤零零一个人在桌外条上"(主人反馈"把自己也放到牌桌里, 不用单独拿出来")。
      //   招募态: 全 n 席等分整椭圆(我在 270°)。打牌态: 我固定 270°, 对手沿"绕开底部我位缺口"的宽弧
      //   (210°左下 → 90°顶 → -30°右下)均分, 底牌正面就在我这张桌底座位上。
      // 横屏: 桌面又宽又矮 → 横向半径放大铺开、竖向半径压扁; 椭圆竖直居中(CY 偏上)让底部我位不溢出。
      // 招募态竖屏: 压扁椭圆 + 中心上移, 座位贴桌、少占竖向
      const RX = land ? 46 : (lob ? 42 : 40), RY = land ? 41 : (lob ? 24 : 32);
      const CY = lob ? (land ? 48 : 36) : (land ? 59 : 46);
      const start = 0;                             // 全席含我(d=0, 270°底部), 招募/打牌一致
      for (let d=start; d<N; d++){
        const seat=order[d];
        const seatEl = els.table.querySelector(`.pk-seat[data-seat="${seat}"]`);
        const commitEl = els.table.querySelector(`.pk-commit[data-seat="${seat}"]`);
        if(!seatEl) continue;
        let deg;
        let cx;
        if (d===0 && !noMe) deg = 270;                           // 我: 正下方
        else if (lob || noMe) deg = 270 - d*(360/N);             // 招募/旁观: 全 n 席等分椭圆
        else if (N===4){
          // 四人桌三位对手以桌面中轴镜像排布, 避免等角弧线造成一侧头像偏高。
          const x = d===1 ? -1 : (d===2 ? 0 : 1);
          cx = 50 + RX * x * (x===0 ? 0 : 0.78);
          deg = 0;
        } else deg = (m===1) ? 90 : (210 - 240*(d-1)/(m-1));   // 其他桌型沿原宽弧均分
        const t = deg * Math.PI/180;
        if (cx===undefined) cx = 50 + RX*Math.cos(t);
        // 横屏我的座位已改横向(矮), 压到桌底(86%)腾出桌心竖向空间给底池/公共牌; 竖屏/招募态仍走椭圆几何
        let cy = !lob && N===4 && d>0
          ? (d===2 ? CY - RY*0.78 : CY + RY*0.18)
          : CY - RY*Math.sin(t);
        if (land && !lob && d===0) cy = 86;
        seatEl.style.left = cx+'%'; seatEl.style.top = cy+'%';
        // 根据水平位置决定气泡展开方向
        const side = cx < 30 ? 'left' : cx > 70 ? 'right' : 'center';
        seatEl.dataset.side = side;
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
            //   就沿竖向推出牌带(上半席推到牌行上方, 下半席推到牌行下方), 保证不压公共牌/底池。
            const f = land ? 0.44 : 0.6;
            let ccx = 50 + (cx-50)*f, ccy = CY + (cy-CY)*f;
            // 牌带用【实测 board 矩形】定位(旧硬编码 28~50 随版面漂移, 顶部席被误推到 44.4 正压公共牌):
            //   把牌区(含底池/公共牌)量成 band, 落点进带就向席位方向退出 —— 上席推到带上沿之上, 下席推到带下沿之下。
            let bandT=28, bandB=50;
            try{
              const br = els.board && els.board.getBoundingClientRect();
              const pr = els.pot && els.pot.getBoundingClientRect();
              if (br && tr.height){
                bandT = Math.max(18, ((Math.min(br.top, pr?pr.top:br.top) - tr.top)/tr.height*100) - 2.5);
                bandB = Math.min(82, ((Math.max(br.bottom, pr?pr.bottom:br.bottom) - tr.top)/tr.height*100) + 2.5);
              }
            }catch(_){}
            if (!land && ccx>16 && ccx<84 && ccy>bandT && ccy<bandB){
              ccy = (cy < CY) ? (bandT - 3.5) : (bandB + 3.5);
            }
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
      if (st.phase==='lobby'){ els.msg.className='pk-msg'; els.msg.innerHTML=cp+'🪑 等人入座'; return; }
      if (st.phase==='seating'){ els.msg.className='pk-msg'; els.msg.innerHTML=cp+'🪑 等人入座…'; return; }
      if (st.phase==='waiting'){ els.msg.className='pk-msg'; els.msg.innerHTML=cp+'🎴 等待发牌…'; return; }
      if (st.phase==='showdown'||st.phase==='over'){ els.msg.className='pk-msg'; els.msg.innerHTML=cp; return; }   // ★fix: 摊牌阶段 toAct=-1, 不该显示"…思考中… · 摊牌"
      const seat=st.toAct;
      // 旁观中: msg 标出旁观态, 同时保留「轮到谁/谁思考中」跟上牌局节奏
      const specTag = (spectating||mySeat<0) ? '🔭 旁观中 · ' : '';
      if (seat===mySeat){ els.msg.className='pk-msg mine'; els.msg.innerHTML=cp+specTag+'🫵 轮到你 · '+streetName(); }
      else { els.msg.className='pk-msg'; els.msg.innerHTML=cp+specTag+(st.players[seat]?escapeHtml(st.players[seat].name):'…')+' 思考中… · '+streetName(); }
    }

    function renderMe(){
      if (mySeat<0 || !st.players[mySeat]){
        // 旁观(已让座): 底部 bar 统一承载旁观提示, me 条留空(CSS .pk-spectating 下整条隐藏), 牌桌与底部 bar 紧凑贴合
        els.me.innerHTML='';
        lastMeSig=''; return;
      }
      if (st.phase==='lobby'){
        // "我"已画在椭圆底部座位(见 positionSeats 招募态), 这里的 pk-me 条不再重复头像,
        //   只留一行居中房主提示, 与 pk-acts 的「开始」按钮上下呼应。
        els.me.innerHTML = `
          <div class="pk-info" style="flex:1;text-align:center">
            <div class="pk-hint">🪑 招募中 · 满 2 席自动开始（含灵魂）</div>
          </div>`;
        lastMeSig=''; return;
      }
      const p=st.players[mySeat];
      const mine = st.toAct===mySeat && st.phase!=='over' && !spectating;   // 旁观后我这席由灵魂推进, 不算"我的回合"
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
      const meSig = st.phase+'|'+(mine?1:0)+'|'+(spectating?1:0)+'|'+(showdown?1:0)+'|'+(p.folded?1:0)+'|'+(p.allin?1:0)+'|'+p.stack
        +'|'+(st.button===mySeat?1:0)+'|'+myBlind+'|'+callAmt+'|'+(dealAnim?1:0)+'|'+boardSig+'|'+madeStr
        +'|'+holeCards.map(c=>c?(c.suit+''+c.rank):'x').join(',')
        +'|'+(st.result&&st.result.winnersBySeat?st.result.winnersBySeat.join(','):'');
      if (meSig === lastMeSig) return;
      lastMeSig = meSig;
      let hint='';
      if (spectating){ madeStr=''; hint='🔭 旁观中 · 座位已让出 · 点空位可再坐'; }
      else if (st.phase==='seating'){ hint='🪑 等人入座…'; }
      else if (st.phase==='waiting'){ hint='🎴 等待发牌'; }
      else if (st.phase==='over'){
        const won=(st.result.winnersBySeat||[]).includes(mySeat);
        hint = won ? '🏆 这手你赢了' : (p.folded?'已弃牌':'本手结束');
      } else if (p.folded){ hint='已弃牌'; }
      else if (p.allin){ hint='已全下'; }
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
      } else { hint='等待中'; }
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
    let awaitingHost = false, awaitingHostT = null;
    // 预选(pre-action): 不是我回合时先勾好意向, 轮到我自动执行并按实况复核。
    //   仅单机陪玩(isLocalSolo)开放 —— 联机需回传同步, 不在本批范围。
    //   'checkfold'=过牌/弃牌(总执行) · 'check'=只过牌(有人下注则作废) · 'callany'=跟任意注(无注则过牌)。
    let preAct = null;   // null | 'checkfold' | 'check' | 'callany'
    let selfVacatedUid = null;   // 我已让座: 记住原 uid, 名册重组不得把我还原回去
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
    // 无操作占位态(旁观/等待/已弃/已全下/离线): 与骨架同高, 但用整行状态条承载文案 —— 长文不再撑破 1/3 宽中键。
    function actsWaitBar(txt){
      return `
        <div class="pk-raise reserved"><input type="range" disabled><span class="pk-amt"></span></div>
        <div class="pk-quick reserved"><button class="pk-qbtn" disabled>最小</button><button class="pk-qbtn" disabled>½池</button><button class="pk-qbtn" disabled>⅔池</button><button class="pk-qbtn" disabled>底池</button><button class="pk-qbtn" disabled>全下</button></div>
        <div class="pk-row"><div class="pk-waitbar">${txt}</div></div>`;
    }
    // 招募态操作区: 补满 / 邀真人 / 开始(满 2 席自动开, 开始作兜底)
    function renderLobbyCtrl(){
      if (!lobbyCtx || !lobbyCtx.actions){ els.acts.innerHTML=''; return; }   // 人人同一套招募操作
      const a = lobbyCtx.actions;
      const btns=[];
      const empties = st.players.filter(p=>p.kind==='empty').length;
      const occupied = st.players.filter(p=>p && p.kind && p.kind!=='empty').length;
      const need = Math.max(0, 2 - occupied);
      const hint = need>0 ? `再来 ${need} 席自动开始（含灵魂）` : '满 2 席 · 即将自动开始…';
      let dayHtml='';
      try{ dayHtml = window.ehDailyLeftInline ? window.ehDailyLeftInline('nlhe') : ''; }catch(_){}
      if (empties>0) btns.push('<button class="pk-b fold" data-lob="fill">🤝 一键补满</button>');
      btns.push('<button class="pk-b fold" data-lob="invite">👥 邀请真人</button>');   // ★fix: 邀请真人为次要操作, 不该与"开始"同色抢主行动视觉
      if (occupied>=2 && typeof a.start === 'function') btns.push('<button class="pk-b call" data-lob="start">▶ 开始</button>');
      els.acts.innerHTML = `<div class="pk-lobacts"><div class="pk-prehint">${hint}${dayHtml}</div><div class="pk-row">${btns.join('')}</div></div>`;
      const map={ fill:a.fillSouls, invite:a.inviteHumans, start:a.start };
      els.acts.querySelectorAll('[data-lob]').forEach(b=> bindTap(b, ()=>{ const f=map[b.dataset.lob]; if(typeof f==='function'){ closeInviteMenu(); f(); } }));
    }
    let _lastActsSig='';
    function renderActs(force){
      // 旁观态钩子: 收掉 pk-me + 压缩 pk-acts 高度, 底部只留一条旁观 bar
      room.classList.toggle('pk-spectating', !!(spectating||mySeat<0));
      if (st.phase==='lobby'){ _lastActsSig='lobby'; renderLobbyCtrl(); return; }
      const p = (mySeat>=0) ? st.players[mySeat] : null;
      // 旁观(已让座): 显示坐下入口, 无操作键 —— 不是 AI 代打
      if (spectating || mySeat<0){
        if(!force && _lastActsSig==='spectate') return;
        _lastActsSig='spectate';
        // 单一横条 bar: 左"🔭 旁观中 · 已让座" + 右"坐下"按钮; 与打牌态同结构三键(旁观时禁用)
        els.acts.innerHTML = `
        <div class="pk-raise reserved"><input type="range" disabled><span class="pk-amt"></span></div>
        <div class="pk-quick reserved"><button class="pk-qbtn" disabled>最小</button><button class="pk-qbtn" disabled>½池</button><button class="pk-qbtn" disabled>⅔池</button><button class="pk-qbtn" disabled>底池</button><button class="pk-qbtn" disabled>全下</button></div>
        <div class="pk-row">
          <button class="pk-b fold" disabled>弃牌</button>
          <button class="pk-b call" id="pkResume">🪑 坐下</button>
          <button class="pk-b raise" disabled>加注</button>
        </div>
        <div class="pk-hint" style="text-align:center;width:100%">🔭 旁观中 · 已让座</div>`;
        const rb=$('#pkResume'); if(rb) bindTap(rb, ()=>{ if (onGrabSeat){ onGrabSeat(); } else { resumeSeat(); } });
        return;
      }
      const offline = isGuest && connState!=='online';
      const mine = !offline && st.toAct===mySeat && (st.phase==='preflop'||st.phase==='flop'||st.phase==='turn'||st.phase==='river');
      // 非本人行动态: 渲染同高禁用骨架(而非清空塌陷), 三键常驻不跳版
      if (!mine){
        // ★不再提供「预选」粘性选中 —— 点按钮就是动作, 不留 .on 让下回合当默认
        //   (主人: 点了像已选中, 程序也真按预选自动出牌)
        let callLbl='等待中';
        if (offline) callLbl = (connState==='host_offline'?'对手掉线':'连接中…');
        else if (st.phase==='seating') callLbl='等人入座';
        else if (st.phase==='waiting') callLbl='等待发牌';
        else if (st.phase==='showdown'||st.phase==='over') callLbl='本手结束';
        else if (p && p.folded) callLbl='已弃牌';
        else if (p && p.allin) callLbl='已全下';
        // 签名护栏: 非我回合 skeleton 文案不变就不重建(等对手时每秒一次的 renderAll 不再白白重建操作区)
        const sig='wait:'+callLbl;
        if(!force && sig===_lastActsSig) return;
        _lastActsSig=sig;
        // ★三键常驻(禁用) + 中键显示状态 —— 出牌切换不闪不跳版
        els.acts.innerHTML = actsSkeleton(callLbl);
        return;
      }
      // ★fix: 我的回合加签名护栏 — 先校正 raiseTo 再算签名, 签名未变则跳过重建,
      //   挡掉 onSync/renderAll 重入造成的无谓 innerHTML 清空重建(轮到我时按钮稳定不闪烁消失)。
      const la=Engine.legalActions(st, mySeat);
      const canRaiseLike = la.canBet || la.canRaise;
      const min=la.minRaiseTo, max=la.maxRaiseTo;
      if (!raiseTo || raiseTo<min || raiseTo>max) raiseTo = Math.min(Math.max(min, Math.round((st.pot||bb))), max);
      const _mineSig='mine:'+st.phase+':'+st.toAct+':'+raiseTo;
      if(!force && _mineSig===_lastActsSig) return;   // 签名未变 → 跳过重建, 按钮保持稳定
      _lastActsSig=_mineSig;
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
          // ★fix: bt 文本更新必须排在 disarmAllin 之后——否则全下确认态拖离时 allinArmed 仍为 true,
          //   bt 跳过更新残留"再点一次", 按钮显示"加注 再点一次"而非"加注 至 N"。
          if(ai!==lastAllin){ lastAllin=ai; rb.classList.toggle('allin',ai);
            if(!ai){ disarmAllin(); } }   // 拖离全下额: 撤销待确认态
          if(!allinArmed){ const bt=rb.querySelector('.bt'); if(bt) bt.textContent = ai? String(raiseTo) : ('至 '+raiseTo); }
          if(!allinArmed && rb.firstChild && rb.firstChild.nodeType===3) rb.firstChild.nodeValue = (ai?'全下':raiseLabel)+' ';
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
      bindTap($('#pkFold'), ()=>humanAct('fold'));
      bindTap($('#pkCall'), ()=>humanAct(la.canCheck?'check':'call'));
      if(rb) rb.addEventListener('click', ()=>{
        // 全下(把全部筹码梭进去)要二次确认防误触: 第一次点亮"确认全下", 3.5s 内再点才执行, 逾时/拖离自动撤销。
        if(raiseTo>=max && !allinArmed){
          allinArmed=true; rb.classList.add('confirm');
          if(rb.firstChild && rb.firstChild.nodeType===3) rb.firstChild.nodeValue='确认全下 ';
          const bt=rb.querySelector('.bt'); if(bt) bt.textContent='再点一次';
          sfx('click');
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
      const btn = (key,label,cls)=>`<button class="pk-b pk-preb${on===key?' queued':''}${cls?' '+cls:''}" data-pre="${key}">${label}</button>`;
      els.acts.innerHTML = `
        <div class="pk-raise reserved"><input type="range" disabled><span class="pk-amt"></span></div>
        <div class="pk-prehint">🕒 预选中</div>
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
      const pa = preAct; preAct = null;   // 预选已下线, 恒 null
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
      if (!auto){
        resetMiss(mySeat);
        // 手动点按 = 清掉预选/加注额残留, 免下一回合被当成"已选中"的默认动作
        preAct = null;
        raiseTo = 0;
      }
      if (isGuest){
        if(onAction){
          try{ onAction({ action, amount }); }
          catch(e){ _ehCatch('poker.humanAct.onAction', e); toast('出牌没成功，再试一次'); return; }
        }
        // ★与引擎持有人同一套体验: 出牌后【本地立刻推进到下家】(伪状态可独立 apply 自己的动作),
        //   权威快照稍后到达再覆盖校正。不插入「等待其他玩家」中间态。
        try{
          var r=Engine.applyAction(st, mySeat, action, amount);
        }catch(e){
          // 动作已回传 host, 本地只是显示推进失败 —— 静默等快照校正, 不要误报「出牌没成功」
          // ★fix: 仍要设 awaitingHost 挡重复提交(动作已发 host, 不能让用户立刻再点发第二条)
          _ehCatch('poker.guestOptimistic', e); awaitingHost=true;
          if (awaitingHostT){ clearTimeout(awaitingHostT); awaitingHostT=null; }
          awaitingHostT = setTimeout(()=>{ awaitingHostT=null; if(awaitingHost){ awaitingHost=false; try{ toast('出牌没成功，再试一次'); }catch(_){} renderActs(true); } }, 12000);
          renderAll(); return;
        }
        try{ afterAction(mySeat, action, amount, r); }
        catch(e){ _ehCatch('poker.afterAction', e); renderAll(); }
        awaitingHost=true;   // 只挡重复提交, 不改显示(显示已随本地推进走「轮到 X」)
        if (awaitingHostT){ clearTimeout(awaitingHostT); awaitingHostT=null; }
        awaitingHostT = setTimeout(()=>{
          awaitingHostT=null;
          if (awaitingHost){ awaitingHost=false; try{ console.error('[pk] guest awaitingHost 超时: 12s 未收到 host 权威快照, handNo=', handNo); }catch(_){} try{ toast('出牌没成功，再试一次'); }catch(_){} renderActs(true); }
        }, 12000);
        return;
      }
      try{ var r2=Engine.applyAction(st, mySeat, action, amount); }
      catch(e){ toast(actErr(e.message)); return; }
      afterAction(mySeat, action, amount, r2);
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
      // 优先用 armTurn 定时时算好的决策(思考时长正是按它定的); 缓存不属于本席才现算, 免同回合重复 MC。
      let d = (pendingAiSeat===seat) ? pendingAiDecision : null;
      pendingAiDecision=null; pendingAiSeat=-1;
      const strategy = strategyFor(seat);
      // armTurn 可能在教练回包前已算好本地决策；若此刻拿到 coach 策略，必须重算，
      // 否则异步教练永远只“请求成功”却不影响实际动作。
      if(strategy && strategy.source==='coach') d=null;
      if(!d){ try{
        const soul = (souls[seat] && souls[seat].archetype) || 'sharp';
        d=AI.decide(st, seat, { persona: personaBySeat[seat] || 'tag', samples: 120, strategy });
        // 方案B: 若此刻才现算（教练回包后重算），且满足 LLM 条件，异步尝试覆盖
        //   aiStep 已在执行链中，LLM 回包已来不及覆盖本次 → 不阻塞，仍用规则引擎结果
      }catch(e){ d=null; } }
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

      // 方案C: 灵魂行动后异步生成性格对话，覆盖默认 quip 气泡
      // 按性格概率 + 每座位独立冷却(25s)控制说话频率，避免刷屏
      if (isAI[seat] && typeof AI.taunt === 'function'){
        try {
          const archetype = (souls[seat] && souls[seat].archetype) || 'sharp';
          // ★fix: TAUNT_PROB 的 key 是 persona(maniac/lag/tag/rock/station), 不是 archetype(warm/cool/sharp/wild/playful)。
          //   旧代码用 archetype 查 TAUNT_PROB 永远 undefined → 概率兜底 0.25, 话多灵魂(maniac 70%)也被压到 25%,
          //   叠加 25s 冷却 → 发言几乎消失。改用 personaBySeat 映射到正确的性格概率。
          const persona = personaBySeat[seat] || 'tag';
          const baseProb = TAUNT_PROB[persona] || 0.25;
          const actionMult = (action === 'raise' || action === 'allin') ? 2 :
                             (action === 'fold' || action === 'check') ? 0.5 : 1;
          const prob = Math.min(1, baseProb * actionMult);
          const now = Date.now();
          const lastAt = _lastTauntAt[seat] || 0;
          const cooledDown = (now - lastAt) >= TAUNT_COOLDOWN_MS;
          if (cooledDown && Math.random() < prob) {
            _lastTauntAt[seat] = now;
            AI.taunt({
              soul: archetype,
              name: st.players[seat].name,
              emoji: (souls[seat] && souls[seat].emoji) || '',
              action: action,
              amount: amount || 0,
              street: st.street,
              pot: Math.round(st.pot),
            }, function(text){
              if (text){ say(seat, text); emitBeat({ type:'taunt', actor: st.players[seat].name, text: '💬 '+st.players[seat].name+'：'+text }); }
            });
          }
        } catch(_) {}
      }

      if (r && r.over){ renderAll(); setTimeout(()=>showOver(), r.result.wentToShowdown?450:200); return; }
      renderAll();
    }

    function boomFx(){
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
    // 按决策难易给"思考时长": 人打牌不会每步都想满 —— 白给的过牌、明显的烂牌弃牌几乎秒决;
    //   要不要跟一注得算算; 主动下注/加注更费神; 全下是重手, 略停顿。再给少数回合叠一段深思(真人偶尔的长考)。
    //   区间比原来的 2.2~7s 整体收窄且下压, 免"每手都卡满好几秒"的机械感。
    function rnd(lo, hi){ return lo + Math.floor(secureRand()*(hi-lo)); }
    function aiThinkMs(d, la){
      const act = (d && d.action) || (la && la.canCheck ? 'check' : 'fold');
      let ms;
      switch(act){
        case 'check': ms = rnd(350, 1000); break;   // 免费过牌: 几乎不用想
        case 'fold':  ms = rnd(500, 1400); break;   // 弃牌: 快
        case 'call':  ms = rnd(900, 2500); break;   // 跟注: 得掂量赔率
        case 'bet':
        case 'raise': ms = rnd(1100, 3300); break;  // 主动进攻: 更费神
        case 'allin': ms = rnd(1400, 4000); break;  // 全下: 重手, 略停
        default:      ms = rnd(900, 2200);
      }
      if (secureRand() < 0.15) ms += rnd(800, 2200);   // ~15% 长考: 偶尔才真"想很久"
      return ms;
    }
    function armTurn(onExpire){
      clearTimers();
      if (st.phase==='lobby' || st.phase==='over' || st.phase==='waiting' || st.phase==='seating') { turnSeatActive=-1; turnStreetActive=''; return; }
      // 摊牌/结算之外, 无人需行动的中间态不该发生(引擎自动跑完); 安全兜底
      const seat=st.toAct;
      if (seat<0 || !st.players[seat]) { turnSeatActive=-1; return; }
      const mine = seat===mySeat && !spectating;   // 旁观后我这席(isAI 已置真)按 AI 席自动推进, 不再算"我的回合"
      // 轮到我且有预选: 先按实况复核执行/作废。执行成功则状态已推进(afterAction→renderAll→armTurn 重入), 中止本次。
      if (mine && preAct){ if (consumePreAction()) return; }
      if (mine && !lastMyTurn){ sfx('yourturn'); vibrate(8); }
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
        if (aiSeat){
          // 决策此刻先算(本席回合静止, 无他人插手)→ 缓存给 aiStep 复用免二次 MC;
          //   思考时长按"这步好不好想"定: 免费过牌/弃牌秒决, 跟注中等, 下注/加注稍长, 全下略久,
          //   再给 ~15% 概率叠一段"深思"抖动。不再雷打不动耗满 2~7s(主人: 别每次都把思考时间用光)。
          let d; try{
            const strategy = strategyFor(seat);
            const soul = (souls[seat] && souls[seat].archetype) || 'sharp';
            // 方案B: decideLLM 先返回规则引擎结果，LLM 回包后通过回调覆盖 pendingAiDecision
            d=AI.decideLLM(st, seat, { persona: personaBySeat[seat] || 'tag', soul, samples: 120, strategy }, function(llmD){
              // LLM 决策回包: 仅当仍是本席回合且 pendingAiSeat 未变时覆盖
              if (pendingAiSeat === seat && turnSeatActive === seat){
                pendingAiDecision = llmD;
              }
            });
          }catch(_){ d=null; }
          pendingAiDecision = d; pendingAiSeat = seat;
          turnAiAct = aiThinkMs(d, Engine.legalActions(st, seat));
        } else { turnAiAct = 0; pendingAiDecision = null; pendingAiSeat = -1; }
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
      bumpMiss(mySeat);
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
      // 我这手净变动: 优先引擎 result.delta[mySeat]（含边池，权威）；兜底 stack-start
      const engDelta = (res && res.delta && typeof res.delta[mySeat]==='number') ? res.delta[mySeat] : null;
      const delta = (engDelta!=null) ? engDelta : (my.stack - my.start);
      // 我收池金额（拆分池按人均）: 与「底池总额」区分 —— 底池含自己投入，不能当「赢到手」
      const potWon = (res.pots||[]).filter(pt=>(pt.winners||[]).includes(mySeat)).reduce((a,pt)=> a + Math.floor(pt.amount/(pt.winners.length||1)), 0);
      const potTotalAll = (res.pots||[]).reduce((a,pt)=>a+pt.amount,0);

      // ── 常规手(未输光/未通吃): 桌上横幅演筹码 + 自动发下一手 —— 真人一律同一套, 不弹结算大面板 ──
      //   完整结算面板只留【输光 / 通吃 / 本场终结】。联机客人同样走此路, 由权威快照接下一手。
      {
        const myNow = my.stack;
        const soulsAlive = st.players.filter(p=> p.seat!==mySeat && p.stack>0).length;
        const iBustNow   = myNow<=0;
        const iWonAllNow = isLocalSolo && soulsAlive===0 && myNow>0;
        if (!iBustNow && !iWonAllNow){
          const champSeat = (res.winnersBySeat||[])[0];
          const champName = (champSeat!=null && st.players[champSeat]) ? st.players[champSeat].name : '赢家';
          const champCount = (res.winnersBySeat||[]).length;
          const potTotal = potTotalAll;
          const handName = (res.wentToShowdown && res.reveal && champSeat!=null && res.reveal[champSeat]) ? res.reveal[champSeat].hand : '';
          const cDelta = (champSeat!=null && res.delta && typeof res.delta[champSeat]==='number') ? res.delta[champSeat] : null;
          const line = won
            ? `🏆 你收池 ${potWon} · 本手 ${delta>=0?'+':''}${delta} · 桌面 ${my.stack}${handName?(' · '+handName):''}`
            : (champCount>1
                ? `🏆 ${champCount} 家平分底池 ${potTotal} · 你 ${delta>=0?'+':''}${delta}`
                : `🏆 ${escapeHtml(champName)}${cDelta!=null&&cDelta>0?` 净赢 +${cDelta}`:` 收池 ${potTotal}`} · 你 ${delta>=0?'+':''}${delta}`);
          showWinBanner(line, won);
          if ((res.winnersBySeat||[]).length) payoutChipsFx(res.winnersBySeat);
          if(won){ sfx('sparkle'); setTimeout(()=>sfx('bloom'),160); pkCelebrate(false); }
          else if(delta<0){ sfx('void'); }
          emitBeat({ type:'over', actor:champName, big:true,
            text: won
              ? `🏁 你收池 ${potWon}（净 ${delta>=0?'+':''}${delta}）`
              : `🏁 ${champName}${cDelta!=null&&cDelta>0?` 净赢 +${cDelta}`:` 收池 ${potTotal}`}${handName?(' · '+handName):''}`,
            quip: beatQuip(champSeat, 'win') });
          if(typeof opts.onResult==='function'){ try{
            opts.onResult(res, st.log, { mySeat, potWon, delta, handName, myStack: my.stack });
          }catch(e){ _ehCatch('poker.onResult', e); } }
          emitWallet();
          if (minimized) updateChip();
          // 自动发下一手: host 到点 nextHand; 客人等权威快照(applySnapshot 会清横幅接下一手)
          if(overTimer){ clearTimeout(overTimer); clearInterval(overTimer); overTimer=null; }
          if (!isGuest){
            overTimer = setTimeout(()=>{ overTimer=null; hideWinBanner(); nextHand(); }, 2300);
          }
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
      // ★输光判定与模式无关(单机/联机同样算): 我的筹码归零 = 输光一次
      const iBust   = myStackNow<=0;
      const iWonAll = isLocalSolo && soulsAliveNow===0 && myStackNow>0;
      // 每日上限 = 输光 N 次: 先记这一次, 再判是否封盘
      let bustLimit = false;
      if (iBust){
        pkAddPlay();
        try{ if (typeof opts.onBustCount==='function') opts.onBustCount(); }catch(_){}
        bustLimit = pkLimitReached();
      }
      // ★输光 1~4 次: 留在桌上给「再来一局」继续玩; 第 5 次才进封盘页
      if (iBust && bustLimit){ try{ showDailyCap(); }catch(_){} return; }
      const matchOver = (isLocalSolo && (iBust || iWonAll)) || iBust;
      const iLeaveNow = false;   // 输光不强制离席 —— 未到额度可「再来一局」
      if (matchOver) over.className = 'pk-over ' + (iBust?'lose':'win');
      const dailyLine = iBust
        ? `<div class="pk-daily">今日已输光 ${pkPlaysToday()}/${PK_DAILY_MAX} 次 · 还可再来</div>`
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
      if (iBust){
        footer = `<button class="pk-b" id="pkDone">返回房间</button><button class="pk-b call" id="pkRestart">再来一局</button>`;
      } else if (isGuest){
        // 客人: 常态下一手由房主引擎自动连发(非手动门); 但房主已离线时别显灰"自动开始"让人干等 —— 直接给"返回房间"。
        footer = (connState==='host_offline')
          ? `<div class="pk-offnote">⚠ 对手掉线 · 可返回房间</div><button class="pk-b call" id="pkDone">返回房间</button>`
          : `<button class="pk-b" id="pkDone">返回房间</button><button class="pk-b" id="pkWait" disabled>下一手即将开始…</button>`;
      } else if (matchOver){
        // 通吃全场(对手都被我打光离场): 除"再来一局"外, 给"邀请对手继续"——补位新对手, 带着当前筹码接着打。
        footer = (iWonAll
              ? `<button class="pk-b" id="pkDone">返回房间</button><button class="pk-b" id="pkRestart">重开一桌</button><button class="pk-b call" id="pkInviteOn">邀请对手继续</button>`
              : `<button class="pk-b" id="pkDone">返回房间</button><button class="pk-b call" id="pkRestart">再来一局</button>`);
      } else {
        footer = `<button class="pk-b" id="pkDone">返回房间</button><button class="pk-b" id="pkNextHand" disabled>下一手 <span id="pkCd" class="pk-cd"></span></button>`;
      }
      // 赢家一行(常显): 谁靠什么赢下多少 —— 一眼看清结果, 不必展开摊牌逐行去数。
      const champSeat0 = (res.winnersBySeat||[])[0];
      const champCount = (res.winnersBySeat||[]).length;
      const champNm = (champSeat0!=null && st.players[champSeat0]) ? st.players[champSeat0].name : '赢家';
      const champHnd = (res.wentToShowdown && res.reveal && champSeat0!=null && res.reveal[champSeat0]) ? res.reveal[champSeat0].hand : '';
      // 赢家展示: 优先「本手净赢」(引擎 delta)；多人平分显示人均收池；避免把含自己投入的底池总额说成「赢下」
      const champDelta = (champSeat0!=null && res.delta && typeof res.delta[champSeat0]==='number') ? res.delta[champSeat0] : null;
      const champShare = (champSeat0!=null)
        ? (res.pots||[]).filter(pt=>(pt.winners||[]).includes(champSeat0))
            .reduce((a,pt)=> a + Math.floor(pt.amount/(pt.winners.length||1)), 0)
        : 0;
      const champLine = champCount>1
        ? `🏆 ${champCount} 家平分底池 ${potTotalAll}（人均约 ${Math.floor(potTotalAll/champCount)}）`
        : `🏆 ${escapeHtml(champNm)} ${champDelta!=null && champDelta>0 ? `净赢 +${champDelta}` : `收池 ${champShare||potTotalAll}`}${champHnd?(' · '+champHnd):''}`;
      // 我方一行(结算tips核心数字): 本手净变动 + 我实际收池 + 当前桌面积分
      const myLine = (delta>0)
        ? `你净赢 +${delta} · 收池 ${potWon} · 桌面 ${myStackNow} 筹码${careerSuffix()}`
        : (delta<0
            ? `你净亏 ${delta} · 桌面 ${myStackNow} 筹码${careerSuffix()}`
            : `本手打平 · 桌面 ${myStackNow} 筹码${careerSuffix()}`);
      function careerSuffix(){
        try{
          const rec = (typeof window.EH_BANK_GET==='function') ? window.EH_BANK_GET('nlhe') : null;
          if (!rec || !rec.plays) return '';
          const n = rec.net||0;
          return ` · 生涯 ${(n>=0?'+':'')+n}`;
        }catch(_){ return ''; }
      }
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
          <div class="eh-over-kicker">本手结算</div>
          <h2>${h2}</h2>
          ${subLine}
          <div class="pk-champ">${champLine}</div>
          <div class="pk-mynums">${myLine}</div>
          ${dailyLine}
          <details class="pk-more">
            <summary>本手详情</summary>
            ${showdownBox}
            ${potsHtml}
            ${netsHtml}
          </details>
          <div class="pk-row">${footer}</div>
        </div>`;
      // 推池动画: 底池飞向赢家席位(我方=底部), 浮层延后淡入让筹码在绒面上先跑完
      if ((res.winnersBySeat||[]).length){ over.classList.add('payout-in'); payoutChipsFx(res.winnersBySeat); }
      els.felt.appendChild(over);
      curOver = over;   // 供 setConn 在房主掉线时改写本浮层的客人按钮(离场用 parentNode 判活, 无需处处清空)
      if(iWonAll || won){ sfx('sparkle'); setTimeout(()=>sfx('bloom'),200); pkCelebrate(iWonAll); }
      else if(busted){ sfx('void'); }
      else if(delta<0){ sfx('void'); }

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
        // 每局空位概率补位(灵魂优先→机器人): 不再焊死“一离光就全员机器人”
        try{ autoFillVacants(); }catch(_){}
        // 兜底: 仍无人可打时再全量机器人续桌, 免空桌卡死
        for (let s=0;s<n;s++){ if (s!==mySeat && !isRemote(s) && stacks[s]<=0){ vacated[s]=true; inviteBot(s, false); } }
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

      // 直播战报 + 结果回调: 用引擎 delta / 我收池, 不把含自己投入的底池总额说成「赢下」
      const champSeatB = (res.winnersBySeat||[])[0];
      const champNameB = st.players[champSeatB] ? st.players[champSeatB].name : '赢家';
      const champDB = (champSeatB!=null && res.delta && typeof res.delta[champSeatB]==='number') ? res.delta[champSeatB] : null;
      const handNameB = res.wentToShowdown && res.reveal && champSeatB!=null && res.reveal[champSeatB] ? res.reveal[champSeatB].hand : '';
      emitBeat({ type:'over', actor:champNameB, big:true,
        text: won
          ? `🏁 你收池 ${potWon}（净 ${delta>=0?'+':''}${delta}）`
          : `🏁 ${champNameB}${champDB!=null&&champDB>0?` 净赢 +${champDB}`:` 收池 ${potTotalAll}`}${handNameB?(' · '+handNameB):''}`,
        quip: beatQuip(champSeatB, 'win') });
      if(typeof opts.onResult==='function'){ try{ opts.onResult(res, st.log, { mySeat, potWon, delta, handName: handNameB, myStack: myStackNow }); }catch(e){ _ehCatch('poker.onResult', e); } }
      emitWallet();
      st.players.forEach(p=>{ if(!p.sitOut) stacks[p.seat]=p.stack; });
      emitStacks();   // 全员真实筹码写回账本(灵魂/远程真人/我)
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
        // ★已让座: 该席即使 DB 还没腾完也不得还原成我(防"自动入座")
        if (selfVacatedUid && ids && ids[s] && ids[s]===selfVacatedUid){ ids[s]=null; names[s]='空位'; avatars[s]='＋'; isAI[s]=false; continue; }
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
          stacks[s] = seatBuyIn(s); buyin[s] = stacks[s]; netSettled[s] = 0;
          vacated[s] = false; vacatedUid[s] = null; saveScore();
        } else if (vacated[s] && !realOccupant){
          vacatedUid[s] = null;                     // DB 已把该席腾空 → 之后同一位灵魂也可被重新邀请
        }
      }
      normalizeBotNames();   // 名册更新后同样统一本机 AI 兜底名为花名
      personaBySeat = names.map((_, seat) => personaFor(seat));
      remoteSeats.length = 0; (A.remoteSeats || []).forEach(x => remoteSeats.push(x));
    }

    // 主人诉求: 点"返回"后不再无限后台连打 —— 到"下一局开始"这一刻就离场。
    //   有其他真人在桌 → 只是退出(离桌, 别人继续); 纯灵魂/AI 桌 → 结束整局。
    //   离桌 vs 散桌的实际落地由 app.js 注入的 onExit 按角色兜底(host→gtClose 散桌 / guest→本地清场离场),
    //   角色天然编码"有无真人": 你是客人 ⟺ 桌上有房主(真人)→ onExit 离场; 你是独自带灵魂的房主 → onExit 散桌。
    function leaveAfterReturn(){ close(); }

    function clearHandSelection(){
      preAct=null;
      raiseTo=0;
      lastMyTurn=false;
      animPhase='preflop';
      lastPotShown=-1;
      lastBoardSig='';
      lastMeSig='';
    }
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
      // ★先标破产离场, 再按概率补位: 顺序反了会把 bust 席直接填掉, 跳过 onSeatVacate 腾 DB 座
      markBustedVacant();
      // ★每局空位概率补位(主人): 灵魂优先, 否则机器人 —— 桌面不至于长期空席
      try{ autoFillVacants(); }catch(_){}
      emitStacks();
      // 对手都离场了(在座不足 2 人): 概率补位后仍不够 → 停在结算态等手动/下一轮概率补
      if (aliveSeats().length < 2){
        try{ autoFillVacants(); }catch(_){}
        if (aliveSeats().length < 2){
          try{ toast('桌上暂时没人 · 点空位邀请补位', 3200); }catch(_){}
          renderOpponents(true); positionSeats();
          return;
        }
      }
      button = (button+1)%n;
      handNo++;
      st = newHand();
      clearHandSelection();
      lastBoardLen=0; dealAnim=true;
      sfx('deal');
      renderAll(); positionSeats();
    }

    // 单机: 本场结束(真人输光)后从头再来 —— 全员按账本真实筹码重新带入(破产/清零回补 1000)
    function resetMatch(){
      _clearAutoTrusteeOnNewDeal();
      if (!isGuest && pkLimitReached()){
        showDailyCap();
        return;
      }
      // ★灵魂/机器人筹码跨局累积(主人: 玩家输完重开时, 灵魂不要清空回 1000):
      //   有筹码的席原样留着接着打; 输光/空席才按账本补买入。我这席按钱包带入。
      stacks = names.map((_, i) => {
        const cur = stacks[i] || 0;
        if (i !== mySeat && cur > 0) return cur;
        return seatBuyIn(i);
      });
      for(let i=0;i<n;i++){ buyin[i]=stacks[i]; netSettled[i]=0; vacated[i]=false; vacatedUid[i]=null; }
      saveScore();
      button = (typeof opts.button==='number') ? opts.button : (n - 1) % n;
      handNo = 0;
      st = newHand();
      clearHandSelection();
      emitWallet();
      emitStacks();
      // 「再来一局」要第一时间入座开打: 不放发牌动画
      lastBoardLen=0; dealAnim=false; lastMyTurn=false; raiseTo=0; preAct=null; animPhase='preflop'; lastPotShown=-1; lastBoardSig=''; lastMeSig='';
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
      if (minimized) updateChip();
      startWalkIns();   // 名册刷新后仍在招募态 → 确保路人入座定时器在跑(内部去重, 不会重复排程)
    }
    function startDeal(A, seed){
      _clearAutoTrusteeOnNewDeal();
      if (st.phase!=='lobby') return;
      // journey-exempt: 每日局数门禁 + seatBuyIn 账本 — journey-chip-authenticity.js
      if (!isGuest && pkLimitReached()){
        try{ toast('今日已输光 '+PK_DAILY_MAX+' 次 · 明天再来'); }catch(_){}
        return;
      }
      clearWalkIn();   // 转正局: 停"路人入座"
      try{ closeInviteMenu(); }catch(_){}
      // 名册就地全量生效(与 applyPendingRoster 同语义, 但这是首发, 全员按账本买入)
      if (A && Array.isArray(A.names) && A.names.length===n){
        for (let s=0;s<n;s++){
          names[s]=A.names[s]; avatars[s]=A.avatars[s]; isAI[s]=A.isAI[s];
          if (ids) ids[s]=(A.ids?A.ids[s]||null:null);
          if (A.souls) souls[s]=A.souls[s];
        }
        remoteSeats.length=0; (A.remoteSeats||[]).forEach(x=>remoteSeats.push(x));
        normalizeBotNames();   // startDeal 首发: 兜底名「机器人N」统一成花名
        // 招募态本机邀请的机器人: DB 该席仍空(→A 里落成 AI 兜底 bot、无灵魂/真人 uid)时, 沿用邀请时的花名/头像,
        //   免"招募时看到疯哥, 开局却换个名"的观感跳变。真人/灵魂真占了该席则以 DB 为准, 不覆盖。
        for (const s in lobbyBots){ const i=+s; if (isAI[i] && !souls[i] && (!ids || !ids[i])){ names[i]=lobbyBots[i].name; avatars[i]=lobbyBots[i].emoji; if(souls) souls[i]={ archetype: lobbyBots[i].archetype||'sharp', name:lobbyBots[i].name, emoji:lobbyBots[i].emoji }; } }
        personaBySeat = names.map((_, seat)=>personaFor(seat));
      }
      // 全新一桌: 筹码按账本真实买入(灵魂/远程真人/我), 买入基准对齐, 离场标记清空
      // ★我这席带生涯钱包入局(opts.myStack), 其余席 seatBuyIn
      // 累积: 已有筹码的席不回 1000
      stacks = names.map((_, i) => {
        const cur = stacks[i] || 0;
        if (i !== mySeat && cur > 0) return cur;
        return seatBuyIn(i);
      });
      for(let i=0;i<n;i++){ buyin[i]=stacks[i]; netSettled[i]=0; vacated[i]=false; vacatedUid[i]=null; }
      handNo = 0; button = 0; pendingRoster = null;
      // 入场即开打: 不放慢发牌动画
      lastBoardLen=0; dealAnim=false; lastMyTurn=false; raiseTo=0; preAct=null; animPhase='preflop'; lastPotShown=-1; lastBoardSig=''; lastMeSig=''; myHole=[];
      st = newHand(seed);
      sfx('deal');
      emitWallet();
      emitStacks();
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
        sfx('arrive');
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
      clearHandSelection();
      lastBoardLen=0; dealAnim=true;
      sfx('deal');
      renderAll(); positionSeats();
    }

    function renderAll(){
      room.dataset.phase = st.phase;   // 招募态桌面化的 CSS 钩子: [data-phase="lobby"] 命中一整套空桌样式(打牌态无此属性→不受影响)
      maybeCollectChips();   // 街结束→筹码归池(须在 renderOpponents 重建座位/清 commit 之前捕获旧位置)
      renderPot(); renderBoard(); renderOpponents(); renderMe(); renderMsg();
      armTurn(minimized ? null : onHumanTimeout);
      if (minimized) updateChip();
      // 招募态不产快照(无牌可发/可泄, 与斗地主/掼蛋同构: lobby 不广播, startDeal 转正局后才走 onSync)
      if (onSync && !isGuest && st.phase!=='lobby'){ try{ onSync(st, handNo); }catch(e){ _ehCatch('poker.onSync', e); } }   // host: 每次状态变更 → 产快照广播 + 写底牌
      renderActs();   // ★fix: 操作区渲染在最后, 确保 onSync/状态更新后再画按钮, 签名护栏挡掉无谓重建, 轮到我时按钮稳定不闪
    }

    // ── guest 端: 收公共快照 / 收自己底牌 → 组伪状态渲染(全程不碰引擎权威) ──
    function feedHand(cards){
      myHole = (cards||[]).map(c => (typeof c==='string') ? idCard(c)
        : (c && c.rank!=null ? Engine.pokerCard(c.rank, c.suit) : null)).filter(Boolean);
      if (isGuest && lastSnap) rebuildFromSnap(lastSnap);
    }
    function rebuildFromSnap(snap){
      if (!PokerNet){ console.warn('[pk] net not loaded'); return; }
      // ★fix: guest 乐观推进街时占位公共牌(label='?')被发进 st.board, renderBoard 把 lastBoardLen 设到占位数;
      //   权威快照到达后 st 被替换为真牌, 但 lastBoardLen 仍=占位数 → grew=false 跳过翻牌动画, 真牌静默替换无动画。
      //   修复: 检测旧 board 是否含占位牌, 是则把 lastBoardLen 回退到【旧 board 中真实牌数】, 让真牌获翻牌动画。
      const oldBoard = (st && st.board) || [];
      const oldRealLen = oldBoard.filter(c => c && c.suit !== '?' && c.label !== '?').length;
      st = PokerNet.pseudoState(snap, mySeat, myHole);
      if (oldRealLen !== lastBoardLen) lastBoardLen = oldRealLen;
      renderAll();
    }
    function applySnapshot(snap){
      if (!isGuest || !snap) return;
      // ★v43: 收到快照先清旧计时器(rAF/timeout/结算横幅), 防上一手残留计时器与新一帧并存驱动同一徽标 → 倒计时双倍
      clearTimers();
      if (root.EHPokerNet && root.EHPokerNet.acceptSeq){
        const acc = root.EHPokerNet.acceptSeq(snap, lastSnapSeq);
        if (!acc.ok) return;                 // 迟到旧包: 丢弃
        lastSnapSeq = acc.seq;
      }
      awaitingHost=false; if (awaitingHostT){ clearTimeout(awaitingHostT); awaitingHostT=null; }
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
          <h2>🛑 今日牌桌已封盘</h2>
          <div class="pk-delta down">今天已输光 ${PK_DAILY_MAX} 次 · 明天再来</div>
          <div class="pk-daily cap">每天最多输光 ${PK_DAILY_MAX} 次，次日自动重置</div>
          <div class="pk-row" style="margin-top:2px"><button class="pk-b call" id="pkDone">返回房间</button></div>
        </div>`;
      els.felt.appendChild(over);
      sfx('void');
      const doneBtn = over.querySelector('#pkDone');
      if (doneBtn) doneBtn.addEventListener('click', ()=>{ close(); });
    }

    renderAll();
    // 首帧对手位置需等布局稳定
    requestAnimationFrame(positionSeats);
    if (lobbyMode && isHostLobby) startWalkIns();   // 招募态开桌即起"路人不定时入座"(host 没手动邀满时慢慢来人)
    // 今日对局已达上限: 不入座不发牌, 直接封盘页(收工)。否则正常走入座序列。
    if (!isGuest && !lobbyMode && pkLimitReached()){
      introSeating = false;
      showDailyCap();
    } else if (introSeating) runSeatingIntro();
    function needsHand(){
      if (!isGuest) return false;
      if (!st || st.phase === 'lobby' || st.phase === 'over' || st.phase === 'waiting') return false;
      return myHole.length === 0;
    }
    return { close, minimize, restore, isMinimized:()=>minimized, state:()=>st, lastSnap:()=>lastSnap,
      applyMove, resync, applySnapshot, feedHand, needsHand, updateRoster, mySeat:()=>mySeat,
      setConn, connState:()=>connState, setOfflineUids,
      isSpectating:()=>spectating,
      // 主动离座旁观: 必须真进 spectating(旧实现只 idleOut, resumeSeat 永不触发 onSeatResume)
      enterSpectator: doEnterSpectator,
      resumeSeat, resumeRemote,
      fillSeat, freeSoulsForSeat, autoFillVacants, vacantSeatsForFill,
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
      _aiThinkMs:(d,la)=>aiThinkMs(d,la),   // 测试: 按决策类型采样思考时长(验"不再每次耗满")
      _walkInTick:()=>{ if(walkInTimer){clearTimeout(walkInTimer);walkInTimer=null;} walkInTick(); if(walkInTimer){clearTimeout(walkInTimer);walkInTimer=null;} },  // 测试: 手动跑一次路人入座判定(不留真实定时器)
      _walkInState:()=>({ target:walkInTarget, empty:lobbyEmptySeats().length, occupied:n-lobbyEmptySeats().length, n }),
      _setWalkInTarget:(t)=>{ walkInTarget=t; },   // 测试: 固定目标人数, 消除随机性做确定性断言
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
