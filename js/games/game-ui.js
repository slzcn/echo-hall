// ============================================================
// game-ui.js — 斗地主牌桌 UI（入室牌桌 + 回合倒计时 + 落牌动效 + AI 陪玩驱动）
// ------------------------------------------------------------
// 依赖(浏览器全局): EHDeck / EHDdzRules / EHDdzEngine / EHDdzAI
// 对外: window.EHDdzGame.open({ mount, seat, names, avatars, onResult })
//   · 纯前端单人 vs AI:引擎跑在浏览器,AI 两家自动决策(定时器驱动)。
//   · 牌桌挂进聊天室 #hall 内(不是全屏浮层): 房间"变成"牌桌, 返回即回聊天。
//   · 每回合有倒计时环, 到点自动过/自动出(和断线托管同一套兜底逻辑)。
//   · 出牌有落桌动画; 当前该谁出用高亮环 + 中央横幅双重强提示。
//   · 视觉走 Echo Hall 主题变量(--accent/--ink/--panel...),自适应任意皮肤。
//   · onResult(result, log) 回调:交给聊天室去写 eh_game_results + 播报。
// 无网络;真人房版本另接 Edge,复用同一引擎与本 UI。
// ============================================================
(function(root){
  'use strict';
  const Deck = root.EHDeck, Rules = root.EHDdzRules, Engine = root.EHDdzEngine, AI = root.EHDdzAI;

  // 回合时限(ms): 到点自动出/自动过, 与断线托管走同一兜底
  const HUMAN_PLAY_MS = 20000;
  const HUMAN_BID_MS  = 15000;
  const AI_MIN_MS = 850, AI_JIT_MS = 650;   // AI 思考时长(也是它的倒计时环长度)

  // ── 一次性注入样式 ─────────────────────────────────────────
  const CSS_ID = 'ddz-ui-css';
  function injectCSS(){
    if (document.getElementById(CSS_ID)) return;
    const s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = `
/* 入室牌桌:挂在 #hall 内, absolute 铺满(房间变成牌桌), 不是全屏黑色浮层 */
/* ★终端自适应: 所有尺寸走 CSS 变量, 小屏默认, 大屏媒体查询整体放大 → 大屏不再"元素不够饱满" */
.ddz-room{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;overflow:hidden;
  background:linear-gradient(180deg,var(--bg2,#0d1524),var(--bg,#070a12));
  border-radius:inherit;animation:ddzRoomIn .22s cubic-bezier(.2,.9,.3,1);
  --cw:44px;--ch:62px;--cn:15px;--cs:12px;--cc:25px;      /* 大牌尺寸 + 内部字号 */
  --cmw:28px;--cmh:40px;                                  /* mini 牌(底牌/座位) */
  --av:52px;--avf:23px;--seatw:104px;                     /* 头像/emoji/座位宽 */
  --hand-ov:-20px;--hand-pad:24px;--banner:13px;--oppmax:none}
@media (min-width:600px) and (min-height:620px){
  .ddz-room{--cw:50px;--ch:70px;--cn:17px;--cs:13px;--cc:28px;--cmw:32px;--cmh:45px;
    --av:60px;--avf:27px;--seatw:120px;--hand-ov:-22px;--hand-pad:28px;--banner:15px;--oppmax:560px}
}
@media (min-width:900px) and (min-height:700px){
  .ddz-room{--cw:58px;--ch:81px;--cn:20px;--cs:14px;--cc:33px;--cmw:36px;--cmh:51px;
    --av:72px;--avf:32px;--seatw:140px;--hand-ov:-26px;--hand-pad:34px;--banner:17px;--oppmax:640px}
}
/* 大屏(平板横屏/桌面): 牌/头像/座位放大, 中央出牌区收束居中不空旷, 操作区更饱满 */
@media (min-width:1000px) and (min-height:760px){
  .ddz-room{--cw:66px;--ch:92px;--cn:23px;--cs:16px;--cc:38px;--cmw:40px;--cmh:56px;
    --av:84px;--avf:38px;--seatw:160px;--hand-ov:-22px;--hand-pad:38px;--banner:20px;--oppmax:720px}
  .ddz-felt{justify-content:center}                       /* 牌桌内容整体竖向居中, 上下留白对称 */
  .ddz-room .ddz-center{flex:none;margin:16px 0}          /* 中央区收到内容自然高(压过 base flex:1), 不再撑出半空盒子 */
  .ddz-opps{padding-top:6px}
  .ddz-seat .nm{font-size:13px}
  .ddz-seat .cnt{font-size:13px}
  .ddz-played{min-height:100px}
  .ddz-turnbanner{min-height:26px}
  .ddz-turnbanner.mine{font-size:20px}
  .ddz-me .ddz-avr{width:48px;height:48px}
  .ddz-me .ddz-avr .av{font-size:22px}
  .ddz-btn{padding:14px 0;font-size:17px;max-width:150px;border-radius:14px}
  .ddz-acts{gap:14px}}
/* 竖屏平板等"窄而高"屏: 宽度够不到大屏断点, 但高屏空间大 → 元素放大 + 收束中央区居中 */
@media (min-width:600px) and (max-width:999px) and (min-height:900px){
  .ddz-room{--cw:62px;--ch:87px;--cn:22px;--cs:15px;--cc:36px;--cmw:38px;--cmh:53px;
    --av:76px;--avf:34px;--seatw:150px;--hand-ov:-22px;--hand-pad:34px;--banner:18px;--oppmax:680px}
  .ddz-felt{justify-content:center}
  .ddz-room .ddz-center{flex:none;margin:16px 0}
  .ddz-seat .nm{font-size:13px}
  .ddz-seat .cnt{font-size:13px}
  .ddz-btn{padding:14px 0;font-size:17px;max-width:150px;border-radius:14px}
  .ddz-acts{gap:14px}}
@keyframes ddzRoomIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.ddz-bar{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line,rgba(0,229,212,.24));flex-shrink:0}
.ddz-title{font-weight:800;letter-spacing:.06em;color:var(--ink,#eaf6ff);font-size:15px;display:flex;align-items:center;gap:8px}
.ddz-title .dot{width:8px;height:8px;border-radius:50%;background:var(--accent,#00e5d4);box-shadow:var(--glow-cyan)}
.ddz-mult{font-size:12px;color:var(--amber,#ffc24d);font-weight:700;padding:2px 8px;border:1px solid var(--line);border-radius:999px}
.ddz-x{margin-left:auto;height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:transparent;
  color:var(--sub,#86cbc6);font-size:13px;cursor:pointer;display:flex;align-items:center;gap:5px}
.ddz-x:hover{color:var(--ink);border-color:var(--line2)}
/* 牌桌绒面 */
.ddz-felt{flex:1;position:relative;display:flex;flex-direction:column;min-height:0}
.ddz-felt.shake{animation:ddzShake .42s cubic-bezier(.36,.07,.19,.97)}
@keyframes ddzShake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(2px)}30%,50%,70%{transform:translateX(-4px)}40%,60%{transform:translateX(4px)}}
.ddz-opps{display:flex;justify-content:space-around;padding:12px 12px 2px;max-width:var(--oppmax,none);margin:0 auto;width:100%;box-sizing:border-box}
/* 座位(对手 + 自己) 公共外观 */
.ddz-seat{display:flex;flex-direction:column;align-items:center;gap:3px;width:var(--seatw,104px);position:relative}
.ddz-avr{width:var(--av,52px);height:var(--av,52px);border-radius:50%;display:grid;place-items:center;padding:3px;box-sizing:border-box;
  background:transparent;transition:background .15s}
.ddz-seat.turn .ddz-avr{background:conic-gradient(from -90deg,var(--accent,#00e5d4) calc(var(--p,360)*1deg),var(--line,rgba(0,229,212,.18)) 0)}
.ddz-avr .av{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:var(--avf,23px);background:var(--panel-solid,#132a29);border:1.5px solid var(--line2);position:relative}
.ddz-seat.turn .ddz-avr .av{box-shadow:0 0 14px var(--accent,rgba(0,229,212,.6))}
.ddz-seat.landlord .ddz-avr .av::after{content:'👑';position:absolute;top:-13px;left:50%;transform:translateX(-50%);font-size:15px}
.ddz-seat .nm{font-size:11px;color:var(--sub);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddz-seat.turn .nm{color:var(--accent);font-weight:700}
.ddz-seat .cnt{font-size:11px;color:var(--dim,#498d88);font-variant-numeric:tabular-nums}
.ddz-seat .cnt b{color:var(--ink)}
.ddz-seat .role{font-size:9px;letter-spacing:.08em;padding:0 5px;border-radius:6px;border:1px solid var(--line);color:var(--dim)}
.ddz-seat.landlord .role{color:var(--amber);border-color:var(--amber)}
.ddz-say{position:absolute;top:56px;font-size:11px;color:var(--ink);background:var(--panel-solid,#132a29);
  border:1px solid var(--line);border-radius:10px;padding:3px 8px;max-width:130px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:4}
.ddz-say.show{opacity:1}
/* 中央出牌区 */
.ddz-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:4px 16px;min-height:120px;position:relative}
.ddz-turnbanner{font-size:var(--banner,13px);letter-spacing:.05em;color:var(--sub);min-height:18px;display:flex;align-items:center;gap:6px;transition:.15s}
.ddz-turnbanner.mine{color:var(--accent);font-weight:800;font-size:15px;text-shadow:var(--glow-cyan)}
.ddz-turnbanner .clk{font-variant-numeric:tabular-nums;color:var(--amber);font-weight:800}
.ddz-turnbanner .clk.urgent{color:var(--magenta,#ff2d8e);animation:ddzBlink .6s steps(2,start) infinite}
@keyframes ddzBlink{50%{opacity:.35}}
.ddz-lastwho{font-size:11px;color:var(--sub);min-height:14px}
.ddz-played{display:flex;min-height:70px;align-items:center;justify-content:center}
.ddz-played.fly-top{animation:ddzFlyTop .28s cubic-bezier(.2,.9,.3,1)}
.ddz-played.fly-bot{animation:ddzFlyBot .28s cubic-bezier(.2,.9,.3,1)}
@keyframes ddzFlyTop{from{transform:translateY(-50px) scale(.78);opacity:0}to{transform:none;opacity:1}}
@keyframes ddzFlyBot{from{transform:translateY(52px) scale(.78);opacity:0}to{transform:none;opacity:1}}
.ddz-passtag{color:var(--dim);font-size:14px;letter-spacing:.14em;border:1px dashed var(--line);border-radius:10px;padding:6px 16px;animation:ddzFlyTop .22s}
.ddz-bottom-cards{position:absolute;top:6px;right:14px;display:flex;gap:3px;transform:scale(.6);transform-origin:top right;opacity:.9}
.ddz-boom{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);font-size:40px;font-weight:900;letter-spacing:.05em;
  color:var(--magenta,#ff2d8e);text-shadow:var(--glow-mag);pointer-events:none;z-index:6;animation:ddzBoom .7s ease-out forwards}
@keyframes ddzBoom{0%{transform:translate(-50%,-50%) scale(.3);opacity:0}25%{transform:translate(-50%,-50%) scale(1.15);opacity:1}100%{transform:translate(-50%,-50%) scale(1.4);opacity:0}}
.ddz-flash{position:absolute;inset:0;z-index:5;pointer-events:none;border-radius:inherit;
  background:radial-gradient(ellipse at center,rgba(255,45,142,.3),rgba(255,45,142,.07) 45%,transparent 70%);animation:ddzFlash .5s ease-out forwards}
@keyframes ddzFlash{0%{opacity:0}12%{opacity:1}100%{opacity:0}}
/* 卡牌 (尺寸/字号走 --cw/--ch/--cn... 变量, 大屏媒体查询整体放大) */
.card{width:var(--cw,44px);height:var(--ch,62px);border-radius:7px;background:#fff;position:relative;flex:none;
  box-shadow:0 2px 5px rgba(0,0,0,.35);border:1px solid rgba(0,0,0,.08);user-select:none;font-family:"SF Pro Rounded","SF Pro Display",-apple-system,"PingFang SC","Helvetica Neue",Arial,sans-serif}
.card.red{color:#e0263e}.card.blk{color:#1a1e28}
.card .cn{position:absolute;top:3px;left:4px;font-size:var(--cn,15px);font-weight:800;line-height:1;text-align:center}
.card .cs{position:absolute;top:18px;left:5px;font-size:var(--cs,12px);line-height:1}
.card .cc{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:var(--cc,25px);opacity:.92}
.card.joker .cc{font-size:calc(var(--cc,25px) * .76)}
.card.joker.big{background:linear-gradient(150deg,#fff,#ffe9b8)}
.card.joker.small{background:linear-gradient(150deg,#fff,#e8ecff)}
.card.back{background:radial-gradient(circle at 30% 22%,rgba(0,229,212,.18),transparent 55%),radial-gradient(circle at 74% 76%,rgba(156,133,255,.16),transparent 60%),linear-gradient(150deg,#182742 0%,#0f1a2c 45%,#0a1220 100%);border:1px solid rgba(0,229,212,.28);box-shadow:inset 0 0 0 1px rgba(255,255,255,.04),inset 0 6px 12px rgba(0,0,0,.35),0 2px 6px rgba(0,0,0,.45)}
.card.mini{width:var(--cmw,28px);height:var(--cmh,40px)}.card.mini .cn{font-size:11px}.card.mini .cs{font-size:8px;top:13px}.card.mini .cc{font-size:15px}
/* 我的座位标(手牌上方左侧) */
.ddz-me{display:flex;align-items:center;gap:9px;padding:4px 14px 0}
.ddz-me .ddz-seat{flex-direction:row;width:auto;gap:8px}
.ddz-me .ddz-avr{width:40px;height:40px;padding:2.5px}
.ddz-me .ddz-avr .av{font-size:19px}
.ddz-me .meta{display:flex;flex-direction:column;align-items:flex-start;gap:1px}
.ddz-me .meta .nm{max-width:150px}
/* 手牌扇形 */
.ddz-hand-wrap{padding:2px 10px 4px;border-top:1px solid var(--line);background:linear-gradient(180deg,transparent,rgba(0,0,0,.18))}
.ddz-hand{display:flex;justify-content:center;padding:var(--hand-pad,24px) 0 6px;min-height:92px;flex-wrap:nowrap}
.ddz-hand .card{margin-left:var(--hand-ov,-20px);transition:transform .14s ease,box-shadow .14s;cursor:pointer;transform-origin:bottom center}
.ddz-hand .card:first-child{margin-left:0}
.ddz-hand.locked .card{cursor:default}
.ddz-hand .card.sel{transform:translateY(-18px);box-shadow:0 6px 14px rgba(0,0,0,.4),0 0 0 2px var(--accent)}
.ddz-hand:not(.locked) .card:hover{transform:translateY(-8px)}
.ddz-hand:not(.locked) .card.sel:hover{transform:translateY(-18px)}
.ddz-hand .card.justdealt{animation:ddzDeal .3s ease}
@keyframes ddzDeal{from{transform:translateY(30px);opacity:0}to{transform:none;opacity:1}}
/* 理牌: 一键(短按)/手动拖排(长按) 共用一个按钮 */
.ddz-hand-wrap{position:relative}
.ddz-sort{position:absolute;right:10px;top:1px;z-index:6;padding:5px 11px;border-radius:11px;font-size:12px;font-weight:800;
  border:1px solid var(--line2);background:var(--panel);color:var(--sub);cursor:pointer;letter-spacing:.04em;transition:.14s;touch-action:none;-webkit-user-select:none;user-select:none}
.ddz-sort:active{transform:scale(.94)}
.ddz-sort.active{background:var(--amber);color:#04060c;border-color:var(--amber);box-shadow:0 0 12px rgba(255,194,77,.5)}
.ddz-hand.arranging{touch-action:none}
.ddz-hand.arranging .card{cursor:grab}
.ddz-hand.arranging .card.dragging{cursor:grabbing;transition:none;box-shadow:0 12px 24px rgba(0,0,0,.55),0 0 0 2px var(--amber);z-index:50}
/* 操作条 */
.ddz-acts{display:flex;gap:10px;justify-content:center;padding:8px 16px calc(12px + env(safe-area-inset-bottom,0px))}
.ddz-btn{flex:1;max-width:130px;padding:11px 0;border-radius:12px;font-weight:800;font-size:15px;cursor:pointer;
  border:1px solid var(--line2);background:var(--panel);color:var(--ink);letter-spacing:.05em;transition:.14s}
.ddz-btn:active{transform:scale(.96)}
.ddz-btn.primary{background:var(--accent);color:var(--btn-ink,#04060c);border-color:var(--accent);box-shadow:var(--glow-cyan)}
.ddz-btn.primary:disabled{background:var(--panel);color:var(--ink)}
.ddz-btn:disabled{opacity:.4;cursor:not-allowed;box-shadow:none}
.ddz-btn.ghost{background:transparent;color:var(--sub)}
/* 叫地主浮条 */
.ddz-bidbar{display:flex;flex-direction:column;align-items:center;gap:10px;padding:8px 16px calc(12px + env(safe-area-inset-bottom,0px))}
.ddz-bidbar .q{font-size:13px;color:var(--sub)}
.ddz-bidbtns{display:flex;gap:8px}
.ddz-bidbtns .ddz-btn{min-width:62px;max-width:none;flex:none;padding:9px 4px;font-size:14px}
/* 结算 */
.ddz-over{position:absolute;inset:0;z-index:9;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
  background:rgba(4,6,12,.84);backdrop-filter:blur(3px);animation:ddzRoomIn .2s}
.ddz-over h2{font-size:30px;margin:0;letter-spacing:.1em;font-weight:900}
.ddz-over.win h2{color:var(--accent);text-shadow:var(--glow-cyan)}
.ddz-over.lose h2{color:var(--magenta,#ff2d8e);text-shadow:var(--glow-mag)}
.ddz-over .sub{color:var(--sub);font-size:13px;text-align:center;line-height:1.6}
.ddz-over .score{font-size:22px;font-weight:800;color:var(--amber)}
.ddz-toast{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%);background:var(--panel-solid);
  border:1px solid var(--line2);color:var(--ink);padding:8px 16px;border-radius:12px;font-size:13px;
  opacity:0;transition:opacity .2s;z-index:8;pointer-events:none;text-align:center}
.ddz-toast.show{opacity:1}
/* 胜利彩带: 顶部撒下一排 emoji, 各自随机横移+旋转飘落, 1.4s 后自清(showOver 里生成) */
.ddz-confetti{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:10}
.ddz-confetti i{position:absolute;top:-8%;font-size:20px;animation:ddzFall linear forwards;will-change:transform,opacity}
@keyframes ddzFall{0%{transform:translateY(0) rotate(0);opacity:0}12%{opacity:1}100%{transform:translateY(115%) rotate(var(--r,540deg));opacity:0}}
/* ── F1 融合: "返回"不销毁牌局, 而是把牌桌折叠成右下角活牌桌片(PiP), 牌局在后台继续; 点片展开回牌桌 ── */
/*    折叠/展开都朝右下角那枚片做 zoom, 读起来是"同一个东西叠进/长出片子", 让 chat⇄table 是一个连续空间 */
.ddz-room.ddz-collapsing{transition:transform .24s cubic-bezier(.4,0,1,1),opacity .24s;transform-origin:100% 100%;
  transform:scale(.14) translate(60%,64%);opacity:0;pointer-events:none}
.ddz-room.ddz-expanding{animation:ddzExpand .28s cubic-bezier(.2,.9,.3,1)}
@keyframes ddzExpand{from{transform-origin:100% 100%;transform:scale(.14) translate(60%,64%);opacity:0}to{transform:none;opacity:1}}
.ddz-chip{position:absolute;right:14px;bottom:calc(env(safe-area-inset-bottom,0px) + 96px);z-index:18;
  display:flex;align-items:center;gap:9px;max-width:min(74vw,264px);padding:8px 12px 8px 11px;cursor:pointer;
  background:linear-gradient(135deg,var(--panel-solid,#132a29),var(--bg2,#0d1524));
  border:1px solid var(--line2,rgba(0,229,212,.4));border-radius:16px;color:var(--ink,#eaf6ff);
  box-shadow:0 10px 28px rgba(0,0,0,.5);animation:ddzChipIn .26s cubic-bezier(.2,.9,.3,1);
  -webkit-tap-highlight-color:transparent;user-select:none}
@keyframes ddzChipIn{from{opacity:0;transform:translateY(10px) scale(.88)}to{opacity:1;transform:none}}
.ddz-chip .ck-ic{font-size:21px;line-height:1;position:relative;flex:none}
.ddz-chip .ck-tx{display:flex;flex-direction:column;min-width:0;line-height:1.28}
.ddz-chip .ck-t{font-size:12px;font-weight:800;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ddz-chip .ck-s{font-size:11px;color:var(--sub,#86cbc6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ddz-chip .ck-x{margin-left:1px;flex:none;width:22px;height:22px;border-radius:50%;border:1px solid var(--line,rgba(0,229,212,.24));
  display:grid;place-items:center;font-size:12px;color:var(--sub,#86cbc6)}
.ddz-chip.turn{border-color:var(--accent,#00e5d4);box-shadow:0 10px 28px rgba(0,0,0,.5),0 0 16px var(--accent,rgba(0,229,212,.55))}
.ddz-chip.turn .ck-ic::after{content:'';position:absolute;inset:-7px;border-radius:50%;border:2px solid var(--accent,#00e5d4);
  animation:ddzChipPulse 1.05s ease-out infinite;pointer-events:none}
@keyframes ddzChipPulse{0%{transform:scale(.65);opacity:.9}100%{transform:scale(1.55);opacity:0}}
.ddz-chip.over{border-color:var(--amber,#ffc24d)}
.ddz-chip.over .ck-s{color:var(--amber,#ffc24d)}
.ddz-conn{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-right:6px;letter-spacing:.03em;vertical-align:1px}
.ddz-conn.online{background:rgba(0,229,212,.12);color:var(--accent,#00e5d4);border:1px solid rgba(0,229,212,.35)}
.ddz-conn.reconnecting{background:rgba(255,194,77,.14);color:var(--amber,#ffc24d);border:1px solid rgba(255,194,77,.4);animation:ddzConnBlink 1s ease-in-out infinite}
.ddz-conn.host_offline{background:rgba(255,93,108,.16);color:#ff5d6c;border:1px solid rgba(255,93,108,.45)}
@keyframes ddzConnBlink{0%,100%{opacity:.62}50%{opacity:1}}
.ddz-chip.hidden-alert{border-color:#ff5d6c!important;box-shadow:0 10px 28px rgba(0,0,0,.5),0 0 20px rgba(255,93,108,.7)!important;filter:brightness(1.12)}

`;
    document.head.appendChild(s);
  }

  // ── 卡牌渲染 ───────────────────────────────────────────────
  function cardEl(card, opts){
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'card' + (opts.mini?' mini':'');
    if (card.joker){
      el.classList.add('joker', card.joker === 'big' ? 'big' : 'small');
      el.classList.add(card.joker === 'big' ? 'red' : 'blk');
      el.innerHTML = `<div class="cn">${card.joker==='big'?'大':'小'}</div><div class="cc">🃏</div>`;
    } else {
      const red = (card.suit === '♥' || card.suit === '♦');
      el.classList.add(red ? 'red' : 'blk');
      el.innerHTML = `<div class="cn">${card.label}</div><div class="cs">${card.suit}</div><div class="cc">${card.suit}</div>`;
    }
    el.dataset.id = card.id;
    return el;
  }
  function cardBack(mini){ const el=document.createElement('div'); el.className='card back'+(mini?' mini':''); return el; }

  // ── 主控 ───────────────────────────────────────────────────
  function open(opts){
    opts = opts || {};
    if (!Deck || !Rules || !Engine || !AI){ console.warn('[ddz] engine not loaded'); return null; }
    injectCSS();

    const mySeat = (typeof opts.mySeat==='number') ? opts.mySeat : 0;   // 联机: 真人可坐非 0 席
    let connState = 'online';
    function connLabel(k){ return ({online:'● 在线', reconnecting:'⟳ 重连中', host_offline:'⚠ 房主离线'})[k] || ''; }
    function setConn(kind){
      if(!kind) kind='online';
      if(kind===connState) return;
      connState = kind; try{ setBanner(); }catch(_){ } try{ updateChip(); }catch(_){ }
      if(kind==='host_offline'){ try{ vibrate([40,80,40]); }catch(_){ } }
    }
    function connPill(){ return connState==='online' ? '' : ('<span class="ddz-conn '+connState+'">'+connLabel(connState)+'</span>'); }
    const names = opts.names || ['你', '灵魂·左', '灵魂·右'];
    const avatars = opts.avatars || ['🙂','🤖','👾'];
    const gameIsAI = opts.isAI || [false,true,true];                    // 联机: host 按座位实况标人/机
    // 对手 DOM 槽位: 以 mySeat 为基, 顺位 (me+1)/(me+2)(单机 mySeat=0 时恰为 1/2)
    const OPP_SEATS = [(mySeat+1)%3, (mySeat+2)%3];
    // ── 联机(host 权威)双模式: guest 只渲染 host 广播的脱敏公共快照 + 回传自己动作, 不建局/不跑引擎 ──
    //   单机路径(isGuest=false)完全走原逻辑, 零改动; 所有 guest 行为一律走 isGuest 分支旁路。
    //   斗地主有【叫分阶段】与【底牌】: 底牌定地主后才随快照明置(见 ddz-net.js); 手牌动态(地主 +3 / 出一张少一张),
    //   由 host 每次广播时重写各远程席私牌行 —— 快照永不带 seed/log/别家手牌/定地主前的底牌。
    const mode = opts.mode || 'local';
    const isGuest = mode === 'guest';
    const remoteSeats = opts.remoteSeats || [];          // host 视角: 哪些席是远程真人(等其回传, 超时代打)
    const isRemote = (seat)=> remoteSeats.indexOf(seat) >= 0;
    const onSync   = (typeof opts.onSync==='function')   ? opts.onSync   : null;  // host: 每次状态变更 → 广播快照
    const onAction = (typeof opts.onAction==='function') ? opts.onAction : null;  // guest: 回传我的动作给 host
    const GNet = root.EHDdzNet;
    let myHand = [];        // guest: 自己手牌(从 eh_gt_hands 拉到)
    let lastSnap = null;    // guest: 最近一张公共快照
    let dealNo = 0;         // 本桌第几局(host 广播随快照带出; guest 据此识别新一局去拉手牌)
    let awaitingHost = false; // guest: 已回传动作, 等 host 裁决快照期间锁 UI 防重复
    const REMOTE_TIMEOUT_MS = HUMAN_PLAY_MS + 8000;      // host 等远程真人回传的宽限, 超时自动代打

    function newGame(){ return Engine.createGame({ isAI: gameIsAI, names, seed: opts.seed }); }
    // guest 占位局: 等 host 首帧快照到达前的空桌, 字段齐全避免渲染读空。
    function waitingState(){
      return { phase:'wait', seed:undefined, turn:-1, landlord:null, multiplier:1, base:1, bombs:0,
        bid:null, result:null, bottom:[], table:{ lastPlay:null, passesInRow:0 },
        players:[0,1,2].map(s=>({ id:'p'+s, seat:s, name:(names[s]||('席'+s)),
          isAI: !!(gameIsAI && gameIsAI[s]), hand:[] })) };
    }
    // ── host: 产出脱敏公共快照交给 app.js 广播(顺带把各远程真人席【当前】手牌写回私牌表: 定地主 +3 / 出一张少一张) ──
    function broadcast(){
      if (isGuest || !onSync || !GNet) return;
      try{ onSync(GNet.snapshot(st, dealNo), st); }catch(_){}
    }
    // 供联机(host 权威应用远程真人动作)/超时托管驱动任意席一手。含叫分阶段。
    // 返回 true=引擎接受并应用; false=非本人回合/非法/牌不在手 → 调用方 resync 把权威快照重播给客人纠偏。
    function applyMove(seat, move){
      if (!move || st.phase==='over' || st.phase==='wait') return false;
      try {
        if (st.phase==='bid'){
          if (!st.bid || st.bid.turn!==seat) return false;
          if (move.action==='call'){ doCall(seat, move.val); return true; }
          return false;
        }
        if (st.phase==='play'){
          if (st.turn!==seat) return false;
          if (move.action==='pass'){ doPass(seat); return true; }
          if (move.action==='play'){
            const hand = st.players[seat].hand;
            const cards = (move.cards||[]).map(c=> hand.find(h=>h.id===(c&&c.id||c))).filter(Boolean);
            const r = Engine.applyPlay(st, seat, cards);
            if (!Rules.isBomb(r&&r.played)) sfx('cardplay');
            maybeBanter(seat); renderAll();
            if (r && r.over) showOver();
            return true;
          }
        }
      } catch(e){ return false; }
      return false;
    }
    let st = isGuest ? waitingState() : newGame();
    let selected = new Set();     // 选中的 card id
    let hintCycle = [];           // 提示循环队列
    let hintIdx = 0;

    // ── 音效 + 触感(复用聊天室 EhSfx 合成器; 未加载则静默, 全程 try/catch 不打断牌局) ──
    function sfx(n){ try{ if(root.EhSfx && root.EhSfx.play) root.EhSfx.play(n); }catch(_){} }
    function vibrate(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(_){} }
    let dealAnim = true;          // 下一次 renderHand 播发牌错峰入场(开局/重发/再来一局各触发一次)
    let lastLord = null;          // 地主揭晓上升沿(null→定人)一次性音效
    let lastMyTurn = false;       // "轮到我"上升沿: 只在刚轮到时提示音+震动, 不每帧响
    sfx('arrive'); if(!isGuest) sfx('deal');   // 开桌一声 + 洗牌发牌(guest 未拿到手牌前不响发牌音)

    // 定时器:AI 行动 + 回合倒计时(环 + 到点兜底)
    let aiTimer = null;
    let ringRAF = null, actionTimer = null;
    let turnStart = 0, turnDur = 0, turnSeatActive = -1;

    // 挂载点:优先聊天室 #hall(入室牌桌), 无则退回 body
    const mountEl = opts.mount || document.getElementById('hall') || document.body;

    const room = document.createElement('div'); room.className = 'ddz-room';
    room.innerHTML = `
      <div class="ddz-bar">
        <div class="ddz-title"><span class="dot"></span>斗地主</div>
        <div class="ddz-mult" id="ddzMult">底分 1 · ×1</div>
        <button class="ddz-x" id="ddzX" aria-label="返回聊天">✕ 返回</button>
      </div>
      <div class="ddz-felt" id="ddzFelt">
        <div class="ddz-opps" id="ddzOpps"></div>
        <div class="ddz-center">
          <div class="ddz-bottom-cards" id="ddzBottom"></div>
          <div class="ddz-turnbanner" id="ddzBanner"></div>
          <div class="ddz-lastwho" id="ddzWho"></div>
          <div class="ddz-played" id="ddzPlayed"></div>
        </div>
      </div>
      <div class="ddz-me" id="ddzMe"></div>
      <div class="ddz-hand-wrap"><button class="ddz-sort" id="ddzSort" aria-label="理牌">🔀 理牌</button><div class="ddz-hand" id="ddzHand"></div></div>
      <div id="ddzCtrl"></div>
      <div class="ddz-toast" id="ddzToast"></div>`;
    mountEl.appendChild(room);

    // F2 边打边聊: 牌桌内嵌聊天坞 + 弹幕(复用 app 注入的房间发送通道/身份; 未注入则不挂)
    const dock = (opts.chat && root.EHTableChat)
      ? root.EHTableChat.mount(room, { send: opts.chat.send, me: opts.chat.me }) : null;

    const $ = sel => room.querySelector(sel);
    const els = {
      opps:$('#ddzOpps'), felt:$('#ddzFelt'), banner:$('#ddzBanner'), who:$('#ddzWho'), played:$('#ddzPlayed'),
      hand:$('#ddzHand'), me:$('#ddzMe'), ctrl:$('#ddzCtrl'), mult:$('#ddzMult'), bottom:$('#ddzBottom'), toast:$('#ddzToast'),
    };

    function toast(msg){
      els.toast.textContent = msg; els.toast.classList.add('show');
      clearTimeout(toast._t); toast._t = setTimeout(()=>els.toast.classList.remove('show'), 1100);
    }
    function say(seat, msg){
      const bubble = els.felt.querySelector(`.ddz-seat[data-seat="${seat}"] .ddz-say`)
                  || els.me.querySelector(`.ddz-seat[data-seat="${seat}"] .ddz-say`);
      if (!bubble) return;
      bubble.textContent = msg; bubble.classList.add('show');
      setTimeout(()=>bubble.classList.remove('show'), 1600);
    }

    // ── F3 牌局直播: 把高光瞬间(定地主/炸弹/报单/终局)播报给聊天室(opts.onBeat 由 app.js 注入)。
    //   AI 对手(灵魂)配即时入戏台词(quip): 走 say() 气泡 + 随 beat 进聊天流, 模板化零延迟 —— 不塞 LLM
    //   到牌局热路径(内网网关一条要 15-21s, 直播就废了)。真人自己的动作不配台词(自己知道)。
    const QUIP = {
      bomb:   ['轰！尝尝这个','这把我说了算','接不接得住','让开让开'],
      rocket: ['王炸！全场最靓','火箭起飞 🚀','这局我锁了','无解，认输吧'],
      danpai: ['就剩一张咯～','要赢啦要赢啦','你们慢慢磨','胜利在望'],
      win:    ['承让承让','这局归我','下次再战','技高一筹 😎'],
    };
    function emitBeat(b){ if (typeof opts.onBeat === 'function'){ try{ opts.onBeat(Object.assign({ game:'ddz' }, b)); }catch(_){} } }
    // 一手落定后按 seat 是否灵魂配台词: AI 走气泡+聊天, 真人不配。返回 quip(供 beat 带入聊天)
    function beatQuip(seat, kind){
      if (!(gameIsAI && gameIsAI[seat])) return null;
      const q = rand(QUIP[kind] || []); if (!q) return null;
      say(seat, q); return q;
    }

    function clearTimers(){
      if (aiTimer){ clearTimeout(aiTimer); aiTimer = null; }
      if (actionTimer){ clearTimeout(actionTimer); actionTimer = null; }
      if (ringRAF){ cancelAnimationFrame(ringRAF); ringRAF = null; }
    }
    const onResize = ()=>layoutHand();
    let _exited=false;
    function close(){ minimized=false; clearTimers(); window.removeEventListener('resize', onResize); if(dock) dock.destroy(); if(chip){ chip.remove(); chip=null; } room.remove();
      if(!_exited){ _exited=true; if(typeof opts.onExit==='function'){ try{ opts.onExit(); }catch(_){} } } }
    window.addEventListener('resize', onResize);

    // ── F1 融合: 折叠(返回聊天但牌局继续) / 展开(回到牌桌) ──
    // "返回"不再销毁牌局: 牌桌 zoom 进右下角一枚活牌桌片, 引擎/定时器后台继续跑(AI 照走),
    // 轮到自己时片子脉冲提醒且不判超时(离席看聊天不该被自动过牌); 点片子再 zoom 回全牌桌。
    let minimized = false, chip = null;
    function chipStatus(){
      if (st.phase==='over'){ const w = st.result && st.result.winners.includes(mySeat); return { t:'斗地主', s:(w?'🏁 你赢了 · 点看战报':'🏁 本局结束 · 点看战报'), cls:'over' }; }
      if (st.phase!=='play' && st.phase!=='bid')   // 联机 guest 等 host 首帧 / 重发空窗
        return { t:'斗地主', s:'⏳ 等待开局…', cls:'' };
      if (st.phase==='bid'){ const mine=st.bid.turn===mySeat;
        return { t:'斗地主 · 叫分', s: mine?'⚡ 轮到你叫分':('等 '+st.players[st.bid.turn].name+' 叫分'), cls: mine?'turn':'' }; }
      const mine = st.turn===mySeat, my=st.players[mySeat];
      return { t:'斗地主', s:(mine?'⚡ 轮到你出牌':('等 '+st.players[st.turn].name+' 出牌'))+' · 你 '+(my&&my.hand?my.hand.length:'?')+' 张', cls: mine?'turn':'' };
    }
    function updateChip(){ if(!minimized||!chip) return; const i=chipStatus();
      const mine=(st.phase==='play' && st.turn===mySeat) || (st.phase==='bid' && st.bid && st.bid.turn===mySeat);
      let cls='ddz-chip'+(i.cls?(' '+i.cls):'');
      if(mine && document.hidden) cls += ' hidden-alert';
      chip.className=cls;
      const tag = connState!=='online' ? (' ['+connLabel(connState).replace(/^[● ⟳ ⚠]+/,'').trim()+']') : '';
      chip.querySelector('.ck-t').textContent=i.t + tag;
      chip.querySelector('.ck-s').textContent=i.s;
    }
    function minimize(){
      if (minimized) return; minimized=true;
      room.classList.remove('ddz-expanding'); room.classList.add('ddz-collapsing');
      setTimeout(()=>{ if(minimized) room.style.display='none'; }, 240);
      if (!chip){
        chip=document.createElement('div'); chip.className='ddz-chip';
        chip.innerHTML=`<span class="ck-ic">🃏</span><span class="ck-tx"><b class="ck-t">斗地主</b><span class="ck-s"></span></span><span class="ck-x">↗</span>`;
        chip.addEventListener('click', restore);
        mountEl.appendChild(chip);
      } else chip.style.display='';
      renderAll();      // 以 minimized 态重排: armTurn 不再催我的回合 + 刷新片子文案
      sfx('click');
    }
    function restore(){
      if (!minimized) return; minimized=false;
      if (chip) chip.style.display='none';
      room.style.display=''; room.classList.remove('ddz-collapsing');
      void room.offsetWidth; room.classList.add('ddz-expanding');
      setTimeout(()=>room.classList.remove('ddz-expanding'), 300);
      renderAll();      // 折叠期间 AI 可能已推进, 回来刷到最新
      sfx('click');
    }
    $('#ddzX').addEventListener('click', minimize);

    // lastPlay 只存 id,需要一张 id→card 表(用整副牌重建)
    const ALL = {}; Deck.standardDeck().forEach(c=>ALL[c.id]=c);
    function findCardById(id){ return ALL[id]; }

    // ── 座位 DOM(对手区 + 我的座位标) ──
    function seatHTML(seat){
      const p = st.players[seat];
      const isLord = st.landlord === seat;
      const role = st.landlord==null ? '' : (isLord?'地主':'农民');
      return `<div class="ddz-seat${st.turn===seat&&st.phase!=='over'?' turn':''}${isLord?' landlord':''}" data-seat="${seat}" style="--p:360">
        <div class="ddz-avr"><div class="av">${avatars[seat]||'🤖'}</div></div>
        <div class="meta">
          <div class="nm">${escapeHtml(p.name)}</div>
          <div class="cnt">剩 <b>${p.hand.length}</b> 张${role?` · <span class="role">${role}</span>`:''}</div>
        </div>
        <div class="ddz-say"></div>
      </div>`;
    }
    function renderSeats(){
      els.opps.innerHTML = OPP_SEATS.map(seatHTML).join('');
      els.me.innerHTML = seatHTML(mySeat);
      // 底牌:未定地主时盖着,定了亮出来
      els.bottom.innerHTML = '';
      st.bottom.forEach(c=>{
        els.bottom.appendChild(st.phase==='bid' ? cardBack(true) : cardEl(c,{mini:true}));
      });
    }

    // ── 中央桌面:最后一手 + 落牌动画 + 轮次横幅 ──
    let lastShownKey = '';
    function playKey(){
      const lp = st.table.lastPlay;
      if (!lp) return st.table.passesInRow>0 ? ('pass:'+st.turn) : 'empty';
      return lp.seat + ':' + lp.cards.join(',');
    }
    function renderTable(){
      els.mult.textContent = `底分 ${st.base||1} · ×${st.multiplier}`;
      const lp = st.table.lastPlay;
      const key = playKey();
      const changed = key !== lastShownKey;
      lastShownKey = key;

      if (!lp){
        els.who.textContent = '';
        els.played.className = 'ddz-played';
        // 桌面已清空(开局 / 两家不要后新一轮领出): 提示这是新的一圈
        els.played.innerHTML = (st.phase==='play' && st.landlord!=null)
          ? `<div class="ddz-passtag">新一轮 · 随意出</div>` : '';
        return;
      }
      els.who.textContent = st.players[lp.seat].name + ' 出';
      els.played.className = 'ddz-played';          // 先复位
      els.played.innerHTML = '';
      lp.cards.map(findCardById).forEach(c=>els.played.appendChild(cardEl(c)));
      if (changed){
        void els.played.offsetWidth;                // 强制回流, 让下一行的动画类重新触发
        // 方向:自己出的从下方飞入, 对手从上方飞入
        els.played.classList.add(lp.seat===mySeat?'fly-bot':'fly-top');
        const nm = st.players[lp.seat].name;
        if (Rules.isBomb(lp.parse)){
          const rocket = lp.parse.type==='rocket';
          boom(rocket?'王 炸':'炸 弹');
          emitBeat({ type: rocket?'rocket':'bomb', actor:nm, big:true,
            text: `💥 ${nm} ${rocket?'放了王炸':'扔出炸弹'}！倍数 ×${st.multiplier}`,
            quip: beatQuip(lp.seat, rocket?'rocket':'bomb') });
        } else if (lp.seat!==mySeat) sfx('cardplay');   // 对手落牌拍击音(我自己出牌的音在 doPlay)
        // 报单: 这手出完只剩最后一张(solo 才有真实手牌; guest 手牌脱敏跳过)
        const rest = st.players[lp.seat].hand;
        if (Array.isArray(rest) && rest.length === 1)
          emitBeat({ type:'danpai', actor:nm, text:`⚠️ ${nm} 只剩最后一张牌！`, quip: beatQuip(lp.seat, 'danpai') });
      }
    }
    function boom(txt){
      sfx('boom'); vibrate([12,40,20]);
      els.felt.classList.remove('shake'); void els.felt.offsetWidth; els.felt.classList.add('shake');
      const fl=document.createElement('div'); fl.className='ddz-flash'; els.felt.appendChild(fl); setTimeout(()=>fl.remove(),520);
      const b = document.createElement('div'); b.className='ddz-boom'; b.textContent='💥 '+txt;
      els.felt.appendChild(b); setTimeout(()=>b.remove(), 750);
    }
    // 胜利彩带: 顶部撒 16 片 emoji, 各自随机横位/时长/旋转飘落, 2.2s 后整体自清。
    function confetti(){
      const box = document.createElement('div'); box.className='ddz-confetti';
      const EM = ['🎉','🃏','✨','🎊','⭐','💠'];
      for (let i=0;i<16;i++){
        const s = document.createElement('i');
        s.textContent = EM[Math.floor(secureRand()*EM.length)];
        s.style.left = (secureRand()*100)+'%';
        s.style.animationDuration = (1.1+secureRand()*0.7)+'s';
        s.style.animationDelay = (secureRand()*0.25)+'s';
        s.style.setProperty('--r', (360+Math.floor(secureRand()*540))+'deg');
        box.appendChild(s);
      }
      els.felt.appendChild(box);
      setTimeout(()=>box.remove(), 2200);
    }

    // ── 我的手牌 ──
    // 摆放顺序: 自动理牌走 Deck.sortHand(与引擎发牌同序); 手动理牌后按玩家排定的 id 顺序摆
    function handOrder(){
      const hand = st.players[mySeat].hand;
      if (customOrder){
        const pos = new Map(customOrder.map((id,i)=>[id,i]));
        return hand.slice().sort((a,b)=>(pos.has(a.id)?pos.get(a.id):9999)-(pos.has(b.id)?pos.get(b.id):9999));
      }
      return Deck.sortHand ? Deck.sortHand(hand) : hand;
    }
    function renderHand(){
      const myTurn = st.phase==='play' && st.turn===mySeat && !(isGuest && awaitingHost);
      els.hand.className = 'ddz-hand' + (myTurn||arrangeMode?'':' locked') + (arrangeMode?' arranging':'');
      els.hand.innerHTML = '';
      const deal = dealAnim; dealAnim = false;   // 只在发牌那一帧错峰入场, 之后普通重绘不动画
      handOrder().forEach((card, idx)=>{
        const el = cardEl(card);
        el.dataset.id = card.id;
        if (selected.has(card.id)) el.classList.add('sel');
        if (deal){ el.style.animationDelay = (idx*20)+'ms'; el.classList.add('justdealt'); }
        el.addEventListener('click', ()=>{
          if (arrangeMode) return;                          // 手动理牌模式: 点击不选牌(拖动重排)
          if (st.phase!=='play' || st.turn!==mySeat) return;
          const willSel = !selected.has(card.id);
          if (willSel) selected.add(card.id); else selected.delete(card.id);
          el.classList.toggle('sel');
          if (willSel) sfx('cardsel');   // 选牌轻触音(取消不响)
          updatePlayBtn();
        });
        els.hand.appendChild(el);
      });
      layoutHand();
    }
    // 手牌单排自适应: 牌多时(开局 17~20 张)动态收紧叠放, 永远吃满一行不换行不溢出屏幕。
    // 治斗地主原 CSS 固定 --hand-ov 叠放, 17 张在 390px 上两侧溢出、首尾牌跑到屏外点不到。
    function layoutHand(){
      const cards = els.hand.children;
      const n = cards.length; if (!n) return;
      const W = els.hand.clientWidth; if (!W) return;
      const cw = cards[0].offsetWidth || parseFloat(getComputedStyle(room).getPropertyValue('--cw')) || 44;
      let step = n>1 ? (W - cw) / (n - 1) : 0;
      step = Math.min(step, cw * 0.62);          // 上限: 牌少时不过度分散, 保留自然扇形
      const ov = Math.round(step - cw);          // 负外边距(叠放量)
      for (let i=0;i<n;i++){ cards[i].style.marginLeft = i===0 ? '0px' : ov+'px'; }
    }

    // ── 理牌: 一键自动(短按) / 手动拖排(长按切模式), 共用 #ddzSort 一个按钮 ──
    // customOrder=null 时 renderHand 走 Deck.sortHand 自动理牌; 非空则按玩家排定的 id 顺序摆。
    // 斗地主原本是点击选牌(非划选), 手动理牌模式下点击不选牌、改为拖动重排。
    let customOrder = null, arrangeMode = false;
    let dragCard = null, dragId = null, dragStartX = 0;
    function handCardAt(x,y){ const el=document.elementFromPoint(x,y); if(!el) return null; const c=el.closest('.card'); return (c && els.hand.contains(c)) ? c : null; }
    function setArrange(on){
      arrangeMode = on;
      const btn = $('#ddzSort'); if(btn){ btn.classList.toggle('active', on); btn.innerHTML = on ? '✓ 完成' : '🔀 理牌'; }
      els.hand.classList.toggle('arranging', on);
      if(on){ vibrate(15); selected.clear(); renderHand(); updatePlayBtn(); toast('拖动手牌自由排序，松手即定'); }
      else renderHand();
    }
    function autoSort(){ customOrder = null; renderHand(); sfx('cardsel'); toast('已按大小理牌'); }
    function startReorder(e){
      const c = handCardAt(e.clientX,e.clientY); if(!c) return;
      dragCard = c; dragId = c.dataset.id; dragStartX = e.clientX;
      c.classList.add('dragging');
      try{ els.hand.setPointerCapture(e.pointerId); }catch(_){}
      e.preventDefault();
    }
    function moveReorder(e){
      if(!dragCard) return;
      const dx = e.clientX - dragStartX;
      dragCard.style.transform = `translateY(-18px) translateX(${dx}px) scale(1.06)`;
      e.preventDefault();
    }
    function endReorder(e){
      if(!dragCard) return;
      const dropX = e.clientX;
      const others = [...els.hand.children].filter(c=>c!==dragCard);
      let insert = others.length;
      for(let i=0;i<others.length;i++){ const r=others[i].getBoundingClientRect(); if(dropX < r.left + r.width/2){ insert=i; break; } }
      const order = others.map(c=>c.dataset.id); order.splice(insert, 0, dragId);
      customOrder = order;
      dragCard.classList.remove('dragging'); dragCard.style.transform=''; dragCard.style.zIndex='';
      dragCard = null; dragId = null;
      sfx('cardsel'); renderHand();
    }
    els.hand.addEventListener('pointerdown', (e)=>{ if(arrangeMode) startReorder(e); });
    els.hand.addEventListener('pointermove', (e)=>{ if(dragCard) moveReorder(e); });
    els.hand.addEventListener('pointerup', (e)=>{ if(dragCard) endReorder(e); });
    els.hand.addEventListener('pointercancel', (e)=>{ if(dragCard) endReorder(e); });
    // 短按=一键理牌(或手动模式下=完成退出); 长按≥350ms=切手动理牌模式
    (function bindSort(){
      const btn=$('#ddzSort'); if(!btn) return;
      let pressTimer=null, longFired=false;
      btn.addEventListener('pointerdown', ()=>{ longFired=false; pressTimer=setTimeout(()=>{ longFired=true; setArrange(!arrangeMode); }, 350); });
      const cancel=()=>{ if(pressTimer){ clearTimeout(pressTimer); pressTimer=null; } };
      btn.addEventListener('pointerup', ()=>{ cancel(); if(longFired) return; if(arrangeMode){ setArrange(false); } else autoSort(); });
      btn.addEventListener('pointerleave', cancel);
      btn.addEventListener('pointercancel', cancel);
    })();

    // ── 轮次横幅 + 倒计时环 ──
    function setBanner(){
      const b = els.banner; const cp = connPill();
      if (st.phase==='over'){ b.className='ddz-turnbanner'; b.innerHTML=cp; return; }
      if (st.phase!=='bid' && st.phase!=='play'){ b.className='ddz-turnbanner'; b.innerHTML=cp+'⏳ 等待开局…'; return; }
      if (isGuest && awaitingHost){ b.className='ddz-turnbanner'; b.innerHTML=cp+'⏳ 已提交 · 等待裁决…'; return; }
      const seat = st.phase==='bid' ? st.bid.turn : st.turn;
      const mine = seat===mySeat;
      const verb = st.phase==='bid' ? '叫分' : '出牌';
      if (mine){
        b.className = 'ddz-turnbanner mine';
        b.innerHTML = cp + `🫵 轮到你${verb} <span class="clk" id="ddzClk"></span>`;
      } else {
        b.className = 'ddz-turnbanner';
        b.innerHTML = cp + `${escapeHtml(st.players[seat].name)} ${st.phase==='bid'?'思考叫分':'思考出牌'}中… <span class="clk" id="ddzClk"></span>`;
      }
    }
    // 倒计时环:驱动当前活动座位的 conic 环 + 横幅秒数; 到点跑 onExpire(仅人类)
    function armTurn(onExpire){
      clearTimers();
      if (st.phase!=='bid' && st.phase!=='play') return;   // over/wait: 不武装倒计时
      const seat = st.phase==='bid' ? st.bid.turn : st.turn;
      if (seat==null || seat<0) return;
      turnSeatActive = seat;
      const mine = seat===mySeat;
      if (isGuest && awaitingHost) return;   // guest 回传后等 host 裁决, 不跑倒计时
      if (mine && !lastMyTurn){ sfx('yourturn'); vibrate(18); }   // 刚轮到我: 提示音+震动(上升沿, 不每帧响)
      lastMyTurn = mine;
      // host 视角: 远程真人席给足宽限(REMOTE_TIMEOUT_MS), 到点由 onRemoteTimeout→aiStep 托管(与本人超时兜底同源)
      const remote = !isGuest && isRemote(seat);
      turnDur = mine ? (st.phase==='bid'?HUMAN_BID_MS:HUMAN_PLAY_MS)
              : remote ? REMOTE_TIMEOUT_MS
              : (AI_MIN_MS + Math.floor(secureRand()*AI_JIT_MS));
      turnStart = Date.now();

      const seatEl = seatOf(seat);
      const clk = room.querySelector('#ddzClk');
      const tick = ()=>{
        const elapsed = Date.now() - turnStart;
        const remain = Math.max(0, turnDur - elapsed);
        const frac = turnDur ? (remain/turnDur) : 0;
        if (seatEl) seatEl.style.setProperty('--p', (frac*360).toFixed(1));
        if (mine && clk){
          const sec = Math.ceil(remain/1000);
          clk.textContent = sec+'s';
          clk.classList.toggle('urgent', sec<=5);
        }
        if (remain<=0){
          ringRAF = null;
          if (mine && typeof onExpire==='function') onExpire();
          return;
        }
        ringRAF = requestAnimationFrame(tick);
      };
      tick();

      // 定时驱动: 我(靠 onExpire)/guest(全等 host 快照, 不驱动任何席)/host 远程真人席(超时托管)/host 本机 AI 席。
      if (mine) return;
      if (isGuest) return;                                    // guest 只渲染, host 是唯一裁判
      if (remote) aiTimer = setTimeout(()=>onRemoteTimeout(seat), turnDur);
      else aiTimer = setTimeout(()=>aiStep(seat), turnDur);
    }
    // host: 远程真人超时未回传 → host 托管代打(与 aiStep 同源, 叫分/出牌都能兜)
    function onRemoteTimeout(seat){
      const active = st.phase==='bid' ? (st.bid && st.bid.turn) : st.turn;
      if ((st.phase!=='bid' && st.phase!=='play') || active!==seat) return;
      toast('远客超时 · 暂由房主托管');
      aiStep(seat);
    }
    function seatOf(seat){
      return els.opps.querySelector(`.ddz-seat[data-seat="${seat}"]`)
          || els.me.querySelector(`.ddz-seat[data-seat="${seat}"]`);
    }

    // ── 控制区:叫地主 / 出牌 ──
    function renderCtrl(){
      if (st.phase === 'bid'){
        if (isGuest && awaitingHost){ els.ctrl.innerHTML = `<div class="ddz-bidbar"><div class="q">⏳ 已叫分 · 等待裁决…</div></div>`; return; }
        if (st.bid.turn === mySeat) renderBidBar();
        else els.ctrl.innerHTML = `<div class="ddz-bidbar"><div class="q">等待 ${escapeHtml(st.players[st.bid.turn].name)} 叫分…</div></div>`;
      } else if (st.phase === 'play'){
        if (isGuest && awaitingHost){ els.ctrl.innerHTML = `<div class="ddz-acts"><button class="ddz-btn ghost" disabled>⏳ 等待裁决…</button></div>`; return; }
        renderActBar();
      } else {
        els.ctrl.innerHTML = '';
      }
    }
    function renderBidBar(){
      const max = st.bid.max;
      const opts2 = [0,1,2,3].map(v=>{
        const label = v===0?'不叫':(v+'分');
        const dis = (v!==0 && v<=max) ? 'disabled':'';
        return `<button class="ddz-btn ${v===3?'primary':''}" data-bid="${v}" ${dis}>${label}</button>`;
      }).join('');
      els.ctrl.innerHTML = `<div class="ddz-bidbar"><div class="q">${max>0?('当前最高 '+max+' 分，'):''}要不要抢地主？</div><div class="ddz-bidbtns">${opts2}</div></div>`;
      els.ctrl.querySelectorAll('[data-bid]').forEach(b=>{
        b.addEventListener('click', ()=>doCall(mySeat, +b.dataset.bid));
      });
    }
    function renderActBar(){
      const myTurn = st.turn === mySeat;
      const mustBeat = st.table.lastPlay && st.table.lastPlay.seat !== mySeat;
      // 智能预判: 轮到我时先算可出的牌(best-first)。压不过=引导不出; 唯一打法=自动选好。
      let plays = [];
      if (myTurn){
        const target = mustBeat ? st.table.lastPlay.parse : null;
        plays = AI.hints(st.players[mySeat].hand, target);
      }
      const noBeat = myTurn && mustBeat && plays.length===0;
      els.ctrl.innerHTML = `<div class="ddz-acts">
        <button class="ddz-btn ${noBeat?'primary':'ghost'}" id="ddzPass" ${!myTurn||!mustBeat?'disabled':''}>${noBeat?'压不过 · 不出':'不出'}</button>
        <button class="ddz-btn ghost" id="ddzHint" ${!myTurn||plays.length<=1?'disabled':''}>提示</button>
        <button class="ddz-btn primary" id="ddzPlay" disabled>出牌</button>
      </div>`;
      $('#ddzPass').addEventListener('click', ()=>doPass(mySeat));
      $('#ddzPlay').addEventListener('click', doPlay);
      $('#ddzHint').addEventListener('click', doHint);
      if (myTurn && plays.length===1 && selected.size===0){
        selected = new Set(plays[0].map(c=>c.id)); renderHand();
      }
      updatePlayBtn();
    }
    function updatePlayBtn(){
      const btn = $('#ddzPlay'); if (!btn) return;
      const cards = [...selected].map(findCardById);
      const p = cards.length ? Rules.parse(cards) : null;
      let okBtn = !!p && st.turn===mySeat;
      if (okBtn && st.table.lastPlay && st.table.lastPlay.seat!==mySeat)
        okBtn = Rules.beats(p, st.table.lastPlay.parse);
      btn.disabled = !okBtn;
    }

    // ── 动作 ──
    function doCall(seat, val){
      if (isGuest){   // guest 只能替自己叫分, 回传给 host 裁决
        if (seat!==mySeat || awaitingHost) return;
        if (onAction) onAction({ action:'call', val });
        say(seat, val>0?val+'分！':'不叫'); awaitingHost=true;
        setBanner(); renderCtrl(); toast('已叫分…'); return;
      }
      try { var r = Engine.applyCall(st, seat, val); }
      catch(e){ toast('不能这样叫'); return; }
      if (val>0) say(seat, val+'分！'); else say(seat,'不叫');
      if (r && r.redeal){ toast('都不叫，重新发牌'); st = Engine.createGame({isAI:gameIsAI,names}); dealNo++; selected.clear(); customOrder=null; if(arrangeMode) setArrange(false); dealAnim=true; lastLord=null; lastMyTurn=false; sfx('deal'); renderAll(); return; }
      renderAll();
    }
    function doPlay(){
      const cards = [...selected].map(findCardById).filter(Boolean);
      if (isGuest){   // guest: 本地已用 updatePlayBtn 校验合法, 只回传动作(id 数组), 由 host 引擎权威裁决 + 广播新快照
        if (!cards.length || awaitingHost) return;
        if (onAction) onAction({ action:'play', cards: cards.map(c=>c.id) });
        sfx('cardplay'); selected.clear(); hintCycle=[]; awaitingHost=true;
        setBanner(); renderCtrl(); renderHand(); return;
      }
      try { var r = Engine.applyPlay(st, mySeat, cards); }
      catch(e){ toast(playErr(e.message)); return; }
      if (!Rules.isBomb(r && r.played)) sfx('cardplay');   // 出牌拍击音(炸弹交给 boom, 不叠)
      selected.clear(); hintCycle=[];
      renderAll();
      if (r && r.over){ showOver(); return; }
    }
    function doPass(seat){
      if (isGuest){   // guest 只能替自己不出, 回传给 host
        if (seat!==mySeat || awaitingHost) return;
        if (onAction) onAction({ action:'pass' });
        sfx('pass'); say(seat,'不出'); awaitingHost=true;
        setBanner(); renderCtrl(); renderHand(); return;
      }
      try { Engine.applyPass(st, seat); } catch(e){ toast('现在不能不出'); return; }
      if (seat===mySeat) sfx('pass');
      say(seat,'不出');
      renderAll();
    }
    function doHint(){
      const hand = st.players[mySeat].hand;
      const target = (st.table.lastPlay && st.table.lastPlay.seat!==mySeat) ? st.table.lastPlay.parse : null;
      // 循环提示:多套可出方案轮着给, 再点一次换一套。best-first: 能一把走完排最前,
      // 领出走长牌型垫单张, 跟牌走最小代价、炸弹垫底(剩一对提示打整对而非拆单张)。
      if (!hintCycle.length){
        hintCycle = AI.hints(hand, target);
        hintIdx = 0;
      }
      if (!hintCycle.length){ toast('没有能压的牌，只能不出'); return; }
      const pick = hintCycle[hintIdx % hintCycle.length]; hintIdx++;
      selected = new Set(pick.map(c=>c.id));
      renderHand(); updatePlayBtn();
    }

    // ── AI 回合 ──
    function aiStep(seat){
      if (st.phase === 'bid'){
        if (st.bid.turn !== seat) return;
        doCall(seat, AI.chooseBid(st.players[seat].hand, st.bid.max));
        return;
      }
      if (st.phase !== 'play' || st.turn !== seat) return;
      const target = (st.table.lastPlay && st.table.lastPlay.seat!==seat) ? st.table.lastPlay.parse : null;
      const mv = AI.decide({ seat, hand: st.players[seat].hand, tableParse: target,
        lastSeat: st.table.lastPlay ? st.table.lastPlay.seat : null,
        handsLeft: st.players.map(p=>p.hand.length), landlord: st.landlord, iAmLandlord: seat===st.landlord });
      if (mv.action === 'pass'){ doPass(seat); return; }
      try { var r = Engine.applyPlay(st, seat, mv.cards); }
      catch(e){ doPass(seat); return; }   // AI 兜底:决策失误就过
      maybeBanter(seat);
      renderAll();
      if (r && r.over){ showOver(); return; }
    }
    function maybeBanter(seat){
      const n = st.players[seat].hand.length;
      if (n === 1) say(seat, '只剩一张咯～');
      else if (n === 2) say(seat, '快没牌了！');
      else if (secureRand()<0.15) say(seat, rand(['接招','看我的','这手不错']));
    }

    // ── 人类超时兜底(与断线托管同一逻辑) ──
    function onHumanTimeout(){
      if (st.phase==='bid' && st.bid.turn===mySeat){ toast('超时 · 自动不叫'); doCall(mySeat, 0); return; }
      if (st.phase==='play' && st.turn===mySeat){
        const mustBeat = st.table.lastPlay && st.table.lastPlay.seat!==mySeat;
        if (mustBeat){ toast('超时 · 自动不出'); doPass(mySeat); return; }
        // 领出必须出牌:托管出最小合法牌(用 AI 决策)
        const mv = AI.decide({ seat:mySeat, hand:st.players[mySeat].hand, tableParse:null,
          handsLeft: st.players.map(p=>p.hand.length), landlord: st.landlord, iAmLandlord: mySeat===st.landlord });
        if (mv.action==='play'){ toast('超时 · 自动出牌'); selected=new Set(mv.cards.map(c=>c.id)); doPlay(); }
      }
    }

    // ── 结算浮层 ──
    function showOver(){
      if (showOver._done) return; showOver._done = true;   // 幂等: guest 会连收多张 over 快照, 只弹一次
      clearTimers();
      const res = st.result;
      if (!res) { showOver._done = false; return; }
      const iWon = res.winners.includes(mySeat);
      const over = document.createElement('div');
      over.className = 'ddz-over ' + (iWon?'win':'lose');
      const roleTxt = st.landlord===mySeat ? '地主' : '农民';
      over.innerHTML = `
        <h2>${iWon?'🎉 胜利':'😵 失败'}</h2>
        <div class="sub">你是${roleTxt} · ${res.landlordWon?'地主赢':'农民赢'}${res.spring?' · 春天翻倍':''}<br>底分 ${res.base} × 倍数 ${res.finalMultiplier}${res.bombs?(' · '+res.bombs+' 炸'):''}</div>
        <div class="score">${(res.delta[mySeat]>=0?'+':'')}${res.delta[mySeat]} 分</div>
        <div class="ddz-acts" style="margin-top:6px">
          <button class="ddz-btn" id="ddzAgain">再来一局</button>
          <button class="ddz-btn primary" id="ddzDone">收工</button>
        </div>`;
      els.felt.appendChild(over);
      if (iWon){ sfx('sparkle'); setTimeout(()=>sfx(res.spring?'spring':'bloom'), 220); vibrate([20,60,30,60,40]); confetti(); }
      else { sfx('void'); vibrate(120); }
      // guest 无权开新一局: 由 host 驱动, 下一副快照到达时 applySnapshot 自动清掉本战报; 只留"收工"
      const againBtn = over.querySelector('#ddzAgain');
      if (isGuest){ againBtn.textContent='等房主开局…'; againBtn.disabled=true; }
      else againBtn.addEventListener('click', ()=>{
        showOver._done=false;
        over.remove(); st = Engine.createGame({isAI:gameIsAI,names}); dealNo++; selected.clear(); customOrder=null; if(arrangeMode) setArrange(false); hintCycle=[]; lastShownKey=''; dealAnim=true; lastLord=null; lastMyTurn=false; sfx('deal'); broadcast(); renderAll();
      });
      over.querySelector('#ddzDone').addEventListener('click', close);
      if (typeof opts.onResult === 'function'){
        try { opts.onResult(res, st.log, { mySeat, roleTxt }); } catch(_){}
      }
      // F3 终局战报进聊天流(春天/炸弹倍数一并播报); 赢家若是灵魂配一句收官台词
      const winNm = st.players[res.winners[0]] ? st.players[res.winners[0]].name : (res.landlordWon?'地主':'农民');
      emitBeat({ type:'over', actor:winNm, big:true,
        text:`🏁 ${res.landlordWon?'地主':'农民'}方胜 · 底分 ${res.base} × ${res.finalMultiplier}${res.spring?' · 春天翻倍':''}${res.bombs?` · ${res.bombs} 炸`:''}`,
        quip: beatQuip(res.winners[0], 'win') });
      if (minimized) updateChip();   // 折叠中终局: 片子翻到"点看战报"态并高亮
    }

    // 每次状态推进后统一重绘 + 重新武装当前回合(倒计时/AI 行动)
    function renderAll(){
      if (lastLord===null && st.landlord!=null){
        sfx('landlord');   // 地主刚揭晓: 号角定音
        const nm = st.players[st.landlord].name;
        emitBeat({ type:'landlord', actor:nm, big:true, text:`🎪 ${nm} 抢到地主 · ${st.multiplier} 倍起` });
      }
      lastLord = st.landlord;
      renderSeats(); renderTable(); renderHand(); setBanner(); renderCtrl();
      // guest 无本地引擎(host 托管超时); 折叠期间也不催我的回合(离席看聊天不该被自动过牌)
      armTurn((isGuest || minimized) ? null : onHumanTimeout);
      broadcast();                                // host: 推送每席脱敏快照
      if (minimized) updateChip();                // 折叠时把最新态同步到右下角活牌桌片
    }

    // ── guest: 收到 host 广播的公共脱敏快照 → 组伪状态渲染。换副/重发时重置手牌与动画; 终局弹战报。 ──
    function applySnapshot(snap){
      if (!snap || !GNet) return;
      const prevPhase = st ? st.phase : null;
      const isNewDeal = (typeof snap.dealNo==='number' && snap.dealNo!==dealNo) || ((prevPhase==='over'||prevPhase==='wait') && (snap.phase==='play'||snap.phase==='bid'));
      if (isNewDeal){
        dealAnim=true; selected.clear(); hintCycle=[]; customOrder=null;
        lastShownKey=''; lastMyTurn=false; lastLord=null; showOver._done=false;
        if (arrangeMode) setArrange(false);
        const ov=els.felt.querySelector('.ddz-over'); if(ov) ov.remove();
      }
      awaitingHost=false;                 // 快照到达即解锁(host 已裁决)
      dealNo = (typeof snap.dealNo==='number') ? snap.dealNo : dealNo;
      lastSnap = snap;
      st = GNet.pseudoState(snap, mySeat, myHand);
      renderAll();
      if (st.phase==='over' && st.result && prevPhase!=='over') showOver();
      if (minimized) updateChip();
    }
    // ── guest: 收到自己那副手牌(来自 eh_gt_hands, RLS 只放行本人)。可传 id 数组或牌对象数组。地主领底后 host 会重写本行。 ──
    function feedHand(cards){
      myHand = (cards||[]).map(c=> (c && c.id) ? c : findCardById(c)).filter(Boolean);
      if (st && st.players[mySeat]) st.players[mySeat].hand = myHand.map(c=>GNet?GNet.cardPlain(c):c);
      renderHand(); renderCtrl(); if(minimized) updateChip();
    }

    // 开局
    renderAll();
    if (!isGuest) broadcast();   // host: 开局首帧即广播脱敏快照(顺带写各远程席初始手牌)
    return { close, minimize, restore, isMinimized:()=>minimized, state:()=>st, mySeat:()=>mySeat,
      applyMove, setConn, connState:()=>connState,
      onSnapshot: applySnapshot, feedHand, resync: broadcast, isGuest:()=>isGuest,
      onRoomMsg:m=>{ if(dock) dock.onRoomMsg(m); } };
  }

  // ── 小工具 ──
  function rand(a){ return a[Math.floor(secureRand()*a.length)]; }
  function secureRand(){ try{ const x=new Uint32Array(1); crypto.getRandomValues(x); return x[0]/4294967296; }catch(_){ return Math.random(); } }
  function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function playErr(code){
    return ({ cannot_beat:'压不过上家', illegal_type:'不是合法牌型', not_your_turn:'还没轮到你',
      not_in_hand:'牌不在手上', empty_play:'先选牌' })[code] || '出牌无效';
  }

  root.EHDdzGame = { open };
})(window);
