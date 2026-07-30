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

  const hall = () => document.getElementById('hall');
  const chatInput = () => document.getElementById('cin');
  const inHall = () => document.body.classList.contains('hall-on');

  function visibleHeight() {
    const top = viewport ? viewport.offsetTop : 0;
    let bottom = viewport ? top + viewport.height : window.innerHeight;
    if (keyboardRect && keyboardRect.height > 0) bottom = Math.min(bottom, keyboardRect.top);
    return Math.max(1, Math.round(bottom - top));
  }

  function applyLayout() {
    frame = 0;
    const el = hall();
    if (!el) return;
    if (!inHall() || !chatFocused) {
      if (el.style.height) el.style.height = '';
      return;
    }
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
      settleChatLayout();
    }
    if (event.target === popupInput) popupInput = null;
  }, { passive: true });

  if (viewport) {
    viewport.addEventListener('resize', () => { if (chatFocused) scheduleLayout(); }, { passive: true });
    viewport.addEventListener('scroll', () => {
      if (chatFocused) scheduleLayout();
      resetDocumentScroll();
    }, { passive: true });
  }

  window.addEventListener('resize', () => { if (chatFocused) scheduleLayout(); }, { passive: true });
  window.addEventListener('orientationchange', () => { if (chatFocused) setTimeout(settleChatLayout, 250); }, { passive: true });

  if (virtualKeyboard) {
    try { virtualKeyboard.overlaysContent = true; } catch (_) {}
    virtualKeyboard.addEventListener('geometrychange', event => {
      keyboardRect = event.target.boundingRect;
      if (chatFocused) settleChatLayout();
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
    const el = hall();
    if (el) el.style.height = '';
    document.documentElement.style.removeProperty('--vh');
    document.documentElement.classList.remove('kb-up');
    document.documentElement.removeAttribute('data-kb-jsfallback');
  };

  window.__ehKbReset();
})();
