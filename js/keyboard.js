// ============ 聊天页键盘协同 · V9 权威方案 (2026-07-30) ============
// 【为什么推翻 V8】权威调研发现 V8 建立在多个错误假设上:
// 1. Safari/iOS 至今未实现 interactive-widget=resizes-content (WebKit bug #259770 追踪中)
//    → V8 注释写"Safari 17.4+ 支持"是错的
// 2. CSS.supports('env(keyboard-inset-height)') 在 iOS Safari 会返回 true
//    但实际 env(keyboard-inset-height) 永远是 0 (MDN: env() 语法合法即通过 supports)
//    → V8 的 iOS fallback 从未启动!
// 3. overlaysContent=true 和 interactive-widget=resizes-content 语义互斥
//    (前者禁止缩 viewport 由应用自己避让, 后者要求浏览器缩 viewport)
// 4. iOS fallback 键盘高公式应是 layoutHeight - (vv.offsetTop + vv.height)
//    V8 少减了 offsetTop, 会推得过高
// 5. overlaysContent=true 是全局设置, 破坏弹窗 isKbOpen 逻辑
//
// 【V9 分层策略】
//  A. Android Chrome (有 navigator.virtualKeyboard):
//     启用 overlaysContent=true, CSS env(keyboard-inset-height) 驱动 composer
//     .stage 保持 100dvh, VirtualKeyboard 通过 boundingRect 精确报告键盘位置
//  B. iOS Safari/PWA + 无 VirtualKeyboard API 环境:
//     禁用 interactive-widget=resizes-content 的错误期望
//     用 VisualViewport 作为唯一真源, 写 --vh 让 .stage 走真实可视高度
//     公式: kbH = innerHeight - (vv.offsetTop + vv.height)  ← 减 offsetTop!
//  C. 覆盖式 IME (讯飞/搜狗浮动): vv 不变时 blur 兜底
//
// 【关键决策】
// - 不再用 CSS.supports 判断 env 可用性, 直接用 navigator.virtualKeyboard 特性存在性
// - iOS 永远走 vv fallback (即使 CSS.supports 返回 true 也不信)
// - .stage 是唯一高度源 (写 --vh + data-kb-jsfallback), 不再单独 transform composer
(function(){
  var vv = window.visualViewport;

  // 平台分层探测: 只有 navigator.virtualKeyboard 存在时才走 CSS env 模式
  // iOS Safari/PWA 从未实现 VirtualKeyboard API, 一律走 vv fallback
  var hasVKAPI = !!(navigator.virtualKeyboard);
  var useVKMode = hasVKAPI;  // 仅 Android Chromium 系走 VK 模式
  var useVVFallback = !useVKMode && !!vv;  // 其他平台一律 vv fallback (含 iOS 全部)

  // Android: 启用 overlaysContent 让 env(keyboard-inset-height) 生效
  // iOS: 不启用 (即使能开也无效, 反而增加复杂度)
  if(useVKMode){
    try{ navigator.virtualKeyboard.overlaysContent = true; }catch(_){}
  }

  var composer = null, cin = null, stage = null;
  function getComposer(){ if(!composer) composer = document.querySelector('.composer'); return composer; }
  function getCin(){ if(!cin) cin = document.getElementById('cin'); return cin; }
  function getStage(){ if(!stage) stage = document.querySelector('.stage'); return stage; }
  function hallOn(){ return document.body.classList.contains('hall-on'); }
  function cinFocused(){ return document.activeElement && document.activeElement.id==='cin'; }

  // VV fallback: 写 --vh 让 .stage 走真高度, 用 html[data-kb-jsfallback] 选择器
  var raf = 0;
  function applyFallback(){
    raf = 0;
    if(!vv) return;
    var s = getStage(); if(!s) return;

    if(!hallOn() || !cinFocused()){
      // 无键盘态: 清 fallback 变量
      document.documentElement.removeAttribute('data-kb-jsfallback');
      document.documentElement.style.removeProperty('--vh');
      document.documentElement.classList.remove('kb-up');
      updateDebug();
      return;
    }

    // 正确公式: 底部遮挡 = layoutHeight - (vv.offsetTop + vv.height)
    // 双 rAF 后 offsetTop 应稳定 (WebKit bug #237851 是瞬时错误)
    var visibleBottom = Math.round(vv.offsetTop + vv.height);
    var kbH = Math.max(0, window.innerHeight - visibleBottom);

    if(kbH > 40){
      // 键盘弹起: .stage 高度 = 可视高 (visibleBottom - 顶部预留)
      // --vh 存的是可用高度, CSS 用 height:var(--vh) 直接吃
      document.documentElement.style.setProperty('--vh', visibleBottom + 'px');
      document.documentElement.setAttribute('data-kb-jsfallback','1');
      document.documentElement.classList.add('kb-up');
    } else {
      // 键盘收起
      document.documentElement.removeAttribute('data-kb-jsfallback');
      document.documentElement.style.removeProperty('--vh');
      document.documentElement.classList.remove('kb-up');
    }
    updateDebug();
  }
  function schedule(){
    if(!raf) raf = requestAnimationFrame(function(){
      // double-rAF: 让 WebKit vv.offsetTop 稳定后再读
      requestAnimationFrame(applyFallback);
      raf = 0;
    });
  }

  if(useVVFallback){
    vv.addEventListener('resize', schedule, {passive:true});
    vv.addEventListener('scroll', schedule, {passive:true});
    window.addEventListener('orientationchange', function(){ setTimeout(schedule, 300); });
    document.addEventListener('focusin', function(e){
      if(!e.target || e.target.id!=='cin') return;
      // 多次纠正 (iOS 键盘弹起 lag ~300ms, offsetTop 稳定需 double-rAF)
      schedule(); setTimeout(schedule, 150); setTimeout(schedule, 400); setTimeout(schedule, 900);
    }, {capture:true});
    document.addEventListener('focusout', function(e){
      if(!e.target || e.target.id!=='cin') return;
      schedule(); setTimeout(schedule, 300);
    }, {capture:true});
  }

  // Android VK 模式: 监听 geometrychange 让诊断浮层可见
  if(useVKMode){
    try{
      navigator.virtualKeyboard.addEventListener('geometrychange', function(){ updateDebug(); });
    }catch(_){}
  }

  // 覆盖式 IME 兜底: 键盘态点输入区外主动 blur (全平台生效)
  document.addEventListener('touchstart', function(e){
    var c = getCin(); if(!c || document.activeElement !== c) return;
    var t = e.target;
    if(t && (t.id==='cin' || (t.closest && t.closest('.composer')))) return;
    try{ c.blur(); }catch(_){}
  }, {passive:true, capture:true});

  // ★ __ehApplyVVH: goScene('hall') 时调用, 场景切换布局收尾钩子
  //   V9 修复: 除清 V7 遗留内联样式外, 必须清 弹窗补丁(下半段) 写在 .stage 的
  //   transform/transition/data-kb-offset, 否则从登录/弹窗进 hall 会残留上移
  //   (这正是主人反馈"从首页进来显示不全"的直接真凶之一)
  function ehApplyVVH(){
    try{
      var s = getStage() || document.querySelector('.stage');
      if(s){
        var st = s.style;
        // 清 V7 遗留 (position:fixed 定位 rect)
        if(st.position || st.height || st.width || st.top || st.left){
          st.position=''; st.left=''; st.top=''; st.width=''; st.height='';
        }
        // 清弹窗补丁遗留 (transform 上移 - P1 真凶!)
        if(st.transform || st.transition){
          st.transform=''; st.transition='';
        }
        if(s.hasAttribute('data-kb-offset')){
          s.removeAttribute('data-kb-offset');
        }
        // 强制 reflow
        void s.offsetHeight;
      }
      // 清 fallback 遗留
      document.documentElement.style.removeProperty('--vh');
      document.documentElement.classList.remove('kb-up');
      document.documentElement.removeAttribute('data-kb-jsfallback');
      // 若在 iOS 且当前 cin 已 focused, 重新算一次
      if(useVVFallback) schedule();
      // 完成后滚到底
      setTimeout(function(){ try{ window.scrollStream && window.scrollStream(); }catch(_){} }, 60);
    }catch(_){}
  }
  window.__ehKbReset  = ehApplyVVH;
  window.__ehApplyVVH = ehApplyVVH;

  // ---- 诊断浮层: ?kbdebug=1 显示实时状态 ----
  var dbg = null;
  var DBG_ON = /[?&]kbdebug=1/.test(location.search);
  var envProbe = null;
  function envKbInset(){
    if(!envProbe){
      envProbe = document.createElement('div');
      envProbe.style.cssText = 'position:fixed;bottom:0;left:-9999px;width:0;'
        + 'height:env(keyboard-inset-height, 0px);pointer-events:none';
      (document.body||document.documentElement).appendChild(envProbe);
    }
    return Math.round(parseFloat(getComputedStyle(envProbe).height) || 0);
  }
  function updateDebug(){
    if(!DBG_ON) return;
    if(!dbg){
      dbg = document.createElement('div');
      dbg.style.cssText = 'position:fixed;z-index:99999;left:4px;top:4px;font:11px/1.35 monospace;'
        + 'background:rgba(0,0,0,.82);color:#0f0;padding:5px 7px;border-radius:6px;'
        + 'pointer-events:none;white-space:pre;max-width:70vw';
      document.body.appendChild(dbg);
    }
    var envKb = envKbInset();
    var vvInfo = vv ? ('vv.h=' + Math.round(vv.height) + '  vv.top=' + Math.round(vv.offsetTop) + '  vv.w=' + Math.round(vv.width)) : 'vv=null';
    var vkInfo = 'VK-API=' + hasVKAPI;
    if(hasVKAPI){
      try{
        var r = navigator.virtualKeyboard.boundingRect;
        vkInfo += '  overlay=' + navigator.virtualKeyboard.overlaysContent + '  kbRect.h=' + (r?Math.round(r.height):'?');
      }catch(_){}
    }
    dbg.textContent =
      'V9 权威方案 (' + (useVKMode ? 'Android/VK' : (useVVFallback ? 'iOS/VV-fallback' : 'unknown')) + ')' +
      '\n' + vkInfo +
      '\nenvKb=' + envKb + '  (0=CSS无源)' +
      '\ninnerH=' + window.innerHeight +
      '\n' + vvInfo +
      '\nkbH=' + (vv ? Math.max(0, window.innerHeight - Math.round(vv.offsetTop + vv.height)) : '?') +
      '\ncin.focused=' + cinFocused() + '  hallOn=' + hallOn() +
      '\nkb-up=' + document.documentElement.classList.contains('kb-up') +
      '  fallbackAttr=' + (document.documentElement.getAttribute('data-kb-jsfallback')||'-') +
      '\n--vh=' + (document.documentElement.style.getPropertyValue('--vh')||'-');
  }
  if(DBG_ON){
    setTimeout(updateDebug, 300);
    if(vv){ vv.addEventListener('resize', updateDebug); }
    document.addEventListener('focusin', function(){ setTimeout(updateDebug, 100); }, {capture:true});
    document.addEventListener('focusout', function(){ setTimeout(updateDebug, 100); }, {capture:true});
  }
})();


