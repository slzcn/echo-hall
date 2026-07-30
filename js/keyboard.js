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
  // ★V35：小米浏览器桌面 PWA 全屏态 —— vv/innerH/clientH 全部不变（三信号真哑），
  // 但浏览器把 composer/`.cin-wrap` 视觉上推了，真值信号在 rect.bottom 上。
  // V33 金矿截图实锤：框底 790 → 589（位移 201 = 键盘高真值）。
  let pollRaf = 0;
  let pollStopAt = 0;
  let pollBaselineBottom = 0;
  let pollBaselineVv = 0;
  let inferredKbH = 0;                   // 从 composer 位移推导出的键盘高真值
  function composerBottom() {
    const wrap = document.querySelector('.composer .cin-wrap');
    if (!wrap) return null;
    return Math.round(wrap.getBoundingClientRect().bottom);
  }
  function pollViewport() {
    pollRaf = 0;
    if (!chatFocused || Date.now() > pollStopAt) return;
    const curVv = viewport ? viewport.height : window.innerHeight;
    const curBottom = composerBottom();
    let needLayout = false;
    // 分支 1：vv.height 变了（iOS / 安卓 Chrome / 小米浏览器地址栏未隐藏态）
    if (Math.abs(curVv - pollBaselineVv) > 1) {
      pollBaselineVv = curVv;
      inferredKbH = 0;
      needLayout = true;
    }
    // 分支 2：vv 不变但 composer 上推了（小米 PWA 全屏态）——位移就是键盘高。
    if (curBottom != null && pollBaselineBottom > 0) {
      const displaced = pollBaselineBottom - curBottom;
      if (displaced > 20 && Math.abs(displaced - inferredKbH) > 2) {
        inferredKbH = displaced;
        needLayout = true;
      }
    }
    if (needLayout) syncLayout();
    pollRaf = requestAnimationFrame(pollViewport);
  }
  function startPoll() {
    pollBaselineVv = viewport ? viewport.height : window.innerHeight;
    // 基线底取 focusin 瞬间值。若 composer 位移与基线差 > 20px 就当作键盘高真值。
    pollBaselineBottom = composerBottom() || 0;
    pollStopAt = Date.now() + 2000;
    inferredKbH = 0;
    if (!pollRaf) pollRaf = requestAnimationFrame(pollViewport);
  }
  function stopPoll() {
    if (pollRaf) { cancelAnimationFrame(pollRaf); pollRaf = 0; }
    inferredKbH = 0;
  }


  const hall = () => document.getElementById('hall');
  const chatInput = () => document.getElementById('cin');
  const inHall = () => document.body.classList.contains('hall-on');

  function visibleHeight() {
    const top = viewport ? viewport.offsetTop : 0;
    let bottom = viewport ? top + viewport.height : window.innerHeight;
    if (keyboardRect && keyboardRect.height > 0) bottom = Math.min(bottom, keyboardRect.top);
    // ★V35：从 composer 视觉位移推导出的键盘高——真值信号，不是估算。
    if (inferredKbH > 0) bottom -= inferredKbH;
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

  document.addEventListener('focusin', event => {
    if (event.target === chatInput()) {
      chatFocused = true;
      resetDocumentScroll();
      // ★V34：启动 rAF 轮询 vv.height/innerH 真值，不靠 resize 事件。
      startPoll();
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
      stopPoll();
      settleChatLayout();
    }
    if (event.target === popupInput) popupInput = null;
  }, { passive: true });

  if (viewport) {
    viewport.addEventListener('resize', scheduleLayout, { passive: true });
    viewport.addEventListener('scroll', () => {
      scheduleLayout();
      resetDocumentScroll();
    }, { passive: true });
  }

  window.addEventListener('resize', scheduleLayout, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(settleChatLayout, 250), { passive: true });

  if (virtualKeyboard) {
    try { virtualKeyboard.overlaysContent = true; } catch (_) {}
    virtualKeyboard.addEventListener('geometrychange', event => {
      keyboardRect = event.target.boundingRect;
      settleChatLayout();
    });
  }

  document.addEventListener('touchstart', event => {
    const input = chatInput();
    if (!input || document.activeElement !== input) return;
    if (event.target === input || event.target.closest?.('.composer')) return;
    input.blur();
  }, { passive: true, capture: true });

  window.__ehApplyVVH = settleChatLayout;
  window.__ehKbReset = function () {
    chatFocused = false;
    keyboardRect = null;
    stopPoll();
    const el = hall();
    if (el) el.style.height = '';
    document.documentElement.style.removeProperty('--vh');
    document.documentElement.classList.remove('kb-up');
    document.documentElement.removeAttribute('data-kb-jsfallback');
  };

  window.__ehKbReset();
})();
