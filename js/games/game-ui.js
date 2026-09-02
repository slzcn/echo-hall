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
/* 横屏(手机侧持/⟳ 旋转态, 由 JS 挂 .is-land): 又宽又矮, 收紧上下留白, 出牌区不再撑空, 消除"叫分条贴手牌"的挤压 */
.ddz-room.is-land{--av:38px;--avf:17px;--seatw:130px;--banner:12px;--hand-pad:8px;--cw:40px;--ch:56px;--cn:14px;--cs:11px;--cc:22px;--cmw:26px;--cmh:37px}
.ddz-room.is-land .ddz-bar{padding-top:calc(4px + env(safe-area-inset-top,0px));padding-bottom:4px}
.ddz-room.is-land .ddz-opps{padding:4px 12px 0}
.ddz-room.is-land .ddz-center{min-height:0;gap:4px}
.ddz-room.is-land .ddz-played{min-height:50px}
.ddz-room.is-land .ddz-me{padding:0 14px}
.ddz-room.is-land .ddz-hand{min-height:74px}
.ddz-room.is-land .ddz-hand-wrap{padding-bottom:2px}
.ddz-room.is-land .ddz-acts{padding-top:5px;padding-bottom:calc(5px + env(safe-area-inset-bottom,0px))}
/* ── 竖屏(手机, <600px)专属美化: 只动竖屏, 横屏(.is-land)与各大屏断点不受影响(用 :not(.is-land) + 窄屏 query 双重隔离) ── */
@media (max-width:599px){
  /* 中央区收紧: 绒面椭圆缩成贴合牌堆的"落牌盘"(insets 拉大→椭圆变小)+ 微增辉光, 不再是撑满半屏的空圈; 上下留白削薄 */
  .ddz-room:not(.is-land) .ddz-center{min-height:96px;padding:2px 16px;gap:5px}
  /* 手机竖屏上面用了 padding 简写会把顶部空档吃回 2px, 这里高特异性补回底牌空档(仅有底牌态) */
  .ddz-room:not(.is-land) .ddz-center.has-bottom{padding-top:56px}
  .ddz-room:not(.is-land) .ddz-center::before{left:13%;right:13%;top:15%;bottom:15%;
    background:radial-gradient(ellipse at center,rgba(0,229,212,.12),rgba(0,120,104,.06) 52%,transparent 74%);
    border-color:rgba(0,229,212,.12);box-shadow:inset 0 0 42px rgba(0,0,0,.32)}
  .ddz-room:not(.is-land) .ddz-opps{padding:10px 12px 0}
  /* 回合提示分层清晰、占位稳定不跳动: 轮次横幅醒目, 上一手信息压一档但恒留位 */
  .ddz-room:not(.is-land) .ddz-turnbanner{min-height:22px}
  .ddz-room:not(.is-land) .ddz-lastwho{min-height:16px;opacity:.92}
  /* 操作区: 按钮等宽整齐, 底部留足 safe-area */
  .ddz-room:not(.is-land) .ddz-acts{gap:12px;padding:10px 18px calc(14px + env(safe-area-inset-bottom,0px))}
  .ddz-room:not(.is-land) .ddz-acts .ddz-btn{flex:1 1 0;max-width:150px}
}
@keyframes ddzRoomIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.ddz-bar{display:flex;align-items:center;gap:10px;flex-shrink:0;border-bottom:1px solid var(--line,rgba(0,229,212,.24));
  padding:calc(12px + env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) 12px max(16px,env(safe-area-inset-left,0px))}
