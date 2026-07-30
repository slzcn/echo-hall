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

  document.addEventListener('focusin', event => {
    if (event.target === chatInput()) {
      chatFocused = true;
      resetDocumentScroll();
      // 不在这里写 #hall 高度：键盘弹起后 visualViewport.resize / VirtualKeyboard.geometrychange 会一次写到位，
      // 避免先写 innerHeight 再写 vv.height 造成的两帧跳变。
      // ★V30：启动无信号判定。记录 focusin 瞬间基线，250ms 后若 vv/VK/window 都没变 → 启用估算。
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
          estimatedKbH = Math.round(window.screen.height * 0.42);
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
    try { virtualKeyboard.overlaysContent = true; } catch (_) {}
    virtualKeyboard.addEventListener('geometrychange', event => {
      // ★V30：真信号回来了 → 撤销估算。
      vkGeomHits++;
      if (estimatedKbH > 0) estimatedKbH = 0;
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
