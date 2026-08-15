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
.gd-bar{display:flex;align-items:center;gap:10px;padding:11px 15px;border-bottom:1px solid var(--line,rgba(0,229,212,.24));flex-shrink:0}
.gd-title{font-weight:800;letter-spacing:.06em;color:var(--ink,#eaf6ff);font-size:15px;display:flex;align-items:center;gap:8px}
.gd-title .dot{width:8px;height:8px;border-radius:50%;background:var(--accent,#00e5d4);box-shadow:var(--glow-cyan)}
.gd-lvl{font-size:12px;color:var(--amber,#ffc24d);font-weight:700;padding:2px 9px;border:1px solid var(--line);border-radius:999px;white-space:nowrap}
.gd-lvl b{color:#fff}
.gd-x{margin-left:auto;height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:transparent;
  color:var(--sub,#86cbc6);font-size:13px;cursor:pointer;display:flex;align-items:center;gap:5px}
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
  box-shadow:0 2px 5px rgba(0,0,0,.35);border:1px solid rgba(0,0,0,.08);user-select:none;font-family:'Arial Narrow',Arial,sans-serif}
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
.card.back{background:repeating-linear-gradient(45deg,#243056,#243056 5px,#1a2440 5px,#1a2440 10px);border:1px solid #3a4a80}
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
    const names = opts.names || ['你','下家','对家','上家'];
    const avatars = opts.avatars || ['🙂','🤖','🤝','👾'];
    // 座位→DOM 槽位: 以 mySeat 为底, 顺时针 下家(右)/对家(上)/上家(左) 相对旋转(单机 mySeat=0 时恰为 1/2/3)
    const SEAT_R = (mySeat+1)%4, SEAT_T = (mySeat+2)%4, SEAT_L = (mySeat+3)%4;
    // 对局延续态(再来一局用): 队等级 + 上局结果(触发进贡)
    let matchLevels = (opts.match && opts.match.teamLevels) ? opts.match.teamLevels.slice() : [2,2];
    let matchDealer = (opts.match && typeof opts.match.dealerTeam==='number') ? opts.match.dealerTeam : 0;
    let prevResult = (opts.match && opts.match.prevResult) || null;

    function newDeal(){
      return Engine.createGame({ isAI: opts.isAI || [false,true,true,true], names,
        teamLevels: matchLevels, dealerTeam: matchDealer,
        level: matchLevels[matchDealer], prevResult });
    }
    let st = newDeal();
    let selected = new Set();
    let hintCycle = [], hintIdx = 0;

    function sfx(n){ try{ if(root.EhSfx && root.EhSfx.play) root.EhSfx.play(n); }catch(_){} }
    function vibrate(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(_){} }
    let dealAnim = true, lastMyTurn = false, lastFinishedN = 0;
    let lastSelTick = 0;
    sfx('arrive'); sfx('deal');

    let aiTimer=null, ringRAF=null, turnStart=0, turnDur=0;

    const mountEl = opts.mount || document.getElementById('hall') || document.body;
    const room = document.createElement('div'); room.className='gd-room';
    room.innerHTML = `
      <div class="gd-bar">
        <div class="gd-title"><span class="dot"></span>掼蛋</div>
        <div class="gd-lvl" id="gdLvl"></div>
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
      <div class="gd-hand-wrap"><div class="gd-hand" id="gdHand"></div></div>
      <div id="gdCtrl"></div>
      <div class="gd-toast" id="gdToast"></div>`;
    mountEl.appendChild(room);

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
    function clearTimers(){ if(aiTimer){clearTimeout(aiTimer);aiTimer=null;} if(ringRAF){cancelAnimationFrame(ringRAF);ringRAF=null;} }
    const onResize = ()=>layoutHand();
    function close(){ clearTimers(); window.removeEventListener('resize', onResize); room.remove(); }
    $('#gdX').addEventListener('click', close);
    window.addEventListener('resize', onResize);

    // ── 划选: 指针涂抹式多选(按下即选 / 拖过整段连选), 与点选共用 selected ──
    let painting=false, paintMode='select', paintSeen=null, paintLastIdx=null;
    function handCardAt(x,y){ const el=document.elementFromPoint(x,y); if(!el) return null; const c=el.closest('.card'); return (c && els.hand.contains(c)) ? c : null; }
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
      if(st.phase!=='play' || st.turn!==mySeat) return;
      const c=handCardAt(e.clientX,e.clientY); if(!c) return;
      painting=true; paintSeen=new Set(); paintLastIdx=null;
      paintMode = selected.has(c.dataset.id) ? 'deselect' : 'select';
      try{ els.hand.setPointerCapture(e.pointerId); }catch(_){}
      paintTo(c); e.preventDefault();
    });
    els.hand.addEventListener('pointermove', (e)=>{ if(painting) paintTo(handCardAt(e.clientX,e.clientY)); });
    els.hand.addEventListener('pointerup', endPaint);
    els.hand.addEventListener('pointercancel', endPaint);

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
        if (Rules.isBomb(lp.parse)) boom(bombName(lp.parse));
        else if (lp.seat!==mySeat) sfx('cardplay');
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

    function renderHand(){
      const myTurn = st.phase==='play' && st.turn===mySeat;
      els.hand.className='gd-hand'+(myTurn?'':' locked');
      els.hand.innerHTML='';
      const deal = dealAnim; dealAnim=false;
      const sorted = Rules.sortHand(st.players[mySeat].hand, st.level);
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
      const b=els.banner;
      if (st.phase==='over'){ b.className='gd-banner'; b.textContent=''; return; }
      const seat=st.turn, mine=seat===mySeat;
      if (mine){ b.className='gd-banner mine'; b.innerHTML=`🫵 轮到你出牌 <span class="clk" id="gdClk"></span>`; }
      else { b.className='gd-banner'; b.innerHTML=`${escapeHtml(st.players[seat].name)} 思考中… <span class="clk" id="gdClk"></span>`; }
    }
    function seatOf(seat){ return room.querySelector(`.gd-seat[data-seat="${seat}"]`); }
    function armTurn(onExpire){
      clearTimers();
      if (st.phase==='over') return;
      const seat=st.turn, mine=seat===mySeat;
      if (mine && !lastMyTurn){ sfx('yourturn'); vibrate(18); }
      lastMyTurn=mine;
      turnDur = mine ? HUMAN_PLAY_MS : (AI_MIN_MS + Math.floor(secureRand()*AI_JIT_MS));
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
      if(!mine) aiTimer=setTimeout(()=>aiStep(seat), turnDur);
    }

    function renderCtrl(){
      if (st.phase!=='play'){ els.ctrl.innerHTML=''; return; }
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
      try{ var r=Engine.applyPlay(st, mySeat, cards); }
      catch(e){ toast(playErr(e.message)); return; }
      sfx('cardplay'); selected.clear(); hintCycle=[];
      afterMove(r);
    }
    function doPass(seat){
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
      // 有人刚出完(名次+1) → 一声提示
      if (st.finished.length>lastFinishedN){ sfx('sparkle'); lastFinishedN=st.finished.length; }
      renderAll();
      if (r && r.over){ showOver(); }
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
      over.innerHTML=`
        <h2>${iWon?'🎉 胜利':'😵 失败'}</h2>
        <div class="rank-list">${rows}</div>
        <div class="lvlup">${lvlLine}</div>
        <div class="gd-acts" style="margin-top:4px">
          <button class="gd-btn" id="gdAgain">${res.matchWon?'新对局':'打下一副'}</button>
          <button class="gd-btn primary" id="gdDone">收工</button>
        </div>`;
      els.felt.appendChild(over);
      if(iWon){ const big=res.matchWon||res.doubleDown; sfx('sparkle'); setTimeout(()=>sfx(big?'spring':'bloom'),220); vibrate([20,60,30,60,40]); confetti(); }
      else { sfx('void'); vibrate(120); }
      over.querySelector('#gdAgain').addEventListener('click', ()=>{
        over.remove();
        if (res.matchWon){ matchLevels=[2,2]; matchDealer=0; prevResult=null; }
        else { matchLevels=res.teamLevelsAfter.slice(); matchDealer=res.nextDealerTeam;
          prevResult={ finishOrder:res.finishOrder.slice(), winnerTeam:res.winnerTeam }; }
        st=newDeal(); selected.clear(); hintCycle=[]; lastShownKey=''; dealAnim=true; lastMyTurn=false; lastFinishedN=0;
        sfx('deal'); renderAll(); showTributeBanner();
      });
      over.querySelector('#gdDone').addEventListener('click', close);
      if(typeof opts.onResult==='function'){ try{ opts.onResult(res, st.log, { mySeat }); }catch(_){} }
    }

    function renderAll(){
      renderSeats(); renderTable(); renderHand(); setBanner(); renderCtrl();
      armTurn(onHumanTimeout);
    }

    renderAll();
    showTributeBanner();
    return { close, state:()=>st };
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