.ddz-title{font-weight:800;letter-spacing:.06em;color:var(--ink,#eaf6ff);font-size:15px;display:flex;align-items:center;gap:8px}
.ddz-title .dot{width:8px;height:8px;border-radius:50%;background:var(--accent,#00e5d4);box-shadow:var(--glow-cyan)}
.ddz-mult{font-size:12px;color:var(--amber,#ffc24d);font-weight:700;padding:2px 8px;border:1px solid var(--line);border-radius:999px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis;flex-shrink:1}
.ddz-mus{margin-left:auto;width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:transparent;
  color:var(--sub,#86cbc6);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ddz-mus:hover{color:var(--ink);border-color:var(--line2)}
.ddz-mus.muted{color:var(--dim,#498d88);opacity:.75}
.ddz-x{height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:transparent;
  color:var(--sub,#86cbc6);font-size:13px;cursor:pointer;display:flex;align-items:center;gap:5px;flex-shrink:0}
.ddz-x:hover{color:var(--ink);border-color:var(--line2)}
/* 窄屏(手机 <380px)顶栏防溢出: 收紧间距/边距 + 「✕ 返回」收成纯图标, 给倍数 chip 让位, 杜绝返回钮被挤出屏 */
@media (max-width:379px){
  .ddz-bar{gap:6px;padding-left:max(10px,env(safe-area-inset-left,0px));padding-right:max(10px,env(safe-area-inset-right,0px))}
  .ddz-title{font-size:14px}
  .ddz-mult{font-size:11px}
  .ddz-x{padding:0 9px}
  .ddz-x .ddz-xlbl{display:none}
}
/* 牌桌绒面 */
.ddz-felt{flex:1;position:relative;display:flex;flex-direction:column;min-height:0}
.ddz-felt.shake{animation:ddzShake .42s cubic-bezier(.36,.07,.19,.97)}
@keyframes ddzShake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(2px)}30%,50%,70%{transform:translateX(-4px)}40%,60%{transform:translateX(4px)}}
.ddz-opps{display:flex;justify-content:space-around;padding:12px 12px 2px;max-width:var(--oppmax,none);margin:0 auto;width:100%;box-sizing:border-box}
/* 座位(对手 + 自己) 公共外观 */
.ddz-seat{display:flex;flex-direction:column;align-items:center;gap:3px;width:var(--seatw,104px);position:relative}
.ddz-avr{width:var(--av,52px);height:var(--av,52px);border-radius:50%;display:grid;place-items:center;padding:3px;box-sizing:border-box;
  background:transparent;transition:background .15s;position:relative}
.ddz-seat.turn .ddz-avr{background:conic-gradient(from -90deg,var(--accent,#00e5d4) calc(var(--p,360)*1deg),var(--line,rgba(0,229,212,.18)) 0)}
.ddz-avr .av{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:var(--avf,23px);background:var(--panel-solid,#132a29);border:1.5px solid var(--line2);position:relative}
.ddz-seat.turn .ddz-avr .av{box-shadow:0 0 14px var(--accent,rgba(0,229,212,.6))}
/* 回合秒数徽标: 只在当前行动席(含对手)头像右下角亮, 让"轮到谁、还剩几秒"看得见 */
.ddz-sec{position:absolute;right:-4px;bottom:-4px;min-width:17px;height:17px;padding:0 3px;box-sizing:border-box;
  border-radius:9px;background:var(--panel-solid,#132a29);border:1px solid var(--amber,#ffc24d);
  color:var(--amber,#ffc24d);font-size:10px;font-weight:800;line-height:15px;text-align:center;
  font-variant-numeric:tabular-nums;display:none;z-index:3}
.ddz-seat.turn .ddz-sec{display:block}
.ddz-sec.urgent{border-color:var(--magenta,#ff2d8e);color:var(--magenta,#ff2d8e);animation:ddzBlink .6s steps(2,start) infinite}
.ddz-seat.win .ddz-avr .av{border-color:var(--amber,#ffc24d);box-shadow:0 0 16px var(--amber,rgba(255,194,77,.7))}
.ddz-seat.win .nm{color:var(--amber,#ffc24d);font-weight:700}
.ddz-seat.landlord .ddz-avr .av::after{content:'👑';position:absolute;top:-13px;left:50%;transform:translateX(-50%);font-size:15px}
.ddz-seat .nm{font-size:11px;color:var(--sub);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddz-seat.turn .nm{color:var(--accent);font-weight:700}
.ddz-seat .cnt{font-size:11px;color:var(--dim,#498d88);font-variant-numeric:tabular-nums}
.ddz-seat .cnt b{color:var(--ink)}
.ddz-seat .role{font-size:9px;letter-spacing:.08em;padding:0 5px;border-radius:6px;border:1px solid var(--line);color:var(--dim)}
.ddz-seat.landlord .role{color:var(--amber);border-color:var(--amber)}
/* 本桌累计比分徽标(常驻座位): 正分暖色亮起, 负分品红压暗, 0 分中性 —— 与结算面板 .ddz-cumbox 同一套语言 */
.ddz-cum{margin-top:2px;font-size:10px;font-weight:800;line-height:15px;padding:0 6px;border-radius:8px;
  font-variant-numeric:tabular-nums;border:1px solid var(--line);display:inline-block}
.ddz-cum.pos{color:var(--amber,#ffc24d);border-color:rgba(255,194,77,.4);background:rgba(255,194,77,.1)}
.ddz-cum.neg{color:var(--magenta,#ff2d8e);border-color:rgba(255,45,142,.35);background:rgba(255,45,142,.08)}
.ddz-cum.zero{color:var(--dim,#498d88);border-color:var(--line)}
.ddz-me .ddz-cum{margin-top:0}
.ddz-say{position:absolute;top:56px;font-size:11px;color:var(--ink);background:var(--panel-solid,#132a29);
  border:1px solid var(--line);border-radius:10px;padding:3px 8px;max-width:130px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:4}
.ddz-say.show{opacity:1}
/* 叫/抢地主印章(对标腾讯: 头像上啪一枚醒目图章, 比气泡更有仪式感) */
.ddz-stamp{position:absolute;top:30px;left:50%;font-size:14px;font-weight:900;letter-spacing:.06em;
  padding:5px 12px;border-radius:11px;white-space:nowrap;z-index:7;pointer-events:none;opacity:0;
  transform:translateX(-50%) scale(.2) rotate(-14deg);box-shadow:0 4px 14px rgba(0,0,0,.42)}
.ddz-stamp.show{animation:ddzStamp 1.3s cubic-bezier(.2,1.4,.35,1) forwards}
.ddz-stamp.call{background:linear-gradient(150deg,#ffb347,#ff8a3d);color:#3a1e00;border:1.5px solid #ffd18a}
.ddz-stamp.rob{background:linear-gradient(150deg,#ff4d6d,#e0263e);color:#fff;border:1.5px solid #ff96a8}
.ddz-stamp.pass{background:var(--panel-solid,#132a29);color:var(--dim,#7fb0ab);border:1.5px solid var(--line)}
@keyframes ddzStamp{0%{transform:translateX(-50%) scale(.2) rotate(-14deg);opacity:0}
  18%{transform:translateX(-50%) scale(1.2) rotate(-8deg);opacity:1}
  30%{transform:translateX(-50%) scale(1) rotate(-8deg)}
  80%{transform:translateX(-50%) scale(1) rotate(-8deg);opacity:1}
  100%{transform:translateX(-50%) scale(.92) rotate(-8deg);opacity:0}}
/* 定地主一刻: 皇冠砸落 + 底牌翻面亮出(对标腾讯揭晓桥段) */
.ddz-seat.just-crowned .ddz-avr .av::after{animation:ddzCrownDrop .62s cubic-bezier(.3,1.5,.4,1) both}
@keyframes ddzCrownDrop{0%{transform:translateX(-50%) translateY(-26px) rotate(-30deg) scale(.4);opacity:0}
  55%{transform:translateX(-50%) translateY(2px) rotate(8deg) scale(1.25);opacity:1}
  100%{transform:translateX(-50%) translateY(0) rotate(0) scale(1);opacity:1}}
.ddz-bottom-cards.reveal .bc-row .card{animation:ddzBcFlip .5s ease-out both}
.ddz-bottom-cards.reveal .bc-row .card:nth-child(2){animation-delay:.1s}
.ddz-bottom-cards.reveal .bc-row .card:nth-child(3){animation-delay:.2s}
@keyframes ddzBcFlip{0%{transform:rotateY(90deg) scale(.9);opacity:.2}100%{transform:rotateY(0) scale(1);opacity:1}}
/* 中央出牌区 */
.ddz-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:4px 16px;min-height:120px;position:relative;isolation:isolate}
/* 底牌钉在中央区顶部(absolute), 脱离文档流 → 定地主后给中央区留出顶部空档, 让居中的横幅/落牌坐在底牌下面而非叠上去。
   safe center: 空间够时纵向居中(高屏好看), 空间不够时退成 flex-start(不再向上溢出压到底牌)。仅"有底牌"态启用, 招募/无底牌态不占空档。 */
.ddz-center.has-bottom{padding-top:58px;justify-content:safe center}
/* 中央绒面椭圆(对标掼蛋/德州: 三家统一有张"桌面"落牌, 不再是空黑 void)。
   落牌/横幅/passtag 都坐在这张绒面上; 椭圆自身发微光 + 内阴影拉出纵深, z-index:-1 沉底不吃点击。 */
.ddz-center::before{content:'';position:absolute;left:7%;right:7%;top:9%;bottom:9%;border-radius:50%/44%;
  background:radial-gradient(ellipse at center,rgba(0,229,212,.09),rgba(0,120,104,.05) 52%,transparent 72%);
  border:1px solid rgba(0,229,212,.08);box-shadow:inset 0 0 55px rgba(0,0,0,.34);z-index:-1;pointer-events:none}
.ddz-turnbanner{font-size:var(--banner,13px);letter-spacing:.05em;color:var(--sub);min-height:18px;display:flex;align-items:center;gap:6px;transition:.15s}
.ddz-turnbanner.mine{color:var(--ink);font-weight:800;font-size:15px;text-shadow:0 0 8px rgba(0,229,212,.75);border-radius:999px;background:linear-gradient(90deg,rgba(0,229,212,.26),rgba(0,229,212,.05));animation:ddzTurnPulse 1.05s ease-in-out infinite}
.ddz-turnbanner .clk{font-variant-numeric:tabular-nums;color:var(--amber);font-weight:800}
.ddz-turnbanner .clk.urgent{color:var(--magenta,#ff2d8e);animation:ddzBlink .6s steps(2,start) infinite}
@keyframes ddzBlink{50%{opacity:.35}}
/* 轮到自己出牌: 横幅化作发光脉冲胶囊(halo+微缩放, 纯 box-shadow/transform 不改盒模型→不引入跳动) */
@keyframes ddzTurnPulse{0%,100%{box-shadow:inset 0 0 0 1px rgba(0,229,212,.35),0 0 6px rgba(0,229,212,.3);transform:scale(1)}50%{box-shadow:inset 0 0 0 1px rgba(0,229,212,.7),0 0 16px 3px rgba(0,229,212,.55);transform:scale(1.04)}}
.ddz-lastwho{font-size:11px;color:var(--sub);min-height:14px}
.ddz-played{display:flex;min-height:70px;align-items:center;justify-content:center;width:100%;box-sizing:border-box}
/* 出牌"掷向中央": 真牌堆先隐后现(land), 由 flyPlayToCenter 生成的幽灵牌从出牌人头像飞抵中央,
   二者交叉淡入 —— 观感是牌从座位被扔到桌心, 而非凭空出现。 */
.ddz-played.land{animation:ddzLand .44s cubic-bezier(.2,.85,.3,1)}
@keyframes ddzLand{0%{opacity:0;transform:scale(.66)}52%{opacity:0}72%{opacity:1;transform:scale(1.06)}100%{opacity:1;transform:none}}
/* ★必须 .card.ddz-fly-card 双类提权: .ddz-fly-card 单类会被后面的 .card{position:relative} 平特异性覆盖,
   幽灵牌落回文档流(每张 64px×5=320px), 把 felt 挤矮→整个下半场每次出牌上下弹 320px(牌桌跳动真凶)。 */
.card.ddz-fly-card{position:absolute;z-index:12;pointer-events:none;will-change:transform,opacity;
  transition:transform .4s cubic-bezier(.22,.75,.3,1),opacity .4s ease}
.ddz-passtag{color:var(--dim);font-size:14px;letter-spacing:.14em;border:1px dashed var(--line);border-radius:10px;padding:6px 16px;animation:ddzFlyTop .22s}
/* 底牌: 顶部居中(两对手之间), 对标腾讯——不再是右上角一堆看不懂的小背。带"底牌"标, 定地主后翻面亮出。 */
.ddz-bottom-cards{position:absolute;top:2px;left:50%;transform:translateX(-50%) scale(.82);transform-origin:top center;
  display:flex;flex-direction:column;align-items:center;gap:2px;opacity:.94}
.ddz-bottom-cards .bc-lbl{font-size:13px;letter-spacing:.28em;color:var(--dim,#498d88);font-weight:600;text-indent:.28em}
.ddz-bottom-cards .bc-row{display:flex;gap:4px}
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
.ddz-hand{display:flex;justify-content:center;padding:var(--hand-pad,24px) 0 6px;min-height:92px;flex-wrap:nowrap;touch-action:none}
.ddz-hand .card{margin-left:var(--hand-ov,-20px);transition:transform .14s ease,box-shadow .14s;cursor:pointer;transform-origin:bottom center}
.ddz-hand .card:first-child{margin-left:0}
.ddz-hand.locked .card{cursor:default}
.ddz-hand .card.sel{transform:translateY(-18px);box-shadow:0 6px 14px rgba(0,0,0,.4),0 0 0 2px var(--accent)}
/* 提示时被选中的牌弹跳一下, 让"提起来的是哪几张"一眼看清 */
@keyframes ddzHintPop{0%{transform:translateY(-18px) scale(1)}45%{transform:translateY(-30px) scale(1.07)}100%{transform:translateY(-18px) scale(1)}}
.ddz-hand .card.sel.hintpop{animation:ddzHintPop .36s cubic-bezier(.2,.85,.3,1);box-shadow:0 10px 20px rgba(0,0,0,.45),0 0 0 2px var(--accent),0 0 16px var(--accent)}
.ddz-hand:not(.locked) .card:hover{transform:translateY(-8px)}
.ddz-hand:not(.locked) .card.sel:hover{transform:translateY(-18px)}
.ddz-hand .card.justdealt{animation:ddzDeal .3s ease}
@keyframes ddzDeal{from{transform:translateY(30px);opacity:0}to{transform:none;opacity:1}}
/* 斗地主发牌即按大小自动理好(Deck.sortHand), 手牌少且点选直接, 不设手动理牌(与掼蛋不同) */
/* 操作条 */
/* 叫分↔出牌↔结算 三态高度不同, 给容器钉一个覆盖最高态(叫分双行)的地板并底对齐,
   富余空间落在绒面一侧, 操作条恒定贴底——游戏中整桌不再上下跳 */
#ddzCtrl{display:flex;flex-direction:column;justify-content:flex-end;min-height:calc(92px + env(safe-area-inset-bottom,0px))}
.ddz-room.is-land #ddzCtrl{min-height:calc(70px + env(safe-area-inset-bottom,0px))}
.ddz-acts{display:flex;gap:10px;justify-content:center;padding:8px 16px calc(12px + env(safe-area-inset-bottom,0px))}
/* ★等宽+定高+长文字自动缩字号(主人诉求 msg5): min-width:0 让 flex 等分真正生效(不被"要不起/抢地主"等长文
   撑破对不齐); min-height 定高防不同按钮高低差; flex 居中 + gap 让 .bt 副标并排居中(不用 margin 破坏居中);
   font-size clamp 随视口收放, 窄屏自动小一号; overflow:hidden 兜底极端长文不溢出。 */
.ddz-btn{flex:1;min-width:0;max-width:130px;min-height:48px;padding:6px 8px;border-radius:12px;font-weight:800;
  font-size:clamp(13px,4vw,16px);line-height:1.15;cursor:pointer;white-space:nowrap;overflow:hidden;
  display:flex;align-items:center;justify-content:center;gap:4px;
  border:1px solid var(--line2);background:var(--panel);color:var(--ink);letter-spacing:.04em;transition:.14s}
.ddz-btn:active{transform:scale(.96)}
.ddz-btn.primary{background:var(--accent);color:var(--btn-ink,#04060c);border-color:var(--accent);box-shadow:var(--glow-cyan)}
.ddz-btn.primary:disabled{background:var(--panel);color:var(--ink)}
.ddz-btn:disabled{opacity:.4;cursor:not-allowed;box-shadow:none}
.ddz-btn.ghost{background:transparent;color:var(--sub)}
.ddz-btn.primary.boom-ready{background:var(--magenta,#ff2d8e);border-color:var(--magenta,#ff2d8e);box-shadow:var(--glow-mag,0 0 12px rgba(255,45,142,.6));color:#fff}
.ddz-btn.danger{background:linear-gradient(150deg,#ff4d6d,#e0263e);border-color:#ff96a8;color:#fff;box-shadow:0 0 12px rgba(224,38,62,.45)}
.ddz-btn .bt{font-size:11px;font-weight:700;opacity:.85;letter-spacing:.02em}
/* 叫地主浮条 */
.ddz-bidbar{display:flex;flex-direction:column;align-items:center;gap:10px;padding:8px 16px calc(12px + env(safe-area-inset-bottom,0px))}
.ddz-bidbar .q{font-size:13px;color:var(--sub)}
.ddz-bidbtns{display:flex;gap:8px}
.ddz-bidbtns .ddz-btn{min-width:62px;max-width:none;flex:none;padding:9px 4px;font-size:14px}
/* 结算: 铺满整个牌桌(挂在 room 上, 不只盖绒面)——把散落的手牌/座位/剩牌都收进面板卡背后, 不再露出半截 */
.ddz-over{position:absolute;inset:0;z-index:22;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;
  background:radial-gradient(ellipse at center,rgba(6,10,20,.9),rgba(3,5,10,.96));backdrop-filter:blur(6px);animation:ddzRoomIn .2s}
/* 结算内容收进带边框的面板卡(治"裸文字浮在死黑上"): 与德州 .pk-over-card 同一套语言 */
.ddz-over-card{display:flex;flex-direction:column;align-items:center;gap:15px;width:min(320px,90%);box-sizing:border-box;
  padding:28px 24px 24px;border-radius:22px;background:linear-gradient(170deg,var(--panel-solid,#132a29),var(--bg2,#0d1524));
  border:1px solid var(--line2,rgba(0,229,212,.4));box-shadow:0 24px 60px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.05)}
.ddz-over.win .ddz-over-card{border-color:rgba(0,229,212,.55);box-shadow:0 24px 60px rgba(0,0,0,.6),0 0 40px rgba(0,229,212,.22),inset 0 1px 0 rgba(255,255,255,.06)}
.ddz-over.lose .ddz-over-card{border-color:rgba(255,45,142,.42);box-shadow:0 24px 60px rgba(0,0,0,.6),0 0 40px rgba(255,45,142,.16),inset 0 1px 0 rgba(255,255,255,.05)}
.ddz-over h2{font-size:32px;margin:0;letter-spacing:.1em;font-weight:900;display:flex;align-items:center;gap:10px}
.ddz-over.win h2{color:var(--accent);text-shadow:var(--glow-cyan)}
.ddz-over.lose h2{color:var(--magenta,#ff2d8e);text-shadow:var(--glow-mag)}
.ddz-over .sub{color:var(--sub);font-size:13px;text-align:center;line-height:1.7}
.ddz-over .score{font-size:30px;font-weight:900;color:var(--amber);letter-spacing:.02em;font-variant-numeric:tabular-nums;
  padding:6px 22px;border-radius:14px;background:rgba(255,194,77,.1);border:1px solid rgba(255,194,77,.28)}
.ddz-over .ddz-acts{margin-top:4px;width:100%}
.ddz-over .ddz-acts .ddz-btn{max-width:none}
/* 本桌累计(结算面板): 逐席列名字 + 累计分, 与残牌盒同底色语言, 让"这桌打了几局谁领先"一眼看清 */
.ddz-over .ddz-cumbox{display:flex;flex-direction:column;gap:5px;width:100%;box-sizing:border-box;padding:10px 14px;
  border-radius:14px;background:rgba(0,0,0,.24);border:1px solid var(--line,rgba(0,229,212,.24))}
.ddz-over .cum-ttl{font-size:11px;letter-spacing:.16em;color:var(--dim,#498d88);text-align:center;text-indent:.16em}
.ddz-over .cum-row{display:flex;align-items:center;font-size:13px}
.ddz-over .cum-nm{color:var(--sub,#86cbc6);display:flex;align-items:center;gap:6px}
.ddz-over .cum-role{font-size:10px;padding:0 6px;border-radius:8px;background:rgba(255,194,77,.12);color:var(--amber,#ffc24d);border:1px solid rgba(255,194,77,.3)}
.ddz-over .cum-v{margin-left:auto;font-weight:800;font-variant-numeric:tabular-nums}
.ddz-over .cum-v.pos{color:var(--amber,#ffc24d)}
.ddz-over .cum-v.neg{color:var(--magenta,#ff2d8e)}
.ddz-over .cum-v.zero{color:var(--dim,#498d88)}
/* 残局:亮输家剩牌(对标腾讯). 每行 名字+剩数 一行, 底下一把叠扇展开的 mini 牌; 逐行错峰浮入 */
.ddz-over .ddz-remains{display:flex;flex-direction:column;gap:9px;width:100%;padding:11px 12px;box-sizing:border-box;
  border-radius:14px;background:rgba(0,0,0,.24);border:1px solid var(--line,rgba(0,229,212,.24))}
.ddz-over .rm-row{display:flex;flex-direction:column;gap:4px;opacity:0;animation:ddzRmIn .34s ease both;animation-delay:calc(.08s + var(--i,0)*.09s)}
@keyframes ddzRmIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.ddz-over .rm-nm{font-size:12px;color:var(--sub,#86cbc6);display:flex;align-items:center;gap:6px;letter-spacing:.02em}
.ddz-over .rm-role{font-size:10.5px;padding:0 6px;border-radius:8px;background:rgba(0,229,212,.12);color:var(--accent,#00e5d4);border:1px solid rgba(0,229,212,.28)}
.ddz-over .rm-n{margin-left:auto;font-size:11px;color:var(--amber,#ffc24d);font-variant-numeric:tabular-nums}
.ddz-over .rm-cards{display:flex;padding-left:2px}
.ddz-over .rm-cards .card{margin-left:-16px;box-shadow:0 2px 5px rgba(0,0,0,.45)}
.ddz-over .rm-cards.dense .card{margin-left:-19px}   /* 19~20 张(反春天地主几乎没出牌)才收紧, 保证不溢出面板 */
.ddz-over .rm-cards .card:first-child{margin-left:0}
/* 丝滑收局:再来一局时结算面板淡出下沉, 让位给新一局的发牌入场(不再瞬拆硬切) */
.ddz-over.out{animation:ddzOverOut .34s cubic-bezier(.4,0,.9,.5) forwards;pointer-events:none}
@keyframes ddzOverOut{from{opacity:1}to{opacity:0;transform:scale(.94) translateY(12px)}}
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

/* ── 记牌器/出牌历史(仅纯单机信息辅助): 顶栏切换钮 + 悬浮面板 ─────────── */
.ddz-cnt{width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:transparent;
  color:var(--sub,#86cbc6);font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ddz-cnt:hover{color:var(--ink);border-color:var(--line2)}
.ddz-cnt.on{color:var(--accent,#00e5d4);border-color:var(--accent,#00e5d4);box-shadow:0 0 12px rgba(0,229,212,.4)}
.ddz-cntp{position:absolute;top:52px;right:max(12px,env(safe-area-inset-right,0px));z-index:60;width:min(320px,calc(100% - 24px));
  background:rgba(9,14,22,.96);border:1px solid var(--line2,rgba(0,229,212,.4));border-radius:16px;padding:12px 12px 10px;
  box-shadow:0 18px 46px rgba(0,0,0,.6);backdrop-filter:blur(8px);animation:ddzRoomIn .16s ease-out}
.ddz-cntp[hidden]{display:none}
.ddz-cntp .cp-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.ddz-cntp .cp-hd b{font-size:13px;letter-spacing:.04em;color:var(--ink,#eaf6ff)}
.ddz-cntp .cp-x{width:24px;height:24px;border-radius:50%;border:1px solid var(--line);background:transparent;color:var(--sub);cursor:pointer;font-size:12px}
.ddz-cnt-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}
.ddz-cnt-cell{display:flex;flex-direction:column;align-items:center;gap:1px;padding:5px 2px;border-radius:9px;
  border:1px solid var(--line,rgba(0,229,212,.2));background:rgba(255,255,255,.03)}
.ddz-cnt-cell .cc-r{font-size:12px;font-weight:800;color:var(--ink,#eaf6ff);line-height:1}
.ddz-cnt-cell .cc-n{font-size:14px;font-weight:800;color:var(--accent,#00e5d4);line-height:1}
.ddz-cnt-cell.joker .cc-r{color:var(--amber,#ffc24d)}
.ddz-cnt-cell.low .cc-n{color:var(--amber,#ffc24d)}
.ddz-cnt-cell.zero{opacity:.34}
.ddz-cnt-cell.zero .cc-n{color:var(--dim,#498d88)}
.ddz-cnt-hist{margin-top:9px;border-top:1px solid var(--line,rgba(0,229,212,.16));padding-top:8px}
.ddz-cnt-hist .ch-t{font-size:11px;color:var(--sub,#86cbc6);margin-bottom:5px;letter-spacing:.04em}
.ddz-cnt-hist .ch-row{display:flex;align-items:baseline;gap:6px;font-size:12px;line-height:1.5;color:var(--ink,#eaf6ff)}
.ddz-cnt-hist .ch-nm{color:var(--sub,#86cbc6);flex:none;min-width:44px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddz-cnt-hist .ch-cd{font-weight:700;letter-spacing:.06em}
.ddz-cnt-hist .ch-row.pass .ch-cd{color:var(--dim,#498d88);font-weight:500}
.ddz-cnt-hist .ch-empty{font-size:12px;color:var(--dim,#498d88)}

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
  // 招募态样式(空位可点邀请 + 邀请浮层): 独立注入, 不动主 CSS 串
  function injectLobbyCSS(){
    if (document.getElementById('ddzLobbyCSS')) return;
    const s = document.createElement('style'); s.id='ddzLobbyCSS';
    s.textContent = `
.ddz-seat.ddz-lobby-empty{cursor:pointer}
.ddz-seat.ddz-lobby-empty .ddz-avr{border:1.5px dashed var(--line2,rgba(0,229,212,.4));border-radius:50%}
.ddz-seat.ddz-lobby-empty .ddz-avr .av{background:transparent;border-style:dashed;color:var(--accent,#00e5d4);font-weight:700}
.ddz-seat.ddz-lobby-empty:hover .ddz-avr .av{box-shadow:0 0 12px var(--accent,rgba(0,229,212,.5))}
.ddz-seat .cnt.lob{color:var(--accent,#00e5d4)}
.ddz-seat.ddz-lobby-empty .cnt.lob{color:var(--sub,#86cbc6)}
.ddz-lob-kick{position:absolute;top:-4px;right:6px;width:18px;height:18px;line-height:16px;text-align:center;
  border-radius:50%;border:1px solid var(--line);background:var(--panel-solid,#132a29);color:var(--dim,#498d88);
  font-size:11px;cursor:pointer;padding:0;z-index:5}
.ddz-lob-kick:hover{color:var(--magenta,#ff2d8e);border-color:var(--magenta,#ff2d8e)}
.ddz-acts.ddz-lobacts{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;padding:10px 18px calc(14px + env(safe-area-inset-bottom,0px))}
.ddz-invite-menu{position:absolute;z-index:40;width:180px;max-height:60%;overflow:auto;padding:6px;
  background:var(--panel-solid,#132a29);border:1px solid var(--line2,rgba(0,229,212,.4));border-radius:12px;
  box-shadow:0 8px 26px rgba(0,0,0,.5);animation:ddzRoomIn .16s ease}
.ddz-invite-menu .im-ttl{font-size:11px;font-weight:800;color:var(--accent,#00e5d4);padding:4px 8px 6px;letter-spacing:.04em}
.ddz-invite-menu .im-sep{font-size:10px;color:var(--dim,#498d88);padding:6px 8px 2px}
.ddz-invite-menu .im-empty{font-size:11px;color:var(--dim,#498d88);padding:6px 8px}
.ddz-invite-menu .im-item{display:block;width:100%;text-align:left;background:transparent;border:0;border-radius:8px;
  padding:8px 10px;color:var(--ink,#eaf6ff);font-size:13px;cursor:pointer}
.ddz-invite-menu .im-item:hover{background:rgba(0,229,212,.12)}`;
    document.head.appendChild(s);
  }
  function open(opts){
    opts = opts || {};
    if (!Deck || !Rules || !Engine || !AI){ console.warn('[ddz] engine not loaded'); return null; }
    injectCSS(); injectLobbyCSS();
    try{ if(root.EhGameBgm) root.EhGameBgm.enter('ddz'); }catch(_){}   // 进桌切斗地主 BGM

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
    // 招募态(lobby)→ 发牌: startDeal 会就地换名册, 故三者必须可重赋值(deal-in-place, 不重挂 room)
    let names = opts.names || ['你', '灵魂·左', '灵魂·右'];
    let avatars = opts.avatars || ['🙂','🤖','👾'];
    let gameIsAI = opts.isAI || [false,true,true];                    // 联机: host 按座位实况标人/机
    // 对手 DOM 槽位: 以 mySeat 为基, 顺位 (me+1)/(me+2)(单机 mySeat=0 时恰为 1/2)
    const OPP_SEATS = [(mySeat+1)%3, (mySeat+2)%3];
    // ── 联机(host 权威)双模式: guest 只渲染 host 广播的脱敏公共快照 + 回传自己动作, 不建局/不跑引擎 ──
    //   单机路径(isGuest=false)完全走原逻辑, 零改动; 所有 guest 行为一律走 isGuest 分支旁路。
    //   斗地主有【叫分阶段】与【底牌】: 底牌定地主后才随快照明置(见 ddz-net.js); 手牌动态(地主 +3 / 出一张少一张),
    //   由 host 每次广播时重写各远程席私牌行 —— 快照永不带 seed/log/别家手牌/定地主前的底牌。
    const mode = opts.mode || 'local';
    const isGuest = mode === 'guest';
    // 加倍系统只在本地单机(对标欢乐斗地主)开启: 定地主后插一屏加倍轮。联机(host/guest)不启用,
    // 引擎默认关 → 联机快照/结算完全走经典路径, ddz-net 一行不动(见 ddz-engine.js opts.doubling)。
    const DOUBLING = (mode === 'local');
    // 记牌器/出牌历史(对标欢乐斗地主的信息辅助): 只用【已出牌】(公共信息, 全场可见)算未出张数, 绝不读手牌。
    //   仅纯单机开: 联机 guest 快照按命门剥离了 log(见 ddz-net), 无从计数 → 只在 local 挂, 与加倍同口径。
    const COUNTER = (mode === 'local') && !!(root.EHCardCounter);
    let counterOn = false;
    let remoteSeats = opts.remoteSeats || [];            // host 视角: 哪些席是远程真人(等其回传, 超时代打)。startDeal 时重赋
    const isRemote = (seat)=> remoteSeats.indexOf(seat) >= 0;
    // ── 招募态(lobby): 开桌先落真牌桌页(本文件), 空位可点邀灵魂/真人, host 满意点「开始 ▶」再 startDeal 就地转正局 ──
    const lobbyMode = !!opts.lobby;                      // 首帧以招募态开桌(仅 host 走此路)
    const isHostLobby = !!opts.isHost;
    let lobbyCtx = opts.lobbyCtx || null;                // { myUid, hostName, souls:[{auth_uid,name,emoji}], actions:{seatSoul,kick,fillSouls,inviteHumans,start,close} }
    let lobbySeats = Array.isArray(opts.lobbySeats) ? opts.lobbySeats : [];
    const onSync   = (typeof opts.onSync==='function')   ? opts.onSync   : null;  // host: 每次状态变更 → 广播快照
    const onAction = (typeof opts.onAction==='function') ? opts.onAction : null;  // guest: 回传我的动作给 host
    const GNet = root.EHDdzNet;
    let myHand = [];        // guest: 自己手牌(从 eh_gt_hands 拉到)
    let lastSnap = null;    // guest: 最近一张公共快照
    let dealNo = 0;         // 本桌第几局(host 广播随快照带出; guest 据此识别新一局去拉手牌)
    let awaitingHost = false; // guest: 已回传动作, 等 host 裁决快照期间锁 UI 防重复
    const REMOTE_TIMEOUT_MS = HUMAN_PLAY_MS + 8000;      // host 等远程真人回传的宽限, 超时自动代打

    function newGame(){ return Engine.createGame({ isAI: gameIsAI, names, seed: opts.seed, doubling: DOUBLING }); }
    // guest 占位局: 等 host 首帧快照到达前的空桌, 字段齐全避免渲染读空。
    function waitingState(){
      return { phase:'wait', seed:undefined, turn:-1, landlord:null, multiplier:1, base:1, bombs:0,
        bid:null, result:null, bottom:[], table:{ lastPlay:null, passesInRow:0 },
        players:[0,1,2].map(s=>({ id:'p'+s, seat:s, name:(names[s]||('席'+s)),
          isAI: !!(gameIsAI && gameIsAI[s]), hand:[] })) };
    }
    // 招募占位局: 未发牌, 座位按 lobbySeats 显示占用/空位; host 点空位邀灵魂/真人, 满意 startDeal 就地转正局。
    function lobbyState(seats){
      const arr = (Array.isArray(seats)?seats:[]).slice().sort((a,b)=>a.seat-b.seat);
      const players=[0,1,2].map(i=>{
        const s = arr[i] || { seat:i, kind:'empty' };
        const kind = s.kind || 'empty';
        return { id:'p'+i, seat:i, dbSeat:(typeof s.seat==='number'?s.seat:i), kind,
          name: kind==='empty' ? '' : (s.name||names[i]||('席'+i)), emoji: s.emoji||null,
          isAI: kind!=='human', hand:[] };
      });
      return { phase:'lobby', seed:undefined, turn:-1, landlord:null, multiplier:1, base:1, bombs:0,
        bid:null, result:null, bottom:[], table:{ lastPlay:null, passesInRow:0 }, players };
    }
    // ── host: 产出脱敏公共快照交给 app.js 广播(顺带把各远程真人席【当前】手牌写回私牌表: 定地主 +3 / 出一张少一张) ──
    function broadcast(){
      if (isGuest || !onSync || !GNet || st.phase==='lobby' || st.phase==='wait') return;   // 招募/占位态无局可播
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
            renderAll(); maybeBanter(seat);   // 先重绘座位再说话: say() 写的气泡若在 renderAll 前加, 会被 renderSeats 整段重建吞掉(从不显示)
            if (r && r.over) showOver();
            return true;
          }
        }
      } catch(e){ return false; }
      return false;
    }
    let st = isGuest ? waitingState() : (lobbyMode ? lobbyState(lobbySeats) : newGame());
    let selected = new Set();     // 选中的 card id
    // 本桌累计比分持久化: 键随牌桌 id(opts.scoreKey), 重进/刷新同一张桌不清零; 桌真正散了由 app.gtClose 清键。
    const SCOREKEY = opts.scoreKey || null;
    function saveScore(){ if(!SCOREKEY) return; try{ localStorage.setItem(SCOREKEY, JSON.stringify(cumScore)); }catch(_){ } }
    function loadScore(){ if(!SCOREKEY) return null; try{ const v=JSON.parse(localStorage.getItem(SCOREKEY)||'null'); return (Array.isArray(v)&&v.length===3&&v.every(x=>typeof x==='number'))?v:null; }catch(_){ return null; } }
    const cumScore = loadScore() || [0,0,0];   // 本桌累计比分(按座位号, 跨"再来一局"累加; showOver 里每手计一次)
    let hintCycle = [];           // 提示循环队列
    let hintIdx = 0;

    // ── 音效 + 触感(复用聊天室 EhSfx 合成器; 未加载则静默, 全程 try/catch 不打断牌局) ──
    function sfx(n){ try{ if(root.EhSfx && root.EhSfx.play) root.EhSfx.play(n); }catch(_){} }
    function vibrate(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(_){} }
    let dealAnim = true;          // 下一次 renderHand 播发牌错峰入场(开局/重发/再来一局各触发一次)
    let lastLord = null;          // 地主揭晓上升沿(null→定人)一次性音效
    let justCrowned = false;      // 本次重绘是否播放"定地主"动画(皇冠砸落 + 底牌翻面)
    let lastMyTurn = false;       // "轮到我"上升沿: 只在刚轮到时提示音+震动, 不每帧响
    sfx('arrive'); if(!isGuest && !lobbyMode) sfx('deal');   // 开桌一声 + 洗牌发牌(guest/招募态未真发牌前不响发牌音)

    // 定时器:AI 行动 + 回合倒计时(环 + 到点兜底)
    let aiTimer = null;
    let ringRAF = null, actionTimer = null;
    let turnStart = 0, turnDur = 0, turnSeatActive = -1, turnPhaseActive = '';

    // 挂载点:优先聊天室 #hall(入室牌桌), 无则退回 body
    const mountEl = opts.mount || document.getElementById('hall') || document.body;

    const room = document.createElement('div'); room.className = 'ddz-room';
    room.innerHTML = `
      <div class="ddz-bar">
        <div class="ddz-title"><span class="dot"></span>斗地主</div>
        <div class="ddz-mult" id="ddzMult">底分 1 · ×1</div>
        <button class="ddz-mus" id="ddzMus" aria-label="背景音乐开关">🎵</button>
        ${COUNTER?`<button class="ddz-cnt" id="ddzCnt" aria-label="记牌器" title="记牌器/出牌历史">🃏</button>`:''}
        <button class="ddz-rot" id="ddzRot" aria-label="横竖屏切换" title="横屏/竖屏">⟳</button>
        <button class="ddz-x" id="ddzX" aria-label="返回聊天">✕<span class="ddz-xlbl"> 返回</span></button>
      </div>
      ${COUNTER?`<div class="ddz-cntp" id="ddzCntPanel" hidden>
        <div class="cp-hd"><b>🃏 记牌器</b><button class="cp-x" id="ddzCntX" aria-label="关闭">✕</button></div>
        <div class="ddz-cnt-grid" id="ddzCntGrid"></div>
        <div class="ddz-cnt-hist"><div class="ch-t">最近出牌</div><div id="ddzCntHist"></div></div>
      </div>`:''}
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
      <div class="ddz-hand-wrap"><div class="ddz-hand" id="ddzHand"></div></div>
      <div id="ddzCtrl"></div>
      <div class="ddz-toast" id="ddzToast"></div>`;
    mountEl.appendChild(room);

    // 游戏内聊天已下线: 牌桌不再挂聊天坞/弹幕, 点"✕ 返回"回聊天室看消息(减少牌桌干扰、专注出牌)
    const dock = null;

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
    // 叫/抢地主印章: 在座位头像上啪一枚图章。cls: 'call'(叫,橙)/'rob'(抢,红)/'pass'(不叫,灰)
    function bidStamp(seat, cls, text){
      const seatEl = els.felt.querySelector(`.ddz-seat[data-seat="${seat}"]`)
                  || els.me.querySelector(`.ddz-seat[data-seat="${seat}"]`);
      if (!seatEl) return;
      let el = seatEl.querySelector('.ddz-stamp');
      if (!el){ el = document.createElement('div'); el.className='ddz-stamp'; seatEl.appendChild(el); }
      el.className = 'ddz-stamp ' + cls;
      el.textContent = text;
      void el.offsetWidth;              // 复位动画
      el.classList.add('show');
      clearTimeout(el._t); el._t = setTimeout(()=>{ el.classList.remove('show'); }, 1350);
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
    // resize rAF 节流: 旋转/移动端地址栏收放会连发数十个 resize, 每个都整段重排手牌 —— 合并到每帧一次。
    let _rzRAF=0;
    const onResize = ()=>{ if(_rzRAF) return; _rzRAF=requestAnimationFrame(()=>{ _rzRAF=0; layoutHand(); }); };
    let _exited=false;
    function close(){ minimized=false; try{ if(root.EhGameBgm) root.EhGameBgm.exit(); }catch(_){} clearTimers(); if(_rzRAF){ cancelAnimationFrame(_rzRAF); _rzRAF=0; } closeInviteMenu(); window.removeEventListener('resize', onResize); if(root.EHTableOrient) root.EHTableOrient.clear(room); if(dock) dock.destroy(); if(chip){ chip.remove(); chip=null; } room.remove();
      if(!_exited){ _exited=true; if(typeof opts.onExit==='function'){ try{ opts.onExit(); }catch(_){} } } }
    window.addEventListener('resize', onResize);

    // ── 划选: 指针涂抹式多选(点=单选 / 拖过整段=连选), 取代逐张 click, 与掼蛋同源 ──
    // 只绑一次(挂在手牌容器上, 手牌重绘不重复绑)。手牌左→右叠放, 后牌盖前牌右半,
    // 故 handCardAt 不用 elementFromPoint(会在牌中心命中右邻牌漏掉最左那张), 改按 x 命中"露出的那张"。
    let painting=false, paintMode='select', paintSeen=null, paintLastIdx=null, lastSelTick=0;
    // 划选期几何缓存: pointerdown 时一次性量好手牌带上沿/下沿 + 每张左沿(选中只上移不横移, 左沿在一次拖动内恒定)。
    //   免得每个 pointermove 都对全部牌 getBoundingClientRect —— 那紧跟 .sel 的 class 写会强制同步重排, 拖动掉帧。
    let paintGeo=null;
    function buildPaintGeo(){
      const kids=els.hand.children, hr=els.hand.getBoundingClientRect();
      const lefts=new Array(kids.length);
      for(let i=0;i<kids.length;i++) lefts[i]=kids[i].getBoundingClientRect().left;
      paintGeo={ top:hr.top, bottom:hr.bottom, lefts };
    }
    function handCardAt(x,y){
      const kids=els.hand.children, n=kids.length; if(!n) return null;
      if(paintGeo && paintGeo.lefts.length===n){          // 拖动中: 走缓存, 零重排
        if(y < paintGeo.top-40 || y > paintGeo.bottom+40) return null;
        let pick=kids[0];
        for(let i=0;i<n;i++){ if(x >= paintGeo.lefts[i]-0.5) pick=kids[i]; else break; }
        return pick;
      }
      const hr=els.hand.getBoundingClientRect();
      if(y < hr.top-40 || y > hr.bottom+40) return null;   // 垂直离手牌带太远不算(拖向出牌钮时不误选)
      let pick=kids[0];                                     // x 在首牌左沿之前 → 归首牌
      for(let i=0;i<n;i++){ if(x >= kids[i].getBoundingClientRect().left-0.5) pick=kids[i]; else break; }
      return pick;                                          // left ≤ x 里最靠右的一张 = 指针下露出的那张
    }
    function applyPaintIdx(i){
      const c=els.hand.children[i]; if(!c) return;
      const id=c.dataset.id; if(!id || paintSeen.has(id)) return; paintSeen.add(id);
      if(paintMode==='select') selected.add(id); else selected.delete(id);
      c.classList.toggle('sel', selected.has(id));
      if(paintMode==='select'){ const now=(performance&&performance.now)?performance.now():Date.now(); if(now-lastSelTick>60){ lastSelTick=now; sfx('cardsel'); } }
    }
    function paintTo(c){
      if(!c) return; const idx=+c.dataset.idx;
      if(paintLastIdx==null) applyPaintIdx(idx);
      else { const lo=Math.min(paintLastIdx,idx), hi=Math.max(paintLastIdx,idx); for(let i=lo;i<=hi;i++) applyPaintIdx(i); }
      paintLastIdx=idx; updatePlayBtn();
    }
    function endPaint(){
      const wasSelect = painting && paintMode==='select';
      painting=false; paintSeen=null; paintLastIdx=null; paintGeo=null;
      if (wasSelect && autoExtendSelection()){ renderHand(); updatePlayBtn(); sfx('cardsel'); }
    }
    els.hand.addEventListener('pointerdown', (e)=>{
      if(st.phase!=='play' || st.turn!==mySeat || (isGuest && awaitingHost)) return;
      buildPaintGeo();                                     // 先量好几何缓存, 本次拖动全程复用
      const c=handCardAt(e.clientX,e.clientY); if(!c) return;
      painting=true; paintSeen=new Set(); paintLastIdx=null;
      paintMode = selected.has(c.dataset.id) ? 'deselect' : 'select';
      try{ els.hand.setPointerCapture(e.pointerId); }catch(_){}
      paintTo(c); e.preventDefault();
    });
    els.hand.addEventListener('pointermove', (e)=>{ if(painting) paintTo(handCardAt(e.clientX,e.clientY)); });
    els.hand.addEventListener('pointerup', endPaint);
    els.hand.addEventListener('pointercancel', endPaint);

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
      // 折叠动画自带 transform, 先复位横屏内联 transform 免打架
      if (root.EHTableOrient) root.EHTableOrient.clear(room);
      if (rotBtn) rotBtn.classList.remove('on');
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
    // ⟳ 横竖屏切换(仍在聊天室内): 竖持手机想要横屏视图时点它, 再点复位
    const rotBtn = $('#ddzRot');
    if (rotBtn) rotBtn.addEventListener('click', ()=>{
      const on = root.EHTableOrient ? root.EHTableOrient.toggle(room) : false;
      rotBtn.classList.toggle('on', on); sfx('click');
      if (!minimized) layoutHand();   // 旋转后按新宽度重排手牌
    });
    // 牌桌内背景音乐开关(复用 EH_BGM, 因大厅 🎵 被牌桌浮层盖住)
    const musBtn = $('#ddzMus');
    function paintMus(){ if(!musBtn) return; const on = !root.EH_BGM || root.EH_BGM.on(); musBtn.textContent = on?'🎵':'🔇'; musBtn.classList.toggle('muted', !on); }
    if (musBtn) musBtn.addEventListener('click', ()=>{ try{ if(root.EH_BGM) root.EH_BGM.set(!root.EH_BGM.on()); }catch(_){} paintMus(); sfx('click'); });
    paintMus();

    // 🃏 记牌器/出牌历史(仅纯单机): 切换悬浮面板, 开着时每次出牌后随 renderTable 自动刷新。
    const cntBtn = $('#ddzCnt'), cntPanel = $('#ddzCntPanel');
    function renderCounter(){
      if (!COUNTER || !counterOn || !cntPanel || !root.EHCardCounter) return;
      const log = (st && st.log) || [];
      const rows = root.EHCardCounter.remaining(log, 1);   // 斗地主单副
      const grid = cntPanel.querySelector('#ddzCntGrid');
      if (grid) grid.innerHTML = rows.map(x=>{
        const cls = (x.rank>=16?'joker ':'') + (x.remain===0?'zero':(x.remain===1?'low':''));
        return `<div class="ddz-cnt-cell ${cls}"><span class="cc-r">${x.label}</span><span class="cc-n">${x.remain}</span></div>`;
      }).join('');
      const hist = root.EHCardCounter.history(log, (names||[]), 6);
      const hbox = cntPanel.querySelector('#ddzCntHist');
      if (hbox) hbox.innerHTML = hist.length
        ? hist.map(h=> h.kind==='pass'
            ? `<div class="ch-row pass"><span class="ch-nm">${escapeHtml(h.name)}</span><span class="ch-cd">不出</span></div>`
            : `<div class="ch-row"><span class="ch-nm">${escapeHtml(h.name)}</span><span class="ch-cd">${h.labels.join(' ')}</span></div>`).join('')
        : '<div class="ch-empty">还没有人出牌</div>';
    }
    function toggleCounter(){
      counterOn = !counterOn;
      if (cntBtn) cntBtn.classList.toggle('on', counterOn);
      if (cntPanel) cntPanel.hidden = !counterOn;
      if (counterOn) renderCounter();
      sfx('click');
    }
    if (cntBtn) cntBtn.addEventListener('click', toggleCounter);
    if (cntPanel){ const cx=cntPanel.querySelector('#ddzCntX'); if(cx) cx.addEventListener('click', toggleCounter); }

    // lastPlay 只存 id,需要一张 id→card 表(用整副牌重建)
    const ALL = {}; Deck.standardDeck().forEach(c=>ALL[c.id]=c);
    function findCardById(id){ return ALL[id]; }

    // ── 座位 DOM(对手区 + 我的座位标) ──
    // 本桌累计比分徽标: 正分暖色 / 负分品红 / 0 分中性; renderSeats 每次重绘即刷新最新累计
    function cumPill(seat){
      const v = cumScore[seat] || 0;
      const cls = v>0 ? 'pos' : (v<0 ? 'neg' : 'zero');
      return `<div class="ddz-cum ${cls}">${v>0?'+':''}${v} 分</div>`;
    }
    // 招募态座位: 空位 → 「＋ 点击邀请」, 占用 → 头像/名/角色 + host 可请离(非 0 席)
    function lobbySeatHTML(seat){
      const p = st.players[seat];
      if (p.kind==='empty'){
        return `<div class="ddz-seat ddz-lobby-empty" data-seat="${seat}" data-invite="${p.dbSeat}">
          <div class="ddz-avr"><div class="av">＋</div></div>
          <div class="meta"><div class="nm">空位</div><div class="cnt lob">点击邀请</div></div>
        </div>`;
      }
      const isMe = seat===mySeat;
      // clone=灵魂分身(本机 AI 顶灵魂身份代打的副本)→ 标「分身」, 别冒充真人「玩家」(状态忠实)
      const roleTxt = p.kind==='soul' ? '灵魂' : (p.kind==='clone' ? '分身' : (isMe ? '你' : '玩家'));
      const canKick = isHostLobby && !isMe && p.dbSeat!==0;
      return `<div class="ddz-seat ddz-lobby-filled" data-seat="${seat}">
        <div class="ddz-avr"><div class="av">${p.emoji||'🙂'}</div></div>
        <div class="meta"><div class="nm">${escapeHtml(p.name||'—')}</div>
          <div class="cnt lob"><span class="role">${roleTxt}</span></div></div>
        ${canKick?`<button class="ddz-lob-kick" data-kick="${p.dbSeat}" title="请离">✕</button>`:''}
      </div>`;
    }
    function seatHTML(seat){
      if (st.phase==='lobby') return lobbySeatHTML(seat);
      const p = st.players[seat];
      const isLord = st.landlord === seat;
      const role = st.landlord==null ? '' : (isLord?'地主':'农民');
      const isWin = st.phase==='over' && st.result && st.result.winners.includes(seat);
      return `<div class="ddz-seat${st.turn===seat&&st.phase!=='over'?' turn':''}${isLord?' landlord':''}${isLord&&justCrowned?' just-crowned':''}${isWin?' win':''}" data-seat="${seat}" style="--p:360">
        <div class="ddz-avr"><div class="av">${avatars[seat]||'🤖'}</div><span class="ddz-sec"></span></div>
        <div class="meta">
          <div class="nm">${escapeHtml(p.name)}</div>
          <div class="cnt">剩 <b>${p.hand.length}</b> 张${role?` · <span class="role">${role}</span>`:''}</div>
          ${cumPill(seat)}
        </div>
        <div class="ddz-say"></div>
      </div>`;
    }
    function renderSeats(){
      els.opps.innerHTML = OPP_SEATS.map(seatHTML).join('');
      els.me.innerHTML = seatHTML(mySeat);
      if (st.phase==='lobby') bindLobbySeats();
      // 底牌:未定地主时盖着,定了亮出来。顶部居中 + "底牌"标(对标腾讯的中上底牌位)。
      els.bottom.innerHTML = '';
      const center = els.bottom.parentElement;
      if (center) center.classList.toggle('has-bottom', !!(st.bottom && st.bottom.length));
      if (st.bottom && st.bottom.length){
        els.bottom.className = 'ddz-bottom-cards' + (justCrowned ? ' reveal' : '');
        const lbl = document.createElement('div'); lbl.className='bc-lbl'; lbl.textContent='底牌';
        const row = document.createElement('div'); row.className='bc-row';
        st.bottom.forEach(c=>{
          row.appendChild(st.phase==='bid' ? cardBack(true) : cardEl(c,{mini:true}));
        });
        els.bottom.appendChild(lbl); els.bottom.appendChild(row);
      }
    }
    // ── 招募态: 空位点击邀请 / host 请离 ──
    function bindLobbySeats(){
      room.querySelectorAll('.ddz-lobby-empty[data-invite]').forEach(el=>{
        el.onclick=()=>openInviteMenu(+el.dataset.invite, el);
      });
      room.querySelectorAll('.ddz-lob-kick[data-kick]').forEach(b=>{
        b.onclick=(e)=>{ e.stopPropagation(); if(lobbyCtx&&lobbyCtx.actions&&lobbyCtx.actions.kick) lobbyCtx.actions.kick(+b.dataset.kick); };
      });
    }
    function _imAway(e){
      const m=room.querySelector('.ddz-invite-menu');
      if(m && !m.contains(e.target) && !(e.target.closest && e.target.closest('.ddz-lobby-empty'))) closeInviteMenu();
    }
    function closeInviteMenu(){ const m=room.querySelector('.ddz-invite-menu'); if(m) m.remove(); document.removeEventListener('click', _imAway, true); }
    function openInviteMenu(dbSeat, anchorEl){
      closeInviteMenu();
      if(!lobbyCtx || !lobbyCtx.actions){ return; }
      const souls = (lobbyCtx.souls||[]).filter(s=>s&&s.auth_uid);
      const menu=document.createElement('div'); menu.className='ddz-invite-menu';
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

    // ── 中央桌面:最后一手 + 落牌动画 + 轮次横幅 ──
    let lastShownKey = '';
    function playKey(){
      const lp = st.table.lastPlay;
      if (!lp) return st.table.passesInRow>0 ? ('pass:'+st.turn) : 'empty';
      return lp.seat + ':' + lp.cards.join(',');
    }
    function renderTable(){
      // 倍数条: 底分×桌面倍数(叫分×炸弹); 本地加倍局若我已选加倍, 追加"我×N"(加倍是按家独立系数, 无全局单一倍数)
      let multTxt = `底分 ${st.base||1} · ×${st.multiplier}`;
      const myF = (st.dbl && st.dbl.choices && st.dbl.choices[mySeat]) || 1;
      if (myF > 1) multTxt += ` · 我×${myF}`;
      els.mult.textContent = multTxt;
      if (counterOn) renderCounter();               // 记牌器开着时随桌面刷新未出张数/出牌历史
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
      layoutPlayed();                               // 大牌型(飞机带对/长顺~20 张)动态收紧, 免中央区横向溢出裁切
      if (changed){
        void els.played.offsetWidth;                // 强制回流, 让下一行的动画类重新触发
        els.played.classList.add('land');           // 牌堆延后淡入(等幽灵牌飞抵)
        flyPlayToCenter(lp.seat);                    // 从出牌人头像掷牌到桌心
        const nm = st.players[lp.seat].name;
        if (Rules.isBomb(lp.parse)){
          const rocket = lp.parse.type==='rocket';
          boom(rocket?'王 炸':'炸 弹');
          emitBeat({ type: rocket?'rocket':'bomb', actor:nm, big:true,
            text: `💥 ${nm} ${rocket?'放了王炸':'扔出炸弹'}！倍数 ×${st.multiplier}`,
            quip: beatQuip(lp.seat, rocket?'rocket':'bomb') });
        } else if (lp.seat!==mySeat) sfx('cardplay');   // 对手落牌拍击音(我自己出牌的音在 doPlay)
        sayPlay(lp.parse, lp.seat);                       // 语音报牌型(炸弹已含在报里, 顶替不了拍击音)
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
    // 摆放顺序: 恒按大小自动理牌(Deck.sortHand, 与引擎发牌同序)
    function handOrder(){
      const hand = st.players[mySeat].hand;
      return Deck.sortHand ? Deck.sortHand(hand) : hand;
    }
    let lastHandSig = '', lastSelSig = '';
    function renderHand(){
      const myTurn = st.phase==='play' && st.turn===mySeat && !(isGuest && awaitingHost);
      const order = handOrder();
      // 增量护栏: 手牌结构(id/回合锁/发牌帧)未变 → 不整段重建。
      //   省掉对家/AI 回合(每秒一次)重绘里的 innerHTML churn + layoutHand 强制回流;
      //   更关键: 我正涂抹选牌时若别家触发 renderAll, 不再把我脚下的手牌 DOM 拆了重建(打断连选)。
      const structSig = (myTurn?1:0)+'|'+(dealAnim?1:0)+'|'+order.map(c=>c.id).join(',');
      const selSig = [...selected].sort().join(',');
      if (structSig === lastHandSig){
        // 结构没变、只是选牌变了 → 只在既有牌上增删 .sel, 让升起/落下走 CSS transform 过渡(丝滑),
        // 不再整段重建 17~27 张 DOM(那会打断 .14s 过渡并强制回流 = 点牌卡顿的主因)。
        if (selSig !== lastSelSig){
          lastSelSig = selSig;
          const kids = els.hand.children;
          for (let i=0;i<kids.length;i++){ const el=kids[i]; el.classList.toggle('sel', selected.has(el.dataset.id)); }
        }
        return;
      }
      lastHandSig = structSig; lastSelSig = selSig;
      els.hand.className = 'ddz-hand' + (myTurn?'':' locked');
      els.hand.innerHTML = '';
      const deal = dealAnim; dealAnim = false;   // 只在发牌那一帧错峰入场, 之后普通重绘不动画
      order.forEach((card, idx)=>{
        const el = cardEl(card);
        el.dataset.id = card.id;
        el.dataset.idx = idx;               // 划选连选按 idx 补齐整段(见 paintTo)
        if (selected.has(card.id)) el.classList.add('sel');
        if (deal){ el.style.animationDelay = (idx*20)+'ms'; el.classList.add('justdealt'); }
        // 选牌统一走手牌区的指针涂抹(点=单选/拖=连选), 见下方 bindPaint(); 不再逐张挂 click
        els.hand.appendChild(el);
      });
      layoutHand();
    }
    // 手牌单排自适应: 牌多时(开局 17~20 张)动态收紧叠放, 永远吃满一行不换行不溢出屏幕。
    // 治斗地主原 CSS 固定 --hand-ov 叠放, 17 张在 390px 上两侧溢出、首尾牌跑到屏外点不到。
    function layoutHand(){
      if (root.EHTableOrient) root.EHTableOrient.reflect(room);  // 横屏态标记(open/resize/旋转都会过这里)
      const cards = els.hand.children;
      const n = cards.length; if (!n) return;
      const W = els.hand.clientWidth; if (!W) return;
      const cw = cards[0].offsetWidth || parseFloat(getComputedStyle(room).getPropertyValue('--cw')) || 44;
      let step = n>1 ? (W - cw) / (n - 1) : 0;
      step = Math.min(step, cw * 0.62);          // 上限: 牌少时不过度分散, 保留自然扇形
      const ov = Math.round(step - cw);          // 负外边距(叠放量)
      for (let i=0;i<n;i++){ cards[i].style.marginLeft = i===0 ? '0px' : ov+'px'; }
    }
    // 中央落牌区自适应: 飞机带对(4 连三+4 对=20 张)/长顺子在窄屏会超出屏宽两侧被裁。
    // 仅当整排全尺寸放不下时才按精确吃满宽收紧叠放(放得下则保持自然并排, 不动)。
    function layoutPlayed(){
      const cards = els.played.children;
      const n = cards.length; if (n<=1) return;
      const W = els.played.clientWidth; if (!W) return;
      const cw = cards[0].offsetWidth || 44;
      if (n*cw <= W) return;                       // 放得下: 不叠放
      const ov = Math.round((W - cw)/(n - 1) - cw);
      for (let i=1;i<n;i++) cards[i].style.marginLeft = ov+'px';
    }

    // 斗地主不设手动理牌(与掼蛋不同): 手牌少、发牌即按大小排好, 点选直接。renderHand 恒走 Deck.sortHand。

    // ── 轮次横幅 + 倒计时环 ──
    function setBanner(){
      const b = els.banner; const cp = connPill();
      if (st.phase==='over'){ b.className='ddz-turnbanner'; b.innerHTML=cp; return; }
      if (st.phase==='lobby'){ b.className='ddz-turnbanner'; b.innerHTML=cp+'🪑 招募中 · 点空位邀请，满意点「开始」'; return; }
      if (st.phase!=='bid' && st.phase!=='play' && st.phase!=='double'){ b.className='ddz-turnbanner'; b.innerHTML=cp+'⏳ 等待开局…'; return; }
      if (isGuest && awaitingHost){ b.className='ddz-turnbanner'; b.innerHTML=cp+'⏳ 已提交 · 等待裁决…'; return; }
      const seat = st.phase==='bid' ? st.bid.turn : (st.phase==='double' ? (st.dbl&&st.dbl.turn) : st.turn);
      const mine = seat===mySeat;
      const verb = st.phase==='bid' ? '叫分' : (st.phase==='double' ? '加倍' : '出牌');
      if (mine){
        b.className = 'ddz-turnbanner mine';
        b.innerHTML = cp + `🫵 轮到你${verb} <span class="clk" id="ddzClk"></span>`;
      } else {
        const thinking = st.phase==='bid'?'思考叫分':(st.phase==='double'?'斟酌加倍':'思考出牌');
        b.className = 'ddz-turnbanner';
        b.innerHTML = cp + `${escapeHtml(st.players[seat].name)} ${thinking}中… <span class="clk" id="ddzClk"></span>`;
      }
    }
    // 倒计时环:驱动当前活动座位的 conic 环 + 横幅秒数; 到点跑 onExpire(仅人类)
    function armTurn(onExpire){
      clearTimers();
      if (st.phase!=='bid' && st.phase!=='play' && st.phase!=='double') { turnSeatActive=-1; turnPhaseActive=''; return; }   // over/wait/lobby: 不武装倒计时
      const seat = st.phase==='bid' ? st.bid.turn : (st.phase==='double' ? (st.dbl&&st.dbl.turn) : st.turn);
      if (seat==null || seat<0) { turnSeatActive=-1; return; }
      const mine = seat===mySeat;
      if (isGuest && awaitingHost) return;   // guest 回传后等 host 裁决, 不跑倒计时
      if (mine && !lastMyTurn){ sfx('yourturn'); vibrate(18); }   // 刚轮到我: 提示音+震动(上升沿, 不每帧响)
      lastMyTurn = mine;
      // host 视角: 远程真人席给足宽限(REMOTE_TIMEOUT_MS), 到点由 onRemoteTimeout→aiStep 托管(与本人超时兜底同源)
      const remote = !isGuest && isRemote(seat);
      // 倒计时只在【回合真正切换】(座位或阶段变)时重置起点; 同一回合内的重渲染(收快照/说话/每帧重绘)保持原起点继续走
      //   —— 否则对手的环每次 renderAll 都被打回满格, 表现为"对方倒计时不动/乱跳"。
      const turnChanged = (seat!==turnSeatActive) || (st.phase!==turnPhaseActive);
      turnSeatActive = seat; turnPhaseActive = st.phase;
      if (turnChanged){
        // guest 端 remoteSeats 恒空(host-only), 对手会落到 AI-思考短时长→"1 秒跑完卡 0"; guest 无裁判职责,
        //   对手倒计时纯展示 → 给足人类时长, 视觉上正常走(真实超时判定在 host)。
        turnDur = mine ? ((st.phase==='bid'||st.phase==='double')?HUMAN_BID_MS:HUMAN_PLAY_MS)
                : isGuest ? HUMAN_PLAY_MS
                : remote ? REMOTE_TIMEOUT_MS
                : (AI_MIN_MS + Math.floor(secureRand()*AI_JIT_MS));
        turnStart = Date.now();
      }

      const seatEl = seatOf(seat);
      const clk = room.querySelector('#ddzClk');
      // 降频: rAF 每帧(~60fps)只在【整度数变化】时才写 --p(conic 环步进 1° ≈ 亚像素, 视觉等价),
      //   秒数也只在【整秒变化】时才写文本 —— 免掉每秒几十次无谓的 conic 重绘与 textContent 回流。
      let lastDeg=-1, lastSec=-1;
      const secEl = seatEl && seatEl.querySelector('.ddz-sec');   // 当前行动席(含对手)头像上的秒数徽标
      const tick = ()=>{
        const elapsed = Date.now() - turnStart;
        const remain = Math.max(0, turnDur - elapsed);
        const frac = turnDur ? (remain/turnDur) : 0;
        const deg = Math.round(frac*360);
        if (seatEl && deg!==lastDeg){ seatEl.style.setProperty('--p', deg); lastDeg=deg; }
        const sec = Math.ceil(remain/1000);
        if (sec!==lastSec){
          if (secEl){ secEl.textContent = sec; secEl.classList.toggle('urgent', sec<=5); }
          if (mine && clk){ clk.textContent = sec+'s'; clk.classList.toggle('urgent', sec<=5); }
          lastSec=sec;
        }
        if (remain<=0){
          ringRAF = null;
          if (mine && typeof onExpire==='function') onExpire();
          return;
        }
        ringRAF = requestAnimationFrame(tick);
      };
      // 折叠(minimized)态房 display:none, 环不可见 —— 不起 rAF 每帧对隐藏节点写 --p 空转耗电。
      //   我方超时 onExpire 折叠时本就为 null(离席不自动过牌/叫分); AI/远程席由下方 setTimeout 独立推进。
      if (!minimized) tick();

      // 定时驱动: 我(靠 onExpire)/guest(全等 host 快照, 不驱动任何席)/host 远程真人席(超时托管)/host 本机 AI 席。
      if (mine) return;
      if (isGuest) return;                                    // guest 只渲染, host 是唯一裁判
      const remainMs = Math.max(0, turnDur - (Date.now()-turnStart));   // 同回合重渲用剩余时间, 否则 AI/远程行动被反复推迟到永不触发
      if (remote) aiTimer = setTimeout(()=>onRemoteTimeout(seat), remainMs);
      else aiTimer = setTimeout(()=>aiStep(seat), remainMs);
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
    // 出牌掷向桌心: 从出牌人头像位置生成幽灵牌(最多 5 张扇形), 飞抵中央落牌区并淡出,
    //   与 .ddz-played.land 的延后淡入交叉 —— 纯展示层, 坐标相对 room 算, 挂 room 上避开 overflow 裁切。
    function flyPlayToCenter(seat){
      const sEl = seatOf(seat); const avr = sEl && sEl.querySelector('.ddz-avr');
      if (!room || !avr || !els.played) return;
      const lp = st.table.lastPlay;
      const cards = (lp && Array.isArray(lp.cards)) ? lp.cards.map(findCardById).filter(Boolean) : [];
      if (!cards.length) return;
      const rr = room.getBoundingClientRect(), fr = avr.getBoundingClientRect(), tr = els.played.getBoundingClientRect();
      const tx = tr.left - rr.left + tr.width/2, ty = tr.top - rr.top + tr.height/2;
      const n = Math.min(cards.length, 5);
      for (let i=0;i<n;i++){
        const g = cardEl(cards[i]); g.classList.add('ddz-fly-card');
        room.appendChild(g);
        const gw = g.offsetWidth||44, gh = g.offsetHeight||62;
        const sx = fr.left - rr.left + fr.width/2 - gw/2, sy = fr.top - rr.top + fr.height/2 - gh/2;
        g.style.left = sx+'px'; g.style.top = sy+'px'; g.style.opacity = '0';
        const spread = (i-(n-1)/2);
        const dx = tx - (sx+gw/2) + spread*11, dy = ty - (sy+gh/2), rot = spread*5;
        (function(g,dx,dy,rot,i){
          setTimeout(()=>{
            g.style.opacity = '1';
            requestAnimationFrame(()=>{ g.style.transform = `translate(${dx}px,${dy}px) scale(.94) rotate(${rot}deg)`; g.style.opacity = '.16'; });
            setTimeout(()=>{ try{ g.remove(); }catch(_){} }, 440);
          }, i*42);
        })(g,dx,dy,rot,i);
      }
    }

    // ── 控制区:叫地主 / 出牌 ──
    // 招募态操作区: 一键邀请(灵魂补位) / 邀真人 / 开始 ▶ —— 就在打牌页的操作按钮位置(主人要求)
    function renderLobbyCtrl(){
      if (!isHostLobby || !lobbyCtx || !lobbyCtx.actions){ els.ctrl.innerHTML=''; return; }
      const a = lobbyCtx.actions;
      const empties = st.players.filter(p=>p.kind==='empty').length;
      const hasSouls = ((lobbyCtx.souls||[]).length>0);
      const btns=[];
      // 「一键邀请」「邀真人」去掉(主人诉求): 空位可点座位邀灵魂/真人, 「开始」本就先补满灵魂再发牌, 两钮纯冗余。
      btns.push('<button class="ddz-btn primary" data-lob="start">开始 ▶</button>');
      els.ctrl.innerHTML = `<div class="ddz-acts ddz-lobacts">${btns.join('')}</div>`;
      const map={ fill:a.fillSouls, invite:a.inviteHumans, start:a.start };
      els.ctrl.querySelectorAll('[data-lob]').forEach(b=> b.onclick=()=>{ const f=map[b.dataset.lob]; if(typeof f==='function'){ closeInviteMenu(); f(); } });
    }
    function renderCtrl(){
      if (st.phase === 'lobby'){ renderLobbyCtrl(); return; }
      if (st.phase === 'bid'){
        // 别人叫分时也渲染按钮行(下面 renderBidBar 用 visibility:hidden 占位), 免得轮到我时凭空多一行→整桌上下跳
        const waiting = (isGuest && awaitingHost) ? '⏳ 已叫分 · 等待裁决…'
                      : (st.bid.turn !== mySeat) ? ('等待 ' + escapeHtml(st.players[st.bid.turn].name) + ' 叫分…')
                      : null;
        renderBidBar(waiting);
      } else if (st.phase === 'double'){
        renderDoubleBar();
      } else if (st.phase === 'play'){
        if (isGuest && awaitingHost){ els.ctrl.innerHTML = `<div class="ddz-acts"><button class="ddz-btn ghost" disabled>⏳ 等待裁决…</button></div>`; return; }
        renderActBar();
      } else {
        els.ctrl.innerHTML = '';
      }
    }
    // ── 加倍轮(仅本地单机): 不加倍 ×1 / 加倍 ×2 / 超级加倍 ×4。轮到别家时占位不空行(与叫分同构, 防整桌上下跳) ──
    function renderDoubleBar(){
      const myTurn = st.dbl && st.dbl.turn === mySeat;
      const iAmLord = mySeat === st.landlord;
      const opts2 = [ {f:1,t:'不加倍',c:''}, {f:2,t:'加倍 ×2',c:'primary'}, {f:4,t:'超级加倍 ×4',c:'danger'} ]
        .map(o=>`<button class="ddz-btn ${o.c}" data-dbl="${o.f}">${o.t}</button>`).join('');
      const who = (st.dbl && st.dbl.turn!=null && st.players[st.dbl.turn]) ? st.players[st.dbl.turn].name : '';
      const q = myTurn ? (iAmLord?'你是地主，要不要加倍下注？':'要不要给地主加点彩头？')
                       : ('等待 ' + escapeHtml(who) + ' 加倍…');
      els.ctrl.innerHTML = `<div class="ddz-bidbar"><div class="q">${q}</div><div class="ddz-bidbtns"${myTurn?'':' style="visibility:hidden"'}>${opts2}</div></div>`;
      if (myTurn) els.ctrl.querySelectorAll('[data-dbl]').forEach(b=>{
        b.addEventListener('click', ()=>doDouble(mySeat, +b.dataset.dbl));
      });
    }
    function renderBidBar(waitingMsg){
      const max = st.bid.max;
      const opts2 = [0,1,2,3].map(v=>{
        const label = v===0?'不叫':(v+'分');
        const dis = (v!==0 && v<=max) ? 'disabled':'';
        return `<button class="ddz-btn ${v===3?'primary':''}" data-bid="${v}" ${dis}>${label}</button>`;
      }).join('');
      const q = waitingMsg ? waitingMsg : `${max>0?('当前最高 '+max+' 分，'):''}要不要抢地主？`;
      els.ctrl.innerHTML = `<div class="ddz-bidbar"><div class="q">${q}</div><div class="ddz-bidbtns"${waitingMsg?' style="visibility:hidden"':''}>${opts2}</div></div>`;
      if (!waitingMsg) els.ctrl.querySelectorAll('[data-bid]').forEach(b=>{
        b.addEventListener('click', ()=>doCall(mySeat, +b.dataset.bid));
      });
    }
    // 提示用的残局上下文(报单意识): 只喂公开信息(座位/各家剩牌数/地主), 绝不含任何隐藏手牌 → 公平。
    function hintCtx(){ return { seat: mySeat, handsLeft: st.players.map(p=>p.hand.length), landlord: st.landlord, log: st.log }; }
    function renderActBar(){
      const myTurn = st.turn === mySeat;
      const mustBeat = st.table.lastPlay && st.table.lastPlay.seat !== mySeat;
      // 智能预判: 轮到我时先算可出的牌(best-first)。压不过=引导不出; 唯一打法=自动选好。
      let plays = [];
      if (myTurn){
        const target = mustBeat ? st.table.lastPlay.parse : null;
        plays = AI.hints(st.players[mySeat].hand, target, hintCtx());
      }
      const noBeat = myTurn && mustBeat && plays.length===0;
      els.ctrl.innerHTML = `<div class="ddz-acts">
        <button class="ddz-btn ${noBeat?'primary':'ghost'}" id="ddzPass" ${!myTurn||!mustBeat?'disabled':''}>${noBeat?'要不起':'不出'}</button>
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
    // 选牌牌型中文名(选牌即时反馈, 对标大厂"出 · 顺子"体验; 与掼蛋同源)
    function typeLabel(p){
      if(!p) return '';
      switch(p.type){
        case 'rocket': return '火箭';
        case 'single': return '单张';
        case 'pair': return '对子';
        case 'trio': return '三张';
        case 'trio_single': return '三带一';
        case 'trio_pair': return '三带二';
        case 'bomb': return '炸弹';
        case 'quad_single': return '四带二';
        case 'quad_pair': return '四带两对';
        case 'straight': return '顺子';
        case 'pairs': return '连对';
        case 'plane': return '飞机';
        case 'plane_single': return '飞机带单';
        case 'plane_pair': return '飞机带对';
        default: return '';
      }
    }
    const isBoomType = (p)=> !!p && (p.type==='bomb'||p.type==='rocket');
    // 语音报牌型(主人要求): 所有牌型都报——单张/对子/三张先前被跳过, 现补齐, 与三带二/炸弹等一致。
    const VOICE_SKIP = new Set();
    // 取某席"发言人"音色档: 灵魂用角色专属嗓(SOUL_VOICE 按名), 真人按名哈希稳定分配; 省略则退全局嗓
    function whoOf(seat){
      if(typeof seat!=='number' || !st.players[seat]) return null;
      const ai = !!(gameIsAI && gameIsAI[seat]);
      return { name: st.players[seat].name, key: st.players[seat].name, isSoul: ai, isHuman: !ai };
    }
    function sayPlay(p, seat){
      if(!p || VOICE_SKIP.has(p.type)) return;
      const lab = typeLabel(p);
      if(!(lab && root.EhSfx && root.EhSfx.say)) return;
      root.EhSfx.say(lab, whoOf(seat));
    }
    // 操作语音(叫分/不出等): 与报牌型同音色, 让每一步动作都出声。
    function sayOp(seat, text){ try{ if(text && root.EhSfx && root.EhSfx.say) root.EhSfx.say(text, whoOf(seat)); }catch(_){} }
    function updatePlayBtn(){
      const btn = $('#ddzPlay'); if (!btn) return;
      const cards = [...selected].map(findCardById);
      const p = cards.length ? Rules.parse(cards) : null;
      let okBtn = !!p && st.turn===mySeat;
      if (okBtn && st.table.lastPlay && st.table.lastPlay.seat!==mySeat)
        okBtn = Rules.beats(p, st.table.lastPlay.parse);
      btn.disabled = !okBtn;
      // 选牌实时牌型反馈: 合法则报牌型, 炸弹/火箭按钮变红发光(对标大厂"出·炸弹")
      const boom = okBtn && isBoomType(p);
      btn.classList.toggle('boom-ready', !!boom);
      if (okBtn){
        const lab = typeLabel(p);
        btn.innerHTML = boom ? `💥 出 <span class="bt">${lab}</span>` : `出牌 <span class="bt">${lab}</span>`;
      } else {
        btn.textContent = '出牌';
      }
    }

    // ── 智能补选: 选了搭子的一头, 自动把能成型的连张补齐 ─────────────
    //   选 4,5 → 补 6,7,8 成顺子; 选 44,55 → 补 66 成连对; 选 三张×2 → 补一组成飞机。
    //   规则: ①只在我方回合、增选手势后触发; ②只补不删; ③当前选区已是合法牌型(领出)
    //   或已能压过桌面(跟牌)就不动; ④选区须"同形"(全单/全对/全三)且点可连(不含2/王);
    //   ⑤领出向【上】扩(保留选区当低端, 契合"选4,5补6,7,8"); 跟牌补到能压过桌面的最低窗口;
    //   ⑥补出的必须过 Rules.parse 且(跟牌时)能 beats 桌面, 否则原样不动——绝不硬凑。
    //   返回 true 表示改了选区。复用引擎/规则判定, 不另造牌型逻辑。
    function autoExtendSelection(){
      if (st.phase!=='play' || st.turn!==mySeat) return false;
      const hand = (st.players[mySeat] && st.players[mySeat].hand) || [];
      const sel = [...selected].map(findCardById).filter(Boolean);
      if (sel.length < 2) return false;                       // 单张意图不明, 不猜
      const target = (st.table.lastPlay && st.table.lastPlay.seat!==mySeat) ? st.table.lastPlay.parse : null;
      const curP = Rules.parse(sel);
      // 选区同形校验
      const byR = new Map();
      for (const c of sel){ if(!byR.has(c.rank)) byR.set(c.rank,[]); byR.get(c.rank).push(c); }
      const ranks = [...byR.keys()].sort((a,b)=>a-b);
      if (ranks.some(r=>r>14)) return false;                  // 含 2/王 不能连
      const per = byR.get(ranks[0]).length;
      if (per<1 || per>3) return false;
      if (ranks.some(r=>byR.get(r).length!==per)) return false;
      const lo = ranks[0], hi = ranks[ranks.length-1];
      const multi = ranks.length >= 2;                        // 已跨≥2 点数 = 明显在建连张
      // 已成型且够用就不动 —— 但"在建连张(multi)且领出"要继续贪心补全(治六张顺子只选五张)
      if (curP && (target ? Rules.beats(curP, target) : !multi)) return false;
      // 手牌各点可用张数
      const handByR = new Map();
      for (const c of hand){ if(!handByR.has(c.rank)) handByR.set(c.rank,[]); handByR.get(c.rank).push(c); }
      const has = r => (r>=3 && r<=14 && handByR.has(r) && handByR.get(r).length>=per);
      for (let r=lo; r<=hi; r++) if(!has(r)) return false;    // 选区内空档手里得有牌
      // 目标长度(rank 段长)
      let needLen, windows=[], best=null;
      if (target){
        const tper = target.type==='straight'?1 : target.type==='pairs'?2
                   : (/^plane/.test(target.type)?3:0);
        if (!tper || tper!==per) return false;                // 跟牌只补同型连张
        needLen = target.type==='straight'?target.len
                : target.type==='pairs'?target.len/2
                : (target.type==='plane'?target.len/3:(target.type==='plane_single'?target.len/4:target.len/5));
        if (hi-lo+1 > needLen) return false;
        // 跟牌: 含[lo,hi]、末端>target.key 的最低窗口(s 升序取第一)
        for (let s=Math.max(3, hi-needLen+1); s<=lo; s++){ windows.push(s); }
        for (const s of windows){
          const e = s+needLen-1;
          if (e>14 || e<hi || s>lo) continue;
          let ok=true; for(let r=s;r<=e;r++) if(!has(r)){ ok=false; break; }
          if(!ok) continue;
          if (e<=target.key) continue;                        // 跟牌必须能压过
          best={s,e}; break;
        }
      } else {
        // 领出: 单点数(对/三)不擅自扩成连对; 已在建连张则向两端贪心扩到手里最长连续段
        if (!multi) return false;
        const minLen = per===1 ? 5 : per===2 ? 3 : 2;         // 顺子≥5 / 连对≥3 / 飞机·钢板≥2
        let s=lo, e=hi;
        while (has(s-1)) s--;                                 // 向低端吃满
        while (has(e+1)) e++;                                 // 向高端吃满
        if (e-s+1 >= minLen) best={s,e};                      // 连不成最短牌型就放弃
      }
      if (!best) return false;
      // 组装: 保留选区已选的具体牌, 缺的点从手里补 per 张
      const out=[];
      for (let r=best.s; r<=best.e; r++){
        const take = (byR.get(r)||[]).slice(0, per);
        if (take.length < per){
          for (const c of handByR.get(r)){ if(take.length>=per) break; if(!selected.has(c.id)) take.push(c); }
        }
        out.push(...take);
      }
      const p2 = Rules.parse(out);
      if (!p2) return false;
      if (target && !Rules.beats(p2, target)) return false;
      if (out.length === sel.length) return false;            // 没补进新牌
      selected = new Set(out.map(c=>c.id));
      return true;
    }

    // ── 动作 ──
    // 叫分→印章参数: prevMax>0 时的正叫是"抢", 首个正叫是"叫", 0 分是"不叫/不抢"
    function bidVisual(seat, val, prevMax){
      if (val>0){ const rob = prevMax>0;
        bidStamp(seat, rob?'rob':'call', (rob?'抢 ':'叫 ')+val+'分'); say(seat, val+'分！'); sayOp(seat, (rob?'抢':'叫')+val+'分'); }
      else { const t=prevMax>0?'不抢':'不叫'; bidStamp(seat, 'pass', t); say(seat, t); sayOp(seat, t); }
    }
    function doCall(seat, val){
      const prevMax = (st.bid && st.bid.max) || 0;
      if (isGuest){   // guest 只能替自己叫分, 回传给 host 裁决
        if (seat!==mySeat || awaitingHost) return;
        if (onAction) onAction({ action:'call', val });
        bidVisual(seat, val, prevMax); awaitingHost=true;
        setBanner(); renderCtrl(); toast('已叫分…'); return;
      }
      try { var r = Engine.applyCall(st, seat, val); }
      catch(e){ toast('不能这样叫'); return; }
      if (r && r.redeal){ toast('都不叫，重新发牌'); st = Engine.createGame({isAI:gameIsAI,names,doubling:DOUBLING}); dealNo++; selected.clear(); dealAnim=true; lastLord=null; lastMyTurn=false; sfx('deal'); renderAll(); return; }
      renderAll();
      bidVisual(seat, val, prevMax);   // 印章画在重绘后的座位上, 不被 renderSeats 清掉
    }
    // ── 加倍(仅本地单机: 定地主后 double 阶段, 各家 不加倍×1 / 加倍×2 / 超级加倍×4) ──
    function doDouble(seat, factor){
      try { var r = Engine.applyDouble(st, seat, factor); }
      catch(e){ toast('现在不能加倍'); return; }
      // 印章 + 台词: 复用叫分那套视觉锚点(印章画在重绘后的座位上)
      renderAll();
      const lbl = factor===4 ? '超级加倍' : (factor===2 ? '加倍' : '不加倍');
      bidStamp(seat, factor>1?'rob':'pass', lbl);
      say(seat, lbl+'！'); sayOp(seat, lbl);
      if (factor>1) sfx('landlord'); else sfx('pass');
      if (r && r.doubleDone){ sfx('deal'); }   // 加倍轮收尾, 进入出牌
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
        sfx('pass'); say(seat,'不出'); sayOp(seat,'不出'); awaitingHost=true;
        selected.clear(); hintCycle=[];   // 不出即把选中的牌收回(放下高亮), 与 doPlay 一致
        setBanner(); renderCtrl(); renderHand(); return;
      }
      try { Engine.applyPass(st, seat); } catch(e){ toast('现在不能不出'); return; }
      if (seat===mySeat){ sfx('pass'); selected.clear(); hintCycle=[]; }   // 我不出 → 收回选中的牌
      say(seat,'不出'); sayOp(seat,'不出');
      renderAll();
    }
    function doHint(){
      const hand = st.players[mySeat].hand;
      const target = (st.table.lastPlay && st.table.lastPlay.seat!==mySeat) ? st.table.lastPlay.parse : null;
      // 循环提示:多套可出方案轮着给, 再点一次换一套。best-first: 能一把走完排最前,
      // 领出走长牌型垫单张, 跟牌走最小代价、炸弹垫底(剩一对提示打整对而非拆单张)。
      if (!hintCycle.length){
        hintCycle = AI.hints(hand, target, hintCtx());
        hintIdx = 0;
      }
      if (!hintCycle.length){ toast('没有能压的牌，只能不出'); return; }
      const pick = hintCycle[hintIdx % hintCycle.length]; hintIdx++;
      selected = new Set(pick.map(c=>c.id));
      renderHand(); updatePlayBtn(); popHint();
    }
    // 提示后让被选中的牌重放一次弹跳(即便 renderHand 因签名未变跳过重建也强制触发)
    function popHint(){
      requestAnimationFrame(()=>{
        els.hand && els.hand.querySelectorAll('.card.sel').forEach(el=>{
          el.classList.remove('hintpop'); void el.offsetWidth; el.classList.add('hintpop');
        });
      });
    }

    // ── AI 回合 ──
    function aiStep(seat){
      if (st.phase === 'bid'){
        if (st.bid.turn !== seat) return;
        doCall(seat, AI.chooseBid(st.players[seat].hand, st.bid.max));
        return;
      }
      if (st.phase === 'double'){
        if (!st.dbl || st.dbl.turn !== seat) return;
        doDouble(seat, AI.chooseDouble(st.players[seat].hand, seat===st.landlord));
        return;
      }
      if (st.phase !== 'play' || st.turn !== seat) return;
      const target = (st.table.lastPlay && st.table.lastPlay.seat!==seat) ? st.table.lastPlay.parse : null;
      const mv = AI.decide({ seat, hand: st.players[seat].hand, tableParse: target,
        lastSeat: st.table.lastPlay ? st.table.lastPlay.seat : null,
        handsLeft: st.players.map(p=>p.hand.length), landlord: st.landlord, iAmLandlord: seat===st.landlord, log: st.log });
      if (mv.action === 'pass'){ doPass(seat); return; }
      try { var r = Engine.applyPlay(st, seat, mv.cards); }
      catch(e){ doPass(seat); return; }   // AI 兜底:决策失误就过
      renderAll();
      maybeBanter(seat);   // 先重绘再说话: 气泡若在 renderSeats 之前加会被整段重建吞掉
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
      if (st.phase==='double' && st.dbl && st.dbl.turn===mySeat){ toast('超时 · 自动不加倍'); doDouble(mySeat, 1); return; }
      if (st.phase==='play' && st.turn===mySeat){
        const mustBeat = st.table.lastPlay && st.table.lastPlay.seat!==mySeat;
        if (mustBeat){ toast('超时 · 自动不出'); doPass(mySeat); return; }
        // 领出必须出牌:托管出最小合法牌(用 AI 决策)
        const mv = AI.decide({ seat:mySeat, hand:st.players[mySeat].hand, tableParse:null,
          handsLeft: st.players.map(p=>p.hand.length), landlord: st.landlord, iAmLandlord: mySeat===st.landlord, log: st.log });
        if (mv.action==='play'){ toast('超时 · 自动出牌'); selected=new Set(mv.cards.map(c=>c.id)); doPlay(); }
      }
    }

    // ── 结算浮层 ──
    function showOver(){
      if (showOver._done) return; showOver._done = true;   // 幂等: guest 会连收多张 over 快照, 只弹一次
      clearTimers();
      const res = st.result;
      if (!res) { showOver._done = false; return; }
      // 本桌累计: 每手只计一次(res._scored 守卫, guest 连收多张 over 快照也只加一次); 放在幂等 _done 通过之后
      if (res && !res._scored){ res._scored = true; st.players.forEach(p=>{ cumScore[p.seat] += (res.delta[p.seat]||0); }); saveScore(); }   // delta 是 {seat→分} 对象非数组, 按座位号累加; 存本桌累计防重进清零
      try{ renderSeats(); }catch(_){}   // 累计刷新: 结算面板揭起前先更新底层座位徽标(下一局 renderAll 也会再刷)
      const iWon = res.winners.includes(mySeat);
      const over = document.createElement('div');
      over.className = 'ddz-over ' + (iWon?'win':'lose');
      const roleTxt = st.landlord===mySeat ? '地主' : '农民';
      // 加倍摘要(仅本地加倍局有 doubles 且有人 >1): 列出各家加倍系数, 让玩家看懂账变为何被放大
      const dbls = res.doubles || {};
      const anyDbl = Object.keys(dbls).some(k=>dbls[k]>1);
      const dblTxt = anyDbl ? ('<br>加倍 · ' + st.players.map(p=>{
        const f = dbls[p.seat]||1; return `${escapeHtml(p.name)}${p.seat===st.landlord?'(地主)':''}×${f}`;
      }).join(' ')) : '';
      // 本桌累计块: 逐席列名字(含地主标)+ 累计分, 正分暖色 / 负分品红
      const cumBox = `<div class="ddz-cumbox"><div class="cum-ttl">本桌累计</div>${
        st.players.map(p=>{
          const v = cumScore[p.seat]||0;
          const cls = v>0?'pos':(v<0?'neg':'zero');
          const isL = st.landlord===p.seat;
          return `<div class="cum-row"><span class="cum-nm">${escapeHtml(p.name)}${p.seat===mySeat?'（你）':''}${isL?' <span class="cum-role">地主</span>':''}</span><span class="cum-v ${cls}">${v>0?'+':''}${v} 分</span></div>`;
        }).join('')
      }</div>`;
      over.innerHTML = `
        <div class="ddz-over-card">
          <h2>${iWon?'🎉 胜利':'😵 失败'}</h2>
          <div class="sub">你是${roleTxt} · ${res.landlordWon?'地主赢':'农民赢'}${res.spring?' · 春天翻倍':''}<br>底分 ${res.base} × 倍数 ${res.finalMultiplier}${res.bombs?(' · '+res.bombs+' 炸'):''}${dblTxt}</div>
          <div class="ddz-remains" id="ddzRemains"></div>
          <div class="score">${(res.delta[mySeat]>=0?'+':'')}${res.delta[mySeat]} 分</div>
          ${cumBox}
          <div class="ddz-acts">
            <button class="ddz-btn primary" id="ddzAgain">再来一局</button>
            <button class="ddz-btn ghost" id="ddzDone">收工</button>
          </div>
        </div>`;
      room.appendChild(over);
      // 残局:亮出仍有剩牌的席位(赢家已出完 → 不列)。对标腾讯斗地主终局亮残牌, 让人看清对手"卡"在什么牌上。
      const remainBox = over.querySelector('#ddzRemains');
      if (remainBox){
        const reveal = res.reveal || {};
        const seats = st.players.map(p=>p.seat).filter(s => (reveal[s]||[]).length > 0);
        if (!seats.length){ remainBox.remove(); }
        else seats.forEach((s, ri)=>{
          const p = st.players[s];
          const roleS = st.landlord==null ? '' : (st.landlord===s?'地主':'农民');
          const row = document.createElement('div'); row.className='rm-row'; row.style.setProperty('--i', ri);
          const nm = document.createElement('div'); nm.className='rm-nm';
          nm.innerHTML = `${escapeHtml(p.name)}${s===mySeat?'（你）':''}${roleS?` <span class="rm-role">${roleS}</span>`:''} <span class="rm-n">剩${reveal[s].length}</span>`;
          const cards = document.createElement('div'); cards.className='rm-cards';
          const objs = (reveal[s]||[]).map(findCardById).filter(Boolean);
          if (objs.length > 18) cards.classList.add('dense');
          (Deck.sortHand ? Deck.sortHand(objs) : objs).forEach(c=> cards.appendChild(cardEl(c,{mini:true})));
          row.appendChild(nm); row.appendChild(cards); remainBox.appendChild(row);
        });
      }
      if (iWon){ sfx('sparkle'); setTimeout(()=>sfx(res.spring?'spring':'bloom'), 220); vibrate([20,60,30,60,40]); confetti(); }
      else { sfx('void'); vibrate(120); }
      // guest 无权开新一局: 由 host 驱动, 下一副快照到达时 applySnapshot 自动清掉本战报; 只留"收工"
      const againBtn = over.querySelector('#ddzAgain');
      const clearAgainTimer = ()=>{ if (over._againTimer){ clearInterval(over._againTimer); over._againTimer=null; } };
      if (isGuest){ againBtn.textContent='等房主开局…'; againBtn.disabled=true; }
      else {
        const startRematch = ()=>{
          if (over._leaving) return; over._leaving = true;   // 防连点
          clearAgainTimer();
          // 丝滑过渡(对标腾讯): 结算面板先淡出下沉 ~.34s, 再拆掉重建新局 → 顺势接发牌入场动画, 不再"啪"地跳切。
          showOver._done=false;
          over.classList.add('out');
          const go = ()=>{ over.remove(); st = Engine.createGame({isAI:gameIsAI,names,doubling:DOUBLING}); dealNo++; selected.clear(); hintCycle=[]; lastShownKey=''; dealAnim=true; lastLord=null; lastMyTurn=false; sfx('deal'); broadcast(); renderAll(); };
          let done=false; const once=()=>{ if(done) return; done=true; go(); };
          over.addEventListener('animationend', once, { once:true });
          setTimeout(once, 420);   // 动画事件兜底(被打断/不触发时仍推进)
        };
        againBtn.addEventListener('click', startRematch);
        // ★默认再来一局(主人要求): 战报页把"再来一局"设为高亮主按钮(默认落点), 但不自动倒计时——
        //   由主人手动点"再来一局"或"收工", 不再读秒自动开新局。
      }
      over.querySelector('#ddzDone').addEventListener('click', ()=>{ clearAgainTimer(); close(); });
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
        justCrowned = true;   // 本次重绘给地主席加皇冠砸落 + 底牌翻面动画
        toast(`👑 ${nm} 当地主 · ${st.multiplier} 倍`);
        emitBeat({ type:'landlord', actor:nm, big:true, text:`🎪 ${nm} 抢到地主 · ${st.multiplier} 倍起` });
      }
      lastLord = st.landlord;
      renderSeats(); renderTable(); renderHand(); setBanner(); renderCtrl();
      justCrowned = false;
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
        dealAnim=true; selected.clear(); hintCycle=[];
        lastShownKey=''; lastMyTurn=false; lastLord=null; showOver._done=false;
        const ov=room.querySelector('.ddz-over'); if(ov) ov.remove();
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

    // ── 招募态实时刷新: 座位随 realtime 变(灵魂入座/真人加入/请离) → 重建 lobby 局面重绘 ──
    function setLobby(seats, ctx){
      if (st.phase!=='lobby') return;
      if (ctx) lobbyCtx = ctx;
      if (Array.isArray(seats)) lobbySeats = seats;
      st = lobbyState(lobbySeats);
      renderSeats(); setBanner(); renderCtrl();
      if (minimized) updateChip();
    }
    // ── 开始发牌(deal-in-place): 招募态 → 用最新名册就地建真局, 同一个 room 不重挂(免二次入场淡入) ──
    function startDeal(A, seed){
      if (A){
        if (Array.isArray(A.names)) names = A.names;
        if (Array.isArray(A.avatars)) avatars = A.avatars;
        if (Array.isArray(A.isAI)) gameIsAI = A.isAI;
        if (Array.isArray(A.remoteSeats)) remoteSeats = A.remoteSeats;
      }
      closeInviteMenu();
      selected.clear(); hintCycle=[]; hintIdx=0; lastShownKey=''; dealAnim=true;
      lastLord=null; lastMyTurn=false; justCrowned=false; showOver._done=false;
      st = Engine.createGame({ isAI: gameIsAI, names, seed: (typeof seed!=='undefined' ? seed : opts.seed) });
      sfx('deal');
      renderAll();
      broadcast();   // 首帧脱敏快照(此刻 hostChan 已接好, 见 app.gtStart)
    }
    // 开局
    renderAll();
    if (!isGuest && !lobbyMode) broadcast();   // host: 开局首帧即广播脱敏快照(招募态无局可播)
    return { close, minimize, restore, isMinimized:()=>minimized, state:()=>st, mySeat:()=>mySeat,
      applyMove, setConn, connState:()=>connState,
      onSnapshot: applySnapshot, feedHand, resync: broadcast, isGuest:()=>isGuest,
      isLobby:()=>st.phase==='lobby', setLobby, startDeal,
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