// ============ 弹窗输入框通用键盘跟随 EH_KEYBOARD_UNIVERSAL_PATCH ============
// V9 修改: isKbOpen 兼容 VirtualKeyboard API (overlaysContent 下 vv 不变)
(function(){
  const KB_THRESH = 120;
  const SAFE_PAD  = 20;
  let activeInput = null;

  function isKbOpen(){
    // 优先用 VirtualKeyboard API 的 boundingRect (Android overlay 模式下 vv 不变)
    if(navigator.virtualKeyboard){
      try{
        var r = navigator.virtualKeyboard.boundingRect;
        if(r && r.height > 40) return true;
      }catch(_){}
    }
    // fallback: vv.height 缩了 >120px
    const vv = window.visualViewport;
    return vv ? (window.innerHeight - vv.height > KB_THRESH) : false;
  }
  function kbTopY(){
    // 键盘顶端 Y 坐标 (从 window 顶算)
    if(navigator.virtualKeyboard){
      try{
        var r = navigator.virtualKeyboard.boundingRect;
        if(r && r.height > 40) return r.y;  // 键盘 y 就是键盘顶
      }catch(_){}
    }
    const vv = window.visualViewport;
    if(vv) return vv.offsetTop + vv.height;
    return window.innerHeight;
  }
  function isTextInput(el){
    if(!el) return false;
    if(el.tagName === 'TEXTAREA') return true;
    if(el.tagName !== 'INPUT') return false;
    const t = (el.type||'text').toLowerCase();
    return ['text','password','email','search','tel','url','number'].includes(t);
  }
  function ensureVisible(el){
    if(!el || !document.body.contains(el)) return;
    const r = el.getBoundingClientRect();
    const kbTop = kbTopY();
    if(r.bottom <= kbTop - SAFE_PAD && r.top >= 8) return;
    const modalHost = el.closest('.modal');
    if(modalHost){
      const hostTop = modalHost.getBoundingClientRect().top;
      const availH = Math.max(200, kbTop - Math.max(0,hostTop) - 8);
      modalHost.style.maxHeight = availH + 'px';
    }
    let scrollable = null;
    let p = el.parentElement;
    while(p && p !== document.body){
      const oy = getComputedStyle(p).overflowY;
      if((oy==='auto'||oy==='scroll') && p.scrollHeight > p.clientHeight + 1){
        scrollable = p; break;
      }
      p = p.parentElement;
    }
    if(scrollable){
      let y = 0, node = el;
      while(node && node !== scrollable){ y += node.offsetTop; node = node.offsetParent; }
      const visibleH = Math.min(scrollable.clientHeight, kbTop - scrollable.getBoundingClientRect().top);
      const target = Math.max(0, y - Math.max(60, visibleH * 0.25));
      try{ scrollable.scrollTo({top:target, behavior:'smooth'}); }
      catch(_){ scrollable.scrollTop = target; }
    } else {
      const need = r.bottom - (kbTop - SAFE_PAD);
      if(need > 0){
        const stage = el.closest('.stage') || document.body;
        if(stage){
          const cur = parseFloat(stage.getAttribute('data-kb-offset')||'0');
          const total = cur + need + 8;
          stage.style.transition = 'transform 0.25s';
          stage.style.transform = `translateY(-${total}px)`;
          stage.setAttribute('data-kb-offset', String(total));
        }
      }
    }
  }
  function restoreModalHeight(){
    document.querySelectorAll('.modal[style*="max-height"]').forEach(m=>{ m.style.maxHeight=''; });
    document.querySelectorAll('[data-kb-offset]').forEach(s=>{
      s.style.transform = '';
      s.style.transition = '';
      s.removeAttribute('data-kb-offset');
    });
  }
  document.addEventListener('focusin', (e)=>{
    const el = e.target;
    if(!isTextInput(el)) return;
    if(el.id === 'cin') return;
    activeInput = el;
    const tick = ()=>{ if(activeInput===el && isKbOpen()) ensureVisible(el); };
    setTimeout(tick, 80);
    setTimeout(tick, 250);
    setTimeout(tick, 500);
    setTimeout(tick, 900);
  }, {passive:true});
  document.addEventListener('focusout', (e)=>{
    if(e.target === activeInput){
      activeInput = null;
      setTimeout(restoreModalHeight, 300);
    }
  }, {passive:true});
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', ()=>{
      if(activeInput && isKbOpen()) ensureVisible(activeInput);
    });
  }
  if(navigator.virtualKeyboard){
    try{
      navigator.virtualKeyboard.addEventListener('geometrychange', ()=>{
        if(activeInput && isKbOpen()) ensureVisible(activeInput);
      });
    }catch(_){}
  }
})();
