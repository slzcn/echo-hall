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

  const HUMAN_ACT_MS = 25000;
  const AI_MIN_MS = 900, AI_JIT_MS = 900;
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
.pk-room.is-land{--av:38px;--avf:18px;--seatw:74px;--cw:32px;--ch:45px;--cn:11px;--cs:9px;--cc:17px;--bcw:36px;--bch:51px}
.pk-room.is-land .pk-bar{padding-top:calc(4px + env(safe-area-inset-top,0px));padding-bottom:4px}
.pk-room.is-land .pk-felt{overflow:visible}
.pk-room.is-land .pk-table{top:4px;bottom:4px}
.pk-room.is-land .pk-me{padding:2px 16px 0;gap:12px}
.pk-room.is-land .pk-acts{gap:5px;padding:5px 14px calc(6px + env(safe-area-inset-bottom,0px))}
.pk-room.is-land .pk-raise input[type=range]{height:18px}
.pk-room.is-land .pk-b{padding:9px 0;font-size:14px}
.pk-room.is-land .pk-qbtn{padding:4px 0}
/* 竖屏美化(手机窄屏): 原 .pk-table 用 top/bottom:9px 撑满整列高度, 椭圆被抻成长蛋——
   上弧座位+公共牌全堆在顶部, 下半个绿肚皮空(因"我"坐在 felt 下方的 pk-me 条, 桌底本无人)。
   这里把桌面收成一个比例匀称的椭圆并竖直居中(操作钮仍钉底、"我"贴其上), 座位/公共牌走 %
   定位随桌高等比缩放, 不再被拉长。.pk-room 前缀提特异性以压过后面定义的基础 .pk-table 规则。 */
@media (max-width:599px){
  .pk-room .pk-table{top:48%;bottom:auto;height:clamp(340px,50vh,430px);transform:translateY(-50%)}
}
@keyframes pkRoomIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.pk-bar{display:flex;align-items:center;gap:10px;flex-shrink:0;border-bottom:1px solid var(--line,rgba(0,229,212,.24));
  padding:calc(11px + env(safe-area-inset-top,0px)) max(15px,env(safe-area-inset-right,0px)) 11px max(15px,env(safe-area-inset-left,0px))}
