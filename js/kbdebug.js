/* Echo Hall 键盘遮挡诊断浮层 v2（?kbdebug=1）。
 * 追加：stream 与 composer 的间距、最新消息底到 composer 的间距，
 * 定位「距离不合适」到底是 stream 布满未顶到 composer，还是消息未贴 stream 底。
 */
(function () {
  if (!/[?&]kbdebug=1(&|$)/.test(location.search)) return;

  const box = document.createElement('div');
  box.id = '__ehkbdbg';
  box.style.cssText = [
    'position:fixed', 'left:6px', 'top:6px', 'z-index:2147483647',
    'background:rgba(0,0,0,.86)', 'color:#0ff', 'font:11px/1.45 monospace',
    'padding:7px 9px', 'border:1px solid #0ff', 'border-radius:6px',
    'pointer-events:none', 'white-space:pre', 'max-width:82vw'
  ].join(';');

  function mount() {
    if (!document.body) return false;
    document.body.appendChild(box);
    return true;
  }
  if (!mount()) document.addEventListener('DOMContentLoaded', mount);

  const vv = window.visualViewport;
  const px = v => (v == null || Number.isNaN(v) ? '?' : Math.round(v));

  function snapshot() {
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

    const lines = [
      'kbdebug v2 · ' + (focused ? '聊天框已聚焦' : '未聚焦'),
      'innerH        = ' + px(window.innerHeight),
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
  document.addEventListener('focusin', () => setTimeout(snapshot, 50), { passive: true });
  document.addEventListener('focusout', () => setTimeout(snapshot, 250), { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(snapshot, 300), { passive: true });
  setInterval(snapshot, 300);
  snapshot();
})();
