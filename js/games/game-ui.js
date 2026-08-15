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
  box-shadow:0 2px 5px rgba(0,0,0,.35);border:1px solid rgba(0,0,0,.08);user-select:none;font-family:'Arial Narrow',Arial,sans-serif}
.card.red{color:#e0263e}.card.blk{color:#1a1e28}
.card .cn{position:absolute;top:3px;left:4px;font-size:var(--cn,15px);font-weight:800;line-height:1;text-align:center}
.card .cs{position:absolute;top:18px;left:5px;font-size:var(--cs,12px);line-height:1}
.card .cc{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:var(--cc,25px);opacity:.92}
.card.joker .cc{font-size:calc(var(--cc,25px) * .76)}
.card.joker.big{background:linear-gradient(150deg,#fff,#ffe9b8)}
.card.joker.small{background:linear-gradient(150deg,#fff,#e8ecff)}
.card.back{background:repeating-linear-gradient(45deg,#243056,#243056 5px,#1a2440 5px,#1a2440 10px);border:1px solid #3a4a80}
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
    const names = opts.names || ['你', '灵魂·左', '灵魂·右'];
    const avatars = opts.avatars || ['🙂','🤖','👾'];
    const gameIsAI = opts.isAI || [false,true,true];                    // 联机: host 按座位实况标人/机
    // 对手 DOM 槽位: 以 mySeat 为基, 顺位 (me+1)/(me+2)(单机 mySeat=0 时恰为 1/2)
    const OPP_SEATS = [(mySeat+1)%3, (mySeat+2)%3];
    let st = Engine.createGame({ isAI: gameIsAI, names });
    let selected = new Set();     // 选中的 card id
    let hintCycle = [];           // 提示循环队列
    let hintIdx = 0;

    // ── 音效 + 触感(复用聊天室 EhSfx 合成器; 未加载则静默, 全程 try/catch 不打断牌局) ──
    function sfx(n){ try{ if(root.EhSfx && root.EhSfx.play) root.EhSfx.play(n); }catch(_){} }
    function vibrate(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(_){} }
    let dealAnim = true;          // 下一次 renderHand 播发牌错峰入场(开局/重发/再来一局各触发一次)
    let lastLord = null;          // 地主揭晓上升沿(null→定人)一次性音效
    let lastMyTurn = false;       // "轮到我"上升沿: 只在刚轮到时提示音+震动, 不每帧响
    sfx('arrive'); sfx('deal');   // 开桌一声 + 洗牌发牌

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
      <div class="ddz-hand-wrap"><div class="ddz-hand" id="ddzHand"></div></div>
      <div id="ddzCtrl"></div>
      <div class="ddz-toast" id="ddzToast"></div>`;
    mountEl.appendChild(room);

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

    function clearTimers(){
      if (aiTimer){ clearTimeout(aiTimer); aiTimer = null; }
      if (actionTimer){ clearTimeout(actionTimer); actionTimer = null; }
      if (ringRAF){ cancelAnimationFrame(ringRAF); ringRAF = null; }
    }
    function close(){ clearTimers(); room.remove(); }
    $('#ddzX').addEventListener('click', close);

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
        if (Rules.isBomb(lp.parse)) boom(lp.parse.type==='rocket'?'王 炸':'炸 弹');
        else if (lp.seat!==mySeat) sfx('cardplay');   // 对手落牌拍击音(我自己出牌的音在 doPlay)
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
    function renderHand(){
      const myTurn = st.phase==='play' && st.turn===mySeat;
      els.hand.className = 'ddz-hand' + (myTurn?'':' locked');
      els.hand.innerHTML = '';
      const deal = dealAnim; dealAnim = false;   // 只在发牌那一帧错峰入场, 之后普通重绘不动画
      st.players[mySeat].hand.forEach((card, idx)=>{
        const el = cardEl(card);
        if (selected.has(card.id)) el.classList.add('sel');
        if (deal){ el.style.animationDelay = (idx*20)+'ms'; el.classList.add('justdealt'); }
        el.addEventListener('click', ()=>{
          if (st.phase!=='play' || st.turn!==mySeat) return;
          const willSel = !selected.has(card.id);
          if (willSel) selected.add(card.id); else selected.delete(card.id);
          el.classList.toggle('sel');
          if (willSel) sfx('cardsel');   // 选牌轻触音(取消不响)
          updatePlayBtn();
        });
        els.hand.appendChild(el);
      });
    }

    // ── 轮次横幅 + 倒计时环 ──
    function setBanner(){
      const b = els.banner;
      if (st.phase==='over'){ b.className='ddz-turnbanner'; b.textContent=''; return; }
      const seat = st.phase==='bid' ? st.bid.turn : st.turn;
      const mine = seat===mySeat;
      const verb = st.phase==='bid' ? '叫分' : '出牌';
      if (mine){
        b.className = 'ddz-turnbanner mine';
        b.innerHTML = `🫵 轮到你${verb} <span class="clk" id="ddzClk"></span>`;
      } else {
        b.className = 'ddz-turnbanner';
        b.innerHTML = `${escapeHtml(st.players[seat].name)} ${st.phase==='bid'?'思考叫分':'思考出牌'}中… <span class="clk" id="ddzClk"></span>`;
      }
    }
    // 倒计时环:驱动当前活动座位的 conic 环 + 横幅秒数; 到点跑 onExpire(仅人类)
    function armTurn(onExpire){
      clearTimers();
      if (st.phase==='over') return;
      const seat = st.phase==='bid' ? st.bid.turn : st.turn;
      turnSeatActive = seat;
      const mine = seat===mySeat;
      if (mine && !lastMyTurn){ sfx('yourturn'); vibrate(18); }   // 刚轮到我: 提示音+震动(上升沿, 不每帧响)
      lastMyTurn = mine;
      turnDur = mine ? (st.phase==='bid'?HUMAN_BID_MS:HUMAN_PLAY_MS) : (AI_MIN_MS + Math.floor(secureRand()*AI_JIT_MS));
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

      if (!mine){
        // AI:到点自己行动(环长度=思考时长)
        aiTimer = setTimeout(()=>aiStep(seat), turnDur);
      }
    }
    function seatOf(seat){
      return els.opps.querySelector(`.ddz-seat[data-seat="${seat}"]`)
          || els.me.querySelector(`.ddz-seat[data-seat="${seat}"]`);
    }

    // ── 控制区:叫地主 / 出牌 ──
    function renderCtrl(){
      if (st.phase === 'bid'){
        if (st.bid.turn === mySeat) renderBidBar();
        else els.ctrl.innerHTML = `<div class="ddz-bidbar"><div class="q">等待 ${escapeHtml(st.players[st.bid.turn].name)} 叫分…</div></div>`;
      } else if (st.phase === 'play'){
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
      try { var r = Engine.applyCall(st, seat, val); }
      catch(e){ toast('不能这样叫'); return; }
      if (val>0) say(seat, val+'分！'); else say(seat,'不叫');
      if (r && r.redeal){ toast('都不叫，重新发牌'); st = Engine.createGame({isAI:gameIsAI,names}); selected.clear(); dealAnim=true; lastLord=null; lastMyTurn=false; sfx('deal'); renderAll(); return; }
      renderAll();
    }
    function doPlay(){
      const cards = [...selected].map(findCardById);
      try { var r = Engine.applyPlay(st, mySeat, cards); }
      catch(e){ toast(playErr(e.message)); return; }
      if (!Rules.isBomb(r && r.played)) sfx('cardplay');   // 出牌拍击音(炸弹交给 boom, 不叠)
      selected.clear(); hintCycle=[];
      renderAll();
      if (r && r.over){ showOver(); return; }
    }
    function doPass(seat){
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
      clearTimers();
      const res = st.result;
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
      over.querySelector('#ddzAgain').addEventListener('click', ()=>{
        over.remove(); st = Engine.createGame({isAI:gameIsAI,names}); selected.clear(); hintCycle=[]; lastShownKey=''; dealAnim=true; lastLord=null; lastMyTurn=false; sfx('deal'); renderAll();
      });
      over.querySelector('#ddzDone').addEventListener('click', close);
      if (typeof opts.onResult === 'function'){
        try { opts.onResult(res, st.log, { mySeat, roleTxt }); } catch(_){}
      }
    }

    // 每次状态推进后统一重绘 + 重新武装当前回合(倒计时/AI 行动)
    function renderAll(){
      if (lastLord===null && st.landlord!=null) sfx('landlord');   // 地主刚揭晓: 号角定音
      lastLord = st.landlord;
      renderSeats(); renderTable(); renderHand(); setBanner(); renderCtrl();
      armTurn(onHumanTimeout);
    }

    // 开局
    renderAll();
    return { close, state:()=>st };
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
