/* 回声厅 · 牌桌高光引擎(三游戏共用) — table-fx
 *
 * 目标: 把三局的"赢牌庆祝"从「一律同款彩带」升级成【分级高光】, 并把演出收敛到一处保证一致:
 *   tier1 普通赢  → 轻量彩带(与旧版观感一致)
 *   tier2 大牌型  → 加量彩带 + 居中金色高光横幅(炸弹翻倍 / 连升 / 葫芦同花…)
 *   tier3 名场面  → 满屏金彩 + 光晕脉冲 + 高光横幅(春天 / 双下通关 / 同花顺四条…)
 *
 * 各游戏仍保留自己的 emoji 身份(斗地主牌面 · 掼蛋麻将 · 德州金币), 只把「强度 + 横幅」交给这里。
 * 落点几何完全沿用三局已在 iOS 验证过的彩带值: 元素 top:-8%, 下落 translateY(115%)。
 * 无依赖 · 幂等 · 首次调用时注入一次 CSS。els.felt 需为定位上下文(三局绒面均 position:relative, 旧彩带已依赖)。
 */
(function () {
  if (window.EHTableFx) return;
  var STYLE_ID = 'eh-tablefx-css';

  function ensureCss() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.eh-fx-confetti{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:12}',
      '.eh-fx-confetti i{position:absolute;top:-8%;font-style:normal;font-size:20px;line-height:1;',
      '  animation:ehFxFall linear forwards;will-change:transform,opacity}',
      '@keyframes ehFxFall{0%{transform:translateY(0) rotate(0);opacity:0}12%{opacity:1}',
      '  100%{transform:translateY(115%) rotate(var(--r,540deg));opacity:0}}',
      // 居中高光横幅: 金色描边 + 弹入, 定格 ~1.2s 后上飘淡出。z-index 高于结算浮层前的绒面, 低于按钮层不挡点击。
      '.eh-fx-splash{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);z-index:14;',
      '  pointer-events:none;text-align:center;white-space:nowrap;max-width:96%}',
      '.eh-fx-splash .t{font-weight:900;font-size:clamp(30px,9vw,56px);letter-spacing:2px;',
      '  background:linear-gradient(180deg,#fff 0%,#ffe27a 52%,#ffab1f 100%);-webkit-background-clip:text;',
      '  background-clip:text;-webkit-text-fill-color:transparent;color:#ffcf5a;',
      '  filter:drop-shadow(0 3px 14px rgba(255,168,20,.6));',
      '  animation:ehFxPop .5s cubic-bezier(.2,1.5,.35,1) both}',
      '.eh-fx-splash .s{margin-top:6px;font-weight:700;font-size:clamp(12px,3.4vw,16px);',
      '  color:#ffe9b8;text-shadow:0 1px 6px rgba(0,0,0,.6);opacity:.96;',
      '  animation:ehFxPop .5s .07s cubic-bezier(.2,1.5,.35,1) both}',
      '.eh-fx-splash.out{animation:ehFxSplashOut .42s ease-in forwards}',
      // 弹入只作用于内部文字块(块级, 非绝对定位), 故不能带 translate(-50%) —— 居中由外层 .eh-fx-splash 负责
      '@keyframes ehFxPop{0%{opacity:0;transform:scale(.4)}100%{opacity:1;transform:scale(1)}}',
      '@keyframes ehFxSplashOut{to{opacity:0;transform:translate(-50%,-64%) scale(1.08)}}',
      // 顶级光晕: 绒面中上部一次性金色脉冲(名场面才亮)
      '.eh-fx-glow{position:absolute;inset:0;pointer-events:none;z-index:11;',
      '  background:radial-gradient(ellipse at 50% 42%,rgba(255,190,60,.34),rgba(255,190,60,0) 62%);',
      '  animation:ehFxGlow 1.5s ease-out forwards}',
      '@keyframes ehFxGlow{0%{opacity:0}22%{opacity:1}100%{opacity:0}}',
      '@media (prefers-reduced-motion:reduce){',
      '  .eh-fx-confetti i,.eh-fx-splash .t,.eh-fx-splash .s,.eh-fx-glow{animation-duration:.01ms!important}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function rnd() {
    try { var a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
    catch (e) { return Math.random(); }
  }

  // 分级参数: 数量 / 落地时长 / 是否光晕 / 字号区间
  var TIERS = {
    1: { n: 16, dur: 2200, glow: false, size: [15, 22] },
    2: { n: 32, dur: 2600, glow: false, size: [16, 26] },
    3: { n: 56, dur: 3000, glow: true,  size: [18, 30] }
  };
  var GOLD = ['✨', '⭐', '🌟', '💫'];

  // celebrate(feltEl, { tier:1|2|3, palette:[emoji…], label:'春天！', sub:'底分×8' })
  function celebrate(felt, opts) {
    if (!felt) return;
    ensureCss();
    opts = opts || {};
    var tier = TIERS[opts.tier] || TIERS[1];
    var pal = (opts.palette && opts.palette.length) ? opts.palette : ['🎉', '✨', '🎊', '⭐'];
    // 顶级追加金色元素密度, 让"名场面"金光更满
    var EM = (opts.tier >= 3) ? pal.concat(GOLD) : pal;

    if (tier.glow) {
      var g = document.createElement('div');
      g.className = 'eh-fx-glow';
      felt.appendChild(g);
      setTimeout(function () { g.remove(); }, 1600);
    }

    var box = document.createElement('div');
    box.className = 'eh-fx-confetti';
    for (var i = 0; i < tier.n; i++) {
      var it = document.createElement('i');
      it.textContent = EM[Math.floor(rnd() * EM.length)];
      it.style.left = (rnd() * 100) + '%';
      it.style.fontSize = (tier.size[0] + rnd() * (tier.size[1] - tier.size[0])).toFixed(1) + 'px';
      it.style.animationDuration = ((tier.dur / 1000) * (0.7 + rnd() * 0.5)).toFixed(2) + 's';
      it.style.animationDelay = (rnd() * 0.35).toFixed(2) + 's';
      it.style.setProperty('--r', (360 + Math.floor(rnd() * 720)) + 'deg');
      box.appendChild(it);
    }
    felt.appendChild(box);
    setTimeout(function () { box.remove(); }, tier.dur + 600);

    if (opts.label) {
      var sp = document.createElement('div');
      sp.className = 'eh-fx-splash';
      var t = document.createElement('div');
      t.className = 't';
      t.textContent = opts.label;
      sp.appendChild(t);
      if (opts.sub) {
        var sub = document.createElement('div');
        sub.className = 's';
        sub.textContent = opts.sub;
        sp.appendChild(sub);
      }
      felt.appendChild(sp);
      setTimeout(function () { sp.classList.add('out'); }, 1250);
      setTimeout(function () { sp.remove(); }, 1720);
    }
  }

  window.EHTableFx = { celebrate: celebrate };
})();
