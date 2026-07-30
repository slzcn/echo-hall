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

  const hall = () => document.getElementById('hall');
  const chatInput = () => document.getElementById('cin');
  const inHall = () => document.body.classList.contains('hall-on');

  function visibleHeight() {
    const top = viewport ? viewport.offsetTop : 0;
    let bottom = viewport ? top + viewport.height : window.innerHeight;
    if (keyboardRect && keyboardRect.height > 0) bottom = Math.min(bottom, keyboardRect.top);
    // ★V30：无信号 WebView 兜底——从可视底扊掋估算键盘高。
    if (estimatedKbH > 0) bottom -= estimatedKbH;
    return Math.max(1, Math.round(bottom - top));
  }

  function applyLayout() {
    frame = 0;
    const el = hall();
    if (!el) return;
    if (!inHall()) {
      if (el.style.height) el.style.height = '';
      return;
    }
    // 不再区分聊天聚焦/未聚焦：#hall 高度始终跟随真实可视区。
    // 避免未聚焦时 CSS 100svh 与 visualViewport.height 差距造成的首次进 hall 底部留白。
    const next = `${visibleHeight()}px`;
    if (el.style.height !== next) el.style.height = next;
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
      // 信号 3：VK.boundingRect 当前为真值（开始 0 后变非 0 又变 0——三信号全哑时很少命中，作为上限兵入共同处理）
      try {
        const r = virtualKeyboard && virtualKeyboard.boundingRect;
        if (r && r.height === 0 && vkGeomHits > (signalBaseline?.vkHits || 0)) {
          // 曾有 geometrychange 峙峰 rect 但现在回 0 → 真实收起。但走不到这里、上面 vv/vk 监听已处理。
        }
      } catch (_) {}
    }, 300);
  }

  document.addEventListener('focusin', event => {
    if (event.target === chatInput()) {
      // ★V55：消除后台恢复“闪一下”。V54 是“先弹起(focusin→估算)再 300ms 后 blur 拉回”，一弹一收就是闪。
      //   改为源头拦截：刚回前台的短窗口内，若 focusin 无伴随用户交互（引擎恢复）→ 立即 blur、不启动估算定时器 → 根本不弹起、不闪。
      if (justForegrounded && (Date.now() - lastUserTouchTs > 500)) {
        try { event.target.blur(); } catch (_) {}
        return;
      }
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
            estimatedKbH = Math.round((viewport ? viewport.height : window.innerHeight) * 0.38);
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
      chatFocused = false;
      keyboardRect = null;
      // ★V30：失焦清零估算键盘高 + 取消待定定时器。
      estimatedKbH = 0;
      if (noSignalTimer) { clearTimeout(noSignalTimer); noSignalTimer = 0; }
      settleChatLayout();
    }
    if (event.target === popupInput) popupInput = null;
  }, { passive: true });

  if (viewport) {
    viewport.addEventListener('resize', () => {
      // ★V30：真信号回来了 → 撤销估算，切回真值主链。
      if (estimatedKbH > 0) estimatedKbH = 0;
      scheduleLayout();
    }, { passive: true });
    viewport.addEventListener('scroll', () => {
      scheduleLayout();
      resetDocumentScroll();
    }, { passive: true });
  }

  window.addEventListener('resize', scheduleLayout, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(settleChatLayout, 250), { passive: true });

  if (virtualKeyboard) {
    // ★V53（主人思路：参考弹起信号解弹回）：overlaysContent=true 把键盘设成“覆盖式”（悬浮盖内容、viewport 不缩）
    //   → vv/win 信号全哑 → 被迫用 0.38 估算 + 弹回时三信号命中不了。这是自己亲手造的难题链。
    //   改回 false（系统默认占位式）：键盘顶起 viewport → vv.resize 有信号 → 弹起/弹回交给系统自动处理，不再依赖估算。
    //   估算整套作为兵底保留（万一某设备 false 下仍哑）。
    try { virtualKeyboard.overlaysContent = false; } catch (_) {}
    virtualKeyboard.addEventListener('geometrychange', event => {
      // ★V30：真信号回来了 → 撤销估算。
      vkGeomHits++;
      if (estimatedKbH > 0) estimatedKbH = 0;
      keyboardRect = event.target.boundingRect;
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
  window.__ehKbReset = function () {
    chatFocused = false;
    keyboardRect = null;
    estimatedKbH = 0;
    if (noSignalTimer) { clearTimeout(noSignalTimer); noSignalTimer = 0; }
    const el = hall();
    if (el) el.style.height = '';
    document.documentElement.style.removeProperty('--vh');
    document.documentElement.classList.remove('kb-up');
    document.documentElement.removeAttribute('data-kb-jsfallback');
  };

  window.__ehKbReset();
})();