.pk-title{font-weight:800;letter-spacing:.06em;color:var(--ink,#eaf6ff);font-size:15px;display:flex;align-items:center;gap:8px}
.pk-title .dot{width:8px;height:8px;border-radius:50%;background:var(--accent,#00e5d4);box-shadow:var(--glow-cyan)}
.pk-blinds{font-size:12px;color:var(--amber,#ffc24d);font-weight:700;padding:2px 9px;border:1px solid var(--line);border-radius:999px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis;flex-shrink:1}
.pk-mus{margin-left:auto;width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:transparent;
  color:var(--sub,#86cbc6);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.pk-mus:hover{color:var(--ink);border-color:var(--line2)}
.pk-mus.muted{color:var(--dim,#498d88);opacity:.75}
.pk-x{height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:transparent;
  color:var(--sub,#86cbc6);font-size:13px;cursor:pointer;display:flex;align-items:center;gap:5px;flex-shrink:0}
.pk-x:hover{color:var(--ink);border-color:var(--line2)}
/* 窄屏(手机 <380px)顶栏防溢出: 收紧间距/边距 + 「✕ 返回」收成纯图标, 给盲注 chip 让位, 杜绝返回钮被挤出屏 */
@media (max-width:379px){
  .pk-bar{gap:6px;padding-left:max(10px,env(safe-area-inset-left,0px));padding-right:max(10px,env(safe-area-inset-right,0px))}
  .pk-title{font-size:14px}
  .pk-blinds{font-size:11px}
  .pk-x{padding:0 9px}
  .pk-x .pk-xlbl{display:none}
}
/* 牌桌绒面 */
.pk-felt{flex:1;position:relative;display:flex;flex-direction:column;min-height:0;max-width:var(--maxw,none);width:100%;margin:0 auto;box-sizing:border-box;overflow:hidden}
.pk-felt.shake{animation:pkShake .42s cubic-bezier(.36,.07,.19,.97)}
@keyframes pkShake{10%,90%{transform:translateX(-1px)}30%,50%,70%{transform:translateX(-3px)}40%,60%{transform:translateX(3px)}}
.pk-table{position:absolute;left:3%;right:3%;top:9px;bottom:9px}
.pk-table::before{content:'';position:absolute;left:4%;right:4%;top:6%;bottom:6%;border-radius:50%/46%;
  background:radial-gradient(ellipse at 50% 42%,rgba(0,120,110,.30),rgba(4,20,20,.55) 62%,rgba(2,10,12,.6) 100%);
  border:2px solid rgba(0,229,212,.18);box-shadow:inset 0 2px 30px rgba(0,0,0,.55),0 0 24px rgba(0,229,212,.06)}
/* 中央: 底池 + 公共牌
 * ★下移到 52%(椭圆偏下半): "我"坐桌外底部, 椭圆下半本是空绒面(见上方竖屏注释); 上弧 6 席的身前下注筹码
 *   在 CY≈48 一圈汇聚, 旧的 top:44% 让底池标签/公共牌与这一圈下注筹码糊在一起(主人反馈"页面太乱")。
 *   下移后: 各家下注在上(各自身前), 底池+公共牌独占中下方空白 —— 层次分明, 对标大厂德州"桌心底池"。 */
.pk-center{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:3;width:88%}
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
.pk-seat.turn .pk-avr .av{box-shadow:0 0 14px var(--accent,rgba(0,229,212,.6))}
/* 回合秒数徽标: 只在当前行动席(含对手)头像右下角亮, 让"轮到谁、还剩几秒"看得见 */
.pk-sec{position:absolute;right:-4px;bottom:-4px;min-width:16px;height:16px;padding:0 3px;box-sizing:border-box;border-radius:8px;background:var(--panel-solid,#132a29);border:1px solid var(--amber,#ffc24d);color:var(--amber,#ffc24d);font-size:9px;font-weight:800;line-height:14px;text-align:center;font-variant-numeric:tabular-nums;display:none;z-index:5}
.pk-seat.turn .pk-sec{display:block}
.pk-sec.urgent{border-color:var(--magenta,#ff2d8e);color:var(--magenta,#ff2d8e);animation:pkBlink .6s steps(2,start) infinite}
@keyframes pkBlink{50%{opacity:.35}}
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
/* 卡牌 */
.card{width:var(--cw,34px);height:var(--ch,48px);border-radius:6px;background:#fff;position:relative;flex:none;
  box-shadow:0 2px 5px rgba(0,0,0,.4);border:1px solid rgba(0,0,0,.08);user-select:none;font-family:"SF Pro Rounded","SF Pro Display",-apple-system,"PingFang SC","Helvetica Neue",Arial,sans-serif}
.card.red{color:#e0263e}.card.blk{color:#1a1e28}
.card .cn{position:absolute;top:2px;left:3px;font-size:var(--cn,12px);font-weight:800;line-height:1}
.card .cs{position:absolute;top:15px;left:4px;font-size:var(--cs,10px);line-height:1}
.card .cc{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:var(--cc,18px);opacity:.92}
.card.mini{width:16px;height:22px;border-radius:3px}.card.mini .cn{font-size:8px;top:1px;left:2px}.card.mini .cs{display:none}.card.mini .cc{display:none}
.card.big{width:var(--bcw,38px);height:var(--bch,54px)}.card.big .cn{font-size:calc(var(--cn,12px) + 3px)}.card.big .cc{font-size:calc(var(--cc,18px) + 5px)}.card.big .cs{top:19px}
.card.back{background:radial-gradient(circle at 30% 22%,rgba(0,229,212,.18),transparent 55%),radial-gradient(circle at 74% 76%,rgba(156,133,255,.16),transparent 60%),linear-gradient(150deg,#182742 0%,#0f1a2c 45%,#0a1220 100%);border:1px solid rgba(0,229,212,.28);box-shadow:inset 0 0 0 1px rgba(255,255,255,.04),inset 0 6px 12px rgba(0,0,0,.35),0 2px 6px rgba(0,0,0,.45)}
.card.dim{opacity:.5}
/* 我的座位条 */
.pk-me{display:flex;align-items:center;gap:12px;padding:4px 16px 0;flex-shrink:0}
.pk-me .pk-hole{display:flex;gap:6px}
.pk-me .pk-hole .card.justdealt{animation:pkDeal .34s ease both}
@keyframes pkDeal{from{transform:translateY(30px) scale(.7);opacity:0}to{transform:none;opacity:1}}
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
.pk-raise input[type=range]{flex:1;accent-color:var(--accent,#00e5d4);height:32px}
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
.pk-b.fold{color:var(--sub)}
.pk-b.call{background:var(--accent);color:var(--btn-ink,#04060c);border-color:var(--accent);box-shadow:var(--glow-cyan)}
.pk-b.raise{background:var(--amber,#ffc24d);color:#04060c;border-color:var(--amber);box-shadow:0 0 12px rgba(255,194,77,.5)}
.pk-b.raise.allin{background:var(--magenta,#ff2d8e);border-color:var(--magenta,#ff2d8e);color:#fff;box-shadow:var(--glow-mag,0 0 12px rgba(255,45,142,.6))}
/* 全下二次确认态: 第一次点"全下"进此态(需再点一次才真梭哈), 白描边+脉冲提示"这步会梭全部筹码, 别误触" */
.pk-b.raise.confirm{background:var(--magenta,#ff2d8e);border-color:#fff;color:#fff;animation:pkConfirmPulse .6s ease-in-out infinite alternate}
@keyframes pkConfirmPulse{from{box-shadow:0 0 0 2px rgba(255,255,255,.5),0 0 10px rgba(255,45,142,.5)}to{box-shadow:0 0 0 3px rgba(255,255,255,.98),0 0 20px rgba(255,45,142,.85)}}
.pk-b .bt{font-size:11px;line-height:14px;font-weight:700;opacity:.85;display:block}
/* 预选(pre-action)条: 提示行 + 三键(默认暗态, 选中 .on 高亮) */
.pk-prehint{font-size:11px;color:var(--sub);text-align:center;letter-spacing:.06em;opacity:.85;min-height:14px}
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
.pk-over h2{font-size:26px;margin:0;letter-spacing:.06em;font-weight:900}
.pk-over.win h2{color:var(--amber,#ffc24d);text-shadow:0 0 18px rgba(255,194,77,.6)}
.pk-over.lose h2{color:var(--sub)}
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
    const START = opts.startStack || 1000;
    let stacks = names.map(() => START);
    // 本桌累计净盈亏(相对买入): buyin[seat]=该席至今累计买入(每破产补带一次 +START); netSettled=上一手结算后的净额(stack-buyin)。
    // 净额只在 showOver 结算时刷新, 故座位徽标不随手内下注抖动(展示"进本手时的本桌战绩")。
    // 持久化: 键随牌桌 id(opts.scoreKey), 重进/刷新同一张桌不清零; 桌真正散了由 app.gtClose 清键。
    const SCOREKEY = opts.scoreKey || null;
    const _psav = (()=>{ if(!SCOREKEY) return null; try{ return JSON.parse(localStorage.getItem(SCOREKEY)||'null'); }catch(_){ return null; } })();
    const _okArr = a => Array.isArray(a) && a.length===names.length && a.every(x=>typeof x==='number');
    const buyin = (_psav && _okArr(_psav.buyin)) ? _psav.buyin.slice() : names.map(() => START);
    let netSettled = (_psav && _okArr(_psav.net)) ? _psav.net.slice() : names.map(() => 0);
    function saveScore(){ if(!SCOREKEY) return; try{ localStorage.setItem(SCOREKEY, JSON.stringify({buyin, net:netSettled})); }catch(e){ _ehCatch('poker.saveScore', e); } }
    let button = (typeof opts.button==='number') ? opts.button : (n - 1) % n;  // 首手庄家在我上家, 我不当第一个庄

    function aliveSeats(){ return stacks.map((v,i)=> v>0?i:-1).filter(i=>i>=0); }
    function newHand(seedOverride){
      // 破产补带: 灵魂/对手破产一律自动补带(练习桌总有对手可打);
      //   真人破产——单机模式保持 0(showOver 已判本场终结, 根本走不到这里发牌),
      //   联机模式沿用旧的"全员补带"语义(在线对局不因一人破产而终止, 由房主掌控)。
      stacks = stacks.map((v, seat) => {
        if (v > 0) return v;
        const rebought = (seat !== mySeat) ? START : (isLocalSolo ? v : START);
        if (rebought > 0) buyin[seat] += START;     // 破产补带一次 = 追加一次买入(计入净盈亏基准)
        return rebought;
      });
      while (stacks[button] <= 0) button = (button+1)%n;   // 庄家落在有筹码的人身上
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
    // 单机: 开局先进"入座"态(灵魂陆续上桌), 到齐后才发第一手; guest: 等房主发牌; host 招募态: 落 lobby; host/其余: 直接发牌
    let introSeating = isLocalSolo && !lobbyMode;
    let arrived = introSeating ? new Set([mySeat]) : null, lastSeated = -1;
    let st = isGuest ? waitingState() : (lobbyMode ? lobbyState(lobbySeats) : (introSeating ? waitingState('seating') : newHand()));

    function sfx(nm){ try{ if(root.EhSfx && root.EhSfx.play) root.EhSfx.play(nm); }catch(_){} }
    // 操作语音: 每席按名/机分配稳定音色, 让弃牌/过/跟/加注/全下都出声(对标腾讯德州报牌)
    function whoOf(seat){ if(typeof seat!=='number' || !st || !st.players || !st.players[seat]) return null;
      const ai=!!isAI[seat], nm=st.players[seat].name; return { name:nm, key:nm, isSoul:ai, isHuman:!ai }; }
    function sayOp(seat, text){ try{ if(text && root.EhSfx && root.EhSfx.say) root.EhSfx.say(text, whoOf(seat)); }catch(_){} }
    function vibrate(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(_){} }
    sfx('arrive'); if(!lobbyMode) sfx('deal');

    let aiTimer=null, ringRAF=null, streetTimer=null, overTimer=null, turnStart=0, turnDur=0, turnSeatActive=-1, turnStreetActive='';
    let animPhase=null, lastPotShown=-1;   // 筹码归池动画: 追踪街推进 / 底池增额
    let lastBoardLen = 0, lastMyTurn=false, dealAnim=true;
    let lastBoardSig='', lastMeSig='';   // 增量护栏签名(公共牌区 / 我的底牌条)

    const mountEl = opts.mount || document.getElementById('hall') || document.body;
    const room = document.createElement('div'); room.className='pk-room';
    room.innerHTML = `
      <div class="pk-bar">
        <div class="pk-title"><span class="dot"></span>德州扑克</div>
        <div class="pk-blinds" id="pkBlinds"></div>
        <button class="pk-mus" id="pkMus" aria-label="背景音乐开关">🎵</button>
        <button class="pk-rot" id="pkRot" aria-label="横竖屏切换" title="横屏/竖屏">⟳</button>
        <button class="pk-x" id="pkX" aria-label="返回聊天">✕<span class="pk-xlbl"> 返回</span></button>
      </div>
      <div class="pk-felt" id="pkFelt">
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

    function clearTimers(){ if(aiTimer){clearTimeout(aiTimer);aiTimer=null;} if(ringRAF){cancelAnimationFrame(ringRAF);ringRAF=null;} if(streetTimer){clearTimeout(streetTimer);streetTimer=null;} if(overTimer){clearInterval(overTimer);overTimer=null;} }
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
    $('#pkX').addEventListener('click', minimize);
    const rotBtn = $('#pkRot');
    if (rotBtn) rotBtn.addEventListener('click', ()=>{
      const on = root.EHTableOrient ? root.EHTableOrient.toggle(room) : false;
      rotBtn.classList.toggle('on', on); sfx('click');
      if (!minimized) positionSeats();
    });
    // 牌桌内背景音乐开关: 大厅 🎵 按钮被牌桌浮层盖住, 这里复用同一套 BGM 控制(EH_BGM)让打牌时也能开关
    const musBtn = $('#pkMus');
    function paintMus(){ if(!musBtn) return; const on = !root.EH_BGM || root.EH_BGM.on(); musBtn.textContent = on?'🎵':'🔇'; musBtn.classList.toggle('muted', !on); }
    if (musBtn) musBtn.addEventListener('click', ()=>{ try{ if(root.EH_BGM) root.EH_BGM.set(!root.EH_BGM.on()); }catch(_){} paintMus(); sfx('click'); });
    paintMus();
    window.addEventListener('resize', onResize);

    // ── 座位渲染: 我固定坐底(在 pk-me 条), 对手沿椭圆上弧分布 ──
    function displayOrder(){                // 从我起, 顺时针一圈的座位号
      const out=[]; for(let i=0;i<n;i++) out.push((mySeat+i)%n); return out;
    }
    // 本桌净盈亏徽标(常驻座位): 取上一手结算后的净额, 手内不抖动。首手结算前(handNo===0)不显, 避免开局一排"±0"。
    function netPill(seat){
      if (handNo===0) return '';
      const v = netSettled[seat]||0;
      const cls = v>0?'up':(v<0?'down':'zero');
      return `<div class="pk-net ${cls}">本桌 ${v>=0?'+':''}${v}</div>`;
    }
    // 小盲/大盲席位(与 poker-engine deal 同口径: 2 人时庄=小盲/对家=大盲; 3+ 人时庄+1=小盲、庄+2=大盲)。
    //   lobby/入座态不显; 结算态仍显(便于回看本手盲位)。返回角标 HTML。
    function blindSeats(){
      if (typeof st.button!=='number' || st.phase==='lobby') return {};
      const b=st.button;
      return n===2 ? { sb:b, bb:(b+1)%n } : { sb:(b+1)%n, bb:(b+2)%n };
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
      if(m && !m.contains(e.target) && !(e.target.closest && e.target.closest('.pk-lobby-empty'))) closeInviteMenu();
    }
    function closeInviteMenu(){ const m=room.querySelector('.pk-invite-menu'); if(m) m.remove(); document.removeEventListener('click', _imAway, true); }
    function openInviteMenu(dbSeat, anchorEl){
      closeInviteMenu();
      if(!lobbyCtx || !lobbyCtx.actions){ return; }
      const souls = (lobbyCtx.souls||[]).filter(s=>s&&s.auth_uid);
      const menu=document.createElement('div'); menu.className='pk-invite-menu';
      let html='<div class="im-ttl">邀请入座</div>';
      if(lobbyCtx.actions.inviteHumans) html+='<button class="im-item" data-invite-human="1">👥 邀请真人来坐</button>';
      html += souls.length ? '<div class="im-sep">灵魂</div>' : '<div class="im-empty">房里暂无灵魂</div>';
      souls.forEach(s=>{ html+=`<button class="im-item" data-soul="${escapeHtml(s.auth_uid)}">${escapeHtml((s.emoji||'👤')+s.name)}</button>`; });
      menu.innerHTML=html;
      room.appendChild(menu);
      const rr=room.getBoundingClientRect(), ar=anchorEl.getBoundingClientRect();
      menu.style.left=Math.min(Math.max(8, ar.left-rr.left+ar.width/2-90), Math.max(8, rr.width-188))+'px';
      menu.style.top=Math.min(ar.bottom-rr.top+6, rr.height-60)+'px';
      menu.querySelectorAll('[data-soul]').forEach(b=> b.onclick=()=>{ lobbyCtx.actions.seatSoul(dbSeat, b.dataset.soul); closeInviteMenu(); });
      const ih=menu.querySelector('[data-invite-human]'); if(ih) ih.onclick=()=>{ lobbyCtx.actions.inviteHumans(); closeInviteMenu(); };
      sfx('click');
      setTimeout(()=>document.addEventListener('click', _imAway, true), 0);
    }
    function seatHTML(seat){
      if (st.phase==='lobby') return lobbySeatHTML(seat);
      const p=st.players[seat];
      const showdown = (st.phase==='over' && st.result && st.result.wentToShowdown && st.result.reveal && st.result.reveal[seat]);
      const won = (st.phase==='over' && (st.result.winnersBySeat||[]).includes(seat));
      let hole='';
      if (showdown){
        const rv=st.result.reveal[seat]; const b5=best5Set(seat);
        const cs = rv.hole.map(id=>{ const el=cardEl(idCard(id),{mini:false}); if(b5&&b5.has(id)) el.classList.add('pk-win-card'); return el.outerHTML; }).join('');
        // 摊牌台面直接标各家成手牌型(同花顺/葫芦…), 不必等结算面板 —— 一眼看清谁靠什么赢
        hole = `<div class="pk-mini-hole">${cs}</div><div class="pk-mini-hn">${escapeHtml(rv.hand||'')}</div>`;
      } else if (!p.folded){
        hole = `<div class="pk-mini-hole">${cardEl(null,{back:true,mini:true}).outerHTML}${cardEl(null,{back:true,mini:true}).outerHTML}</div>`;
      } else {
        hole = `<div class="pk-mini-hole"></div>`;
      }
      const dbtn = seat===st.button ? `<span class="pk-btn-d">D</span>` : '';
      const blbtn = blindBadge(seat);
      return `<div class="pk-seat${st.toAct===seat&&st.phase!=='over'?' turn':''}${p.folded?' folded':''}${p.allin?' allin':''}${won?' win':''}" data-seat="${seat}" style="--p:360">
        <div class="pk-avr"><div class="av">${avatars[seat]||'🤖'}</div>${dbtn}${blbtn}${p.allin&&!p.folded?'<span class="pk-allin-tag">ALL IN</span>':''}<span class="pk-sec"></span></div>
        <div class="nm">${escapeHtml(p.name)}</div>
        <div class="stk">${p.allin?'全下':'💰'} <b>${p.allin?'':p.stack}</b></div>
        ${netPill(seat)}
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
      const sig = order.join(',')+'#'+parts+'#T'+st.toAct+'#'+(land?'L':'P')+'#'+(lastSeated||'')+'#'+st.phase;
      if(!force && sig===_lastOppSig) return;
      _lastOppSig=sig;
      // 移除旧对手节点(保留 pk-table 内的 center)
      els.table.querySelectorAll('.pk-seat, .pk-commit').forEach(e=>e.remove());
      for (let d=1; d<order.length; d++){
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
      if (st.phase==='lobby') bindLobbySeats();
    }
    function positionSeats(){
      const land = root.EHTableOrient ? root.EHTableOrient.reflect(room) : false;  // 横屏态标记(open/resize/旋转都会过这里)
      const order = displayOrder();
      const m = order.length - 1;                 // 对手数(我固定坐底, 不占上弧)
      // 对手沿【上弧】分布(而非绕整椭圆): 免得侧位落到 3/9 点钟中线上, 既撞中央公共牌又戳出屏外。
      // 角度域 158°(左上)→90°(正上)→22°(右上); 横半径 40%/竖半径 34% 收在牌桌内(seat 宽 78px 时两侧不溢出)。
      const TMAX=158, TMIN=22;
      // 横屏: 桌面又宽又矮 → 横向半径放大(铺开占满宽度不挤中央), 竖向半径压扁 + 中心上移(上弧别顶出矮felt)。
      // 竖屏 felt 收成比例椭圆后变矮(见上方 @media 注释), 上弧中心随之下移(CY 46→48), 免得高约 110px 的座位卡顶边戳出矮 felt。
      const RX = land ? 46 : 40, RY = land ? 30 : 34, CY = land ? 42 : 48;
      for (let d=1; d<order.length; d++){
        const seat=order[d];
        const seatEl = els.table.querySelector(`.pk-seat[data-seat="${seat}"]`);
        const commitEl = els.table.querySelector(`.pk-commit[data-seat="${seat}"]`);
        if(!seatEl) continue;
        const t = (m===1 ? 90 : TMAX - (TMAX-TMIN)*(d-1)/(m-1)) * Math.PI/180;
        const cx = 50 + RX*Math.cos(t);
        const cy = CY - RY*Math.sin(t);
        seatEl.style.left = cx+'%'; seatEl.style.top = cy+'%';
        if (commitEl){   // 投入筹码摆在座位与中心之间, 偏座位一侧(0.62)→下注贴各家身前, 不再往桌心堆(配合底池下移到 52%)
          const ccx = 50 + (cx-50)*0.62, ccy = CY + (cy-CY)*0.62;
          commitEl.style.left = ccx+'%'; commitEl.style.top = ccy+'%';
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
      els.blinds.textContent = `盲注 ${st.sb}/${st.bb} · 第 ${handNo+1} 手`;
      // 有人 all-in 且投入分层 → 拆主池/边池展示(对标德州扑克); 否则单一底池
      let pots = null;
      try { pots = Engine.buildSidePots(st); } catch(e){ _ehCatch('poker.buildSidePots', e); }
      const anyAllin = st.players.some(p=>p.allin && !p.folded);
      if (pots && pots.length>1 && anyAllin){
        const parts = pots.map((pt,i)=> `<span class="pk-potpart${i?' side':''}">${i===0?'主池':'边'+i} ${pt.amount}</span>`).join('');
        els.pot.innerHTML = `<span class="pc"></span>${parts}`;
      } else {
        els.pot.innerHTML = `<span class="pc"></span>底池 ${st.pot}`;
      }
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
        const p=st.players[mySeat]||{};
        const nm = p.name || names[mySeat] || '你';
        const roleTxt = p.kind==='soul' ? '灵魂' : '你 · 房主';
        els.me.innerHTML = `
          <div class="pk-hole"><div class="pk-avr" style="width:var(--av,44px);height:var(--av,44px);border-radius:50%"><div class="av">${avatars[mySeat]||p.emoji||'🙂'}</div></div></div>
          <div class="pk-info"><div class="pk-nmrow"><span class="pk-nm">${escapeHtml(nm)}</span><span class="pk-stk" style="color:var(--sub)">${roleTxt}</span></div>
          <div class="pk-hint">🪑 招募中 · 点空位邀灵魂或真人入座</div></div>`;
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
      const holeHtml = holeCards.map((c,i)=>{
        const e=cardEl(c,{big:true});
        if(dealAnim){ e.classList.add('justdealt'); e.style.animationDelay=(i*90)+'ms'; }
        return e.outerHTML;
      }).join('');
      els.me.innerHTML = `
        <div class="pk-hole">${holeHtml}</div>
        <div class="pk-info">
          <div class="pk-nmrow"><span class="pk-nm${mine?' turn':''}">${escapeHtml(p.name)}</span><span class="pk-stk">💰 ${p.stack}</span>${st.button===mySeat?'<span class="pk-btn-d" style="position:static;width:16px;height:16px">D</span>':''}${myBlind?myBlind.replace('class="pk-btn-bl','class="pk-btn-bl inline'):''}${madeStr?`<span class="pk-made">${madeStr}</span>`:''}<span class="pk-clk" id="pkClk"></span></div>
          <div class="pk-hint">${hint}</div>
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
          <button class="pk-b fold" disabled>弃牌<span class="bt">&nbsp;</span></button>
          <button class="pk-b call" disabled>${callLbl}<span class="bt">&nbsp;</span></button>
          <button class="pk-b raise" disabled>加注<span class="bt">&nbsp;</span></button>
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
      const callTxt = la.canCheck ? '过牌 <span class="bt">&nbsp;</span>' : `跟注 <span class="bt">${la.callAmount}</span>`;
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
          <button class="pk-b fold" id="pkFold" ${(la.canFold && !la.canCheck)?'':'disabled'}>弃牌<span class="bt">&nbsp;</span></button>
          <button class="pk-b call" id="pkCall">${callTxt}</button>
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

    function humanAct(action, amount){
      if (st.toAct!==mySeat || awaitingHost) return;
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

    // host 权威应用远程真人动作 / 测试驱动任意席; 返回是否被引擎接受(app.js 据此决定要不要重播快照纠偏)
    function applyMove(seat, move){
      if(isGuest) return false;                // 客人无权威, 不本地应用
      if(!move || st.toAct!==seat) return false;
      try{ var r=Engine.applyAction(st, seat, move.action, move.amount); }catch(e){ return false; }
      afterAction(seat, move.action, move.amount, r);
      return true;
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

    // ── 回合驱动: 亮环倒计时 + AI/自动 ──
    function armTurn(onExpire){
      clearTimers();
      if (st.phase==='lobby' || st.phase==='over' || st.phase==='waiting' || st.phase==='seating') { turnSeatActive=-1; turnStreetActive=''; return; }
      // 摊牌/结算之外, 无人需行动的中间态不该发生(引擎自动跑完); 安全兜底
      const seat=st.toAct;
      if (seat<0 || !st.players[seat]) { turnSeatActive=-1; return; }
      const mine = seat===mySeat;
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
        turnDur = mine     ? HUMAN_ACT_MS
                : isGuest  ? HUMAN_ACT_MS          // guest 看别人回合: 纯展示, 给人类时长让环正常走(原为 0 → 徽标从不更新/空白)
                : aiSeat   ? (AI_MIN_MS + Math.floor(secureRand()*AI_JIT_MS))
                : remote   ? (HUMAN_ACT_MS + 6000)   // host 兜底比对端 25s 稍长, 留网络冗余; 久不动就代打
                : 0;
        turnStart = Date.now();
      }
      const seatEl = mine ? null : els.table.querySelector(`.pk-seat[data-seat="${seat}"]`);
      const clk = mine ? $('#pkClk') : null;
      const secEl = seatEl && seatEl.querySelector('.pk-sec');   // 对手行动席头像秒数徽标
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
        if(aiSeat){ const remainMs=Math.max(0,turnDur-(Date.now()-turnStart)); aiTimer=setTimeout(()=>aiStep(seat), remainMs); }
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
          if(secEl){ secEl.textContent=sec; secEl.classList.toggle('urgent',sec<=5); }
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
      if(aiSeat){ const remainMs=Math.max(0,turnDur-(Date.now()-turnStart)); aiTimer=setTimeout(()=>aiStep(seat), remainMs); }   // 同回合重渲用剩余时间, 否则 AI 行动被反复推迟
    }
    // host 侧: 远程真人久不响应 → 用引擎权威替其过牌/弃牌, 防一人掉线卡死全桌
    function onRemoteTimeout(seat){
      if (isGuest || st.toAct!==seat || st.phase==='over') return;
      const la=Engine.legalActions(st, seat);
      applyMove(seat, { action: la.canCheck?'check':'fold' });
    }
    function onHumanTimeout(){
      if (st.toAct!==mySeat || st.phase==='over') return;
      const la=Engine.legalActions(st, mySeat);
      if (la.canCheck){ toast('超时 · 自动过牌'); humanAct('check'); }
      else { toast('超时 · 自动弃牌'); humanAct('fold'); }
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
        footer = (iBust && bustLimit)
          ? `<button class="pk-b call" id="pkDone">收工</button>`
          : `<button class="pk-b" id="pkDone">收工</button><button class="pk-b call" id="pkRestart">再来一局</button>`;
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
      if(iWonAll || won){ sfx('sparkle'); setTimeout(()=>sfx('bloom'),200); vibrate([20,60,30]); confetti(); }
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
      if(typeof opts.onResult==='function'){ try{ opts.onResult(res, st.log, { mySeat, potWon, delta, handName }); }catch(e){ _ehCatch('poker.onResult', e); } }
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
        names[s]   = A.names[s];
        avatars[s] = A.avatars[s];
        isAI[s]    = A.isAI[s];
        if (ids) ids[s] = A.ids[s] || null;
        if (A.souls) souls[s] = A.souls[s];
        if (!wasHuman && nowHuman){ stacks[s] = START; buyin[s] = START; netSettled[s] = 0; saveScore(); }   // 新真人坐下: 全新买入, 净盈亏归零重算
      }
      personaBySeat = names.map((_, seat) => personaFor(seat));
      remoteSeats.length = 0; (A.remoteSeats || []).forEach(x => remoteSeats.push(x));
    }

    function nextHand(){
      // 写回筹码 → (应用中途加入/离座名册变化) → 开新一手
      st.players.forEach(p=> stacks[p.seat]=p.stack);
      applyPendingRoster();
      button = (button+1)%n;
      handNo++;
      st = newHand();
      lastBoardLen=0; dealAnim=true; lastMyTurn=false; raiseTo=0; preAct=null; animPhase='preflop'; lastPotShown=-1; lastBoardSig=''; lastMeSig='';
      sfx('deal');
      renderAll(); positionSeats();
      if (aliveSeats().length<2){}   // newHand 已兜底重新带入
    }

    // 单机: 本场结束(真人输光)后从头再来 —— 全员重新带入 START, 从第一手开始
    function resetMatch(){
      stacks = names.map(()=>START);
      for(let i=0;i<n;i++){ buyin[i]=START; netSettled[i]=0; }   // 本场重来: 买入基准 + 净盈亏全部归零
      saveScore();
      button = (typeof opts.button==='number') ? opts.button : (n - 1) % n;
      handNo = 0;
      st = newHand();
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
      // 全新一桌: 筹码/买入/净盈亏/手数/庄位全部重置
      stacks = names.map(()=>START);
      for(let i=0;i<n;i++){ buyin[i]=START; netSettled[i]=0; }
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
