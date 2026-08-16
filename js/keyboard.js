/* Echo Hall 聊天键盘：#hall 是唯一视口容器。
 * VisualViewport 负责 iOS/浏览器；VirtualKeyboard geometry 负责安卓覆盖式 IME/PWA。
 */
(function () {
  const viewport = window.visualViewport;
  const virtualKeyboard = navigator.virtualKeyboard;
  let frame = 0;
  let chatFocused = false;
  let keyboardRect = null;
  let popupInput = null;
  // ★V30：三信号全哑 WebView（小米浏览器等）兜底。focusin 后 250ms 内若 vv/VK/window 均无变化，启用估算键盘高。
  let estimatedKbH = 0;                   // 当前估算键盘高（0=未启用）
  let noSignalTimer = 0;                  // focusin 后判定无信号的定时器
  let signalBaseline = null;              // focusin 瞬间的 vv.height / VK 计数基线
  let vkGeomHits = 0;
  let vkHadPositiveGeometry = false; // 只有先观测到键盘正高度，后续 0 才能判定为收起
  // journey-exempt: 现有键盘收起旅程覆盖估算态回位；此状态门防止初始 VK=0 误清估算。
  // ★V57：键盘落下时的全屏可视高【持久基线】。visibleHeight() 里扣键盘高(vkH/估算)时的"分母"必须用它,
  //   而不是 max(当前innerH, 当前vv.h)——后者在 resizes-content 设备(安卓折叠屏)上键盘弹起会随 innerH
  //   一起缩到 180, 于是 full-估算 = 180-68 = 112(把已经缩掉的键盘又扣一遍 → 双减)。用落键盘时的稳定全高
  //   做分母: 折叠屏 min(180, 457-174)=180 估算天然失效(min 取已缩的真值), 覆盖式(vv/innerH 不缩)才真正扣高。
  let baseFullH = 0;
  // ★V59：折叠屏展开/收折时，键盘仍弹起但 innerHeight 会随新屏幕几何改变。
  //   记录上次布局宽度，供 applyLayout 在既有 resize 链里区分“普通键盘缩高”和“折叠/展开”。
  let layoutWidth = 0;

  const hall = () => document.getElementById('hall');
  const chatInput = () => document.getElementById('cin');
  const inHall = () => document.body.classList.contains('hall-on');
  // 软键盘控制器只服务以触屏为主的设备。PC 聚焦输入框不会弹 IME，
  // “视口无变化”是正常现象，不能误判为小米 WebView 键盘信号丢失。
  const usesSoftKeyboardLayout = () => window.matchMedia('(hover:none) and (pointer:coarse)').matches;

  function visibleHeight() {
    // ★V56（对齐私信稳定方案 dm.js._kbHeightRaw）：键盘上方可视高 = min(innerHeight, visualViewport.height)。
    //   安卓 interactive-widget=resizes-content 靠收缩 innerHeight 避让, iOS 靠 vv.height 收缩 → 取更紧者两平台通吃。
    //   【为何弃用旧 vv.offsetTop+vv.height - keyboardRect.top】小米浏览器实测(innerH=400/vv=401 却 hall=369):
    //   旧式减的是【缓存的】keyboardRect.top; 键盘动画中途上报过一次"键盘高≈32"的 geometrychange, 而 MIUI
    //   focusout 常不触发 → 这个陈旧 keyboardRect 没被清 → #hall 被永久卡在 369, composer 浮在距底 32px 半空。
    //   改为: 主用 min(innerH,vv.h)(私信同款), VK.boundingRect 每次【实时读】不缓存(覆盖式键盘 vv/innerH 不缩时才用),
    //   天然免疫陈旧值。
    let vis = window.innerHeight;
    if (viewport && viewport.height) vis = Math.min(vis, viewport.height);
    // ★V57：扣键盘高的"全屏分母"用【落键盘时的持久基线 baseFullH】, 不用 max(当前innerH, 当前vv.h)。
    //   后者在 resizes-content 设备上键盘弹起会随 innerH 一起缩 → full-估算 把已缩的键盘再扣一遍(双减 → 112)。
    //   baseFullH 恒为键盘落下时的全高: 折叠屏 min(180, 457-174)=180 → 估算天然让位给已缩真值; 覆盖式才真扣。
    const full = Math.max(baseFullH || 0, window.innerHeight, viewport ? viewport.height : 0);
    let vkH = 0;
    try { const r = virtualKeyboard && virtualKeyboard.boundingRect; if (r && r.height > 0) vkH = Math.round(r.height); } catch (_) {}
    // ★V62（真机四组数据推翻「38→39」后重写）：只在 innerH、vv 都未缩（vis 接近 full＝真覆盖式 IME）时
    //   才从全高减 VK/估算；若 vis 已被平台缩（resizes-content / iOS），min(innerH,vv.h) 已是真可视高，
    //   不再减（免双减）。私信一直稳＝读真值不减，聊天室对齐同一策略。
    if (vkH > 0 && vis >= full - 4) vis = Math.min(vis, full - vkH);
    if (estimatedKbH > 0 && vis >= full - 4) vis = Math.min(vis, full - estimatedKbH);
    return Math.max(1, Math.round(vis));
  }

  function applyLayout() {
    frame = 0;
    const el = hall();
    if (!el) return;
    // PC 恢复纯 CSS 桌面布局（92dvh，最大 900px），禁止写入 VisualViewport 全高。
    if (!usesSoftKeyboardLayout()) {
      if (el.style.height) el.style.height = '';
      return;
    }
    if (!inHall()) {
      if (el.style.height) el.style.height = '';
      return;
    }
    // ★V59：折叠屏展开/收折时复用 resize → applyLayout，不新增监听器。
    //   键盘弹起且宽度发生变化，说明屏幕几何改变；此时 innerHeight 已是“新全高-键盘高”，
    //   用 innerHeight + 实际/估算键盘高重建新全高，避免继续沿用闭合态 baseFullH。
    const currentWidth = window.innerWidth;
    const widthChanged = layoutWidth > 0 && currentWidth !== layoutWidth;
    if (widthChanged && chatFocused) {
      let vkH = 0;
      try { const r = virtualKeyboard && virtualKeyboard.boundingRect; if (r && r.height > 0) vkH = Math.round(r.height); } catch (_) {}
      if (vkH > 0) baseFullH = Math.max(baseFullH, window.innerHeight + vkH);
      else if (estimatedKbH > 0) baseFullH = Math.max(baseFullH, window.innerHeight + estimatedKbH);
    }
    layoutWidth = currentWidth;

    // ★V57：键盘确定落下时(未聚焦且无估算/无覆盖式键盘几何), 当前 innerH 即真全高 → 刷新持久基线。
    //   进 hall、收键盘、转屏后都会走到这里把 baseFullH 校到当前朝向的全高, 避免陈旧竖屏高污染横屏。
    if (!chatFocused && estimatedKbH === 0) {
      let vkDown = true;
      try { const r = virtualKeyboard && virtualKeyboard.boundingRect; if (r && r.height > 0) vkDown = false; } catch (_) {}
      if (vkDown) baseFullH = Math.max(window.innerHeight, viewport ? viewport.height : 0);
    }
    // 不再区分聊天聚焦/未聚焦：#hall 高度始终跟随真实可视区。
    // 避免未聚焦时 CSS 100svh 与 visualViewport.height 差距造成的首次进 hall 底部留白。
    // 键盘弹起态收窄 composer 底部安全区，避免输入框与 IME 顶沿多出 10px 空隙。
    try {
      let vkH = 0;
      try { const r = virtualKeyboard && virtualKeyboard.boundingRect; if (r && r.height > 0) vkH = r.height; } catch (_) {}
      const kbUp = !!(chatFocused && (vkH > 0 || estimatedKbH > 0));
      document.documentElement.classList.toggle('kb-up', kbUp);
    } catch (_) {}
    const next = `${visibleHeight()}px`;
    if (el.style.height !== next) {
      // ★键盘弹起/收回改变 #hall 高度 → #stream 这个滚动容器随之变矮/变高。
      //   若用户本来贴在底部(在看最新消息, 含灵魂刚发的那条), 改高度前先记住"在底", 改完后重新贴底,
      //   否则底部内容会被键盘挤出视口(弹起)或下方留白(收回)——即"输入法弹起收回没考虑到新内容"。
      let wasAtBottom = false;
      try { wasAtBottom = (typeof window.nearBottom === 'function') ? window.nearBottom() : false; } catch (_) {}
      el.style.height = next;
      if (wasAtBottom) {
        try {
          if (typeof window.scrollStream === 'function') {
            // 等本帧高度落定再滚, 拿到新的 scrollHeight
            requestAnimationFrame(() => { try { window.scrollStream(); } catch (_) {} });
          }
        } catch (_) {}
      }
    }
  }

  function scheduleLayout() {
    if (!frame) frame = requestAnimationFrame(applyLayout);
  }

  function syncLayout() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    applyLayout();
  }

  function resetDocumentScroll() {
    if (inHall() && window.scrollY !== 0) window.scrollTo(0, 0);
  }

  function isTextInput(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && /^(text|password|email|search|tel|url|number)$/i.test(el.type || 'text');
  }

  function revealPopupInput() {
    const input = popupInput;
    if (!input || !document.body.contains(input)) return;
    requestAnimationFrame(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }

  function settleChatLayout() {
    syncLayout();
    resetDocumentScroll();
  }

  // 安卓 PWA 点系统输入法“收起”时，焦点可能仍留在 #cin，且 WebView 不发 focusout、resize 或 VK geometrychange。
  // 复位必须独立于输入框焦点：清掉估算态和轮询，再按当前真实可视区恢复 #hall。
  function dismissSoftKeyboardLayout() {
    chatFocused = false;
    keyboardRect = null;
    estimatedKbH = 0;
    vkHadPositiveGeometry = false;
    if (noSignalTimer) { clearTimeout(noSignalTimer); noSignalTimer = 0; }
    if (collapseTimer) { clearInterval(collapseTimer); collapseTimer = 0; }
    settleChatLayout();
  }

  // ★V45：小米 PWA 三信号全哑时，键盘收起同样无信号。启动轮询 fallback：
  // 在沉入估算态后，每 300ms 重探 VK.boundingRect / env(keyboard-inset-height) / window.innerHeight。
  // 任一信号变化到“键盘已收”情形（真值=0 或 innerH 回升）→ 清零 estimatedKbH + 重经布局。
  let collapseTimer = 0;
  let collapseBaseInnerH = 0;
  function startKbCollapseWatch() {
    if (collapseTimer) return;
    collapseBaseInnerH = window.innerHeight;
    collapseTimer = setInterval(() => {
      if (!chatFocused || estimatedKbH === 0) {
        clearInterval(collapseTimer); collapseTimer = 0; return;
      }
      // 信号 1：#cin 不再是活动元素（用户点了别处，focusout 可能未触发但 activeElement 变了）
      if (document.activeElement !== chatInput()) {
        chatFocused = false;
        estimatedKbH = 0;
        clearInterval(collapseTimer); collapseTimer = 0;
        settleChatLayout();
        return;
      }
      // 信号 2：window.innerHeight 回升（部分 WebView 收键盘时会变大）
      if (window.innerHeight > collapseBaseInnerH + 50) {
        estimatedKbH = 0;
        clearInterval(collapseTimer); collapseTimer = 0;
        settleChatLayout();
        return;
      }
      // 信号 3：VK.boundingRect 曾非 0 现在回 0（键盘物理收起）→ 清零估算。
      //   小米 WebView 覆盖式键盘常不触发 vv.resize / focusout，activeElement 也可能仍是 #cin、
      //   innerH 只微动 <50 → 只有这条 VK 现值信号能把估算拉回来。
      try {
        const r = virtualKeyboard && virtualKeyboard.boundingRect;
        // 不要求 vkGeomHits 增长：部分 Android PWA 只更新 boundingRect，不派 geometrychange。
        // 初始 boundingRect=0 不是收键盘；必须先看到过正高度，后续回到 0 才能清估算。
        if (r && r.height > 0) vkHadPositiveGeometry = true;
        if (vkHadPositiveGeometry && r && r.height === 0) {
          dismissSoftKeyboardLayout();
          return;
        }
      } catch (_) {}
    }, 300);
  }

  document.addEventListener('focusin', event => {
    if (event.target === chatInput()) {
      // PC 没有软键盘，不启动无信号估算；输入框由桌面 CSS 原位管理。
      if (!usesSoftKeyboardLayout()) return;
      // ★V55：消除后台恢复“闪一下”。V54 是“先弹起(focusin→估算)再 300ms 后 blur 拉回”，一弹一收就是闪。
      //   改为源头拦截：刚回前台的短窗口内，若 focusin 无伴随用户交互（引擎恢复）→ 立即 blur、不启动估算定时器 → 根本不弹起、不闪。
      if (justForegrounded && (Date.now() - lastUserTouchTs > 500)) {
        try { event.target.blur(); } catch (_) {}
        return;
      }
      // ★V57：focusin 此刻键盘尚未弹起(viewport 仍全高), 记下持久全屏基线, 供 visibleHeight() 扣键盘高做分母。
      //   比取当前(可能已缩)的 innerH 稳: 是键盘落下态的真全高。
      baseFullH = Math.max(baseFullH, window.innerHeight, viewport ? viewport.height : 0);
      chatFocused = true;
      resetDocumentScroll();
      // ★V40：退回 V38 估算兼容。V39 不干预方向错误（浏览器并未自动避让）。
      // ★同时：如果 VK.boundingRect 或 env(keyboard-inset-height) 给了真值，优先使用真值（待 V40 看能不能拿到）。
      signalBaseline = {
        vvH: viewport ? viewport.height : window.innerHeight,
        vkHits: vkGeomHits,
        winH: window.innerHeight,
      };
      if (noSignalTimer) clearTimeout(noSignalTimer);
      noSignalTimer = setTimeout(() => {
        if (!chatFocused || estimatedKbH > 0) return;
        const curVv = viewport ? viewport.height : window.innerHeight;
        const changed = (Math.abs(curVv - signalBaseline.vvH) > 1)
          || (vkGeomHits > signalBaseline.vkHits)
          || (Math.abs(window.innerHeight - signalBaseline.winH) > 1);
        if (!changed) {
          // ★V40：优先直读 VirtualKeyboard.boundingRect，拿不到再看 env(keyboard-inset-height)，都拿不到才落到 0.33 估算。
          let realKbH = 0;
          try {
            const r = virtualKeyboard && virtualKeyboard.boundingRect;
            if (r && r.height > 0) realKbH = Math.round(r.height);
          } catch (_) {}
          if (!realKbH) {
            // 探 env(keyboard-inset-height)
            const probe = document.createElement('div');
            probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;height:env(keyboard-inset-height,0px)';
            document.body.appendChild(probe);
            const h = probe.getBoundingClientRect().height;
            probe.remove();
            if (h > 0) realKbH = Math.round(h);
          }
          // ★V42：主人指令，fallback 系数从 0.33+25 改为 0.35（真机微调）。真值路径不变。
          if (realKbH) {
            estimatedKbH = realKbH;
          } else {
            // ★V61：安卓折叠屏 PWA 的覆盖式 IME 无几何信号时，38% 会让输入框仍落进键盘边缘；
            //   只增加 1 个百分点的安全余量。真实 vv/innerH/VK 信号路径不走这里。
            estimatedKbH = Math.round((viewport ? viewport.height : window.innerHeight) * 0.39);
          }
          // ★V45：估算启用后启动轮询，检测“键盘收起”信号（小米 PWA 上收键盘不一定触发 focusout，也不一定发 vv.resize）。
          startKbCollapseWatch();
          settleChatLayout();
        }
      }, 250);
      return;
    }
    if (isTextInput(event.target)) {
      popupInput = event.target;
      setTimeout(revealPopupInput, 250);
    }
  }, { passive: true });

  document.addEventListener('focusout', event => {
    if (event.target === chatInput()) {
      if (!usesSoftKeyboardLayout()) return;
      dismissSoftKeyboardLayout();
    }
    if (event.target === popupInput) popupInput = null;
  }, { passive: true });

  if (viewport) {
    viewport.addEventListener('resize', () => {
      // ★V60：resize 事件不等于几何信号。小米 18 Fold 覆盖式键盘会发空 resize，
      //   innerHeight/vv.height 都不变；此时不能撤销刚建立的 estimatedKbH，否则 composer 又回到底部被键盘盖住。
      const hasRealVvChange = !!(signalBaseline && Math.abs(viewport.height - signalBaseline.vvH) > 1);
      if (estimatedKbH > 0 && hasRealVvChange) estimatedKbH = 0;
      scheduleLayout();
    }, { passive: true });
    viewport.addEventListener('scroll', () => {
      scheduleLayout();
      resetDocumentScroll();
    }, { passive: true });
  }

  window.addEventListener('resize', scheduleLayout, { passive: true });
  window.addEventListener('orientationchange', () => {
    // ★V58（VK 双减修复）：只在【键盘确认落下】时才把 baseFullH=0；键盘弹起中转屏保留旧全高。
    //   旧实现无条件 baseFullH=0 → visibleHeight() 的 full 退化成【已缩的 innerH/vv.h】
    //   → 再减一次 vkH/estimatedKbH = 双减(#hall 被过度压缩、composer 浮空)。
    //   落下判定与 applyLayout 复位分支同款三条件：!chatFocused && estimatedKbH===0 && VK.boundingRect.height===0。
    //   键盘弹起态保留旧 baseFullH；等键盘落下后 applyLayout 会自动把 baseFullH 刷新到新朝向真全高。
    let vkDown = true;
    try { const r = virtualKeyboard && virtualKeyboard.boundingRect; if (r && r.height > 0) vkDown = false; } catch (_) {}
    if (!chatFocused && estimatedKbH === 0 && vkDown) baseFullH = 0;
    setTimeout(settleChatLayout, 250);
  }, { passive: true });

  if (virtualKeyboard) {
    // ★V53（主人思路：参考弹起信号解弹回）：overlaysContent=true 把键盘设成“覆盖式”（悬浮盖内容、viewport 不缩）
    //   → vv/win 信号全哑 → 被迫用 0.38 估算 + 弹回时三信号命中不了。这是自己亲手造的难题链。
    //   改回 false（系统默认占位式）：键盘顶起 viewport → vv.resize 有信号 → 弹起/弹回交给系统自动处理，不再依赖估算。
    //   估算整套作为兵底保留（万一某设备 false 下仍哑）。
    try { virtualKeyboard.overlaysContent = false; } catch (_) {}
    virtualKeyboard.addEventListener('geometrychange', event => {
      // ★V30：真信号回来了 → 撤销估算。
      vkGeomHits++;
      const rect = event.target.boundingRect;
      if (rect && rect.height > 0) {
        vkHadPositiveGeometry = true;
        if (estimatedKbH > 0) estimatedKbH = 0;
      } else if (vkHadPositiveGeometry) {
        estimatedKbH = 0;
      }
      keyboardRect = rect;
      settleChatLayout();
    });
  }

  // ★V54：记录最近用户真实交互时间戳（用于区分后台恢复的引擎 focus vs 用户主动 focus）。
  let lastUserTouchTs = 0;
  // ★V55：刚回前台的短窗口标记。回前台后 700ms 内视为“可能有引擎 focus 快照恢复”，focusin 源头拦截用。
  let justForegrounded = false;
  let justFgTimer = 0;
  document.addEventListener('touchstart', event => {
    lastUserTouchTs = Date.now();
    const input = chatInput();
    if (!input || document.activeElement !== input) return;
    if (event.target === input || event.target.closest?.('.composer')) return;
    input.blur();
  }, { passive: true, capture: true });

  // ★V54：后台恢复误弹起修复。小米浏览器/PWA 进程冻结恢复时，引擎会自动把 focus
  //   还原到进后台前的 #cin（引擎级 focus 快照恢复，早于任何 JS 事件）→ 触发 focusin → 误估算键盘高 → 输入框误弹上。
  //   用户主动点击会伴随 touchstart（上面记了时间戳）；回前台后短窗口内若 #cin 被 focus 但无伴随交互 → 引擎恢复 → 主动 blur。
  // ★V55：源头拦截已在 focusin 处理（justForegrounded 窗口内引擎 focus 直接 blur 不弹）。
  //   guardBackgroundRefocus 保留作兜底：万一 focusin 拦截漏了（例如 focus 早于窗口标记设立），300ms 后再收一次。
  function guardBackgroundRefocus() {
    if (!usesSoftKeyboardLayout()) return;
    justForegrounded = true;
    if (justFgTimer) clearTimeout(justFgTimer);
    justFgTimer = setTimeout(() => { justForegrounded = false; justFgTimer = 0; }, 700);
    setTimeout(() => {
      if (!inHall()) return;
      if (document.activeElement !== chatInput()) return;
      if (Date.now() - lastUserTouchTs > 500) {
        try { chatInput().blur(); } catch (_) {}
        chatFocused = false;
        estimatedKbH = 0;
        if (noSignalTimer) { clearTimeout(noSignalTimer); noSignalTimer = 0; }
        settleChatLayout();
      }
    }, 300);
  }
  // 复用 app.js 已有的 visibilitychange/pageshow/focus 多源入口（不新增监听器，过 CI 门禁）。
  window.__ehKbGuardBg = guardBackgroundRefocus;

  window.__ehApplyVVH = settleChatLayout;
  // 供 DM 抽屉(独立 fixed 容器, 不是 #hall)复用同一套键盘几何: vv + VirtualKeyboard.boundingRect + 估算兜底。
  //   DM 只读 vv.height 在【覆盖式键盘(overlaysContent=true)】下失效(vv 不缩), 必须走这个统一口子:
  //   visibleHeight() 会在有 VK.boundingRect 时把键盘高扣掉 → 覆盖式/占位式两种模式都返回真实可视高。
  window.__ehKbVisibleH = function () { try { return visibleHeight(); } catch (_) { return (viewport ? viewport.height : window.innerHeight); } };
  window.__ehKbReset = function () {
    dismissSoftKeyboardLayout();
    const el = hall();
    if (el) el.style.height = '';
    document.documentElement.style.removeProperty('--vh');
    document.documentElement.classList.remove('kb-up');
    document.documentElement.removeAttribute('data-kb-jsfallback');
  };

  window.__ehKbReset();
})();
