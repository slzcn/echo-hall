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
.gd-seat.win .gd-avr .av{border-color:var(--amber,#ffc24d);box-shadow:0 0 16px var(--amber,rgba(255,194,77,.7))}
.gd-seat.win .nm{color:var(--amber,#ffc24d);font-weight:700}
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
.gd-played.fly-left{animation:gdFlyLeft .28s cubic-bezier(.2,.9,.3,1)}
.gd-played.fly-right{animation:gdFlyRight .28s cubic-bezier(.2,.9,.3,1)}
@keyframes gdFlyTop{from{transform:translateY(-46px) scale(.78);opacity:0}to{transform:none;opacity:1}}
@keyframes gdFlyBot{from{transform:translateY(48px) scale(.78);opacity:0}to{transform:none;opacity:1}}
@keyframes gdFlyLeft{from{transform:translateX(-56px) scale(.78);opacity:0}to{transform:none;opacity:1}}
@keyframes gdFlyRight{from{transform:translateX(56px) scale(.78);opacity:0}to{transform:none;opacity:1}}
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
.gd-tribute .tb-back{opacity:.82}
/* 接风横幅: 队友接出下一手时轻提示(比炸弹 boom 收敛, 不震屏) */
.gd-jiefeng{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);font-size:24px;font-weight:800;letter-spacing:.08em;
  color:var(--accent,#2fe0c8);text-shadow:0 0 14px rgba(47,224,200,.55);pointer-events:none;z-index:6;animation:gdJiefeng 1.5s ease-out forwards}
@keyframes gdJiefeng{0%{transform:translate(-50%,-50%) scale(.6) translateX(-30px);opacity:0}18%{transform:translate(-50%,-50%) scale(1);opacity:1}80%{opacity:1}100%{transform:translate(-50%,-50%) scale(1) translateX(24px);opacity:0}}
/* 进贡飞牌: 贡牌从进贡席飞向收贡席(对标欢乐掼蛋的进贡桥段, 让"谁给谁"看得见) */
.gd-fly-card{position:absolute;z-index:12;pointer-events:none;box-shadow:0 8px 22px rgba(0,0,0,.55);
  transition:transform .7s cubic-bezier(.4,.05,.2,1),opacity .7s ease-out;will-change:transform,opacity}
/* 级牌徽标: 当前台面打几做成醒目金牌(对标大厂顶部级牌位) */
.gd-lvl .lv-now{display:inline-flex;align-items:center;gap:3px;color:#3a2600;background:linear-gradient(150deg,#ffd76a,#ffb020);
  border-radius:999px;padding:1px 8px;font-weight:900;margin-right:5px;box-shadow:0 1px 5px rgba(255,176,32,.4)}
.gd-lvl .lv-now.bump{animation:gdLvlBump .5s ease-out}
@keyframes gdLvlBump{0%{transform:scale(1)}40%{transform:scale(1.32)}100%{transform:scale(1)}}
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
.gd-hand{display:flex;flex-direction:column;gap:6px;padding:var(--hand-pad,16px) 0 4px;min-height:0;touch-action:none}
.gd-hand-row{display:flex;justify-content:center;flex-wrap:nowrap;min-height:0}
.gd-hand-row.top:empty{display:none}
.gd-hand-row .card{margin-left:var(--hand-ov,-19px);transition:transform .14s ease,box-shadow .14s;cursor:pointer;transform-origin:bottom center;margin-bottom:4px}
.gd-hand-row .card:first-child{margin-left:0}
.gd-hand.locked .card{cursor:default}
.gd-hand .card.sel{transform:translateY(-16px);box-shadow:0 6px 14px rgba(0,0,0,.4),0 0 0 2px var(--accent);z-index:2}
.gd-hand:not(.locked) .card:hover{transform:translateY(-7px)}
.gd-hand:not(.locked) .card.sel:hover{transform:translateY(-16px)}
.gd-hand .card.justdealt{animation:gdDeal .3s ease both}
/* 手动理牌: 空的上排显示成一条虚线投放区, 提示"拖到此处分组"(掼蛋 27 张可分两排码) */
.gd-hand.arranging .gd-hand-row.top:empty{display:flex;align-items:center;justify-content:center;min-height:calc(var(--cw,38px)*1.3);margin:0 10px;border:1.5px dashed var(--line2);border-radius:10px}
.gd-hand.arranging .gd-hand-row.top:empty::before{content:'⬆ 拖到此处分成上排';color:var(--dim);font-size:11px;font-weight:700;letter-spacing:.03em}
@keyframes gdDeal{from{transform:translateY(26px);opacity:0}to{transform:none;opacity:1}}
/* 理牌: 一键(短按)/手动拖排(长按) 共用一个按钮。
   放进独立表头条(in-flow, 右对齐), 不再 position:absolute 浮在牌面上——
   旧版按钮压住最右几张牌的角标(rank 在 top:3px), 满手 27 张时最右牌像"缺角/被裁";
   选牌上抬 16px 时更糟。收进表头后与牌面彻底分层, 抬牌至多贴到表头底边不再压按钮。 */
.gd-hand-wrap{position:relative}
.gd-hand-head{display:flex;justify-content:flex-end;align-items:center;padding:2px 6px 3px;min-height:22px}
.gd-sort{z-index:6;padding:5px 11px;border-radius:11px;font-size:12px;font-weight:800;
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
.gd-over .gd-remains{display:flex;flex-direction:column;gap:5px;align-items:center;max-width:100%}
.gd-over .gd-remains .rm-nm{font-size:11.5px;color:var(--sub);display:flex;align-items:center;gap:6px;letter-spacing:.02em}
.gd-over .gd-remains .rm-n{font-size:11px;color:var(--amber);font-variant-numeric:tabular-nums}
.gd-over .gd-remains .rm-cards{display:flex;padding-left:2px;max-width:100%}
.gd-over .gd-remains .rm-cards .card{margin-left:-16px;box-shadow:0 2px 5px rgba(0,0,0,.45)}
.gd-over .gd-remains .rm-cards.dense .card{margin-left:-20px}
.gd-over .gd-remains .rm-cards .card:first-child{margin-left:0}
.gd-over.out{animation:gdOverOut .32s cubic-bezier(.4,0,.9,.5) forwards;pointer-events:none}
@keyframes gdOverOut{from{opacity:1}to{opacity:0;transform:scale(.94) translateY(12px)}}
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
  // 语音报牌型(主人要求): 只报显著牌型(炸弹/天王炸/三带二/钢板/顺子…), 单张/对子/三张不絮叨。
  const VOICE_SKIP = new Set(['single','pair','trio']);
  function sayPlay(p){
    if(!p || VOICE_SKIP.has(p.type)) return;
    const lab = typeLabel(p);
    if(lab && root.EhSfx && root.EhSfx.say) root.EhSfx.say(lab);
  }

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
        <button class="gd-rot" id="gdRot" aria-label="横竖屏切换" title="横屏/竖屏">⟳</button>
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
      <div class="gd-hand-wrap"><div class="gd-hand-head"><button class="gd-sort" id="gdSort" aria-label="理牌">🔀 理牌</button></div><div class="gd-hand" id="gdHand"></div></div>
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
      // 延一帧再写气泡: 出牌/不出常在同步 afterMove→renderAll 之前调 say(), 而 renderSeats 会整段
      // 重建 .gd-seat 节点, 直接写会被当帧重建吞掉(气泡从不显示)。rAF 到点时 renderAll 已完成,
      // 查到的是新座位节点, 灵魂"不出/就剩一张咯"才真正上屏。(与斗地主/德州同源修法)
      requestAnimationFrame(()=>{
        const b = room.querySelector(`.gd-seat[data-seat="${seat}"] .gd-say`);
        if(!b) return; b.textContent=msg; b.classList.add('show'); setTimeout(()=>b.classList.remove('show'),1500);
      });
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
    function close(){ minimized=false; clearTimers(); window.removeEventListener('resize', onResize); if(root.EHTableOrient) root.EHTableOrient.clear(room); if(dock) dock.destroy(); if(chip){ chip.remove(); chip=null; } room.remove();
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
      if (root.EHTableOrient) root.EHTableOrient.clear(room); if (rotBtn) rotBtn.classList.remove('on');
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
    const rotBtn = $('#gdRot');
    if (rotBtn) rotBtn.addEventListener('click', ()=>{
      const on = root.EHTableOrient ? root.EHTableOrient.toggle(room) : false;
      rotBtn.classList.toggle('on', on); sfx('click');
      if (!minimized) layoutHand();
    });
    // 牌桌内背景音乐开关(复用 EH_BGM, 因大厅 🎵 被牌桌浮层盖住)
    const musBtn = $('#gdMus');
    function paintMus(){ if(!musBtn) return; const on = !root.EH_BGM || root.EH_BGM.on(); musBtn.textContent = on?'🎵':'🔇'; musBtn.classList.toggle('muted', !on); }
    if (musBtn) musBtn.addEventListener('click', ()=>{ try{ if(root.EH_BGM) root.EH_BGM.set(!root.EH_BGM.on()); }catch(_){} paintMus(); sfx('click'); });
    paintMus();
    window.addEventListener('resize', onResize);

    // ── 划选: 指针涂抹式多选(按下即选 / 拖过整段连选), 与点选共用 selected ──
    let painting=false, paintMode='select', paintSeen=null, paintLastIdx=null, paintCards=null;
    // 手牌现分上/下两排(掼蛋 27 张可码两排)。先按 y 定位命中哪一排, 再在该排里按 x 命中"露出的那张":
    // 左→右叠放后牌盖前牌右半, elementFromPoint 在牌中心会命中右邻牌(漏最左那张) → 改逐张比左沿。
    function rowAt(y){
      const rowsEl=[...els.hand.children].filter(r=>r.children.length);
      if(!rowsEl.length) return null;
      for(const r of rowsEl){ const rr=r.getBoundingClientRect(); if(y>=rr.top-26 && y<=rr.bottom+26) return r; }
      // 落在两排之外: 取竖直中心最近的一排(拖到边缘也不丢牌)
      let best=null, bd=Infinity;
      for(const r of rowsEl){ const rr=r.getBoundingClientRect(); const d=Math.abs(y-(rr.top+rr.bottom)/2); if(d<bd){ bd=d; best=r; } }
      return best;
    }
    function handCardAt(x,y){
      const row=rowAt(y); if(!row) return null;
      const kids=row.children, n=kids.length; if(!n) return null;
      let pick=kids[0];
      for(let i=0;i<n;i++){ if(x >= kids[i].getBoundingClientRect().left-0.5) pick=kids[i]; else break; }
      return pick;
    }
    function applyPaintIdx(i){
      const c = paintCards ? paintCards[i] : els.hand.querySelectorAll('.card')[i]; if(!c) return;
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
    function endPaint(){
      const wasSelect = painting && paintMode==='select';
      painting=false; paintSeen=null; paintLastIdx=null; paintCards=null;
      if (wasSelect && autoExtendSelection()){ renderHand(); updatePlayBtn(); sfx('cardsel'); }
    }
    els.hand.addEventListener('pointerdown', (e)=>{
      if(arrangeMode){ startReorder(e); return; }        // 手动理牌: 拖牌重排(暂停划选)
      if(st.phase!=='play' || st.turn!==mySeat) return;
      const c=handCardAt(e.clientX,e.clientY); if(!c) return;
      painting=true; paintSeen=new Set(); paintLastIdx=null;
      paintCards=[...els.hand.querySelectorAll('.card')];   // 全局阅读序(上排→下排), 供区间连选按 data-idx 补齐
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
    // rows=null 时 renderHand 走 Rules.sortHand 自动理牌(全在下排); 非空则按 {top,bot} 两排的 id 顺序摆。
    // 掼蛋手牌多(27 张), 允许上下两排码牌: 拖一张到上方虚线区=分到上排, 拖回下方=下排, 排内按 x 定位插入。
    let rows = null, arrangeMode = false;
    let dragCard = null, dragId = null, dragStartX = 0, dragStartY = 0;
    function setArrange(on){
      arrangeMode = on;
      const btn = $('#gdSort'); if(btn){ btn.classList.toggle('active', on); btn.innerHTML = on ? '✓ 完成' : '🔀 理牌'; }
      els.hand.classList.toggle('arranging', on);
      if(on){ vibrate(15); selected.clear(); renderHand(); updatePlayBtn(); toast('拖动手牌自由排序 · 拖到上方可分成两排'); }
      else renderHand();
    }
    function autoSort(){ rows = null; renderHand(); sfx('cardsel'); toast('已按大小理牌'); }
    // 读当前 DOM 两排的 id 顺序(落位重算的基准)
    function domRows(){
      const [topEl, botEl] = els.hand.children;
      return { top:[...(topEl?topEl.children:[])].map(c=>c.dataset.id),
               bot:[...(botEl?botEl.children:[])].map(c=>c.dataset.id) };
    }
    function startReorder(e){
      const c = handCardAt(e.clientX,e.clientY); if(!c) return;
      dragCard = c; dragId = c.dataset.id; dragStartX = e.clientX; dragStartY = e.clientY;
      c.classList.add('dragging');
      try{ els.hand.setPointerCapture(e.pointerId); }catch(_){}
      e.preventDefault();
    }
    function moveReorder(e){
      if(!dragCard) return;
      const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
      dragCard.style.transform = `translate(${dx}px,${dy-6}px) scale(1.06)`;
      e.preventDefault();
    }
    function endReorder(e){
      if(!dragCard) return;
      const dropX = e.clientX, dropY = e.clientY;
      const cur = domRows();
      cur.top = cur.top.filter(id=>id!==dragId); cur.bot = cur.bot.filter(id=>id!==dragId);
      // 目标排: 放下点在"下排上沿"之上 → 上排, 否则下排(上排空时其虚线投放区已占位, 故可拖上去建排)
      const botEl = els.hand.children[1];
      const boundary = botEl ? botEl.getBoundingClientRect().top : dropY;
      const target = dropY < boundary ? 'top' : 'bot';
      const rowEl = els.hand.children[target==='top'?0:1];
      const arr = target==='top' ? cur.top : cur.bot;
      const others = [...(rowEl?rowEl.children:[])].filter(c=>c!==dragCard);
      let insert = others.length;
      for(let i=0;i<others.length;i++){ const r=others[i].getBoundingClientRect(); if(dropX < r.left + r.width/2){ insert=i; break; } }
      arr.splice(insert, 0, dragId);
      rows = { top:cur.top, bot:cur.bot };
      dragCard.classList.remove('dragging'); dragCard.style.transform=''; dragCard.style.zIndex='';
      dragCard = null; dragId = null;
      sfx('cardsel'); vibrate(10); renderHand();
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
      const isWin = st.phase==='over' && st.result && Engine.teamOf(seat)===st.result.winnerTeam;
      return `<div class="gd-seat${st.turn===seat&&st.phase!=='over'?' turn':''}${isMate?' mate':''}${alarm?' alarm':''}${isWin?' win':''}" data-seat="${seat}" style="--p:360">
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
      const lvlChanged = (lastLevel!=null && lastLevel!==st.level);
      els.lvl.innerHTML = `<span class="lv-now${lvlChanged?' bump':''}">🎯 打 ${LVL_LABEL(st.level)}</span>我方 <b>${LVL_LABEL(st.teamLevels[Engine.teamOf(mySeat)])}</b> · 对方 <b>${LVL_LABEL(st.teamLevels[1-Engine.teamOf(mySeat)])}</b>`;
      lastLevel = st.level;
    }

    let lastShownKey='';
    let lastLevel=null;          // 台面级(打几)变化上升沿 → 级牌徽标跳动
    function playKey(){ const lp=st.table.lastPlay; if(!lp) return st.table.passesInRow>0?('pass:'+st.turn):'empty'; return lp.seat+':'+lp.cards.join(','); }
    function renderTable(){
      const lp = st.table.lastPlay;
      const key = playKey(); const changed = key!==lastShownKey; lastShownKey=key;
      if (!lp){
        els.who.textContent=''; els.played.className='gd-played';
        els.played.innerHTML = st.phase==='play' ? `<div class="gd-passtag">新一圈 · 随意出</div>` : '';
        return;
      }
      // 台面直接标出这手的牌型(顺子/连对/钢板/炸弹…), 免玩家自己数牌辨型
      const tl = typeLabel(lp.parse);
      els.who.textContent = st.players[lp.seat].name + ' 出' + (tl?(' · '+tl):'') + (Engine.partnerOf(mySeat)===lp.seat?'（队友）':'');
      els.played.className='gd-played'; els.played.innerHTML='';
      lp.cards.map(findCardById).forEach(c=> els.played.appendChild(cardEl(c, st.level)));
      if (changed){
        void els.played.offsetWidth;
        // 落牌飞入方向按出牌人座位来(对标真实牌桌: 牌从谁那边推过来): 自己下家右/对家上/上家左
        els.played.classList.add(
          lp.seat===mySeat ? 'fly-bot' :
          lp.seat===SEAT_R ? 'fly-right' :
          lp.seat===SEAT_L ? 'fly-left' : 'fly-top');
        const nm = st.players[lp.seat].name;
        if (Rules.isBomb(lp.parse)){
          const bn = bombName(lp.parse);
          boom(bn);
          emitBeat({ type:'bomb', actor:nm, big:true, text:`💥 ${nm} 甩出${bn.replace(/ /g,'')}！`, quip: beatQuip(lp.seat, 'bomb') });
        } else if (lp.seat!==mySeat) sfx('cardplay');
        sayPlay(lp.parse);                                // 语音报牌型
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
    // 返回 [上排卡[], 下排卡[]]: rows=null → 上排空, 下排按级牌 Rules.sortHand 自动理牌;
    // 手动理牌后 → 各排按玩家排定 id 序; 本副新出现/未归位的牌兜到下排末尾(重发不丢牌)。
    function orderedRows(){
      const hand = st.players[mySeat].hand;
      const byId = new Map(hand.map(c=>[c.id,c]));
      if (rows){
        const placed = new Set();
        const pick = (ids)=> ids.filter(id=>byId.has(id) && !placed.has(id)).map(id=>{ placed.add(id); return byId.get(id); });
        const top = pick(rows.top);
        let bot = pick(rows.bot);
        const left = hand.filter(c=>!placed.has(c.id));
        if (left.length) bot = bot.concat(Rules.sortHand(left, st.level));
        return [top, bot];
      }
      return [[], Rules.sortHand(hand, st.level)];
    }
    let lastHandSig = '';
    function renderHand(){
      const myTurn = st.phase==='play' && st.turn===mySeat && !(isGuest && awaitingHost);
      const [top, bot] = orderedRows();
      // 增量护栏(同斗地主): 手牌两排 id / 选中集 / 回合锁 / 理牌态 / 级牌 / 发牌帧 全未变 → 跳过重建。
      //   免每秒一次重绘的 innerHTML churn + 两排 layoutRow 强制回流; 且不在别家回合把我正拖排/涂选的 DOM 拆掉。
      //   任一变化改签名 → 照常整段重建, 与旧逻辑逐字节一致; resize 另走 layoutHand 兜底不受影响。
      const sig = (myTurn?1:0)+'|'+(arrangeMode?1:0)+'|'+(dealAnim?1:0)+'|'+st.level+'|'
        + top.map(c=>c.id).join(',')+'#'+bot.map(c=>c.id).join(',')+'|'+[...selected].sort().join(',');
      if (sig === lastHandSig) return;
      lastHandSig = sig;
      els.hand.className='gd-hand'+(myTurn||arrangeMode?'':' locked')+(arrangeMode?' arranging':'');
      els.hand.innerHTML='';
      const deal = dealAnim; dealAnim=false;
      const rowTop = document.createElement('div'); rowTop.className='gd-hand-row top'; rowTop.dataset.row='0';
      const rowBot = document.createElement('div'); rowBot.className='gd-hand-row bot'; rowBot.dataset.row='1';
      els.hand.appendChild(rowTop); els.hand.appendChild(rowBot);
      let idx = 0;   // 全局阅读序(上排先, 下排后): 供划选区间连选按 data-idx 补齐
      [[top, rowTop], [bot, rowBot]].forEach(([cards, container])=>{
        cards.forEach(card=>{
          const el = cardEl(card, st.level);
          el.dataset.idx = idx++;
          if (selected.has(card.id)) el.classList.add('sel');
          if (deal){ el.style.animationDelay=((idx-1)*11)+'ms'; el.classList.add('justdealt'); }
          container.appendChild(el);
        });
      });
      layoutHand();
    }
    // 手牌自适应: 每排各自动态收紧叠放, 永远吃满一行不换行(对标大厂手牌扇)。两排各自算步距。
    function layoutRow(container){
      const cards = container.children;
      const n = cards.length; if (!n) return;
      const W = els.hand.clientWidth; if (!W) return;
      const cw = cards[0].offsetWidth || parseFloat(getComputedStyle(room).getPropertyValue('--cw')) || 38;
      // 排满: 步距 step 使 cw + (n-1)*step ≤ W; 牌少时封顶给自然扇形叠放
      let step = n>1 ? (W - cw) / (n - 1) : 0;
      step = Math.min(step, cw * 0.64);         // 上限: 不过度分散
      // 亚像素外边距, 不 Math.round —— 取整会让每张多漂 ~0.15px, 满手 27 张累积溢出 ~10px
      // (最右一张右沿越出手牌带自身宽度)。精确到两位小数使 cw+(n-1)*step 恰好吃满 W, 严丝合缝不溢。
      const ov = (step - cw).toFixed(2);         // 负外边距(叠放量)
      for (let i=0;i<n;i++){ cards[i].style.marginLeft = i===0 ? '0px' : ov+'px'; }
    }
    function layoutHand(){ for (const row of els.hand.children) layoutRow(row); }

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
      // 降频: 每帧只在整度数/整秒变化时才写 DOM(conic 环 1° 步进视觉等价), 免每秒几十次无谓重绘回流。
      let lastDeg=-1, lastSec=-1;
      const tick=()=>{
        const remain=Math.max(0,turnDur-(Date.now()-turnStart));
        const frac=turnDur?(remain/turnDur):0;
        const deg=Math.round(frac*360);
        if(seatEl && deg!==lastDeg){ seatEl.style.setProperty('--p',deg); lastDeg=deg; }
        if(mine && clk){ const sec=Math.ceil(remain/1000); if(sec!==lastSec){ clk.textContent=sec+'s'; clk.classList.toggle('urgent',sec<=5); lastSec=sec; } }
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
        plays = AI.hints({ hand: st.players[mySeat].hand, tableParse:target, level:st.level, seat:mySeat, handsLeft: st.players.map(p=>p.hand.length) });
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

    // ── 智能补选: 选了搭子的一头, 自动补成定长连张 ────────────────
    //   掼蛋牌型定长: 顺子=5连单 / 连对(pairline)=3连对 / 钢板(trioline)=2连三。
    //   选 4,5 → 补成 45678 顺子; 选 44,55 → 补 66 成三连对; 选 三张×1 已是三张(合法)不动。
    //   规则同斗地主: ①我方回合、增选手势后; ②只补不删; ③已成型且够用不动;
    //   ④选区须同形且点可连(3..A, 不含 2/王); ⑤【排除百搭/级牌 wild】——补牌不吃百搭,
    //   让百搭由玩家自己安排, 免得猜错; ⑥领出向上扩, 跟牌补到能压过桌面的最低窗口;
    //   ⑦一律以 Rules.parse(out, level) + beats 终判, 补不成就原样不动。返回 true=改了选区。
    function autoExtendSelection(){
      if (st.phase!=='play' || st.turn!==mySeat) return false;
      const level = st.level;
      const hand = (st.players[mySeat] && st.players[mySeat].hand) || [];
      const sel = [...selected].map(findCardById).filter(Boolean);
      if (sel.length < 2) return false;
      if (sel.some(c=>Rules.isWild(c, level))) return false;   // 选区含百搭 → 太微妙, 不猜
      const target = (st.table.lastPlay && st.table.lastPlay.seat!==mySeat) ? st.table.lastPlay.parse : null;
      const curP = Rules.parse(sel, level);
      if (curP && (!target || Rules.beats(curP, target, level))) return false;
      // 同形校验(按自然点分组)
      const byR = new Map();
      for (const c of sel){ if(!byR.has(c.rank)) byR.set(c.rank,[]); byR.get(c.rank).push(c); }
      const ranks = [...byR.keys()].sort((a,b)=>a-b);
      if (ranks.some(r=>r>14)) return false;                   // 2(15)/王 不进连张
      const per = byR.get(ranks[0]).length;
      if (per<1 || per>3) return false;
      if (ranks.some(r=>byR.get(r).length!==per)) return false;
      const lo = ranks[0], hi = ranks[ranks.length-1];
      // 手牌各点【非百搭】可用张数(补牌不消耗百搭)
      const handByR = new Map();
      for (const c of hand){ if(Rules.isWild(c, level)) continue; if(!handByR.has(c.rank)) handByR.set(c.rank,[]); handByR.get(c.rank).push(c); }
      const has = r => (r>=3 && r<=14 && handByR.has(r) && handByR.get(r).length>=per);
      for (let r=lo; r<=hi; r++) if(!has(r)) return false;
      const needLen = per===1 ? 5 : per===2 ? 3 : 2;           // 掼蛋定长
      if (hi-lo+1 > needLen) return false;
      // 跟牌只补同型连张
      if (target){
        const wantPer = target.type==='straight'?1 : target.type==='pairline'?2 : target.type==='trioline'?3 : 0;
        if (wantPer!==per) return false;
      }
      // 候选窗口顺序: 领出优先 s=lo(向上扩); 跟牌从最低窗口起(升序), 终判交给 parse+beats
      const windows=[];
      if (target){ for(let s=Math.max(3,hi-needLen+1); s<=lo; s++) windows.push(s); }
      else { for(let s=lo; s>=Math.max(3,hi-needLen+1); s--) windows.push(s); }
      for (const s of windows){
        const e = s+needLen-1;
        if (e>14 || e<hi || s>lo) continue;
        let ok=true; for(let r=s;r<=e;r++) if(!has(r)){ ok=false; break; }
        if(!ok) continue;
        const out=[];
        for (let r=s; r<=e; r++){
          const take=(byR.get(r)||[]).slice(0,per);
          if (take.length<per){ for(const c of handByR.get(r)){ if(take.length>=per) break; if(!selected.has(c.id)) take.push(c); } }
          out.push(...take);
        }
        if (out.length===sel.length) continue;
        const p2 = Rules.parse(out, level);
        if (!p2) continue;
        if (target && !Rules.beats(p2, target, level)) continue;
        selected = new Set(out.map(c=>c.id));
        return true;
      }
      return false;
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
      try{ var rp=Engine.applyPass(st, seat); }catch(e){ toast('现在不能不出'); return; }
      if(seat===mySeat) sfx('pass');
      say(seat,'不出'); afterMove(rp);
    }
    function doHint(){
      const hand=st.players[mySeat].hand;
      const target=(st.table.lastPlay && st.table.lastPlay.seat!==mySeat)?st.table.lastPlay.parse:null;
      if(!hintCycle.length){
        // best-first: 能一把走完排最前(剩一对提示打对子而非拆单张), 领出走长牌型、跟牌走最小代价
        hintCycle = AI.hints({ hand, tableParse:target, level:st.level, seat:mySeat, handsLeft: st.players.map(p=>p.hand.length) }); hintIdx=0;
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
        if(move.action==='pass'){ const rp=Engine.applyPass(st, seat); say(seat,'不出'); afterMove(rp); return true; }
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
        finished: st.finished ? st.finished.slice() : [],
        handsLeft: st.players.map(p=>p.hand.length), level: st.level });
      if(mv.action==='pass'){
        let rp;
        try{ rp=Engine.applyPass(st,seat); }
        catch(e){ rp=Engine.applyPlay(st,seat, AI.chooseLead(st.players[seat].hand, st.level)); }
        say(seat,'不出'); afterMove(rp); return;
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
      // 接风: 控制者打完、由队友接出下一手 —— 掼蛋特有规则, 新手常懵"怎么轮到队友领出", 明确播报一下。
      // 放在 renderAll 之后(否则被整段重建吞掉), 且只在真·接风(jiefeng)时提示, 普通赢圈不打扰。
      if (r && r.trickEnd && r.jiefeng && st.players[r.leader]) jiefengBanner(st.players[r.leader].name);
      if (r && r.over){ showOver(); }
    }
    // 接风提示: 居中轻横幅(比炸弹 boom 收敛, 不震屏), 自动消失
    function jiefengBanner(name){
      const b=document.createElement('div'); b.className='gd-jiefeng'; b.textContent='🌬️ '+escapeHtml(name)+' 接风';
      els.felt.appendChild(b); setTimeout(()=>b.remove(),1500);
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
        dealAnim=true; selected.clear(); hintCycle=[]; rows=null;
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

    // 进贡飞牌: 贡牌从进贡席飞向收贡席(对标欢乐掼蛋)。坐标相对 room 算, 可跨 felt/me 两区。
    function flyTributeCard(fromSeat, toSeat, card, delay){
      const fromEl = room.querySelector(`.gd-seat[data-seat="${fromSeat}"] .gd-avr`);
      const toEl   = room.querySelector(`.gd-seat[data-seat="${toSeat}"] .gd-avr`);
      if (!fromEl || !toEl || !card) return;
      const rr = room.getBoundingClientRect(), fr = fromEl.getBoundingClientRect(), tr = toEl.getBoundingClientRect();
      const fly = cardEl(card, st.level); fly.classList.add('gd-fly-card');
      room.appendChild(fly);
      const fw = fly.offsetWidth || 40, fh = fly.offsetHeight || 56;
      fly.style.left = (fr.left - rr.left + fr.width/2 - fw/2) + 'px';
      fly.style.top  = (fr.top  - rr.top  + fr.height/2 - fh/2) + 'px';
      fly.style.opacity = '0';
      const dx = (tr.left - fr.left), dy = (tr.top - fr.top);
      setTimeout(()=>{
        fly.style.opacity = '1';
        requestAnimationFrame(()=>{
          fly.style.transform = `translate(${dx}px,${dy}px) scale(.66) rotate(6deg)`;
          fly.style.opacity = '.2';
        });
        sfx('cardplay');
        setTimeout(()=>fly.remove(), 760);
      }, delay||0);
    }
    // 进贡横幅(开局若有进贡, 展示 1 条并自动消失; 非抗贡时贡牌飞一手)
    function showTributeBanner(){
      if (!st.tribute) return;
      const box=document.createElement('div'); box.className='gd-tribute';
      if (st.tribute.refused){
        box.innerHTML=`<div class="th">🛡️ 抗贡成功</div><div class="tl">输方手握双大王，免于进贡</div>`;
      } else {
        const cardLab = c => c ? (c.joker?(c.joker==='big'?'大王':'小王'):(c.suit+c.label)) : '牌';
        const rows = (st.tribute.transfers||[]).map(t=>{
          const gc = findCardById(t.give), bc = t.back!=null ? findCardById(t.back) : null;
          const nameF = escapeHtml(st.players[t.from].name), nameT = escapeHtml(st.players[t.to].name);
          // 进贡(输家→赢家) + 还贡(赢家挑一张小牌还回), 两条都摆明, 让"贡了什么、还了什么"闭环可见
          const give = `<span>${nameF} 进贡 <b style="color:var(--amber)">${cardLab(gc)}</b> → ${nameT}</span>`;
          const back = bc ? `<span class="tb-back">${nameT} 还贡 <b style="color:var(--sub)">${cardLab(bc)}</b> → ${nameF}</span>` : '';
          return give + back;
        }).join('');
        box.innerHTML=`<div class="th">🎁 进贡 · ${st.tribute.doubleDown?'双下双贡':'单贡'}</div><div class="tl">${rows}</div>`;
        // 逐张飞牌: 先进贡(输家→赢家), 再还贡(赢家→输家)错峰接续, 双贡不重叠
        (st.tribute.transfers||[]).forEach((t,i)=>{
          flyTributeCard(t.from, t.to, findCardById(t.give), 360 + i*420);
          if (t.back!=null) flyTributeCard(t.to, t.from, findCardById(t.back), 1240 + i*420);
        });
      }
      els.felt.appendChild(box);
      sfx('echo');
      // 有还贡飞牌时多留一会(让 1240+ 的还贡动画落地再淡出)
      const hold = (!st.tribute.refused && (st.tribute.transfers||[]).some(t=>t.back!=null)) ? 3400 : 2600;
      setTimeout(()=>{ box.style.transition='opacity .4s'; box.style.opacity='0'; setTimeout(()=>box.remove(),420); }, hold);
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
        <div class="gd-remains" id="gdRemains"></div>
        <div class="lvlup">${lvlLine}</div>
        <div class="gd-acts" style="margin-top:4px">
          <button class="gd-btn" id="gdAgain" ${isGuest?'disabled':''}>${againLabel}</button>
          <button class="gd-btn primary" id="gdDone">收工</button>
        </div>`;
      els.felt.appendChild(over);
      // 残局(对标腾讯亮残牌): 掼蛋终局只有末游还捏着牌 → 亮它剩了哪些, 让人看清"卡在哪几张"。
      const remainBox = over.querySelector('#gdRemains');
      if (remainBox){
        const reveal = res.reveal || {};
        const lastSeat = res.finishOrder[res.finishOrder.length-1];
        const lastIds = reveal[lastSeat] || [];
        if (!lastIds.length){ remainBox.remove(); }
        else {
          const lp = st.players[lastSeat];
          const meL = lastSeat===mySeat, mateL = Engine.partnerOf(mySeat)===lastSeat;
          const nm = document.createElement('div'); nm.className='rm-nm';
          nm.innerHTML = `末游 ${escapeHtml(lp.name)}${meL?'（你）':(mateL?'（队友）':'')} <span class="rm-n">剩${lastIds.length}</span>`;
          const cards = document.createElement('div'); cards.className='rm-cards';
          if (lastIds.length > 18) cards.classList.add('dense');
          lastIds.map(findCardById).filter(Boolean).forEach(c=> cards.appendChild(cardEl(c, st.level, {mini:true})));
          remainBox.appendChild(nm); remainBox.appendChild(cards);
        }
      }
      if(iWon){ const big=res.matchWon||res.doubleDown; sfx('sparkle'); setTimeout(()=>sfx(big?'spring':'bloom'),220); vibrate([20,60,30,60,40]); confetti(); }
      else { sfx('void'); vibrate(120); }
      const againBtn = over.querySelector('#gdAgain');
      const clearAgainTimer = ()=>{ if (over._againTimer){ clearInterval(over._againTimer); over._againTimer=null; } };
      if (!isGuest){
        const startRematch = ()=>{
          if (over._leaving) return; over._leaving = true;   // 防连点: 过渡中重复点被吞, 不重复开副
          clearAgainTimer();
          // 先把下一副的升级/庄/进贡上下文捕获好(同步), 再走淡出 → 重建, 避免瞬拆硬切(对标腾讯"打下一副"衔接)。
          if (res.matchWon){ matchLevels=[2,2]; matchDealer=0; prevResult=null; }
          else { matchLevels=res.teamLevelsAfter.slice(); matchDealer=res.nextDealerTeam;
            prevResult={ finishOrder:res.finishOrder.slice(), winnerTeam:res.winnerTeam }; }
          over.classList.add('out');
          const go = ()=>{
            over.remove();
            st=newDeal(); dealNo++; selected.clear(); hintCycle=[]; lastShownKey=''; dealAnim=true; lastMyTurn=false; lastFinishedN=0;
            rows=null; if(arrangeMode) setArrange(false);
            sfx('deal'); broadcast(); renderAll(); showTributeBanner();
          };
          let done=false; const once=()=>{ if(done) return; done=true; go(); };
          over.addEventListener('animationend', once, { once:true });
          setTimeout(once, 400);   // 动画事件兜底(被打断/不触发也不卡在战报页)
        };
        againBtn.addEventListener('click', startRematch);
        // ★默认再来一局(主人要求): 收局后自动倒计时开下一副, 期间按钮读秒; 点它立刻开、点"收工"取消。
        //   通关(matchWon)是整场终点, 不自动续 —— 让人看清通关战报再决定新对局。折叠期间暂停读秒。
        if (!res.matchWon){
          let left = 5;
          const baseLbl = '打下一副';
          againBtn.textContent = `${baseLbl} (${left})`;
          over._againTimer = setInterval(()=>{
            if (!over.isConnected){ clearAgainTimer(); return; }
            if (minimized) return;
            left--;
            if (left <= 0){ clearAgainTimer(); startRematch(); return; }
            if (!over._leaving) againBtn.textContent = `${baseLbl} (${left})`;
          }, 1000);
        }
      }
      over.querySelector('#gdDone').addEventListener('click', ()=>{ clearAgainTimer(); close(); });
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
