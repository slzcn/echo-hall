/* Echo Hall 键盘遮挡诊断浮层（?kbdebug=1 开启）。
 * 只读、不占布局、不改任何样式，实时显示 composer 与键盘顶的关系。
 * 目的：一眼看清"遮挡量 = composer 底边 - 键盘顶边"，定位遮挡根源。
 */
(function () {
  if (!/[?&]kbdebug=1(&|$)/.test(location.search)) return;

  const box = document.createElement('div');
  box.id = '__ehkbdbg';
  box.style.cssText = [
    'position:fixed', 'left:6px', 'top:6px', 'z-index:2147483647',
    'background:rgba(0,0,0,.86)', 'color:#0ff', 'font:11px/1.45 monospace',
    'padding:7px 9px', 'border:1px solid #0ff', 'border-radius:6px',
    'pointer-events:none', 'white-space:pre', 'max-width:78vw'
  ].join(';');

  function mount() {
    if (!document.body) return false;
    document.body.appendChild(box);
    return true;
  }
  if (!mount()) document.addEventListener('DOMContentLoaded', mount);

  const vv = window.visualViewport;
  const px = v => (v == null ? '?' : Math.round(v));

  function snapshot() {
    const stage = document.querySelector('.stage');
    const hall = document.getElementById('hall');
    const composer = document.querySelector('.composer');
    const cin = document.getElementById('cin');

    const kbTop = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const cRect = composer ? composer.getBoundingClientRect() : null;
    const overlap = cRect ? cRect.bottom - kbTop : null;
    const focused = document.activeElement === cin;

    const lines = [
      'kbdebug · ' + (focused ? '聊天框已聚焦' : '未聚焦'),
      'innerH      = ' + px(window.innerHeight),
      'vv.height   = ' + px(vv && vv.height),
      'vv.offsetTop= ' + px(vv && vv.offsetTop),
      '键盘顶边    = ' + px(kbTop),
      'stage内联h  = ' + (stage ? (stage.style.height || '(空)') : '无'),
      'stage实际h  = ' + (stage ? px(parseFloat(getComputedStyle(stage).height)) : '无'),
      'hall实际h   = ' + (hall ? px(parseFloat(getComputedStyle(hall).height)) : '无'),
      'hall溢出    = ' + (hall ? getComputedStyle(hall).overflow : '无'),
      'composer底  = ' + (cRect ? px(cRect.bottom) : '无'),
      'composer高  = ' + (cRect ? px(cRect.height) : '无'),
      '★遮挡量    = ' + (overlap == null ? '?' : (px(overlap) + (overlap > 1 ? ' ← 被键盘盖住' : ' ok'))),
      'ver         = ' + (window.__EH_BUILD_VER || '?')
    ];
    box.textContent = lines.join('\n');
    box.style.color = overlap > 1 ? '#f66' : '#0ff';
    box.style.borderColor = overlap > 1 ? '#f66' : '#0ff';
  }

  if (vv) {
    vv.addEventListener('resize', snapshot, { passive: true });
    vv.addEventListener('scroll', snapshot, { passive: true });
  }
  document.addEventListener('focusin', () => setTimeout(snapshot, 50), { passive: true });
  document.addEventListener('focusout', () => setTimeout(snapshot, 250), { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(snapshot, 300), { passive: true });
  setInterval(snapshot, 500);
  snapshot();
})();
