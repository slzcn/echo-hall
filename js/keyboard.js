/* Echo Hall 键盘布局：一个控制器，一个高度源。
 * 进入聊天室后，.stage 始终跟随 visualViewport.height；聊天框聚焦只触发一次即时重算。
 * 其他输入框只滚动到可见位置，不改页面布局。
 */
(function () {
  const viewport = window.visualViewport;
  let frame = 0;
  let popupInput = null;
  let kbActive = false; // 聊天输入框聚焦=键盘意图激活

  const stage = () => document.querySelector('.stage');
  const chatInput = () => document.getElementById('cin');
  const inHall = () => document.body.classList.contains('hall-on');

  function clearLegacyLayout() {
    const el = stage();
    if (el) {
      el.style.height = '';
      el.style.position = '';
      el.style.inset = '';
      el.style.top = '';
      el.style.left = '';
      el.style.width = '';
      el.style.transform = '';
      el.style.transition = '';
      el.removeAttribute('data-kb-offset');
    }
    document.documentElement.style.removeProperty('--vh');
    document.documentElement.classList.remove('kb-up');
    document.documentElement.removeAttribute('data-kb-jsfallback');
  }

  function updateChatLayout() {
    frame = 0;
    const el = stage();
    if (!el || !inHall() || !viewport) {
      if (el) el.style.height = '';
      return;
    }
    // 键盘激活时取两个 viewport 的较小值：Android PWA 走 resizes-content
    // 时 innerHeight 会先缩小；iOS 则通常由 visualViewport.height 反映键盘。
    // 两者只保留一个共同高度源，避免某一侧停在键盘弹起前的大值。
    if (kbActive) {
      const h = Math.min(window.innerHeight, viewport.height);
      el.style.height = `${Math.round(h)}px`;
    } else {
      // 失焦立即释放 inline 高度，避免二次聚焦继承键盘期间的小高度。
      el.style.height = '';
    }
  }

  function syncChatLayout() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    updateChatLayout();
  }

  function resetIOSScroll() {
    // iOS 聚焦输入框后可能异步把文档向上滚；聊天页本身不应滚动文档。
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  }

  function scheduleChatLayout() {
    if (!frame) frame = requestAnimationFrame(updateChatLayout);
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

  document.addEventListener('focusin', event => {
    if (event.target === chatInput()) {
      kbActive = true;
      // 必须在系统键盘调整 viewport 之前同步把 stage 接管到当前较小高度，
      // 避免 iOS 先滚动整页、Android PWA 先沿用旧高度。
      syncChatLayout();
      resetIOSScroll();
      [100, 250, 450, 700, 1000, 1500].forEach(ms => setTimeout(() => {
        syncChatLayout();
        resetIOSScroll();
      }, ms));
      return;
    }
    if (isTextInput(event.target)) {
      popupInput = event.target;
      setTimeout(revealPopupInput, 250);
    }
  }, { passive: true });

  document.addEventListener('focusout', event => {
    if (event.target === chatInput()) {
      kbActive = false;
      syncChatLayout();
      resetIOSScroll();
      [100, 300, 600].forEach(ms => setTimeout(() => {
        syncChatLayout();
        resetIOSScroll();
      }, ms));
    }
    if (event.target === popupInput) popupInput = null;
  }, { passive: true });

  if (viewport) {
    viewport.addEventListener('resize', () => {
      scheduleChatLayout();
      revealPopupInput();
    }, { passive: true });
  }

  window.addEventListener('resize', () => {
    scheduleChatLayout();
  }, { passive: true });

  window.addEventListener('orientationchange', () => setTimeout(scheduleChatLayout, 250), { passive: true });

  document.addEventListener('touchstart', event => {
    const input = chatInput();
    if (!input || document.activeElement !== input) return;
    if (event.target === input || event.target.closest?.('.composer')) return;
    input.blur();
  }, { passive: true, capture: true });

  window.__ehApplyVVH = function () {
    clearLegacyLayout();
    scheduleChatLayout();
    requestAnimationFrame(() => window.scrollStream?.());
  };
  window.__ehKbReset = clearLegacyLayout;

  clearLegacyLayout();
})();
