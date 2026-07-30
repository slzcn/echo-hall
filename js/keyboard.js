/* Echo Hall 键盘布局：一个控制器，一个高度源。
 * 聊天框聚焦时，.stage 跟随 visualViewport.height；失焦时恢复 CSS。
 * 其他输入框只滚动到可见位置，不改页面布局。
 */
(function () {
  const viewport = window.visualViewport;
  let frame = 0;
  let popupInput = null;

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
    // 进入房间就让 .stage 恒等于 visualViewport.height(当前真实可视区高):
    // 工具栏展开=小、收起=大、键盘弹起=更小, vv.height 永远精确 -> composer 永远贴真实底边。
    // 底边 5px 间距由 .composer 的 padding-bottom 控制, 不再依赖 CSS 静态 svh/dvh。
    if (!el || !inHall() || !viewport) {
      if (el) el.style.height = '';
      return;
    }
    el.style.height = `${Math.round(viewport.height)}px`;
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
      scheduleChatLayout();
      return;
    }
    if (isTextInput(event.target)) {
      popupInput = event.target;
      setTimeout(revealPopupInput, 250);
    }
  }, { passive: true });

  document.addEventListener('focusout', event => {
    if (event.target === chatInput()) setTimeout(scheduleChatLayout, 200);
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
