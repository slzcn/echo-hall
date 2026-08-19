// ============================================================
// guandan-ui.js — 掼蛋牌桌 UI（入室牌桌 · 4 席 2 队 · 级牌/百搭 · 进贡 · 接风 · AI 陪玩）
// ------------------------------------------------------------
// 依赖(浏览器全局): EHDeck / EHGuandanRules / EHGuandanEngine / EHGuandanAI
// 对外: window.EHGuandanGame.open({ names, avatars, onResult })
//   · 纯前端单人 vs 3 个 AI(对家=队友)。引擎跑浏览器, 三家 AI 定时器驱动。
//   · 牌桌挂进 #hall 内(入室牌桌, 非全屏浮层): 房间"变成"牌桌, 返回即回聊天。
//   · 每回合倒计时环, 到点自动过/自动出(断线托管同一兜底)。
//   · 落牌飞入动画 + 当前席高亮环 + 中央横幅; 炸弹震屏; 胜利彩带。
//   · 级牌抬权/红桃级牌逢人配全程可视(级牌描金边, 百搭标"配")。
//   · 一副打完带名次(头游/二游/三游/末游)与升级; 再来一局延续对局(进贡/升级)。
//   · 尺寸走 CSS 变量, 小屏默认大屏放大 → 终端自适应。
//   · onResult(result, log, meta) 交给聊天室写战绩 + 播报。
// 无网络; 真人房版本另接 Edge, 复用同一引擎与本 UI。
// ============================================================
(function(root){
  'use strict';
  const Deck = root.EHDeck, Rules = root.EHGuandanRules, Engine = root.EHGuandanEngine, AI = root.EHGuandanAI;

  const HUMAN_PLAY_MS = 22000;
  const AI_MIN_MS = 750, AI_JIT_MS = 600;

  const CSS_ID = 'gd-ui-css';
  function injectCSS(){
    if (document.getElementById(CSS_ID)) return;
    const s = document.createElement('style'); s.id = CSS_ID;
    s.textContent = `
.gd-room{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;overflow:hidden;
  background:linear-gradient(180deg,var(--bg2,#0d1524),var(--bg,#070a12));border-radius:inherit;
  animation:gdRoomIn .22s cubic-bezier(.2,.9,.3,1);
  --cw:38px;--ch:54px;--cn:13px;--cs:11px;--cc:21px;--cmw:22px;--cmh:32px;
  --av:42px;--avf:19px;--seatw:74px;--hand-ov:-25px;--hand-pad:16px;--banner:13px;--maxw:none}
@media (min-width:600px) and (min-height:620px){
  .gd-room{--cw:44px;--ch:62px;--cn:15px;--cs:12px;--cc:25px;--cmw:26px;--cmh:37px;
    --av:50px;--avf:23px;--seatw:100px;--hand-ov:-18px;--hand-pad:22px;--banner:15px;--maxw:640px}}
@media (min-width:900px) and (min-height:700px){
  .gd-room{--cw:52px;--ch:73px;--cn:18px;--cs:13px;--cc:30px;--cmw:30px;--cmh:43px;
    --av:62px;--avf:28px;--seatw:124px;--hand-ov:-16px;--hand-pad:28px;--banner:17px;--maxw:820px}}
/* 大屏(平板横屏/桌面): 元素进一步放大, 中央牌桌收束不空旷, 操作区更饱满 */
@media (min-width:1000px) and (min-height:760px){
  .gd-room{--cw:60px;--ch:84px;--cn:21px;--cs:15px;--cc:35px;--cmw:34px;--cmh:48px;
    --av:82px;--avf:38px;--seatw:150px;--hand-ov:-12px;--hand-pad:30px;--banner:20px;--maxw:860px}
  .gd-mid{max-height:440px}                              /* 收束中央牌桌高度, 不让空椭圆撑满竖屏 */
  .gd-felt{justify-content:center}                        /* 牌桌整体在多余竖向空间里居中, 上下留白对称 */
  .gd-partner{padding-top:14px}
  .gd-seat .nm{font-size:13px}
  .gd-seat .cnt{font-size:13px}
  .gd-banner{min-height:26px}
  .gd-banner.mine{font-size:20px}
  .gd-played{min-height:96px}
  .gd-me .gd-avr{width:46px;height:46px}
  .gd-me .gd-avr .av{font-size:22px}
  .gd-btn{padding:14px 0;font-size:17px;max-width:150px;border-radius:14px}
  .gd-acts{gap:14px;padding-top:12px}}
/* 竖屏平板等"窄而高"屏: 宽度够不到大屏断点, 但高屏空间大 → 元素放大 + 收束中央牌桌并居中 */
@media (min-width:600px) and (max-width:999px) and (min-height:900px){
  .gd-room{--cw:56px;--ch:78px;--cn:20px;--cs:14px;--cc:33px;--cmw:32px;--cmh:45px;
    --av:74px;--avf:34px;--seatw:140px;--hand-ov:-14px;--hand-pad:28px;--banner:18px;--maxw:760px}
  .gd-mid{max-height:420px}
  .gd-felt{justify-content:center}
  .gd-partner{padding-top:12px}
  .gd-seat .nm{font-size:13px}
  .gd-seat .cnt{font-size:13px}
  .gd-banner.mine{font-size:19px}
  .gd-btn{padding:14px 0;font-size:17px;max-width:150px;border-radius:14px}
  .gd-acts{gap:14px}}
@keyframes gdRoomIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.gd-bar{display:flex;align-items:center;gap:10px;flex-shrink:0;border-bottom:1px solid var(--line,rgba(0,229,212,.24));
  padding:calc(11px + env(safe-area-inset-top,0px)) max(15px,env(safe-area-inset-right,0px)) 11px max(15px,env(safe-area-inset-left,0px))}
.gd-title{font-weight:800;letter-spacing:.06em;color:var(--ink,#eaf6ff);font-size:15px;display:flex;align-items:center;gap:8px}
.gd-title .dot{width:8px;height:8px;border-radius:50%;background:var(--accent,#00e5d4);box-shadow:var(--glow-cyan)}
.gd-lvl{font-size:12px;color:var(--amber,#ffc24d);font-weight:700;padding:2px 9px;border:1px solid var(--line);border-radius:999px;white-space:nowrap}
.gd-lvl b{color:#fff}
.gd-mus{margin-left:auto;width:30px;height:30px;border-radius:50%;border:1px solid var(--line);background:transparent;
  color:var(--sub,#86cbc6);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.gd-mus:hover{color:var(--ink);border-color:var(--line2)}
.gd-mus.muted{color:var(--dim,#498d88);opacity:.75}
.gd-x{height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:transparent;
  color:var(--sub,#86cbc6);font-size:13px;cursor:pointer;display:flex;align-items:center;gap:5px;flex-shrink:0}
.gd-x:hover{color:var(--ink);border-color:var(--line2)}
.gd-felt{flex:1;position:relative;display:flex;flex-direction:column;min-height:0;max-width:var(--maxw,none);width:100%;margin:0 auto;box-sizing:border-box}
.gd-felt.shake{animation:gdShake .42s cubic-bezier(.36,.07,.19,.97)}
@keyframes gdShake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(2px)}30%,50%,70%{transform:translateX(-4px)}40%,60%{transform:translateX(4px)}}
.gd-partner{display:flex;justify-content:center;padding:8px 8px 0}
.gd-mid{flex:1;display:flex;align-items:stretch;min-height:0}
.gd-side{display:flex;flex-direction:column;justify-content:center;align-items:center;padding:0 4px;flex:none}
.gd-center{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:2px 6px;min-height:110px;position:relative;isolation:isolate}
.gd-center::before{content:'';position:absolute;left:2%;right:2%;top:8%;bottom:8%;border-radius:50%/42%;
  background:radial-gradient(ellipse at center,rgba(0,229,212,.07),rgba(0,229,212,.02) 55%,transparent 72%);
  border:1px solid rgba(0,229,212,.07);z-index:-1;pointer-events:none}
/* 座位 */
.gd-seat{display:flex;flex-direction:column;align-items:center;gap:2px;width:var(--seatw,82px);position:relative}
.gd-avr{width:var(--av,42px);height:var(--av,42px);border-radius:50%;display:grid;place-items:center;padding:3px;box-sizing:border-box;background:transparent;transition:background .15s}
.gd-seat.turn .gd-avr{background:conic-gradient(from -90deg,var(--accent,#00e5d4) calc(var(--p,360)*1deg),var(--line,rgba(0,229,212,.18)) 0)}
.gd-avr .av{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:var(--avf,19px);background:var(--panel-solid,#132a29);border:1.5px solid var(--line2);position:relative}
.gd-seat.turn .gd-avr .av{box-shadow:0 0 14px var(--accent,rgba(0,229,212,.6))}
.gd-seat.mate .gd-avr .av{border-color:var(--accent)}
.gd-seat .nm{font-size:11px;color:var(--sub);max-width:var(--seatw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gd-seat.turn .nm{color:var(--accent);font-weight:700}
.gd-seat .cnt{font-size:11px;color:var(--dim,#498d88);font-variant-numeric:tabular-nums}
.gd-seat .cnt b{color:var(--ink)}
.gd-tags{display:flex;gap:3px;flex-wrap:wrap;justify-content:center}
.gd-tag{font-size:9px;letter-spacing:.06em;padding:0 5px;border-radius:6px;border:1px solid var(--line);color:var(--dim)}
.gd-tag.mate{color:var(--accent);border-color:var(--accent)}
.gd-tag.rank{color:var(--amber);border-color:var(--amber);font-weight:700}
.gd-tag.alarm{color:var(--magenta,#ff2d8e);border-color:var(--magenta,#ff2d8e);font-weight:800;animation:gdBlink .7s steps(2,start) infinite}
.gd-seat.alarm .cnt b{color:var(--magenta,#ff2d8e)}
.gd-seat.alarm .gd-avr .av{border-color:var(--magenta,#ff2d8e);box-shadow:0 0 10px rgba(255,45,142,.5)}
.gd-say{position:absolute;top:48px;font-size:11px;color:var(--ink);background:var(--panel-solid,#132a29);border:1px solid var(--line);border-radius:10px;padding:3px 8px;max-width:130px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:4}
.gd-say.show{opacity:1}
.gd-mini-hand{display:flex;margin-top:3px}
.gd-mini-hand .card.mini{margin-left:-16px}.gd-mini-hand .card.mini:first-child{margin-left:0}
/* 中央 */
.gd-banner{font-size:var(--banner,13px);letter-spacing:.05em;color:var(--sub);min-height:18px;display:flex;align-items:center;gap:6px;transition:.15s;text-align:center}
.gd-banner.mine{color:var(--accent);font-weight:800;font-size:15px;text-shadow:var(--glow-cyan)}
.gd-banner .clk{font-variant-numeric:tabular-nums;color:var(--amber);font-weight:800}
.gd-banner .clk.urgent{color:var(--magenta,#ff2d8e);animation:gdBlink .6s steps(2,start) infinite}
@keyframes gdBlink{50%{opacity:.35}}
.gd-who{font-size:11px;color:var(--sub);min-height:14px}
.gd-played{display:flex;flex-wrap:wrap;gap:0;min-height:60px;align-items:center;justify-content:center;max-width:100%}
.gd-played.fly-top{animation:gdFlyTop .28s cubic-bezier(.2,.9,.3,1)}
.gd-played.fly-bot{animation:gdFlyBot .28s cubic-bezier(.2,.9,.3,1)}
@keyframes gdFlyTop{from{transform:translateY(-46px) scale(.78);opacity:0}to{transform:none;opacity:1}}
@keyframes gdFlyBot{from{transform:translateY(48px) scale(.78);opacity:0}to{transform:none;opacity:1}}
.gd-played .card{margin-left:-18px}.gd-played .card:first-child{margin-left:0}
.gd-passtag{color:var(--dim);font-size:13px;letter-spacing:.14em;border:1px dashed var(--line);border-radius:10px;padding:5px 14px;animation:gdFlyTop .22s}
.gd-boom{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);font-size:38px;font-weight:900;letter-spacing:.05em;color:var(--magenta,#ff2d8e);text-shadow:var(--glow-mag);pointer-events:none;z-index:6;animation:gdBoom .7s ease-out forwards}
@keyframes gdBoom{0%{transform:translate(-50%,-50%) scale(.3);opacity:0}25%{transform:translate(-50%,-50%) scale(1.15);opacity:1}100%{transform:translate(-50%,-50%) scale(1.4);opacity:0}}
.gd-flash{position:absolute;inset:0;z-index:5;pointer-events:none;border-radius:inherit;
  background:radial-gradient(ellipse at center,rgba(255,45,142,.3),rgba(255,45,142,.07) 45%,transparent 70%);animation:gdFlash .5s ease-out forwards}
@keyframes gdFlash{0%{opacity:0}12%{opacity:1}100%{opacity:0}}
/* 进贡横幅 */
.gd-tribute{position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:7;display:flex;flex-direction:column;gap:4px;align-items:center;
  background:var(--panel-solid,#132a29);border:1px solid var(--amber,#ffc24d);border-radius:12px;padding:7px 14px;max-width:88%;
  box-shadow:0 4px 18px rgba(0,0,0,.4);animation:gdRoomIn .25s}
.gd-tribute .th{font-size:12px;font-weight:800;color:var(--amber);letter-spacing:.08em}
.gd-tribute .tl{font-size:11px;color:var(--sub);display:flex;align-items:center;gap:5px;flex-wrap:wrap;justify-content:center}
/* 卡牌 */
.card{width:var(--cw,38px);height:var(--ch,54px);border-radius:6px;background:#fff;position:relative;flex:none;
  box-shadow:0 2px 5px rgba(0,0,0,.35);border:1px solid rgba(0,0,0,.08);user-select:none;font-family:"SF Pro Rounded","SF Pro Display",-apple-system,"PingFang SC","Helvetica Neue",Arial,sans-serif}
.card.red{color:#e0263e}.card.blk{color:#1a1e28}
.card .cn{position:absolute;top:2px;left:3px;font-size:var(--cn,13px);font-weight:800;line-height:1}
.card .cs{position:absolute;top:16px;left:4px;font-size:var(--cs,11px);line-height:1}
.card .cc{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:var(--cc,21px);opacity:.92}
.card.joker .cc{font-size:calc(var(--cc,21px) * .72)}
.card.joker.big{background:linear-gradient(150deg,#fff,#ffe9b8)}
.card.joker.small{background:linear-gradient(150deg,#fff,#e8ecff)}
.card.lvl{box-shadow:0 2px 5px rgba(0,0,0,.35),0 0 0 2px var(--amber,#ffc24d)}
.card.wild{box-shadow:0 2px 8px rgba(255,45,142,.5),0 0 0 2px var(--magenta,#ff2d8e)}
.card .wbadge{position:absolute;bottom:1px;right:2px;font-size:9px;font-weight:800;color:var(--magenta,#ff2d8e);background:rgba(255,255,255,.85);border-radius:4px;padding:0 2px;line-height:1.2}
.card.back{background:radial-gradient(circle at 30% 22%,rgba(0,229,212,.18),transparent 55%),radial-gradient(circle at 74% 76%,rgba(156,133,255,.16),transparent 60%),linear-gradient(150deg,#182742 0%,#0f1a2c 45%,#0a1220 100%);border:1px solid rgba(0,229,212,.28);box-shadow:inset 0 0 0 1px rgba(255,255,255,.04),inset 0 6px 12px rgba(0,0,0,.35),0 2px 6px rgba(0,0,0,.45)}
.card.mini{width:var(--cmw,22px);height:var(--cmh,32px)}.card.mini .cn{font-size:9px}.card.mini .cs{font-size:7px;top:11px}.card.mini .cc{font-size:12px}
/* 我的座位 */
.gd-me{display:flex;align-items:center;gap:9px;padding:3px 14px 0}
.gd-me .gd-seat{flex-direction:row;width:auto;gap:8px}
.gd-me .gd-avr{width:36px;height:36px;padding:2.5px}
.gd-me .gd-avr .av{font-size:17px}
.gd-me .meta{display:flex;flex-direction:column;align-items:flex-start;gap:1px}
/* 手牌 */
.gd-hand-wrap{padding:2px 8px 4px;border-top:1px solid var(--line);background:linear-gradient(180deg,transparent,rgba(0,0,0,.18))}
.gd-hand{display:flex;justify-content:center;flex-wrap:nowrap;padding:var(--hand-pad,16px) 0 4px;min-height:0;touch-action:none}
.gd-hand .card{margin-left:var(--hand-ov,-19px);transition:transform .14s ease,box-shadow .14s;cursor:pointer;transform-origin:bottom center;margin-bottom:4px}
.gd-hand .card:first-child{margin-left:0}
.gd-hand.locked .card{cursor:default}
.gd-hand .card.sel{transform:translateY(-16px);box-shadow:0 6px 14px rgba(0,0,0,.4),0 0 0 2px var(--accent);z-index:2}
.gd-hand:not(.locked) .card:hover{transform:translateY(-7px)}
.gd-hand:not(.locked) .card.sel:hover{transform:translateY(-16px)}
.gd-hand .card.justdealt{animation:gdDeal .3s ease both}
@keyframes gdDeal{from{transform:translateY(26px);opacity:0}to{transform:none;opacity:1}}
/* 理牌: 一键(短按)/手动拖排(长按) 共用一个按钮 */
.gd-hand-wrap{position:relative}
.gd-sort{position:absolute;right:8px;top:1px;z-index:6;padding:5px 11px;border-radius:11px;font-size:12px;font-weight:800;
  border:1px solid var(--line2);background:var(--panel);color:var(--sub);cursor:pointer;letter-spacing:.04em;transition:.14s;touch-action:none;-webkit-user-select:none;user-select:none}
.gd-sort:active{transform:scale(.94)}
.gd-sort.active{background:var(--amber);color:#04060c;border-color:var(--amber);box-shadow:0 0 12px rgba(255,194,77,.5)}
.gd-hand.arranging .card{cursor:grab}
.gd-hand.arranging .card.dragging{cursor:grabbing;transition:none;box-shadow:0 12px 24px rgba(0,0,0,.55),0 0 0 2px var(--amber);z-index:50}
/* 操作条 */
.gd-acts{display:flex;gap:9px;justify-content:center;padding:8px 14px calc(11px + env(safe-area-inset-bottom,0px))}
.gd-btn{flex:1;max-width:120px;padding:11px 0;border-radius:12px;font-weight:800;font-size:15px;cursor:pointer;
  border:1px solid var(--line2);background:var(--panel);color:var(--ink);letter-spacing:.05em;transition:.14s}
.gd-btn:active{transform:scale(.96)}
.gd-btn.primary{background:var(--accent);color:var(--btn-ink,#04060c);border-color:var(--accent);box-shadow:var(--glow-cyan)}
.gd-btn:disabled{opacity:.4;cursor:not-allowed;box-shadow:none}
.gd-btn.ghost{background:transparent;color:var(--sub)}
.gd-btn.primary.boom-ready{background:var(--magenta,#ff2d8e);border-color:var(--magenta,#ff2d8e);box-shadow:var(--glow-mag,0 0 12px rgba(255,45,142,.6));color:#fff}
.gd-btn .bt{font-size:11px;font-weight:700;opacity:.85;margin-left:5px;letter-spacing:.02em}
/* 结算 */
.gd-over{position:absolute;inset:0;z-index:9;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
  background:rgba(4,6,12,.86);backdrop-filter:blur(3px);animation:gdRoomIn .2s;padding:16px;box-sizing:border-box;text-align:center}
.gd-over h2{font-size:28px;margin:0;letter-spacing:.08em;font-weight:900}
.gd-over.win h2{color:var(--accent);text-shadow:var(--glow-cyan)}
.gd-over.lose h2{color:var(--magenta,#ff2d8e);text-shadow:var(--glow-mag)}
.gd-over .rank-list{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--sub)}
.gd-over .rank-row{display:flex;align-items:center;gap:7px;justify-content:center}
.gd-over .rank-row .r{font-weight:800;width:34px;text-align:right}
.gd-over .rank-row.me{color:var(--ink)}
.gd-over .lvlup{font-size:15px;font-weight:800;color:var(--amber)}
.gd-toast{position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);background:var(--panel-solid);border:1px solid var(--line2);color:var(--ink);padding:8px 16px;border-radius:12px;font-size:13px;opacity:0;transition:opacity .2s;z-index:8;pointer-events:none;text-align:center;max-width:80%}
.gd-toast.show{opacity:1}
.gd-confetti{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:10}
.gd-confetti i{position:absolute;top:-8%;font-size:20px;animation:gdFall linear forwards;will-change:transform,opacity}
@keyframes gdFall{0%{transform:translateY(0) rotate(0);opacity:0}12%{opacity:1}100%{transform:translateY(115%) rotate(var(--r,540deg));opacity:0}}
/* ── F1 融合: "返回"不销毁牌局, 折叠成右下角活牌桌片(PiP), 牌局后台继续; 点片展开回牌桌 ── */
.gd-room.gd-collapsing{transition:transform .24s cubic-bezier(.4,0,1,1),opacity .24s;transform-origin:100% 100%;
  transform:scale(.14) translate(60%,64%);opacity:0;pointer-events:none}
.gd-room.gd-expanding{animation:gdExpand .28s cubic-bezier(.2,.9,.3,1)}
@keyframes gdExpand{from{transform-origin:100% 100%;transform:scale(.14) translate(60%,64%);opacity:0}to{transform:none;opacity:1}}
.gd-chip{position:absolute;right:14px;bottom:calc(env(safe-area-inset-bottom,0px) + 96px);z-index:18;
  display:flex;align-items:center;gap:9px;max-width:min(74vw,264px);padding:8px 12px 8px 11px;cursor:pointer;
  background:linear-gradient(135deg,var(--panel-solid,#132a29),var(--bg2,#0d1524));
  border:1px solid var(--line2,rgba(0,229,212,.4));border-radius:16px;color:var(--ink,#eaf6ff);
  box-shadow:0 10px 28px rgba(0,0,0,.5);animation:gdChipIn .26s cubic-bezier(.2,.9,.3,1);
  -webkit-tap-highlight-color:transparent;user-select:none}
@keyframes gdChipIn{from{opacity:0;transform:translateY(10px) scale(.88)}to{opacity:1;transform:none}}
.gd-chip .ck-ic{font-size:21px;line-height:1;position:relative;flex:none}
.gd-chip .ck-tx{display:flex;flex-direction:column;min-width:0;line-height:1.28}
.gd-chip .ck-t{font-size:12px;font-weight:800;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gd-chip .ck-s{font-size:11px;color:var(--sub,#86cbc6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gd-chip .ck-x{margin-left:1px;flex:none;width:22px;height:22px;border-radius:50%;border:1px solid var(--line,rgba(0,229,212,.24));
  display:grid;place-items:center;font-size:12px;color:var(--sub,#86cbc6)}
.gd-chip.turn{border-color:var(--accent,#00e5d4);box-shadow:0 10px 28px rgba(0,0,0,.5),0 0 16px var(--accent,rgba(0,229,212,.55))}
.gd-chip.turn .ck-ic::after{content:'';position:absolute;inset:-7px;border-radius:50%;border:2px solid var(--accent,#00e5d4);
  animation:gdChipPulse 1.05s ease-out infinite;pointer-events:none}
@keyframes gdChipPulse{0%{transform:scale(.65);opacity:.9}100%{transform:scale(1.55);opacity:0}}
.gd-chip.over{border-color:var(--amber,#ffc24d)}
.gd-chip.over .ck-s{color:var(--amber,#ffc24d)}
.gd-conn{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-right:6px;letter-spacing:.03em;vertical-align:1px}
.gd-conn.online{background:rgba(0,229,212,.12);color:var(--accent,#00e5d4);border:1px solid rgba(0,229,212,.35)}
.gd-conn.reconnecting{background:rgba(255,194,77,.14);color:var(--amber,#ffc24d);border:1px solid rgba(255,194,77,.4);animation:gdConnBlink 1s ease-in-out infinite}
.gd-conn.host_offline{background:rgba(255,93,108,.16);color:#ff5d6c;border:1px solid rgba(255,93,108,.45)}
@keyframes gdConnBlink{0%,100%{opacity:.62}50%{opacity:1}}
.gd-chip.hidden-alert{border-color:#ff5d6c!important;box-shadow:0 10px 28px rgba(0,0,0,.5),0 0 20px rgba(255,93,108,.7)!important;filter:brightness(1.12)}

`;
    document.head.appendChild(s);
  }

  const LVL_LABEL = (lvl)=> Deck.RANK_LABEL[lvl===2?15:lvl] || String(lvl);
  // 选牌牌型中文名(选牌即时反馈, 对标大厂"出 · 顺子"体验)
  function typeLabel(p){
    if(!p) return '';
    switch(p.type){
      case 'single': return '单张';
      case 'pair': return '对子';
      case 'trio': return '三张';
      case 'fullhouse': return '三带二';
      case 'straight': return '顺子';
      case 'pairline': return '连对';
      case 'trioline': return '钢板';
      case 'straightflush': return '同花顺';
      case 'jokerbomb': return '天王炸';
      case 'bomb': return (p.size||4)+'炸';
      default: return '';
    }
  }
  const isBoomType = (p)=> !!p && (p.type==='bomb'||p.type==='straightflush'||p.type==='jokerbomb');

  function cardEl(card, level, opts){
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'card' + (opts.mini?' mini':'');
    const wild = Rules.isWild(card, level);
    const isLvl = !card.joker && Rules.naturalRank(card)===level;
    if (card.joker){
      el.classList.add('joker', card.joker==='big'?'big':'small', card.joker==='big'?'red':'blk');
      el.innerHTML = `<div class="cn">${card.joker==='big'?'大':'小'}</div><div class="cc">🃏</div>`;
    } else {
      const red = (card.suit==='♥'||card.suit==='♦');
      el.classList.add(red?'red':'blk');
      el.innerHTML = `<div class="cn">${card.label}</div><div class="cs">${card.suit}</div><div class="cc">${card.suit}</div>`;
    }
    if (wild){ el.classList.add('wild'); if(!opts.mini) el.insertAdjacentHTML('beforeend','<span class="wbadge">配</span>'); }
    else if (isLvl) el.classList.add('lvl');
    el.dataset.id = card.id;
    return el;
  }
  function cardBack(mini){ const el=document.createElement('div'); el.className='card back'+(mini?' mini':''); return el; }

  function open(opts){
    opts = opts || {};
    if (!Deck || !Rules || !Engine || !AI){ console.warn('[gd] engine not loaded'); return null; }
    injectCSS();

    const mySeat = (typeof opts.mySeat==='number') ? opts.mySeat : 0;   // 联机: 真人可坐非 0 席
    let connState = 'online';
    function connLabel(k){ return ({online:'● 在线', reconnecting:'⟳ 重连中', host_offline:'⚠ 房主离线'})[k] || ''; }
    function setConn(kind){
      if(!kind) kind='online';
      if(kind===connState) return;
      connState = kind; try{ setBanner(); }catch(_){ } try{ renderCtrl(); }catch(_){ } try{ updateChip(); }catch(_){ }
      if(kind==='host_offline'){ try{ vibrate([40,80,40]); }catch(_){ } }
    }
    function connPill(){ return connState==='online' ? '' : ('<span class="gd-conn '+connState+'">'+connLabel(connState)+'</span>'); }
    const names = opts.names || ['你','下家','对家','上家'];
    const avatars = opts.avatars || ['🙂','🤖','🤝','👾'];
    // 座位→DOM 槽位: 以 mySeat 为底, 顺时针 下家(右)/对家(上)/上家(左) 相对旋转(单机 mySeat=0 时恰为 1/2/3)
    const SEAT_R = (mySeat+1)%4, SEAT_T = (mySeat+2)%4, SEAT_L = (mySeat+3)%4;
    // 对局延续态(再来一局用): 队等级 + 上局结果(触发进贡)
    let matchLevels = (opts.match && opts.match.teamLevels) ? opts.match.teamLevels.slice() : [2,2];
    let matchDealer = (opts.match && typeof opts.match.dealerTeam==='number') ? opts.match.dealerTeam : 0;
    let prevResult = (opts.match && opts.match.prevResult) || null;

    // ── 联机(host 权威)双模式: guest 只渲染 host 广播的脱敏公共快照 + 回传自己动作, 不建局/不跑引擎 ──
    //   单机路径(isGuest=false)完全走原逻辑, 零改动; 所有 guest 行为一律走 isGuest 分支旁路。
    const mode = opts.mode || 'local';
    const isGuest = mode === 'guest';
    const remoteSeats = opts.remoteSeats || [];          // host 视角: 哪些席是远程真人(等其回传, 超时代打)
    const isRemote = (seat)=> remoteSeats.indexOf(seat) >= 0;
    const onSync   = (typeof opts.onSync==='function')   ? opts.onSync   : null;  // host: 每次状态变更 → 广播快照
    const onAction = (typeof opts.onAction==='function') ? opts.onAction : null;  // guest: 回传我的动作给 host
    const GNet = root.EHGuandanNet;
    let myHand = [];        // guest: 自己手牌(从 eh_gt_hands 拉到)
    let lastSnap = null;    // guest: 最近一张公共快照
    let dealNo = 0;         // 本桌第几副(host 广播随快照带出; guest 据此识别新一副去拉手牌)
    let awaitingHost = false; // guest: 已回传动作, 等 host 裁决快照期间锁 UI 防重复出牌
    const REMOTE_TIMEOUT_MS = HUMAN_PLAY_MS + 8000;      // host 等远程真人回传的宽限, 超时自动代打(不出/领出)

    function newDeal(){
      return Engine.createGame({ isAI: opts.isAI || [false,true,true,true], names,
        teamLevels: matchLevels, dealerTeam: matchDealer,
        level: matchLevels[matchDealer], prevResult,
        seed: (prevResult ? undefined : opts.seed) });
    }
    // guest 占位局: 等 host 首帧快照到达前的空桌, 字段齐全避免渲染读空。
    function waitingState(){
      return { phase:'wait', seed:undefined, level: (matchLevels[matchDealer]||2), teamLevels: matchLevels.slice(),
        dealerTeam: matchDealer, turn:-1, bombs:0, finished:[], table:{ lastPlay:null, passesInRow:0 },
        players:[0,1,2,3].map(s=>({ id:'p'+s, seat:s, team:s%2, name:(names[s]||('席'+s)),
          isAI: !!(opts.isAI && opts.isAI[s]), hand:[] })),
        tribute:null, result:null };
    }
    let st = isGuest ? waitingState() : newDeal();
    let selected = new Set();
    let hintCycle = [], hintIdx = 0;

    function sfx(n){ try{ if(root.EhSfx && root.EhSfx.play) root.EhSfx.play(n); }catch(_){} }
    function vibrate(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(_){} }
    let dealAnim = true, lastMyTurn = false, lastFinishedN = 0;
    let lastSelTick = 0;
    sfx('arrive'); if(!isGuest) sfx('deal');   // guest 未拿到手牌前不响发牌音

    let aiTimer=null, ringRAF=null, turnStart=0, turnDur=0;

    const mountEl = opts.mount || document.getElementById('hall') || document.body;
    const room = document.createElement('div'); room.className='gd-room';
    room.innerHTML = `
      <div class="gd-bar">
        <div class="gd-title"><span class="dot"></span>掼蛋</div>
        <div class="gd-lvl" id="gdLvl"></div>
        <button class="gd-mus" id="gdMus" aria-label="背景音乐开关">🎵</button>
        <button class="gd-x" id="gdX" aria-label="返回聊天">✕ 返回</button>
      </div>
      <div class="gd-felt" id="gdFelt">
        <div class="gd-partner" id="gdP2"></div>
        <div class="gd-mid">
          <div class="gd-side left" id="gdP3"></div>
          <div class="gd-center">
            <div class="gd-banner" id="gdBanner"></div>
            <div class="gd-who" id="gdWho"></div>
            <div class="gd-played" id="gdPlayed"></div>
          </div>
          <div class="gd-side right" id="gdP1"></div>
        </div>
      </div>
      <div class="gd-me" id="gdMe"></div>
      <div class="gd-hand-wrap"><button class="gd-sort" id="gdSort" aria-label="理牌">🔀 理牌</button><div class="gd-hand" id="gdHand"></div></div>
      <div id="gdCtrl"></div>
      <div class="gd-toast" id="gdToast"></div>`;
    mountEl.appendChild(room);

    // F2 边打边聊: 牌桌内嵌聊天坞 + 弹幕(复用 app 注入的房间发送通道/身份; 未注入则不挂)
    const dock = (opts.chat && root.EHTableChat)
      ? root.EHTableChat.mount(room, { send: opts.chat.send, me: opts.chat.me }) : null;

    const $ = sel => room.querySelector(sel);
    const els = { felt:$('#gdFelt'), p1:$('#gdP1'), p2:$('#gdP2'), p3:$('#gdP3'),
      banner:$('#gdBanner'), who:$('#gdWho'), played:$('#gdPlayed'), me:$('#gdMe'),
      hand:$('#gdHand'), ctrl:$('#gdCtrl'), lvl:$('#gdLvl'), toast:$('#gdToast') };

    function toast(msg, ms){ els.toast.textContent=msg; els.toast.classList.add('show');
      clearTimeout(toast._t); toast._t=setTimeout(()=>els.toast.classList.remove('show'), ms||1200); }
    function say(seat, msg){
      const b = room.querySelector(`.gd-seat[data-seat="${seat}"] .gd-say`);
      if(!b) return; b.textContent=msg; b.classList.add('show'); setTimeout(()=>b.classList.remove('show'),1500);
    }
    // ── F3 牌局直播: 高光瞬间(炸弹/报单/头游/终局升级)播报给聊天室(opts.onBeat 由 app.js 注入)。
    //   灵魂对手配即时入戏台词(quip): say() 气泡 + 随 beat 进聊天流, 模板化零延迟(不塞 LLM 到热路径)。
    const gameIsAI = opts.isAI || [false,true,true,true];
    const QUIP = {
      bomb:  ['轰！接不接得住','这把我说了算','让开让开','炸你没商量'],
      danpai:['就剩一张咯～','要走啦','你们慢慢磨','头游预定'],
      finish:['走咯，先撤一步～','头游到手 😎','剩下你们玩','漂亮收工'],
      win:   ['升级喽','这盘归我们队','承让承让','技高一筹'],
    };
    function emitBeat(b){ if(typeof opts.onBeat==='function'){ try{ opts.onBeat(Object.assign({ game:'gd' }, b)); }catch(_){} } }
    function beatQuip(seat, kind){
      if(!(gameIsAI && gameIsAI[seat])) return null;
      const q = rand(QUIP[kind]||[]); if(!q) return null;
      say(seat, q); return q;
    }
    function clearTimers(){ if(aiTimer){clearTimeout(aiTimer);aiTimer=null;} if(ringRAF){cancelAnimationFrame(ringRAF);ringRAF=null;} }
    const onResize = ()=>layoutHand();
    let _exited=false;
    function close(){ minimized=false; clearTimers(); window.removeEventListener('resize', onResize); if(dock) dock.destroy(); if(chip){ chip.remove(); chip=null; } room.remove();
      if(!_exited){ _exited=true; if(typeof opts.onExit==='function'){ try{ opts.onExit(); }catch(_){} } } }

    // ── F1 融合: 折叠(返回聊天但牌局继续) / 展开(回牌桌); 见 game-ui.js 同款注释 ──
    let minimized=false, chip=null;
    function chipStatus(){
      if (st.phase==='over'){ const w=st.result && Engine.teamOf(mySeat)===st.result.winnerTeam;
        return { t:'掼蛋', s:(w?'🏁 你方赢了 · 点看战报':'🏁 本副结束 · 点看战报'), cls:'over' }; }
      if (st.phase!=='play' || st.turn<0)   // 联机 guest 等 host 首帧 / 换副空窗
        return { t:'掼蛋', s:'⏳ 等待开局…', cls:'' };
      const mine=st.turn===mySeat, my=st.players[mySeat];
      return { t:'掼蛋 · 打'+LVL_LABEL(st.level), s:(mine?'⚡ 轮到你出牌':('等 '+st.players[st.turn].name+' 出牌'))+' · 你 '+(my&&my.hand?my.hand.length:'?')+' 张', cls: mine?'turn':'' };
    }
    function updateChip(){ if(!minimized||!chip) return; const i=chipStatus();
      const mine=(st.phase==='play' && st.turn===mySeat && !(isGuest && awaitingHost));
      let cls='gd-chip'+(i.cls?(' '+i.cls):'');
      if(mine && document.hidden) cls += ' hidden-alert';
      chip.className=cls;
      const tag = connState!=='online' ? (' ['+connLabel(connState).replace(/^[● ⟳ ⚠]+/,'').trim()+']') : '';
      chip.querySelector('.ck-t').textContent=i.t + tag;
      chip.querySelector('.ck-s').textContent=i.s;
    }
    function minimize(){
      if (minimized) return; minimized=true;
      room.classList.remove('gd-expanding'); room.classList.add('gd-collapsing');
      setTimeout(()=>{ if(minimized) room.style.display='none'; }, 240);
      if (!chip){
        chip=document.createElement('div'); chip.className='gd-chip';
        chip.innerHTML=`<span class="ck-ic">🎴</span><span class="ck-tx"><b class="ck-t">掼蛋</b><span class="ck-s"></span></span><span class="ck-x">↗</span>`;
        chip.addEventListener('click', restore);
        mountEl.appendChild(chip);
      } else chip.style.display='';
      renderAll(); sfx('click');
    }
    function restore(){
      if (!minimized) return; minimized=false;
      if (chip) chip.style.display='none';
      room.style.display=''; room.classList.remove('gd-collapsing');
      void room.offsetWidth; room.classList.add('gd-expanding');
      setTimeout(()=>room.classList.remove('gd-expanding'), 300);
      renderAll(); sfx('click');
    }
    $('#gdX').addEventListener('click', minimize);
    // 牌桌内背景音乐开关(复用 EH_BGM, 因大厅 🎵 被牌桌浮层盖住)
    const musBtn = $('#gdMus');
    function paintMus(){ if(!musBtn) return; const on = !root.EH_BGM || root.EH_BGM.on(); musBtn.textContent = on?'🎵':'🔇'; musBtn.classList.toggle('muted', !on); }
    if (musBtn) musBtn.addEventListener('click', ()=>{ try{ if(root.EH_BGM) root.EH_BGM.set(!root.EH_BGM.on()); }catch(_){} paintMus(); sfx('click'); });
    paintMus();
    window.addEventListener('resize', onResize);

    // ── 划选: 指针涂抹式多选(按下即选 / 拖过整段连选), 与点选共用 selected ──
    let painting=false, paintMode='select', paintSeen=null, paintLastIdx=null;
    // 手牌左→右叠放, 后牌盖前牌右半 → elementFromPoint 在牌中心会命中右邻牌(漏掉最左那张)。
    // 改按 x 命中"露出的那张": left ≤ x 里最靠右的一张(最后被指针越过的左沿), x 在首牌之前归首牌。
    function handCardAt(x,y){
      const kids=els.hand.children, n=kids.length; if(!n) return null;
      const hr=els.hand.getBoundingClientRect();
      if(y < hr.top-40 || y > hr.bottom+40) return null;
      let pick=kids[0];
      for(let i=0;i<n;i++){ if(x >= kids[i].getBoundingClientRect().left-0.5) pick=kids[i]; else break; }
      return pick;
    }
    function applyPaintIdx(i){
      const c = els.hand.children[i]; if(!c) return;
      const id = c.dataset.id; if(!id || paintSeen.has(id)) return; paintSeen.add(id);
      if(paintMode==='select') selected.add(id); else selected.delete(id);
      c.classList.toggle('sel', selected.has(id));
      // 选牌轻触音: 只在"选中"时响 + 60ms 节流, 避免划选连点像机关枪
      if(paintMode==='select'){ const now=(performance&&performance.now)?performance.now():Date.now(); if(now-lastSelTick>60){ lastSelTick=now; sfx('cardsel'); } }
    }
    function paintTo(c){
      if(!c) return; const idx=+c.dataset.idx;
      if(paintLastIdx==null) applyPaintIdx(idx);
      else { const lo=Math.min(paintLastIdx,idx), hi=Math.max(paintLastIdx,idx); for(let i=lo;i<=hi;i++) applyPaintIdx(i); }
      paintLastIdx=idx; updatePlayBtn();
    }
    function endPaint(){ painting=false; paintSeen=null; paintLastIdx=null; }
    els.hand.addEventListener('pointerdown', (e)=>{
      if(arrangeMode){ startReorder(e); return; }        // 手动理牌: 拖牌重排(暂停划选)
      if(st.phase!=='play' || st.turn!==mySeat) return;
      const c=handCardAt(e.clientX,e.clientY); if(!c) return;
      painting=true; paintSeen=new Set(); paintLastIdx=null;
      paintMode = selected.has(c.dataset.id) ? 'deselect' : 'select';
      try{ els.hand.setPointerCapture(e.pointerId); }catch(_){}
      paintTo(c); e.preventDefault();
    });
    els.hand.addEventListener('pointermove', (e)=>{
      if(dragCard){ moveReorder(e); return; }
      if(painting) paintTo(handCardAt(e.clientX,e.clientY));
    });
    els.hand.addEventListener('pointerup', (e)=>{ if(dragCard) endReorder(e); else endPaint(); });
    els.hand.addEventListener('pointercancel', (e)=>{ if(dragCard) endReorder(e); else endPaint(); });

    // ── 理牌: 一键自动(短按) / 手动拖排(长按切模式), 共用 #gdSort 一个按钮 ──
    // customOrder=null 时 renderHand 走 Rules.sortHand 自动理牌; 非空则按玩家排定的 id 顺序摆。
    let customOrder = null, arrangeMode = false;
    let dragCard = null, dragId = null, dragStartX = 0;
    function setArrange(on){
      arrangeMode = on;
      const btn = $('#gdSort'); if(btn){ btn.classList.toggle('active', on); btn.innerHTML = on ? '✓ 完成' : '🔀 理牌'; }
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
    // 短按=一键理牌(或手动模式下=完成退出); 长按≥350ms=切手动理牌模式
    (function bindSort(){
      const btn=$('#gdSort'); if(!btn) return;
      let pressTimer=null, longFired=false;
      btn.addEventListener('pointerdown', ()=>{ longFired=false; pressTimer=setTimeout(()=>{ longFired=true; setArrange(!arrangeMode); }, 350); });
      const cancel=()=>{ if(pressTimer){ clearTimeout(pressTimer); pressTimer=null; } };
      btn.addEventListener('pointerup', ()=>{ cancel(); if(longFired) return; if(arrangeMode){ setArrange(false); } else autoSort(); });
      btn.addEventListener('pointerleave', cancel);
      btn.addEventListener('pointercancel', cancel);
    })();

    // id → card 表(整两副牌重建 lastPlay 用)
    const ALL = {}; Deck.doubleDeck().forEach(c=>ALL[c.id]=c);
    const findCardById = (id)=> ALL[id];
    const RANKNAME = { headgame:'头游', second:'二游', third:'三游', last:'末游' };
    function finishBadge(seat){
      const idx = st.finished.indexOf(seat);
      if (idx===0) return '头游'; if (idx===1) return '二游'; if (idx===2) return '三游';
      if (st.phase==='over'){ const fo=st.result.finishOrder; const i=fo.indexOf(seat); return ['头游','二游','三游','末游'][i]; }
      return '';
    }

    function seatHTML(seat, mini){
      const p = st.players[seat];
      const isMate = Engine.partnerOf(mySeat)===seat;
      const badge = finishBadge(seat);
      const done = p.hand.length===0;
      // 剩牌告警: 未出完且 ≤2 张 → 座位报牌(对标大厂残局紧张感)
      const alarm = st.phase==='play' && !done && p.hand.length<=2;
      const miniHand = (mini && !done) ? `<div class="gd-mini-hand">${Array.from({length:Math.min(p.hand.length,10)}).map(()=>'').join('')}</div>` : '';
      const tags = [];
      if (isMate) tags.push('<span class="gd-tag mate">队友</span>');
      else if (seat!==mySeat) tags.push('<span class="gd-tag">对手</span>');
      if (badge) tags.push(`<span class="gd-tag rank">${badge}</span>`);
      if (alarm) tags.push(`<span class="gd-tag alarm">⚠ 报牌</span>`);
      return `<div class="gd-seat${st.turn===seat&&st.phase!=='over'?' turn':''}${isMate?' mate':''}${alarm?' alarm':''}" data-seat="${seat}" style="--p:360">
        <div class="gd-avr"><div class="av">${avatars[seat]||'🤖'}</div></div>
        <div class="nm">${escapeHtml(p.name)}</div>
        <div class="cnt">剩 <b>${p.hand.length}</b> 张</div>
        <div class="gd-tags">${tags.join('')}</div>
        <div class="gd-say"></div>
      </div>`;
    }
    function renderSeats(){
      els.p2.innerHTML = seatHTML(SEAT_T);   // 对家/队友(上)
      els.p3.innerHTML = seatHTML(SEAT_L);   // 上家(左)
      els.p1.innerHTML = seatHTML(SEAT_R);   // 下家(右)
      els.me.innerHTML = seatHTML(mySeat);
      els.lvl.innerHTML = `打 <b>${LVL_LABEL(st.level)}</b> · 我方 ${LVL_LABEL(st.teamLevels[Engine.teamOf(mySeat)])} · 对方 ${LVL_LABEL(st.teamLevels[1-Engine.teamOf(mySeat)])}`;
    }

    let lastShownKey='';
    function playKey(){ const lp=st.table.lastPlay; if(!lp) return st.table.passesInRow>0?('pass:'+st.turn):'empty'; return lp.seat+':'+lp.cards.join(','); }
    function renderTable(){
      const lp = st.table.lastPlay;
      const key = playKey(); const changed = key!==lastShownKey; lastShownKey=key;
      if (!lp){
        els.who.textContent=''; els.played.className='gd-played';
        els.played.innerHTML = st.phase==='play' ? `<div class="gd-passtag">新一圈 · 随意出</div>` : '';
        return;
      }
      els.who.textContent = st.players[lp.seat].name + ' 出' + (Engine.partnerOf(mySeat)===lp.seat?'（队友）':'');
      els.played.className='gd-played'; els.played.innerHTML='';
      lp.cards.map(findCardById).forEach(c=> els.played.appendChild(cardEl(c, st.level)));
      if (changed){
        void els.played.offsetWidth;
        els.played.classList.add(lp.seat===mySeat?'fly-bot':'fly-top');
        const nm = st.players[lp.seat].name;
        if (Rules.isBomb(lp.parse)){
          const bn = bombName(lp.parse);
          boom(bn);
          emitBeat({ type:'bomb', actor:nm, big:true, text:`💥 ${nm} 甩出${bn.replace(/ /g,'')}！`, quip: beatQuip(lp.seat, 'bomb') });
        } else if (lp.seat!==mySeat) sfx('cardplay');
        // 报单: 出完只剩最后一张(solo 有真实手牌; guest 脱敏跳过)
        const rest = st.players[lp.seat].hand;
        if (Array.isArray(rest) && rest.length === 1)
          emitBeat({ type:'danpai', actor:nm, text:`⚠️ ${nm} 只剩最后一张牌！`, quip: beatQuip(lp.seat, 'danpai') });
      }
    }
    function bombName(p){ return p.type==='jokerbomb'?'天 王 炸':(p.type==='straightflush'?'同 花 顺':(p.size+' 炸')); }
    function boom(txt){
      sfx('boom'); vibrate([12,40,20]);
      els.felt.classList.remove('shake'); void els.felt.offsetWidth; els.felt.classList.add('shake');
      const fl=document.createElement('div'); fl.className='gd-flash'; els.felt.appendChild(fl); setTimeout(()=>fl.remove(),520);
      const b=document.createElement('div'); b.className='gd-boom'; b.textContent='💥 '+txt;
      els.felt.appendChild(b); setTimeout(()=>b.remove(),750);
    }
    function confetti(){
      const box=document.createElement('div'); box.className='gd-confetti';
      const EM=['🎉','🃏','✨','🎊','⭐','💠','🀄'];
      for(let i=0;i<18;i++){ const s=document.createElement('i');
        s.textContent=EM[Math.floor(secureRand()*EM.length)];
        s.style.left=(secureRand()*100)+'%';
        s.style.animationDuration=(1.1+secureRand()*0.8)+'s';
        s.style.animationDelay=(secureRand()*0.3)+'s';
        s.style.setProperty('--r',(360+Math.floor(secureRand()*540))+'deg');
        box.appendChild(s); }
      els.felt.appendChild(box); setTimeout(()=>box.remove(),2300);
    }

    // 手牌摆放顺序: 自动理牌走 Rules.sortHand(级牌感知); 手动理牌后按玩家排定的 id 顺序摆(已出的牌自然从序列消失)
    function handOrder(){
      const hand = st.players[mySeat].hand;
      if (customOrder){
        const pos = new Map(customOrder.map((id,i)=>[id,i]));
        return hand.slice().sort((a,b)=>(pos.has(a.id)?pos.get(a.id):9999)-(pos.has(b.id)?pos.get(b.id):9999));
      }
      return Rules.sortHand(hand, st.level);
    }
    function renderHand(){
      const myTurn = st.phase==='play' && st.turn===mySeat && !(isGuest && awaitingHost);
      els.hand.className='gd-hand'+(myTurn||arrangeMode?'':' locked')+(arrangeMode?' arranging':'');
      els.hand.innerHTML='';
      const deal = dealAnim; dealAnim=false;
      const sorted = handOrder();
      sorted.forEach((card, idx)=>{
        const el = cardEl(card, st.level);
        el.dataset.idx = idx;
        if (selected.has(card.id)) el.classList.add('sel');
        if (deal){ el.style.animationDelay=(idx*11)+'ms'; el.classList.add('justdealt'); }
        els.hand.appendChild(el);
      });
      layoutHand();
    }
    // 手牌单排自适应: 牌多时动态收紧叠放, 永远吃满一行不换行(对标大厂手牌扇)
    function layoutHand(){
      const cards = els.hand.children;
      const n = cards.length; if (!n) return;
      const W = els.hand.clientWidth; if (!W) return;
      const cw = cards[0].offsetWidth || parseFloat(getComputedStyle(room).getPropertyValue('--cw')) || 38;
      // 单排排满: 步距 step 使 cw + (n-1)*step ≤ W; 牌少时封顶给自然扇形叠放
      let step = n>1 ? (W - cw) / (n - 1) : 0;
      step = Math.min(step, cw * 0.64);         // 上限: 不过度分散
      const ov = Math.round(step - cw);          // 负外边距(叠放量)
      for (let i=0;i<n;i++){ cards[i].style.marginLeft = i===0 ? '0px' : ov+'px'; }
    }

    function setBanner(){
      const b=els.banner; const cp=connPill();
      if (st.phase==='over'){ b.className='gd-banner'; b.innerHTML=cp; return; }
      if (st.phase!=='play' || st.turn<0){ b.className='gd-banner'; b.innerHTML=cp+'⏳ 等待开局…'; return; }
      if (isGuest && awaitingHost){ b.className='gd-banner'; b.innerHTML=cp+'⏳ 已出牌 · 等待裁决…'; return; }
      const seat=st.turn, mine=seat===mySeat;
      if (mine){ b.className='gd-banner mine'; b.innerHTML=cp+'🫵 轮到你出牌 <span class="clk" id="gdClk"></span>'; }
      else { b.className='gd-banner'; b.innerHTML=cp+escapeHtml(st.players[seat].name)+' 思考中… <span class="clk" id="gdClk"></span>'; }
    }
    function seatOf(seat){ return room.querySelector(`.gd-seat[data-seat="${seat}"]`); }
    function armTurn(onExpire){
      clearTimers();
      if (st.phase!=='play' || st.turn<0) return;
      const seat=st.turn, mine=seat===mySeat;
      if (isGuest && awaitingHost) return;   // guest 回传后等裁决, 不跑倒计时
      if (mine && !lastMyTurn){ sfx('yourturn'); vibrate(18); }
      lastMyTurn=mine;
      // host 视角: 远程真人席只等其回传(宽限 REMOTE_TIMEOUT_MS 后托管); 本机 AI 席走 AI 节奏。
      const remote = !isGuest && isRemote(seat);
      turnDur = mine ? HUMAN_PLAY_MS : (remote ? REMOTE_TIMEOUT_MS : (AI_MIN_MS + Math.floor(secureRand()*AI_JIT_MS)));
      turnStart = Date.now();
      const seatEl=seatOf(seat), clk=room.querySelector('#gdClk');
      const tick=()=>{
        const remain=Math.max(0,turnDur-(Date.now()-turnStart));
        const frac=turnDur?(remain/turnDur):0;
        if(seatEl) seatEl.style.setProperty('--p',(frac*360).toFixed(1));
        if(mine && clk){ const sec=Math.ceil(remain/1000); clk.textContent=sec+'s'; clk.classList.toggle('urgent',sec<=5); }
        if(remain<=0){ ringRAF=null; if(mine&&typeof onExpire==='function') onExpire(); return; }
        ringRAF=requestAnimationFrame(tick);
      };
      tick();
      // 定时驱动: 我(靠 onExpire)/guest(全等 host 快照, 不驱动任何席)/host 远程席(超时托管)/host 本机 AI 席。
      if (mine) return;
      if (isGuest) return;                                             // guest 只渲染, host 是唯一裁判
      if (remote) aiTimer=setTimeout(()=>onRemoteTimeout(seat), turnDur);
      else aiTimer=setTimeout(()=>aiStep(seat), turnDur);
    }
    // host: 远程真人超时未回传 → host 托管代打(与 aiStep 同源, 出完即随 afterMove 广播)。
    function onRemoteTimeout(seat){
      if (st.phase!=='play' || st.turn!==seat) return;
      toast('远客超时 · 暂由房主托管');
      aiStep(seat);
    }

    function renderCtrl(){
      if (isGuest && connState!=='online'){
        const label=connState==='host_offline'?'房主离线 · 等待恢复':'连接恢复中…';
        els.ctrl.innerHTML=`<div class="gd-acts"><button class="gd-btn ghost" disabled>⏳ ${label}</button></div>`; return; }
      if (st.phase!=='play'){ els.ctrl.innerHTML=''; return; }
      if (isGuest && awaitingHost){   // 已回传动作, 锁操作条防重复
        els.ctrl.innerHTML=`<div class="gd-acts"><button class="gd-btn ghost" disabled>⏳ 等待裁决…</button></div>`; return; }
      const myTurn=st.turn===mySeat;
      const mustBeat = st.table.lastPlay && st.table.lastPlay.seat!==mySeat;
      // 智能预判: 轮到我时先算一遍可打的牌(best-first)。压不过=引导不出; 只有一种打法=自动选好。
      let plays=[];
      if (myTurn){
        const target = mustBeat ? st.table.lastPlay.parse : null;
        plays = AI.hints({ hand: st.players[mySeat].hand, tableParse:target, level:st.level });
      }
      const noBeat = myTurn && mustBeat && plays.length===0;   // 要压却压不过 → 只能不出
      els.ctrl.innerHTML=`<div class="gd-acts">
        <button class="gd-btn ${noBeat?'primary':'ghost'}" id="gdPass" ${!myTurn||!mustBeat?'disabled':''}>${noBeat?'压不过 · 不出':'不出'}</button>
        <button class="gd-btn ghost" id="gdHint" ${!myTurn||plays.length<=1?'disabled':''}>提示</button>
        <button class="gd-btn primary" id="gdPlay" disabled>出牌</button>
      </div>`;
      $('#gdPass').addEventListener('click', ()=>doPass(mySeat));
      $('#gdPlay').addEventListener('click', doPlay);
      $('#gdHint').addEventListener('click', doHint);
      // 只有唯一合法打法(常见于残局/剩一对) → 直接替玩家选好, 省得一张张点
      if (myTurn && plays.length===1 && selected.size===0){
        selected = new Set(plays[0].map(c=>c.id)); renderHand();
      }
      updatePlayBtn();
    }
    function updatePlayBtn(){
      const btn=$('#gdPlay'); if(!btn) return;
      const cards=[...selected].map(findCardById).filter(Boolean);
      const p = cards.length ? Rules.parse(cards, st.level) : null;
      let okBtn = !!p && st.turn===mySeat;
      if (okBtn && st.table.lastPlay && st.table.lastPlay.seat!==mySeat)
        okBtn = Rules.beats(p, st.table.lastPlay.parse, st.level);
      btn.disabled=!okBtn;
      // 选牌实时牌型反馈: 合法则报牌型, 炸弹按钮变红发光(对标大厂"出·同花顺")
      const boom = okBtn && isBoomType(p);
      btn.classList.toggle('boom-ready', !!boom);
      if (okBtn){
        const lab = typeLabel(p);
        btn.innerHTML = boom ? `💥 出 <span class="bt">${lab}</span>` : `出牌 <span class="bt">${lab}</span>`;
      } else {
        btn.textContent = '出牌';
      }
    }

    function doPlay(){
      const cards=[...selected].map(findCardById).filter(Boolean);
      if (isGuest){
        // guest: 本地已用 updatePlayBtn 校验合法, 只回传动作(id 数组), 由 host 引擎权威裁决 + 广播新快照
        if (!cards.length || awaitingHost) return;
        if (onAction) onAction({ action:'play', cards: cards.map(c=>c.id) });
        sfx('cardplay'); selected.clear(); hintCycle=[]; awaitingHost=true;
        setBanner(); renderCtrl(); renderHand(); return;
      }
      try{ var r=Engine.applyPlay(st, mySeat, cards); }
      catch(e){ toast(playErr(e.message)); return; }
      sfx('cardplay'); selected.clear(); hintCycle=[];
      afterMove(r);
    }
    function doPass(seat){
      if (isGuest){   // guest 只能替自己不出, 回传给 host
        if (awaitingHost) return;
        if (onAction) onAction({ action:'pass' });
        sfx('pass'); say(mySeat,'不出'); awaitingHost=true;
        setBanner(); renderCtrl(); renderHand(); return;
      }
      try{ Engine.applyPass(st, seat); }catch(e){ toast('现在不能不出'); return; }
      if(seat===mySeat) sfx('pass');
      say(seat,'不出'); afterMove({});
    }
    function doHint(){
      const hand=st.players[mySeat].hand;
      const target=(st.table.lastPlay && st.table.lastPlay.seat!==mySeat)?st.table.lastPlay.parse:null;
      if(!hintCycle.length){
        // best-first: 能一把走完排最前(剩一对提示打对子而非拆单张), 领出走长牌型、跟牌走最小代价
        hintCycle = AI.hints({ hand, tableParse:target, level:st.level }); hintIdx=0;
      }
      if(!hintCycle.length){ toast('没有能压的牌，只能不出'); return; }
      const pick=hintCycle[hintIdx%hintCycle.length]; hintIdx++;
      selected=new Set(pick.map(c=>c.id)); renderHand(); updatePlayBtn();
    }

    // 供联机(host 权威应用远程真人动作)/测试驱动任意席一手, 与 aiStep 同源(掼蛋无叫分, 只 play/pass)。
    // 返回 true=引擎接受并应用; false=非本人回合/非法/牌不在手 → 调用方应 resync 把权威快照重播给客人纠偏。
    function applyMove(seat, move){
      if(!move || st.phase!=='play' || st.turn!==seat) return false;
      try{
        if(move.action==='pass'){ Engine.applyPass(st, seat); say(seat,'不出'); afterMove({}); return true; }
        const hand=st.players[seat].hand;
        const cards=(move.cards||[]).map(c=> hand.find(h=>h.id===(c&&c.id||c))).filter(Boolean);
        const r=Engine.applyPlay(st, seat, cards);
        sfx('cardplay'); maybeBanter(seat); afterMove(r); return true;
      }catch(e){ return false; }
    }
    function aiStep(seat){
      if (st.phase!=='play' || st.turn!==seat) return;
      const target=(st.table.lastPlay && st.table.lastPlay.seat!==seat)?st.table.lastPlay.parse:null;
      const mv=AI.decide({ seat, hand:st.players[seat].hand, tableParse:target,
        lastSeat: st.table.lastPlay?st.table.lastPlay.seat:null,
        handsLeft: st.players.map(p=>p.hand.length), level: st.level });
      if(mv.action==='pass'){
        try{ Engine.applyPass(st,seat); }
        catch(e){ Engine.applyPlay(st,seat, AI.chooseLead(st.players[seat].hand, st.level)); }
        say(seat,'不出'); afterMove({}); return;
      }
      try{ var r=Engine.applyPlay(st, seat, mv.cards); }
      catch(e){ try{ Engine.applyPass(st,seat); }catch(_){ Engine.applyPlay(st,seat,AI.chooseLead(st.players[seat].hand,st.level)); } afterMove({}); return; }
      maybeBanter(seat); afterMove(r);
    }
    function maybeBanter(seat){
      const n=st.players[seat].hand.length;
      if(n===0) say(seat, rand(['走咯！','先走一步～','头游预定']));
      else if(n===1) say(seat,'就剩一张咯～');
      else if(n===2) say(seat,'快没了！');
      else if(secureRand()<0.13) say(seat, rand(['接招','看我的','这手稳']));
    }

    function afterMove(r){
      // 有人刚出完(名次+1) → 一声提示 + 播报名次(头游/二游/三游)
      if (st.finished.length>lastFinishedN){
        sfx('sparkle');
        const seat = st.finished[st.finished.length-1];
        const rankNm = ['头游','二游','三游'][st.finished.length-1] || '出完';
        const nm = st.players[seat].name;
        emitBeat({ type:'finish', actor:nm, big:st.finished.length===1,
          text:`🏆 ${nm} 打完 · ${rankNm}`, quip: st.finished.length===1 ? beatQuip(seat,'finish') : null });
        lastFinishedN=st.finished.length;
      }
      broadcast();          // host: 每次状态变更后广播脱敏公共快照 + 重写各远程席私牌行(掼蛋手牌动态)
      renderAll();
      if (r && r.over){ showOver(); }
    }

    // ── host: 产出脱敏公共快照并交给 app.js 广播(顺带把各远程真人席【当前】手牌写回私牌表, 掼蛋出一张变一次) ──
    function broadcast(){
      if (isGuest || !onSync || !GNet) return;
      try{ onSync(GNet.snapshot(st, dealNo), st); }catch(_){}
    }
    // ── guest: 收到 host 广播的公共快照 → 组伪状态渲染。换副时重置手牌/动画; 终局弹战报。 ──
    function applySnapshot(snap){
      if (!snap || !GNet) return;
      const prevPhase = st ? st.phase : null;
      const isNewDeal = (typeof snap.dealNo==='number' && snap.dealNo!==dealNo) || (prevPhase==='over' && snap.phase==='play');
      if (isNewDeal){
        dealAnim=true; selected.clear(); hintCycle=[]; customOrder=null;
        lastShownKey=''; lastFinishedN=0; lastMyTurn=false;
        if (arrangeMode) setArrange(false);
        const ov=els.felt.querySelector('.gd-over'); if(ov) ov.remove();
      }
      awaitingHost=false;                 // 快照到达即解锁(host 已裁决)
      dealNo = (typeof snap.dealNo==='number') ? snap.dealNo : dealNo;
      lastSnap = snap;
      st = GNet.pseudoState(snap, mySeat, myHand);
      renderAll();
      if (isNewDeal) showTributeBanner();
      if (st.phase==='over' && st.result && prevPhase!=='over') showOver();
      if (minimized) updateChip();
    }
    // ── guest: 收到自己那副手牌(来自 eh_gt_hands, RLS 只放行本人)。可传 id 数组或牌对象数组。 ──
    function feedHand(cards){
      myHand = (cards||[]).map(c=> (c && c.id) ? c : findCardById(c)).filter(Boolean);
      if (st && st.players[mySeat]) st.players[mySeat].hand = myHand.map(c=>GNet?GNet.cardPlain(c):c);
      renderHand(); renderCtrl(); if(minimized) updateChip();
    }

    function onHumanTimeout(){
      if (st.phase!=='play' || st.turn!==mySeat) return;
      const mustBeat = st.table.lastPlay && st.table.lastPlay.seat!==mySeat;
      if (mustBeat){ toast('超时 · 自动不出'); doPass(mySeat); return; }
      const lead = AI.chooseLead(st.players[mySeat].hand, st.level);
      toast('超时 · 自动出牌'); selected=new Set(lead.map(c=>c.id)); doPlay();
    }

    // 进贡横幅(开局若有进贡, 展示 1 条并自动消失)
    function showTributeBanner(){
      if (!st.tribute) return;
      const box=document.createElement('div'); box.className='gd-tribute';
      if (st.tribute.refused){
        box.innerHTML=`<div class="th">🛡️ 抗贡成功</div><div class="tl">输方手握双大王，免于进贡</div>`;
      } else {
        const rows = (st.tribute.transfers||[]).map(t=>{
          const gc = findCardById(t.give);
          const nameF = escapeHtml(st.players[t.from].name), nameT = escapeHtml(st.players[t.to].name);
          const lab = gc ? (gc.joker?(gc.joker==='big'?'大王':'小王'):(gc.suit+gc.label)) : '牌';
          return `<span>${nameF} 进贡 <b style="color:var(--amber)">${lab}</b> → ${nameT}</span>`;
        }).join('');
        box.innerHTML=`<div class="th">🎁 进贡 · ${st.tribute.doubleDown?'双下双贡':'单贡'}</div><div class="tl">${rows}</div>`;
      }
      els.felt.appendChild(box);
      sfx('echo');
      setTimeout(()=>{ box.style.transition='opacity .4s'; box.style.opacity='0'; setTimeout(()=>box.remove(),420); }, 2600);
    }

    function showOver(){
      clearTimers();
      const res=st.result;
      const iWon = Engine.teamOf(mySeat)===res.winnerTeam;
      const over=document.createElement('div'); over.className='gd-over '+(iWon?'win':'lose');
      const rankNames=['头游','二游','三游','末游'];
      const rows = res.finishOrder.map((seat,i)=>{
        const mate=Engine.partnerOf(mySeat)===seat, me=seat===mySeat;
        return `<div class="rank-row${me?' me':''}"><span class="r">${rankNames[i]}</span><span>${escapeHtml(st.players[seat].name)}${me?'（你）':(mate?'（队友）':'')}</span></div>`;
      }).join('');
      const lvlFrom=LVL_LABEL(res.teamLevelsBefore[res.winnerTeam]), lvlTo=LVL_LABEL(res.teamLevelsAfter[res.winnerTeam]);
      const winSide = res.winnerTeam===Engine.teamOf(mySeat)?'我方':'对方';
      const lvlLine = res.matchWon
        ? `🏆 ${winSide}打过 A，通关胜利！`
        : `${winSide}升级：${lvlFrom} → <b>${lvlTo}</b>（+${res.advance}，${res.doubleDown?'双下':'单下'}）`;
      // guest 无权开新一副: 由 host 驱动, 下一副快照到达时 applySnapshot 自动清掉本战报。只留"收工"。
      const againLabel = isGuest ? '等房主开局…' : (res.matchWon?'新对局':'打下一副');
      over.innerHTML=`
        <h2>${iWon?'🎉 胜利':'😵 失败'}</h2>
        <div class="rank-list">${rows}</div>
        <div class="lvlup">${lvlLine}</div>
        <div class="gd-acts" style="margin-top:4px">
          <button class="gd-btn" id="gdAgain" ${isGuest?'disabled':''}>${againLabel}</button>
          <button class="gd-btn primary" id="gdDone">收工</button>
        </div>`;
      els.felt.appendChild(over);
      if(iWon){ const big=res.matchWon||res.doubleDown; sfx('sparkle'); setTimeout(()=>sfx(big?'spring':'bloom'),220); vibrate([20,60,30,60,40]); confetti(); }
      else { sfx('void'); vibrate(120); }
      if (!isGuest) over.querySelector('#gdAgain').addEventListener('click', ()=>{
        over.remove();
        if (res.matchWon){ matchLevels=[2,2]; matchDealer=0; prevResult=null; }
        else { matchLevels=res.teamLevelsAfter.slice(); matchDealer=res.nextDealerTeam;
          prevResult={ finishOrder:res.finishOrder.slice(), winnerTeam:res.winnerTeam }; }
        st=newDeal(); dealNo++; selected.clear(); hintCycle=[]; lastShownKey=''; dealAnim=true; lastMyTurn=false; lastFinishedN=0;
        customOrder=null; if(arrangeMode) setArrange(false);
        sfx('deal'); broadcast(); renderAll(); showTributeBanner();
      });
      over.querySelector('#gdDone').addEventListener('click', close);
      // F3 终局战报进聊天流(升级/双下/通关一并播报); 头游若是灵魂配一句收官台词
      const champSeat = res.finishOrder[0];
      emitBeat({ type:'over', actor:st.players[champSeat]?st.players[champSeat].name:winSide, big:true,
        text: res.matchWon ? `🏆 ${winSide}打过 A · 通关胜利！`
          : `🏁 ${winSide}升级 ${lvlFrom}→${lvlTo}（+${res.advance} · ${res.doubleDown?'双下':'单下'}）`,
        quip: beatQuip(champSeat, 'win') });
      if(typeof opts.onResult==='function'){ try{ opts.onResult(res, st.log, { mySeat }); }catch(_){} }
      if (minimized) updateChip();   // 折叠中终局: 片子翻到"点看战报"态并高亮
    }

    function renderAll(){
      renderSeats(); renderTable(); renderHand(); setBanner(); renderCtrl();
      armTurn(minimized ? null : onHumanTimeout);   // 折叠期间不催我的回合(离席看聊天不该被自动过牌)
      if (minimized) updateChip();
    }

    renderAll();
    showTributeBanner();
    if (!isGuest) broadcast();   // host: 开局首帧即广播(顺带写各远程席初始手牌)
    return { close, minimize, restore, isMinimized:()=>minimized, state:()=>st, mySeat:()=>mySeat,
      applyMove, setConn, connState:()=>connState,
      onSnapshot: applySnapshot, feedHand, resync: broadcast, isGuest:()=>isGuest,
      onRoomMsg:m=>{ if(dock) dock.onRoomMsg(m); } };
  }

  function rand(a){ return a[Math.floor(secureRand()*a.length)]; }
  function secureRand(){ try{ const x=new Uint32Array(1); crypto.getRandomValues(x); return x[0]/4294967296; }catch(_){ return Math.random(); } }
  function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function playErr(code){
    return ({ cannot_beat:'压不过上家', illegal_type:'不是合法牌型', not_your_turn:'还没轮到你',
      not_in_hand:'牌不在手上', empty_play:'先选牌' })[code] || '出牌无效';
  }

  root.EHGuandanGame = { open };
})(window);
