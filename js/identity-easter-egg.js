// ============================================================
//  identity-easter-egg.js — echo-hall 匿名身份彩蛋系统
//  罕见身份组合 → 特殊进场动画 + 隐藏称号 + 分享卡片
//
//  ★ 接入说明：
//  1. 在 index.html 中引入本文件和 identity-easter-egg.css（放在 app.js 之后）
//       <link rel="stylesheet" href="./identity-easter-egg.css?v=20260929">
//       <script defer src="./identity-easter-egg.js?v=20260929"></script>
//
//  2. 在现有身份生成函数 rollIdentity() 执行后（或 paintIdentity() 末尾）调用：
//
//       // me = { id, name, emoji, color }
//       // name = 形容词 + 动物（如 "量子水獭"），无分隔符
//       var ee = EhEasterEgg.check(me);
//       if (ee) {
//         // 播放特效（在指定容器内）
//         EhEasterEgg.trigger(ee, document.body);
//         // 渲染称号徽章（追加到身份名旁）
//         var badge = EhEasterEgg.renderBadge(ee);
//         $('#idName').appendChild(badge); // 或其他展示位置
//         // 可选：生成分享卡片
//         // var dataURL = EhEasterEgg.generateShareCard(me, ee);
//       }
//
//  3. 也可在"换一个"按钮(reroll)的回调里同样调用 check()，
//     每次重掷身份后检测彩蛋。
//
//  身份对象格式（与 app.js 一致）：
//    me = { id, name, emoji, color }
//    adj  = ['量子','霓虹','午夜','像素','赛博','游离','镜像','脉冲',
//            '银河','深海','极光','熵增','折跃','暗物质','超导','游牧']
//    ani  = ['水獭','狐狸','渡鸦','水母','狼','鲸','猫头鹰','蝙蝠',
//            '章鱼','麋鹿','企鹅','黑猫','海豚','老虎','刺猬','蝴蝶']
// ============================================================
(function (root) {
  'use strict';

  // ---- 回退词表（EH_CONFIG 不可用时用）----
  var ADJ_FALLBACK = ['量子','霓虹','午夜','像素','赛博','游离','镜像','脉冲',
                      '银河','深海','极光','熵增','折跃','暗物质','超导','游牧'];
  var ANI_FALLBACK = ['水獭','狐狸','渡鸦','水母','狼','鲸','猫头鹰','蝙蝠',
                     '章鱼','麋鹿','企鹅','黑猫','海豚','老虎','刺猬','蝴蝶'];

  function _getAdjectives() {
    try {
      if (root && root.EH_CONFIG && root.EH_CONFIG.identityPool)
        return root.EH_CONFIG.identityPool.adjectives || ADJ_FALLBACK;
    } catch (_) {}
    return ADJ_FALLBACK;
  }
  function _getAnimals() {
    try {
      if (root && root.EH_CONFIG && root.EH_CONFIG.identityPool)
        return root.EH_CONFIG.identityPool.animals || ANI_FALLBACK;
    } catch (_) {}
    return ANI_FALLBACK;
  }

  // ---- 工具函数 ----
  function _safeColor(c, def) {
    def = def || '#0ABAB5';
    if (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
    return def;
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _rand(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function _secureRand() {
    try {
      if (typeof root !== 'undefined' && typeof root.secureRand === 'function')
        return root.secureRand();
    } catch (_) {}
    return Math.random();
  }
  function _reduceMotion() {
    try {
      return root.matchMedia && root.matchMedia('(prefers-reduced-motion:reduce)').matches;
    } catch (_) { return false; }
  }
  function _catch(scope, fn) {
    try { return fn(); } catch (e) {
      try { if (typeof root._ehCatch === 'function') root._ehCatch(scope, e); else console.warn('[EhEasterEgg]', scope, e); } catch (_) {}
    }
  }

  // ============================================================
  //  彩蛋身份词表
  //  trigger: { adj?: '形容词', animal?: '动物' }
  //    — 同时给 adj+animal = 精确组合触发
  //    — 只给 adj 或只给 animal = 单字段触发（优先级低于精确组合）
  //  rarity: rare=1/30, epic=1/80, legendary=1/200
  // ============================================================
  var EASTER_EGGS = [
    // ---- 精确组合（adj + animal）----
    { trigger: { adj:'赛博',   animal:'狼'     }, title:'赛博孤狼',     effect:'glitch',   rarity:'epic'      },
    { trigger: { adj:'深海',   animal:'鲸'     }, title:'深海信使',     effect:'aurora',   rarity:'rare'      },
    { trigger: { adj:'暗物质', animal:'蝙蝠'   }, title:'暗夜使徒',     effect:'matrix',   rarity:'legendary' },
    { trigger: { adj:'极光',   animal:'蝴蝶'   }, title:'极光蝶变',     effect:'aurora',   rarity:'epic'      },
    { trigger: { adj:'银河',   animal:'渡鸦'   }, title:'银河渡鸦',     effect:'spark',    rarity:'rare'      },
    { trigger: { adj:'脉冲',   animal:'章鱼'   }, title:'脉冲触手',     effect:'glitch',   rarity:'rare'      },
    { trigger: { adj:'折跃',   animal:'猫头鹰' }, title:'折跃守望者',   effect:'matrix',   rarity:'epic'      },
    { trigger: { adj:'超导',   animal:'水母'   }, title:'超导浮游',     effect:'aurora',   rarity:'rare'      },
    { trigger: { adj:'午夜',   animal:'黑猫'   }, title:'午夜潜行者',   effect:'rain',     rarity:'epic'      },
    { trigger: { adj:'像素',   animal:'刺猬'   }, title:'像素尖刺',     effect:'glitch',   rarity:'rare'      },
    { trigger: { adj:'霓虹',   animal:'狐狸'   }, title:'霓虹妖狐',     effect:'spark',    rarity:'epic'      },
    { trigger: { adj:'量子',   animal:'水獭'   }, title:'量子漫游者',   effect:'matrix',   rarity:'rare'      },
    { trigger: { adj:'熵增',   animal:'老虎'   }, title:'熵增之虎',     effect:'glitch',   rarity:'legendary' },
    { trigger: { adj:'游牧',   animal:'海豚'   }, title:'数字游民',     effect:'aurora',   rarity:'rare'      },
    { trigger: { adj:'镜像',   animal:'麋鹿'   }, title:'镜像迷鹿',     effect:'rain',     rarity:'epic'      },
    { trigger: { adj:'游离',   animal:'企鹅'   }, title:'游离信标',     effect:'spark',    rarity:'rare'      },
    // ---- 单字段触发（较低优先级，仅当精确组合未命中时尝试）----
    { trigger: { animal:'鲸'        }, title:'深渊歌者',     effect:'aurora',   rarity:'rare'      },
    { trigger: { adj:'暗物质'        }, title:'虚空行者',     effect:'matrix',   rarity:'epic'      },
  ];

  // ---- 稀有度概率 ----
  var RARITY_PROB = { rare: 1/30, epic: 1/80, legendary: 1/200 };

  // ---- 稀有度配色（与 CSS 变量对齐）----
  var RARITY_COLOR = {
    rare:      '#00E5D4',  // 青蓝
    epic:      '#C77DFF',  // 紫
    legendary: '#FFD700',  // 金
  };

  // ---- 特效配色 ----
  var EFFECT_COLOR = {
    glitch:   '#FF3D92',
    aurora:   '#00E5D4',
    rain:     '#22FF95',
    spark:    '#F5D06A',
    matrix:   '#22FF95',
  };

  // ============================================================
  //  check(identity) — 检测身份是否触发彩蛋
  //  @param identity { id, name, emoji, color }
  //  @return 彩蛋对象（附加 _triggered 标记）或 null
  // ============================================================
  function check(identity) {
    if (!identity || !identity.name) return null;

    var adjs = _getAdjectives();
    var animals = _getAnimals();
    var name = identity.name;

    // 从 name 中提取 adj 和 animal
    var adj = null, animal = null;
    var i;
    for (i = 0; i < animals.length; i++) {
      if (name.endsWith(animals[i])) { animal = animals[i]; break; }
    }
    if (animal) {
      var aLen = animal.length;
      var prefix = name.slice(0, name.length - aLen);
      for (i = 0; i < adjs.length; i++) {
        if (prefix === adjs[i] || prefix.startsWith(adjs[i])) { adj = adjs[i]; break; }
      }
      // 也尝试从开头匹配形容词
      if (!adj) {
        for (i = 0; i < adjs.length; i++) {
          if (name.startsWith(adjs[i])) { adj = adjs[i]; break; }
        }
      }
    }

    // 匹配触发：先精确组合（adj+animal），再单字段
    var exact = [];  // 精确组合命中
    var single = []; // 单字段命中

    for (i = 0; i < EASTER_EGGS.length; i++) {
      var ee = EASTER_EGGS[i];
      var t = ee.trigger;
      var hasAdj = !!t.adj;
      var hasAnimal = !!t.animal;

      if (hasAdj && hasAnimal) {
        // 精确组合
        if (adj === t.adj && animal === t.animal) exact.push(ee);
      } else if (hasAdj) {
        // 仅形容词
        if (adj === t.adj) single.push(ee);
      } else if (hasAnimal) {
        // 仅动物
        if (animal === t.animal) single.push(ee);
      }
    }

    // 按优先级尝试：精确 > 单字段
    var candidates = exact.concat(single);

    for (i = 0; i < candidates.length; i++) {
      var egg = candidates[i];
      var prob = RARITY_PROB[egg.rarity] || 0;
      if (prob > 0 && Math.random() < prob) {
        // 命中！返回彩蛋对象（深拷贝 + 额外信息）
        var result = Object.assign({}, egg);
        result.triggered = { adj: adj, animal: animal };
        result.color = RARITY_COLOR[egg.rarity] || '#00E5D4';
        result.effectColor = EFFECT_COLOR[egg.effect] || '#00E5D4';
        return result;
      }
    }

    return null;
  }

  // ============================================================
  //  trigger(easterEgg, containerEl) — 在容器内播放特效动画
  //  @param easterEgg  彩蛋对象（来自 check()）
  //  @param containerEl  DOM 元素，特效覆盖层挂载于此
  // ============================================================
  function trigger(easterEgg, containerEl) {
    if (!easterEgg || !easterEgg.effect) return;
    containerEl = containerEl || document.body;
    if (!containerEl) return;

    // 尊重"减少动态效果"系统设置
    if (_reduceMotion()) return;

    var effect = easterEgg.effect;
    var fx = {
      glitch:   fxGlitch,
      aurora:   fxAurora,
      rain:     fxRain,
      spark:    fxSpark,
      matrix:   fxMatrix,
    };
    var fn = fx[effect];
    if (fn) _catch('trigger:' + effect, function () { fn(containerEl, easterEgg); });
  }

  // ============================================================
  //  特效实现
  // ============================================================

  // ---- glitch：文字故障闪烁 ----
  function fxGlitch(container, ee) {
    var overlay = document.createElement('div');
    overlay.className = 'ee-overlay ee-glitch';
    var text = ee.triggered ? (ee.triggered.adj || '') + (ee.triggered.animal || '') : '';
    overlay.innerHTML =
      '<div class="ee-glitch-text" data-text="' + _esc(text) + '">' + _esc(text) + '</div>' +
      '<div class="ee-glitch-sweep"></div>';
    container.appendChild(overlay);
    // 触发重排让动画生效
    void overlay.offsetWidth;
    overlay.classList.add('on');
    _cleanup(container, overlay, 2500);
  }

  // ---- aurora：极光色渐变扫过屏幕 ----
  function fxAurora(container, ee) {
    var overlay = document.createElement('div');
    overlay.className = 'ee-overlay ee-aurora';
    overlay.innerHTML =
      '<div class="ee-aurora-band"></div>' +
      '<div class="ee-aurora-band" style="animation-delay:.4s"></div>' +
      '<div class="ee-aurora-band" style="animation-delay:.8s"></div>';
    container.appendChild(overlay);
    void overlay.offsetWidth;
    overlay.classList.add('on');
    _cleanup(container, overlay, 3000);
  }

  // ---- rain：赛博雨（绿色字符下落，Matrix 风格，轻量版）----
  function fxRain(container, ee) {
    var overlay = document.createElement('div');
    overlay.className = 'ee-overlay ee-rain';
    container.appendChild(overlay);

    var chars = '01ｱｲｳｴｵｶｷｸｹ0123456789ABCDEF';
    var colCount = window.innerWidth < 500 ? 14 : 22;

    for (var i = 0; i < colCount; i++) {
      var col = document.createElement('div');
      col.className = 'ee-rain-col';
      var str = '';
      var len = 6 + Math.floor(_secureRand() * 8);
      for (var j = 0; j < len; j++) str += _rand(chars);
      col.textContent = str;
      col.style.left = (i / colCount * 100 + _secureRand() * 2) + 'vw';
      col.style.animationDuration = (1.2 + _secureRand() * 0.8) + 's';
      col.style.animationDelay = (_secureRand() * 0.6) + 's';
      col.style.fontSize = (11 + Math.floor(_secureRand() * 4)) + 'px';
      overlay.appendChild(col);
    }

    void overlay.offsetWidth;
    overlay.classList.add('on');
    _cleanup(container, overlay, 2500);
  }

  // ---- spark：粒子爆炸 ----
  function fxSpark(container, ee) {
    var overlay = document.createElement('div');
    overlay.className = 'ee-overlay ee-spark';
    container.appendChild(overlay);

    var cx = window.innerWidth / 2;
    var cy = window.innerHeight / 2;
    var count = 36;
    var color = ee.effectColor || '#F5D06A';

    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      p.className = 'ee-spark-particle';
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.background = color;
      p.style.boxShadow = '0 0 6px ' + _safeColor(color);
      overlay.appendChild(p);

      var angle = (i / count) * Math.PI * 2 + _secureRand() * 0.3;
      var dist = 120 + _secureRand() * 180;
      var dx = Math.cos(angle) * dist;
      var dy = Math.sin(angle) * dist;

      (function (el, dx, dy) {
        el.animate([
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: 'translate(' + dx * 0.5 + 'px,' + dy * 0.5 + 'px) scale(.8)', opacity: .8, offset: .5 },
          { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0)', opacity: 0 }
        ], {
          duration: 900 + _secureRand() * 500,
          easing: 'cubic-bezier(.2,.6,.4,1)'
        }).onfinish = function () { if (el.parentNode) el.remove(); };
      })(p, dx, dy);
    }

    void overlay.offsetWidth;
    overlay.classList.add('on');
    _cleanup(container, overlay, 2000);
  }

  // ---- matrix：短暂的数字矩阵叠加 ----
  function fxMatrix(container, ee) {
    var overlay = document.createElement('div');
    overlay.className = 'ee-overlay ee-matrix';
    container.appendChild(overlay);

    var chars = '01100101101001010110';
    var colCount = window.innerWidth < 500 ? 16 : 28;

    for (var i = 0; i < colCount; i++) {
      var col = document.createElement('div');
      col.className = 'ee-matrix-col';
      var str = '';
      var len = 4 + Math.floor(_secureRand() * 6);
      for (var j = 0; j < len; j++) str += _rand(chars);
      col.textContent = str;
      col.style.left = (i / colCount * 100) + 'vw';
      col.style.animationDuration = (0.9 + _secureRand() * 0.6) + 's';
      col.style.animationDelay = (_secureRand() * 0.4) + 's';
      overlay.appendChild(col);
    }

    void overlay.offsetWidth;
    overlay.classList.add('on');
    _cleanup(container, overlay, 2200);
  }

  // ---- 通用清理：N 毫秒后移除覆盖层 ----
  function _cleanup(container, overlay, ms) {
    setTimeout(function () {
      if (!overlay || !overlay.parentNode) return;
      overlay.classList.remove('on');
      overlay.classList.add('off');
      setTimeout(function () {
        if (overlay.parentNode) overlay.remove();
      }, 300);
    }, ms);
  }

  // ============================================================
  //  renderBadge(easterEgg) — 生成称号徽章 DOM 元素
  //  返回一个 <span> 可追加到身份名旁
  // ============================================================
  function renderBadge(easterEgg) {
    if (!easterEgg || !easterEgg.title) return null;
    var badge = document.createElement('span');
    badge.className = 'ee-badge ee-' + (easterEgg.rarity || 'rare');
    badge.textContent = easterEgg.title;
    badge.title = '隐藏称号 · ' + (easterEgg.rarity || 'rare');
    return badge;
  }

  // ============================================================
  //  generateShareCard(identity, easterEgg) — Canvas 生成分享卡片
  //  @return dataURL（PNG）
  //  尺寸 400×600，赛博朋克风格
  // ============================================================
  function generateShareCard(identity, easterEgg) {
    var W = 400, H = 600;
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    var id = identity || {};
    var ee = easterEgg || {};
    var name = id.name || '匿名信号';
    var emoji = id.emoji || '🦊';
    var idColor = _safeColor(id.color, '#00E5D4');
    var eeColor = ee.color || RARITY_COLOR[ee.rarity] || '#00E5D4';
    var effectColor = ee.effectColor || EFFECT_COLOR[ee.effect] || '#00E5D4';
    var title = ee.title || '隐藏称号';
    var rarity = ee.rarity || 'rare';
    var effect = ee.effect || 'spark';

    // ---- 背景渐变 ----
    var bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#0a0e1a');
    bgGrad.addColorStop(0.5, '#0d1220');
    bgGrad.addColorStop(1, '#070a12');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // ---- 背景网格线（赛博朋克）----
    ctx.strokeStyle = 'rgba(0,229,212,0.06)';
    ctx.lineWidth = 1;
    var gridSize = 40;
    ctx.beginPath();
    for (var x = 0; x <= W; x += gridSize) {
      ctx.moveTo(x, 0); ctx.lineTo(x, H);
    }
    for (var y = 0; y <= H; y += gridSize) {
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    ctx.stroke();

    // ---- 顶部光带 ----
    var topGrad = ctx.createLinearGradient(0, 0, W, 0);
    topGrad.addColorStop(0, 'transparent');
    topGrad.addColorStop(0.3, _hexA(eeColor, 0.6));
    topGrad.addColorStop(0.7, _hexA(effectColor, 0.5));
    topGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, W, 4);

    // ---- 底部光带 ----
    var botGrad = ctx.createLinearGradient(0, 0, W, 0);
    botGrad.addColorStop(0, 'transparent');
    botGrad.addColorStop(0.5, _hexA(idColor, 0.4));
    botGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, H - 4, W, 4);

    // ---- 中央装饰圆环 ----
    ctx.save();
    ctx.translate(W / 2, 200);
    // 外环
    ctx.strokeStyle = _hexA(eeColor, 0.15);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 80, 0, Math.PI * 2);
    ctx.stroke();
    // 内环
    ctx.strokeStyle = _hexA(eeColor, 0.3);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 65, 0, Math.PI * 2);
    ctx.stroke();
    // 辉光
    var glowGrad = ctx.createRadialGradient(0, 0, 10, 0, 0, 70);
    glowGrad.addColorStop(0, _hexA(idColor, 0.25));
    glowGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ---- emoji（大号居中）----
    ctx.font = '64px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, W / 2, 200);

    // ---- 身份名 ----
    ctx.font = 'bold 22px "SF Mono",ui-monospace,Menlo,Consolas,monospace';
    ctx.fillStyle = idColor;
    ctx.shadowColor = _hexA(idColor, 0.6);
    ctx.shadowBlur = 12;
    ctx.fillText(name, W / 2, 310);
    ctx.shadowBlur = 0;

    // ---- 分隔线 ----
    var lineGrad = ctx.createLinearGradient(W * 0.2, 0, W * 0.8, 0);
    lineGrad.addColorStop(0, 'transparent');
    lineGrad.addColorStop(0.5, _hexA(eeColor, 0.5));
    lineGrad.addColorStop(1, 'transparent');
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W * 0.2, 345);
    ctx.lineTo(W * 0.8, 345);
    ctx.stroke();

    // ---- 隐藏称号 ----
    ctx.font = 'bold 18px "SF Mono",ui-monospace,Menlo,Consolas,monospace';
    ctx.fillStyle = eeColor;
    ctx.shadowColor = _hexA(eeColor, 0.7);
    ctx.shadowBlur = 10;
    ctx.fillText('「' + title + '」', W / 2, 380);
    ctx.shadowBlur = 0;

    // ---- 稀有度标签 ----
    var rarityLabels = { rare: '★ RARE', epic: '★★ EPIC', legendary: '★★★ LEGENDARY' };
    ctx.font = 'bold 12px "SF Mono",ui-monospace,Menlo,Consolas,monospace';
    ctx.fillStyle = eeColor;
    ctx.fillText(rarityLabels[rarity] || rarity, W / 2, 410);

    // ---- 特效类型 ----
    var effectLabels = {
      glitch: 'GLITCH · 故障',
      aurora: 'AURORA · 极光',
      rain:   'RAIN · 赛博雨',
      spark:  'SPARK · 粒子',
      matrix: 'MATRIX · 矩阵',
    };
    ctx.font = '11px "SF Mono",ui-monospace,Menlo,Consolas,monospace';
    ctx.fillStyle = _hexA(effectColor, 0.8);
    ctx.fillText(effectLabels[effect] || effect, W / 2, 435);

    // ---- 底部品牌 ----
    ctx.font = '10px "SF Mono",ui-monospace,Menlo,Consolas,monospace';
    ctx.fillStyle = 'rgba(120,140,160,0.5)';
    ctx.fillText('ECHO HALL · 回声厅', W / 2, H - 30);

    // ---- 底部装饰点阵 ----
    ctx.fillStyle = _hexA(eeColor, 0.3);
    for (var dx = 0; dx < 6; dx++) {
      ctx.beginPath();
      ctx.arc(W / 2 - 40 + dx * 16, H - 50, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    return canvas.toDataURL('image/png');
  }

  // ---- hex 颜色加 alpha（返回 rgba 字符串）----
  function _hexA(hex, alpha) {
    hex = _safeColor(hex, '#0ABAB5');
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // ============================================================
  //  导出
  // ============================================================
  var api = Object.freeze({
    EASTER_EGGS: EASTER_EGGS,
    RARITY_PROB: RARITY_PROB,
    RARITY_COLOR: RARITY_COLOR,
    EFFECT_COLOR: EFFECT_COLOR,
    check: check,
    trigger: trigger,
    renderBadge: renderBadge,
    generateShareCard: generateShareCard,
  });
  if (root) root.EhEasterEgg = api;
  return api;

})((typeof window !== 'undefined') ? window : ((typeof globalThis !== 'undefined') ? globalThis : this));
