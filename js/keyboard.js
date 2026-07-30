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
      el.style.height = '';
      return;
    }
    el.style.height = `${visibleHeight()}px`;
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
      settleChatLayout();
      [100, 250, 450, 700, 1000].forEach(ms => setTimeout(settleChatLayout, ms));
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
      [100, 300, 600].forEach(ms => setTimeout(settleChatLayout, ms));
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
    const el = hall();
    if (el) el.style.height = '';
    document.documentElement.style.removeProperty('--vh');
    document.documentElement.classList.remove('kb-up');
    document.documentElement.removeAttribute('data-kb-jsfallback');
  };

  window.__ehKbReset();
})();
