/* Echo Hall 浏览器工具栏／键盘遮挡诊断浮层 v3（?kbdebug=1）。
 * 比较 svh/dvh/lvh 与实际布局，区分浏览器底部工具栏遮挡和输入法遮挡。
 */
(function () {
  const queryEnabled = /[?&]kbdebug=1(&|$)/.test(location.search);
  const isAndroid = /Android/i.test(navigator.userAgent);
  // 临时（V28）：安卓 PWA 三重 standalone 检测全 false，先无条件挂浮层仅限安卓，
  // 让浮层自己报告 display-mode / UA 真实值，拿到后再收敛条件。
  const standalone = matchMedia('(display-mode: standalone)').matches
    || matchMedia('(display-mode: fullscreen)').matches
    || matchMedia('(display-mode: minimal-ui)').matches
    || !!navigator.standalone
    || /android-app:\/\//.test(document.referrer);
  if (!queryEnabled && !isAndroid) return;

  const box = document.createElement('div');
  box.id = '__ehkbdbg';
  box.style.cssText = [
    'position:fixed', 'right:6px', 'bottom:6px', 'z-index:2147483647',
    'background:rgba(255,0,80,.92)', 'color:#fff', 'font:10px/1.35 monospace',
    'padding:5px 7px', 'border:2px solid #fff', 'border-radius:6px',
    'pointer-events:none', 'white-space:pre', 'max-width:60vw',
    'box-shadow:0 0 12px rgba(255,0,80,.6)'
  ].join(';');

  function mount() {
    if (!document.body) return false;
    document.body.appendChild(box);
    return true;
  }
  if (!mount()) document.addEventListener('DOMContentLoaded', mount);

  const vv = window.visualViewport;
  const vk = navigator.virtualKeyboard || null;
  const px = v => (v == null || Number.isNaN(v) ? '?' : Math.round(v));
  const probes = {};
  let vkGeomHits = 0;
  let vkRect = null;
  let vvResizeHits = 0;
  let winResizeHits = 0;

  if (vk) {
    try { vk.overlaysContent = true; } catch (_) {}
    vk.addEventListener('geometrychange', ev => {
      vkGeomHits++;
      vkRect = ev.target.boundingRect;
      snapshot();
    });
  }
  if (vv) {
    vv.addEventListener('resize', () => { vvResizeHits++; }, { passive: true });
  }
  window.addEventListener('resize', () => { winResizeHits++; }, { passive: true });

  function mountProbes() {
    if (!document.body || probes.svh) return;
    ['svh', 'dvh', 'lvh'].forEach(unit => {
      const el = document.createElement('div');
      el.style.cssText = `position:fixed;visibility:hidden;height:100${unit};pointer-events:none`;
      document.body.appendChild(el);
      probes[unit] = el;
    });
    // ★V36：VirtualKeyboard 事件可能不派发，补测 CSS keyboard-inset 环境变量真值。
    const kbInset = document.createElement('div');
    kbInset.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;height:env(keyboard-inset-height,0px);width:env(keyboard-inset-width,0px);top:env(keyboard-inset-top,0px);left:env(keyboard-inset-left,0px)';
    document.body.appendChild(kbInset);
    probes.kbInset = kbInset;
  }

  function viewportUnit(unit) {
    const probe = probes[unit];
    return probe ? probe.getBoundingClientRect().height : null;
  }

  function directVkRect() {
    try { return vk && vk.boundingRect ? vk.boundingRect : null; } catch (_) { return null; }
  }

  function keyboardInsetRect() {
    const probe = probes.kbInset;
    return probe ? probe.getBoundingClientRect() : null;
  }

  function snapshot() {
    mountProbes();
    const stage = document.querySelector('.stage');
    const hall = document.getElementById('hall');
    const stream = document.getElementById('stream') || document.querySelector('.stream');
    const composer = document.querySelector('.composer');
    const cin = document.getElementById('cin');
    const lastMsg = stream ? stream.lastElementChild : null;

    const kbTop = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const cRect = composer ? composer.getBoundingClientRect() : null;
    const sRect = stream ? stream.getBoundingClientRect() : null;
    const mRect = lastMsg ? lastMsg.getBoundingClientRect() : null;
    const overlap = cRect ? cRect.bottom - kbTop : null;
    const streamToComposer = (sRect && cRect) ? cRect.top - sRect.bottom : null;
    const lastMsgToComposer = (mRect && cRect) ? cRect.top - mRect.bottom : null;
    const streamScrollGap = stream ? (stream.scrollHeight - stream.scrollTop - stream.clientHeight) : null;
    const focused = document.activeElement === cin;

    const directVk = directVkRect();
    const inset = keyboardInsetRect();

    // ★私信会话窗几何(独立 fixed 抽屉, 不同于聊天室 #hall): 定位/高度算错时 composer 会浮在键盘上方留大缝
    const dmDrawer = document.getElementById('dmChatDrawer');
    const dmComposer = document.querySelector('.dm-composer');
    const dmInput = document.getElementById('dmChatInput');
    const dmOn = dmDrawer && dmDrawer.classList.contains('on');
    const dRect = dmDrawer ? dmDrawer.getBoundingClientRect() : null;
    const dcRect = dmComposer ? dmComposer.getBoundingClientRect() : null;
    const dmFocused = document.activeElement === dmInput;
    const dmComposerToKb = dcRect ? (kbTop - dcRect.bottom) : null;  // >0 = composer 底与键盘顶之间的空缝

    const lines = [
      'kbdebug v3 · ' + (focused ? '聊天框已聚焦' : '未聚焦'),
      'innerH        = ' + px(window.innerHeight),
      'clientH       = ' + px(document.documentElement.clientHeight),
      '100svh        = ' + px(viewportUnit('svh')),
      '100dvh        = ' + px(viewportUnit('dvh')),
      '100lvh        = ' + px(viewportUnit('lvh')),
      'vv.height     = ' + px(vv && vv.height),
      'vv.offsetTop  = ' + px(vv && vv.offsetTop),
      '键盘顶边      = ' + px(kbTop),
      'stage内联h    = ' + (stage ? (stage.style.height || '(空)') : '无'),
      'stage实际h    = ' + (stage ? px(parseFloat(getComputedStyle(stage).height)) : '无'),
      'hall实际h     = ' + (hall ? px(parseFloat(getComputedStyle(hall).height)) : '无'),
      'hall溢出      = ' + (hall ? getComputedStyle(hall).overflow : '无'),
      'stream底      = ' + (sRect ? px(sRect.bottom) : '无'),
      'stream可滚剩  = ' + (streamScrollGap == null ? '无' : px(streamScrollGap)),
      '最新消息底    = ' + (mRect ? px(mRect.bottom) : '无'),
      'composer顶    = ' + (cRect ? px(cRect.top) : '无'),
      'composer底    = ' + (cRect ? px(cRect.bottom) : '无'),
      '★遮挡量      = ' + (overlap == null ? '?' : (px(overlap) + (overlap > 1 ? ' ← 被键盘盖住' : ' ok'))),
      '★stream↔composer= ' + (streamToComposer == null ? '?' : px(streamToComposer)),
      '★最新消息↔composer= ' + (lastMsgToComposer == null ? '?' : px(lastMsgToComposer)),
      '--- PWA/API 信号 ---',
      'display-mode  = ' + (['standalone','fullscreen','minimal-ui','browser'].find(m => matchMedia('(display-mode: '+m+')').matches) || '?'),
      'nav.standalone= ' + String(!!navigator.standalone),
      'referrer      = ' + (document.referrer.slice(0,40) || '(空)'),
      'UA snippet    = ' + navigator.userAgent.match(/(Chrome|SamsungBrowser|MiuiBrowser|HuaweiBrowser|EdgA|Firefox|UCBrowser|OPR)\/[\d.]+/g)?.join(' ') || 'other',
      'standalone 组合= ' + (standalone ? '✓' : '✗'),
      'VirtualKeyboard API = ' + (vk ? '✓ 已挂载' : '✗ 未挂载(无法用 geometrychange)'),
      'VK.overlaysContent = ' + (vk ? String(vk.overlaysContent) : 'n/a'),
      'VK.geometrychange 次数 = ' + vkGeomHits,
      'VK.boundingRect = ' + (vkRect ? (px(vkRect.x)+','+px(vkRect.y)+' '+px(vkRect.width)+'x'+px(vkRect.height)) : '(无)'),
      '★VK直读 rect  = ' + (directVk ? (px(directVk.x)+','+px(directVk.y)+' '+px(directVk.width)+'x'+px(directVk.height)) : '(无)'),
      '★envKb inset  = ' + (inset ? ('top='+px(inset.top)+' h='+px(inset.height)) : '(无)'),
      'vv.resize 次数 = ' + vvResizeHits,
      'window.resize 次数 = ' + winResizeHits,
      '--- 私信会话窗 ---',
      'DM抽屉开     = ' + (dmOn ? '✓' : '✗') + (dmFocused ? ' 输入框聚焦' : ''),
      'DM抽屉top    = ' + (dRect ? px(dRect.top) : '无'),
      'DM抽屉底     = ' + (dRect ? px(dRect.bottom) : '无'),
      'DM抽屉高     = ' + (dRect ? px(dRect.height) : '无'),
      'DM抽屉内联h  = ' + (dmDrawer ? (dmDrawer.style.height || '(空)') : '无'),
      'DMcomposer底 = ' + (dcRect ? px(dcRect.bottom) : '无'),
      '★DMcomposer↔键盘 = ' + (dmComposerToKb == null ? '?' : (px(dmComposerToKb) + (dmComposerToKb > 2 ? ' ← 上方留缝' : (dmComposerToKb < -2 ? ' ← 被键盘盖' : ' ok')))),
      'ver           = ' + (window.__EH_BUILD_VER || '?')
    ];
    box.textContent = lines.join('\n');
    const bad = overlap > 1;
    box.style.color = bad ? '#f66' : '#0ff';
    box.style.borderColor = bad ? '#f66' : '#0ff';
  }

  if (vv) {
    vv.addEventListener('resize', snapshot, { passive: true });
    vv.addEventListener('scroll', snapshot, { passive: true });
  }
  // ★聚焦后多帧采样：抓键盘弹起前/中/后 vv.height 与 stage 高度，暴露“点击后不跟随”到底哪一环断。
  var trace = [];
  function traceLine(tag) {
    var stage = document.querySelector('.stage');
    var wrap = document.querySelector('.composer .cin-wrap');
    var kbTop = vv ? Math.round(vv.offsetTop + vv.height) : window.innerHeight;
    var wb = wrap ? Math.round(wrap.getBoundingClientRect().bottom) : null;
    trace.push(tag + ': vv=' + (vv ? Math.round(vv.height) : '?') +
      ' stageH=' + (stage ? Math.round(parseFloat(getComputedStyle(stage).height)) : '?') +
      ' 框底=' + (wb == null ? '?' : wb) +
      ' 键盘顶=' + kbTop +
      ' 距键盘=' + (wb == null ? '?' : (kbTop - wb)));
    if (trace.length > 6) trace.shift();
    var t = document.getElementById('__ehkbtrace');
    if (!t && document.body) {
      t = document.createElement('div');
      t.id = '__ehkbtrace';
      t.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:2147483647;background:rgba(20,0,0,.9);color:#fd6;font:10px/1.4 monospace;padding:6px 8px;border:1px solid #fd6;border-radius:6px;pointer-events:none;white-space:pre;max-width:88vw';
      document.body.appendChild(t);
    }
    if (t) t.textContent = '聚焦采样(距键盘应=15):\n' + trace.join('\n');
  }
  document.addEventListener('focusin', function (e) {
    if (e.target && e.target.id === 'cin') {
      trace = [];
      traceLine('t0聚焦');
      [100, 250, 450, 700, 1000].forEach(function (ms) {
        setTimeout(function () { traceLine('t' + ms); }, ms);
      });
      schedulePoll('弹出');
    }
  }, { passive: true });
  // ★V33 全量信号对比：focusin(弹出)→focusout(弹回) 全程逐帧穷举所有可能变化的量，
  //   找出 PWA 里到底哪个信号还会动（浏览器 vs PWA 各截一次对比）。
  var poll = [];
  function allMetrics() {
    mountProbes();
    var de = document.documentElement;
    var se = document.scrollingElement || de;
    var deRect = de.getBoundingClientRect();
    var directVk = directVkRect();
    var inset = keyboardInsetRect();
    return {
      innerH: window.innerHeight,
      outerH: window.outerHeight,
      clientH: de.clientHeight,
      deRectH: Math.round(deRect.height),
      scrollTop: Math.round(se.scrollTop),
      scrollH: se.scrollHeight,
      bodyH: Math.round(document.body.getBoundingClientRect().height),
      vvH: vv ? Math.round(vv.height) : null,
      vvTop: vv ? Math.round(vv.offsetTop) : null,
      vvPageTop: vv ? Math.round(vv.pageTop) : null,
      vvScale: vv ? +vv.scale.toFixed(2) : null,
      svh: Math.round(viewportUnit('svh') || 0),
      dvh: Math.round(viewportUnit('dvh') || 0),
      lvh: Math.round(viewportUnit('lvh') || 0),
      screenH: window.screen.height,
      screenAvailH: window.screen.availHeight,
      vkEventH: vkRect ? Math.round(vkRect.height) : 0,
      vkDirectY: directVk ? Math.round(directVk.y) : -1,
      vkDirectH: directVk ? Math.round(directVk.height) : 0,
      envKbTop: inset ? Math.round(inset.top) : -1,
      envKbH: inset ? Math.round(inset.height) : 0,
    };
  }
  var baseM = null;
  function pollLine(tag) {
    var m = allMetrics();
    if (!baseM) baseM = m;
    // 只显示相对基线有变化的量（★标记），一眼看出弹键盘时谁动了
    var keys = Object.keys(m);
    var parts = keys.map(function (k) {
      var changed = m[k] !== baseM[k];
      return (changed ? '★' : '') + k + '=' + m[k];
    });
    poll.push(tag + ' ' + parts.filter(function (s) { return s.indexOf('★') === 0; }).join(' ') || (tag + ' (无变化)'));
    if (poll.length > 16) poll.shift();
    var p = document.getElementById('__ehkbpoll');
    if (!p && document.body) {
      p = document.createElement('div');
      p.id = '__ehkbpoll';
      p.style.cssText = 'position:fixed;right:6px;top:6px;z-index:2147483647;background:rgba(0,20,40,.94);color:#7fd;font:9px/1.3 monospace;padding:6px 8px;border:1px solid #7fd;border-radius:6px;pointer-events:none;white-space:pre;max-width:66vw';
      document.body.appendChild(p);
    }
    if (p) p.textContent = '全量信号(★=相对基线变了):\n基线innerH=' + baseM.innerH + '\n' + poll.join('\n');
  }
  function schedulePoll(phase) {
    baseM = null; poll = [];
    pollLine(phase + 't0');
    [80, 160, 260, 400, 600, 900, 1400].forEach(function (ms) {
      setTimeout(function () { pollLine(phase + 't' + ms); }, ms);
    });
  }
  document.addEventListener('focusin', () => setTimeout(snapshot, 50), { passive: true });
  document.addEventListener('focusout', function (e) {
    if (e.target && e.target.id === 'cin') { schedulePoll('弹回'); }
    setTimeout(snapshot, 250);
  }, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(snapshot, 300), { passive: true });
  setInterval(snapshot, 300);
  snapshot();
})();
