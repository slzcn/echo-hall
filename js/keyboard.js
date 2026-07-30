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
    // ★失焦（键盘收回）时清空 inline height 退回 CSS 满高，
    //   避免安卓 PWA 下 vv.resize 不可靠导致 stage 卡在小高度，
    //   二次聚焦时输入框被顶到顶部。只在聚焦（键盘激活）时才钉 vv.height。
    if (kbActive) {
      el.style.height = `${Math.round(viewport.height)}px`;
    } else {
      el.style.height = '';
    }
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
      scheduleChatLayout();
      // 兜底：vv.resize 在安卓 PWA 可能延迟/不触发，多帧采样保证 stage 跟上
      [100, 250, 450, 700, 1000, 1500].forEach(ms => setTimeout(scheduleChatLayout, ms));
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
      scheduleChatLayout(); // 立即释放高度
      // 兜底：键盘收回动画期间不断确保回满高
      [100, 300, 600].forEach(ms => setTimeout(scheduleChatLayout, ms));
    }
    if (event.target === popupInput) popupInput = null;
  }, { passive: true });

  if (viewport) {
    viewport.addEventListener('resize', () => {
      scheduleChatLayout();
      revealPopupInput();
    }, { passive: true });
  }

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
