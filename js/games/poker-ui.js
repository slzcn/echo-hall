// ============================================================
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
@keyframes pkRoomIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.pk-bar{display:flex;align-items:center;gap:10px;flex-shrink:0;border-bottom:1px solid var(--line,rgba(0,229,212,.24));
  padding:calc(11px + env(safe-area-inset-top,0px)) max(15px,env(safe-area-inset-right,0px)) 11px max(15px,env(safe-area-inset-left,0px))}
.pk-title{font-weight:800;letter-spacing:.06em;color:var(--ink,#eaf6ff);font-size:15px;display:flex;align-items:center;gap:8px}
.pk-title .dot{width:8px;height:8px;border-radius:50%;background:var(--accent,#00e5d4);box-shadow:var(--glow-cyan)}
.pk-blinds{font-size:12px;color:var(--amber,#ffc24d);font-weight:700;padding:2px 9px;border:1px solid var(--line);border-radius:999px;white-space:nowrap}
.pk-mus{margin-left:auto;width:30px;height:30px;border-radius:50%;border:1px solid var(--line);background:transparent;
  color:var(--sub,#86cbc6);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.pk-mus:hover{color:var(--ink);border-color:var(--line2)}
.pk-mus.muted{color:var(--dim,#498d88);opacity:.75}
.pk-x{height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:transparent;
  color:var(--sub,#86cbc6);font-size:13px;cursor:pointer;display:flex;align-items:center;gap:5px;flex-shrink:0}
.pk-x:hover{color:var(--ink);border-color:var(--line2)}
/* 牌桌绒面 */
.pk-felt{flex:1;position:relative;display:flex;flex-direction:column;min-height:0;max-width:var(--maxw,none);width:100%;margin:0 auto;box-sizing:border-box;overflow:hidden}
.pk-felt.shake{animation:pkShake .42s cubic-bezier(.36,.07,.19,.97)}
@keyframes pkShake{10%,90%{transform:translateX(-1px)}30%,50%,70%{transform:translateX(-3px)}40%,60%{transform:translateX(3px)}}
.pk-table{position:absolute;left:3%;right:3%;top:9px;bottom:9px}
.pk-table::before{content:'';position:absolute;left:4%;right:4%;top:6%;bottom:6%;border-radius:50%/46%;
  background:radial-gradient(ellipse at 50% 42%,rgba(0,120,110,.30),rgba(4,20,20,.55) 62%,rgba(2,10,12,.6) 100%);
  border:2px solid rgba(0,229,212,.18);box-shadow:inset 0 2px 30px rgba(0,0,0,.55),0 0 24px rgba(0,229,212,.06)}
/* 中央: 底池 + 公共牌 */
.pk-center{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:3;width:88%}
.pk-pot{font-size:13px;color:var(--amber,#ffc24d);font-weight:800;letter-spacing:.03em;display:flex;align-items:center;gap:6px;
  background:rgba(4,10,14,.5);border:1px solid rgba(255,194,77,.35);border-radius:999px;padding:3px 12px;white-space:nowrap}
.pk-pot .pc{width:11px;height:11px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe08a,#e0a020);box-shadow:0 1px 2px rgba(0,0,0,.4)}
.pk-board{display:flex;gap:5px;min-height:var(--ch,48px);align-items:center;justify-content:center;flex-wrap:wrap}
.pk-board .card.flip-in{animation:pkFlip .34s cubic-bezier(.2,.9,.3,1) both}
@keyframes pkFlip{from{transform:rotateY(90deg) scale(.8);opacity:0}to{transform:none;opacity:1}}
.pk-msg{font-size:12px;color:var(--sub);min-height:14px;text-align:center}
.pk-msg.mine{color:var(--accent);font-weight:800}
/* 座位(对手, 绝对定位于上弧) */
.pk-seat{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:2px;width:var(--seatw,78px);z-index:4}
.pk-seat.folded{opacity:.4;filter:grayscale(.7)}
.pk-avr{width:var(--av,44px);height:var(--av,44px);border-radius:50%;display:grid;place-items:center;padding:3px;box-sizing:border-box;position:relative;transition:background .15s}
.pk-seat.turn .pk-avr{background:conic-gradient(from -90deg,var(--accent,#00e5d4) calc(var(--p,360)*1deg),var(--line,rgba(0,229,212,.18)) 0)}
.pk-avr .av{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:var(--avf,20px);background:var(--panel-solid,#132a29);border:1.5px solid var(--line2);position:relative}
.pk-seat.turn .pk-avr .av{box-shadow:0 0 14px var(--accent,rgba(0,229,212,.6))}
.pk-seat.win .pk-avr .av{border-color:var(--amber,#ffc24d);box-shadow:0 0 16px var(--amber,rgba(255,194,77,.7))}
.pk-btn-d{position:absolute;right:-6px;bottom:-4px;width:18px;height:18px;border-radius:50%;background:#fff;color:#111;font-size:10px;font-weight:900;display:grid;place-items:center;box-shadow:0 1px 3px rgba(0,0,0,.5);z-index:5}
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
.pk-raise input[type=range]{flex:1;accent-color:var(--accent,#00e5d4);height:22px}
.pk-raise .pk-amt{min-width:58px;text-align:center;font-size:14px;font-weight:800;color:var(--amber);font-variant-numeric:tabular-nums}
.pk-quick{display:flex;gap:6px}
.pk-qbtn{flex:1;padding:5px 0;border-radius:9px;font-size:11px;font-weight:700;border:1px solid var(--line2);background:var(--panel);color:var(--sub);cursor:pointer}
.pk-qbtn:active{transform:scale(.95)}
.pk-row{display:flex;gap:9px;justify-content:center}
.pk-b{flex:1;max-width:150px;padding:12px 0;border-radius:12px;font-weight:800;font-size:15px;line-height:18px;cursor:pointer;white-space:nowrap;
  border:1px solid var(--line2);background:var(--panel);color:var(--ink);letter-spacing:.04em;transition:.14s}
.pk-b:active{transform:scale(.96)}
.pk-b:disabled{opacity:.35;cursor:not-allowed;box-shadow:none}
.pk-b.fold{color:var(--sub)}
.pk-b.call{background:var(--accent);color:var(--btn-ink,#04060c);border-color:var(--accent);box-shadow:var(--glow-cyan)}
.pk-b.raise{background:var(--amber,#ffc24d);color:#04060c;border-color:var(--amber);box-shadow:0 0 12px rgba(255,194,77,.5)}
.pk-b.raise.allin{background:var(--magenta,#ff2d8e);border-color:var(--magenta,#ff2d8e);color:#fff;box-shadow:var(--glow-mag,0 0 12px rgba(255,45,142,.6))}
.pk-b .bt{font-size:11px;line-height:14px;font-weight:700;opacity:.85;display:block}
/* 结算 */
.pk-over{position:absolute;inset:0;z-index:9;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 50% 40%,rgba(6,14,20,.72),rgba(3,5,10,.9));backdrop-filter:blur(5px);animation:pkRoomIn .2s;padding:16px;box-sizing:border-box;text-align:center}
.pk-over-card{display:flex;flex-direction:column;align-items:center;gap:12px;width:min(340px,92%);box-sizing:border-box;
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
    const PokerNet = root.EHPokerNet;
    let myHole = [];       // guest: 自己的两张底牌(牌对象), 由 feedHand 注入
    let lastSnap = null;   // guest: 最近一张公共快照

    const sb = opts.sb || 5, bb = opts.bb || 10;
    const START = opts.startStack || 1000;
    let stacks = names.map(() => START);
    let button = (typeof opts.button==='number') ? opts.button : (n - 1) % n;  // 首手庄家在我上家, 我不当第一个庄

    function aliveSeats(){ return stacks.map((v,i)=> v>0?i:-1).filter(i=>i>=0); }
    function newHand(seedOverride){
      // 破产补带: 灵魂/对手破产一律自动补带(练习桌总有对手可打);
      //   真人破产——单机模式保持 0(showOver 已判本场终结, 根本走不到这里发牌),
      //   联机模式沿用旧的"全员补带"语义(在线对局不因一人破产而终止, 由房主掌控)。
      stacks = stacks.map((v, seat) => {
        if (v > 0) return v;
        if (seat !== mySeat) return START;          // 灵魂/对手
        return isLocalSolo ? v : START;             // 真人
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
    // 单机: 开局先进"入座"态(灵魂陆续上桌), 到齐后才发第一手; guest: 等房主发牌; host/其余: 直接发牌
    let introSeating = isLocalSolo;
    let arrived = isLocalSolo ? new Set([mySeat]) : null, lastSeated = -1;
    let st = isGuest ? waitingState() : (isLocalSolo ? waitingState('seating') : newHand());

    function sfx(nm){ try{ if(root.EhSfx && root.EhSfx.play) root.EhSfx.play(nm); }catch(_){} }
    function vibrate(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(_){} }
    sfx('arrive'); sfx('deal');

    let aiTimer=null, ringRAF=null, streetTimer=null, turnStart=0, turnDur=0;
    let animPhase=null, lastPotShown=-1;   // 筹码归池动画: 追踪街推进 / 底池增额
    let lastBoardLen = 0, lastMyTurn=false, dealAnim=true;

    const mountEl = opts.mount || document.getElementById('hall') || document.body;
    const room = document.createElement('div'); room.className='pk-room';
    room.innerHTML = `
      <div class="pk-bar">
        <div class="pk-title"><span class="dot"></span>德州扑克</div>
        <div class="pk-blinds" id="pkBlinds"></div>
        <button class="pk-mus" id="pkMus" aria-label="背景音乐开关">🎵</button>
        <button class="pk-x" id="pkX" aria-label="返回聊天">✕ 返回</button>
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

    const dock = (opts.chat && root.EHTableChat)
      ? root.EHTableChat.mount(room, { send: opts.chat.send, me: opts.chat.me }) : null;

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
    function connLabel(k){ return ({online:'● 在线', reconnecting:'⟳ 重连中', host_offline:'⚠ 房主离线'})[k] || ''; }
    function setConn(kind){
      if(!kind) kind='online';
      if(kind===connState) return;
      connState = kind;
      renderMsg(); renderActs(); updateChip();
      if(kind==='host_offline'){ try{ vibrate([40,80,40]); }catch(_){ } }
    }
    function emitBeat(b){ if(typeof opts.onBeat==='function'){ try{ opts.onBeat(Object.assign({ game:'nlhe' }, b)); }catch(_){} } }
    function beatQuip(seat, kind){
      if(!(isAI[seat])) return null;
      const q = rand(QUIP[kind]||[]); if(!q) return null; say(seat, q); return q;
    }

    function clearTimers(){ if(aiTimer){clearTimeout(aiTimer);aiTimer=null;} if(ringRAF){cancelAnimationFrame(ringRAF);ringRAF=null;} if(streetTimer){clearTimeout(streetTimer);streetTimer=null;} }
    const onResize = ()=>positionSeats();
    let _exited=false;
    function close(){ minimized=false; clearTimers(); window.removeEventListener('resize', onResize); if(dock) dock.destroy(); if(chip){ chip.remove(); chip=null; } room.remove();
      if(!_exited){ _exited=true; if(typeof opts.onExit==='function'){ try{ opts.onExit(); }catch(_){} } } }

    // ── 折叠 / 展开(返回聊天但牌局继续) ──
    let minimized=false, chip=null;
    function chipStatus(){
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
    function seatHTML(seat){
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
      return `<div class="pk-seat${st.toAct===seat&&st.phase!=='over'?' turn':''}${p.folded?' folded':''}${p.allin?' allin':''}${won?' win':''}" data-seat="${seat}" style="--p:360">
        <div class="pk-avr"><div class="av">${avatars[seat]||'🤖'}</div>${dbtn}${p.allin&&!p.folded?'<span class="pk-allin-tag">ALL IN</span>':''}</div>
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
    function renderOpponents(){
      // 移除旧对手节点(保留 pk-table 内的 center)
      els.table.querySelectorAll('.pk-seat, .pk-commit').forEach(e=>e.remove());
      const order = displayOrder();
      for (let d=1; d<order.length; d++){
        const seat = order[d];
        const wrap = document.createElement('div');
        const pending = introSeating && arrived && !arrived.has(seat);
        wrap.innerHTML = pending ? seatEmptyHTML(seat) : seatHTML(seat);
        const seatEl = wrap.firstElementChild;
        if (introSeating && arrived && seat===lastSeated) seatEl.classList.add('pk-justseated');
        els.table.appendChild(seatEl);
        if (pending) continue;   // 虚位不摆投入筹码
        // 身前投入(本街) 筹码牌
        const commit = document.createElement('div');
        commit.className='pk-commit'+(st.players[seat].street>0?'':' zero');
        commit.dataset.seat=seat;
        commit.innerHTML=`<span class="pc"></span>${st.players[seat].street}`;
        els.table.appendChild(commit);
      }
      positionSeats();
    }
    function positionSeats(){
      const order = displayOrder();
      const m = order.length - 1;                 // 对手数(我固定坐底, 不占上弧)
      // 对手沿【上弧】分布(而非绕整椭圆): 免得侧位落到 3/9 点钟中线上, 既撞中央公共牌又戳出屏外。
      // 角度域 158°(左上)→90°(正上)→22°(右上); 横半径 40%/竖半径 34% 收在牌桌内(seat 宽 78px 时两侧不溢出)。
      const TMAX=158, TMIN=22;
      for (let d=1; d<order.length; d++){
        const seat=order[d];
        const seatEl = els.table.querySelector(`.pk-seat[data-seat="${seat}"]`);
        const commitEl = els.table.querySelector(`.pk-commit[data-seat="${seat}"]`);
        if(!seatEl) continue;
        const t = (m===1 ? 90 : TMAX - (TMAX-TMIN)*(d-1)/(m-1)) * Math.PI/180;
        const cx = 50 + 40*Math.cos(t);
        const cy = 46 - 34*Math.sin(t);
        seatEl.style.left = cx+'%'; seatEl.style.top = cy+'%';
        if (commitEl){   // 投入筹码摆在座位与中心之间(朝中心方向 ~55% 处)
          const ccx = 50 + (cx-50)*0.5, ccy = 46 + (cy-46)*0.5;
          commitEl.style.left = ccx+'%'; commitEl.style.top = ccy+'%';
        }
      }
    }

    function renderBoard(){
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
      els.blinds.textContent = `盲注 ${st.sb}/${st.bb} · 第 ${handNo+1} 手`;
      // 有人 all-in 且投入分层 → 拆主池/边池展示(对标德州扑克); 否则单一底池
      let pots = null;
      try { pots = Engine.buildSidePots(st); } catch(_){}
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
      if (st.phase==='seating'){ els.msg.className='pk-msg'; els.msg.innerHTML=cp+'🪑 灵魂陆续入座…'; return; }
      if (st.phase==='waiting'){ els.msg.className='pk-msg'; els.msg.innerHTML=cp+'🎴 等房主发牌…'; return; }
      if (st.phase==='over'){ els.msg.className='pk-msg'; els.msg.innerHTML=cp; return; }
      const seat=st.toAct;
      if (seat===mySeat){ els.msg.className='pk-msg mine'; els.msg.innerHTML=cp+'🫵 轮到你 · '+streetName(); }
      else { els.msg.className='pk-msg'; els.msg.innerHTML=cp+(st.players[seat]?escapeHtml(st.players[seat].name):'…')+' 思考中… · '+streetName(); }
    }

    function renderMe(){
      const p=st.players[mySeat];
      const mine = st.toAct===mySeat && st.phase!=='over';
      const showdown = (st.phase==='over' && st.result && st.result.wentToShowdown && st.result.reveal && st.result.reveal[mySeat]);
      const holeCards = (showdown ? st.result.reveal[mySeat].hole.map(idCard) : p.hole);
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
      } else { hint='等待其他玩家行动'; }
      const holeHtml = holeCards.map((c,i)=>{
        const e=cardEl(c,{big:true});
        if(dealAnim){ e.classList.add('justdealt'); e.style.animationDelay=(i*90)+'ms'; }
        return e.outerHTML;
      }).join('');
      els.me.innerHTML = `
        <div class="pk-hole">${holeHtml}</div>
        <div class="pk-info">
          <div class="pk-nmrow"><span class="pk-nm${mine?' turn':''}">${escapeHtml(p.name)}</span><span class="pk-stk">💰 ${p.stack}</span>${st.button===mySeat?'<span class="pk-btn-d" style="position:static;width:16px;height:16px">D</span>':''}<span class="pk-clk" id="pkClk"></span></div>
          <div class="pk-hint">${hint}</div>
        </div>`;
      dealAnim=false;
    }

    // ── 操作区 ──
    let raiseTo = 0;
    let awaitingHost = false;
    // 操作条禁用骨架: 与激活态【同高同结构】——三键禁用 + 滑杆/快捷占位隐藏。中键文案随状态变(等待/已弃牌/已全下/离线/已提交)。
    function actsSkeleton(callLbl){
      return `
        <div class="pk-raise reserved"><input type="range" disabled><span class="pk-amt"></span></div>
        <div class="pk-quick reserved"><button class="pk-qbtn" disabled>½ 池</button><button class="pk-qbtn" disabled>底池</button><button class="pk-qbtn" disabled>2×池</button><button class="pk-qbtn" disabled>全下</button></div>
        <div class="pk-row">
          <button class="pk-b fold" disabled>弃牌<span class="bt">&nbsp;</span></button>
          <button class="pk-b call" disabled>${callLbl}<span class="bt">&nbsp;</span></button>
          <button class="pk-b raise" disabled>加注<span class="bt">&nbsp;</span></button>
        </div>`;
    }
    function renderActs(){
      const p=st.players[mySeat];
      const offline = isGuest && connState!=='online';
      const mine = !offline && !awaitingHost && st.toAct===mySeat && (st.phase==='preflop'||st.phase==='flop'||st.phase==='turn'||st.phase==='river');
      // 非本人行动态: 渲染同高禁用骨架(而非清空塌陷), 三键常驻不跳版
      if (!mine){
        let callLbl='等待行动';
        if (offline) callLbl = (connState==='host_offline'?'房主离线':'连接中…');
        else if(awaitingHost) callLbl='已提交 · 等待裁决';
        else if (st.phase==='seating') callLbl='等灵魂入座';
        else if (st.phase==='waiting') callLbl='等房主发牌';
        else if (st.phase==='showdown'||st.phase==='over') callLbl='本手结束';
        else if (p && p.folded) callLbl='已弃牌 · 观战';
        else if (p && p.allin) callLbl='已全下 · 等摊牌';
        els.acts.innerHTML = actsSkeleton(callLbl);
        return;
      }
      const la=Engine.legalActions(st, mySeat);
      const canRaiseLike = la.canBet || la.canRaise;
      const min=la.minRaiseTo, max=la.maxRaiseTo;
      if (raiseTo<min || raiseTo>max) raiseTo = Math.min(Math.max(min, Math.round((st.pot||bb))), max);
      const callTxt = la.canCheck ? '过牌 <span class="bt">&nbsp;</span>' : `跟注 <span class="bt">${la.callAmount}</span>`;
      const raiseLabel = la.canBet ? '下注' : '加注';
      const isAllinAmt = raiseTo>=max;
      els.acts.innerHTML = `
        <div class="pk-raise${canRaiseLike?'':' reserved'}">
          <input type="range" id="pkSlider" min="${min}" max="${max}" step="${Math.max(1,Math.round(bb/2))}" value="${raiseTo}">
          <span class="pk-amt" id="pkAmt">${raiseTo}</span>
        </div>
        <div class="pk-quick${canRaiseLike?'':' reserved'}">
          <button class="pk-qbtn" data-q="half">½ 池</button>
          <button class="pk-qbtn" data-q="pot">底池</button>
          <button class="pk-qbtn" data-q="2x">2×池</button>
          <button class="pk-qbtn" data-q="allin">全下</button>
        </div>
        <div class="pk-row">
          <button class="pk-b fold" id="pkFold" ${la.canFold?'':'disabled'}>弃牌<span class="bt">&nbsp;</span></button>
          <button class="pk-b call" id="pkCall">${callTxt}</button>
          <button class="pk-b raise ${isAllinAmt?'allin':''}" id="pkRaise" ${canRaiseLike?'':'disabled'}>${isAllinAmt?'全下':raiseLabel} <span class="bt">${isAllinAmt?raiseTo:('至 '+raiseTo)}</span></button>
        </div>`;
      const slider=$('#pkSlider'), amt=$('#pkAmt'), rb=$('#pkRaise');
      function syncAmt(){ if(amt) amt.textContent=raiseTo; if(rb){ const ai=raiseTo>=max; rb.classList.toggle('allin',ai);
        rb.innerHTML = `${ai?'全下':raiseLabel} <span class="bt">${ai?raiseTo:('至 '+raiseTo)}</span>`; } }
      if(slider) slider.addEventListener('input', ()=>{ raiseTo=parseInt(slider.value,10)||min; syncAmt(); sfx('cardsel'); });
      room.querySelectorAll('.pk-qbtn').forEach(b=> b.addEventListener('click', ()=>{
        const q=b.dataset.q; const pot=Math.max(st.pot,bb);
        let to = q==='half'? st.currentBet+Math.round(pot*0.5) : q==='pot'? st.currentBet+pot : q==='2x'? st.currentBet+pot*2 : max;
        raiseTo=Math.min(Math.max(to,min),max); if(slider) slider.value=raiseTo; syncAmt(); sfx('cardsel');
      }));
      $('#pkFold').addEventListener('click', ()=>humanAct('fold'));
      $('#pkCall').addEventListener('click', ()=>humanAct(la.canCheck?'check':'call'));
      if(rb) rb.addEventListener('click', ()=>humanAct(la.canBet?'bet':'raise', raiseTo));
    }

    function humanAct(action, amount){
      if (st.toAct!==mySeat || awaitingHost) return;
      if (isGuest){
        awaitingHost=true;
        if(onAction){ try{ onAction({ action, amount }); }catch(_){} }
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
      if (st.phase==='over' || st.phase==='waiting' || st.phase==='seating') return;
      // 摊牌/结算之外, 无人需行动的中间态不该发生(引擎自动跑完); 安全兜底
      const seat=st.toAct;
      if (seat<0 || !st.players[seat]) return;
      const mine = seat===mySeat;
      if (mine && !lastMyTurn){ sfx('yourturn'); vibrate(18); }
      lastMyTurn=mine;
      // 谁来推进这一步: 我(本地/relay) · AI(本机决策) · 远程真人(等回传, host 侧兜底代打) · guest 观战他人(静态)
      const remote = isRemote(seat);
      const aiSeat = !mine && !remote && !isGuest && isAI[seat];
      turnDur = mine     ? HUMAN_ACT_MS
              : aiSeat   ? (AI_MIN_MS + Math.floor(secureRand()*AI_JIT_MS))
              : remote   ? (HUMAN_ACT_MS + 6000)   // host 兜底比对端 25s 稍长, 留网络冗余; 久不动就代打
              : 0;                                 // guest 看别人回合: 不 tick, 静态高亮即可
      turnStart = Date.now();
      const seatEl = mine ? null : els.table.querySelector(`.pk-seat[data-seat="${seat}"]`);
      const clk = mine ? $('#pkClk') : null;
      if (turnDur<=0) return;
      const tick=()=>{
        const remain=Math.max(0,turnDur-(Date.now()-turnStart));
        const frac=turnDur?(remain/turnDur):0;
        if(seatEl) seatEl.style.setProperty('--p',(frac*360).toFixed(1));
        if(mine && clk){ const sec=Math.ceil(remain/1000); clk.textContent=sec+'s'; clk.classList.toggle('urgent',sec<=5); }
        if(remain<=0){ ringRAF=null;
          if(mine){ if(typeof onExpire==='function') onExpire(); }
          else if(remote){ onRemoteTimeout(seat); }
          return; }
        ringRAF=requestAnimationFrame(tick);
      };
      tick();
      if(aiSeat) aiTimer=setTimeout(()=>aiStep(seat), turnDur);
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
        footer = `<button class="pk-b" id="pkDone">收工</button><button class="pk-b" id="pkWait" disabled>等房主发下一手…</button>`;
      } else if (matchOver){
        footer = `<button class="pk-b" id="pkDone">收工</button><button class="pk-b call" id="pkRestart">再来一局</button>`;
      } else {
        footer = `<button class="pk-b" id="pkDone">收工</button><button class="pk-b" id="pkAuto" disabled>下一手 <span id="pkCd" class="pk-cd"></span></button>`;
      }
      over.innerHTML=`
        <div class="pk-over-card">
          <h2>${h2}</h2>
          ${subLine}
          <div class="pk-showbox"><div class="pk-showrows">${rowsHtml}</div></div>
          ${potsHtml}
          <div class="pk-row" style="margin-top:2px">${footer}</div>
        </div>`;
      // 推池动画: 底池飞向赢家席位(我方=底部), 浮层延后淡入让筹码在绒面上先跑完
      if ((res.winnersBySeat||[]).length){ over.classList.add('payout-in'); payoutChipsFx(res.winnersBySeat); }
      els.felt.appendChild(over);
      if(iWonAll || won){ sfx('sparkle'); setTimeout(()=>sfx('bloom'),200); vibrate([20,60,30]); confetti(); }
      else if(busted){ sfx('void'); vibrate([90,60,90]); }
      else if(delta<0){ sfx('void'); vibrate(90); }

      // host(单机/联机)常规: 倒计时结束全自动开下一手(无手动按钮; "收工"可停)。
      //   联机有其他真人时给多一点时间读结算(5s), 纯单机 3s。破产离桌不自动进下一手。
      let autoT=null;
      function stopAuto(){ if(autoT){ clearInterval(autoT); autoT=null; } }
      if (!isGuest && !matchOver){
        let left = (remoteSeats.length>0) ? 5 : 3;
        const cd=over.querySelector('#pkCd'); if(cd) cd.textContent='('+left+'s)';
        autoT=setInterval(()=>{
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
        if(typeof opts.onBust==='function'){ try{ opts.onBust(); }catch(_){} } close(); });
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
      if(typeof opts.onResult==='function'){ try{ opts.onResult(res, st.log, { mySeat, potWon, delta, handName }); }catch(_){} }
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
        if (!wasHuman && nowHuman) stacks[s] = START;   // 新真人坐下: 全新买入
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
      lastBoardLen=0; dealAnim=true; lastMyTurn=false; raiseTo=0; animPhase='preflop'; lastPotShown=-1;
      sfx('deal');
      renderAll(); positionSeats();
      if (aliveSeats().length<2){}   // newHand 已兜底重新带入
    }

    // 单机: 本场结束(真人输光)后从头再来 —— 全员重新带入 START, 从第一手开始
    function resetMatch(){
      stacks = names.map(()=>START);
      button = (typeof opts.button==='number') ? opts.button : (n - 1) % n;
      handNo = 0;
      st = newHand();
      lastBoardLen=0; dealAnim=true; lastMyTurn=false; raiseTo=0; animPhase='preflop'; lastPotShown=-1;
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
      lastBoardLen=0; dealAnim=true; lastMyTurn=false; raiseTo=0; animPhase='preflop'; lastPotShown=-1;
      sfx('deal');
      renderAll(); positionSeats();
    }

    function renderAll(){
      maybeCollectChips();   // 街结束→筹码归池(须在 renderOpponents 重建座位/清 commit 之前捕获旧位置)
      renderPot(); renderBoard(); renderOpponents(); renderMe(); renderMsg(); renderActs();
      armTurn(minimized ? null : onHumanTimeout);
      if (minimized) updateChip();
      if (onSync && !isGuest){ try{ onSync(st, handNo); }catch(_){} }   // host: 每次状态变更 → 产快照广播 + 写底牌
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
        lastBoardLen=0; dealAnim=true; lastMyTurn=false; raiseTo=0; animPhase='preflop'; lastPotShown=-1; myHole=[];
      }
      rebuildFromSnap(snap);
      if (snap.phase==='over' && !els.felt.querySelector('.pk-over')) showOver();
    }
    function resync(){ if (onSync && !isGuest){ try{ onSync(st, handNo); }catch(_){} } }  // host: 应新客人之请重播当前态

    // id → card (供摊牌/对手明牌重建)
    const SUIT_OF = { s:'♠', h:'♥', c:'♣', d:'♦' };
    function idCard(id){ const suit=SUIT_OF[id[0]]; const rank=parseInt(id.slice(1),10); return Engine.pokerCard(rank, suit); }

    renderAll();
    // 首帧对手位置需等布局稳定
    requestAnimationFrame(positionSeats);
    // 单机: 开局先走灵魂入座序列, 到齐后 beginFirstHand 发第一手
    if (introSeating) runSeatingIntro();
    return { close, minimize, restore, isMinimized:()=>minimized, state:()=>st,
      applyMove, resync, applySnapshot, feedHand, updateRoster, mySeat:()=>mySeat,
      setConn, connState:()=>connState,
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
