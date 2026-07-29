// ============ 聊天页键盘协同 · V8 CSS 主导 (2026-07-30) ============
// 【为什么推翻 V7】主人 7/30 明确要求"看看网上怎么解决的, 不要自己再猜了"。行业 2024-2025 权威方案:
//   1) viewport meta 加 interactive-widget=resizes-content (Chrome 108+/Safari 17.4+)
//      → 浏览器自动把 layout viewport 缩到键盘上方, .stage 100dvh 自动跟随, 不需要 JS pin
//   2) VirtualKeyboard.overlaysContent = true → 浏览器通过 CSS env(keyboard-inset-height)
//      暴露键盘覆盖高度, composer padding-bottom 直接吃这个 env, 完全 CSS 驱动
//   3) iOS PWA WebKit bug #237851: standalone 下 visualViewport.offsetTop 错误报 0
//      → V7 用 vv.offsetTop 定位 .stage 在 iOS PWA 必然失效, 这正是主人反馈"PWA 不跟随"的根因
//   4) 正确的键盘高公式是 innerHeight - vv.height - vv.offsetTop (V7 没减 offsetTop)
//   5) input 字号 ≥16px 防 iOS 聚焦缩放 (EH .cin 已 16px, 满足)
//
// 【V8 分工】
//   - CSS 主导: .stage:100dvh + composer padding-bottom:max(safe-area, env(keyboard-inset)+8)
//     这两条完全 CSS 处理常规场景, 支持 Chrome 108+/Safari 17.4+/所有安卓现代浏览器
//   - JS 只做两件事:
//     a) 尽早启用 VirtualKeyboard.overlaysContent=true, 让浏览器暴露 env(keyboard-inset-height)
//     b) 对无 env 支持的旧 iOS (Safari <17.4) 用 visualViewport 兜底: 把 composer transform 上推
//        `innerHeight - vv.height` 高度; 此路径不用 vv.offsetTop, 避开 PWA bug
//   - 完全废弃 V7 的 .stage position:fixed pin 逻辑, 因为它依赖 vv.offsetTop 在 iOS PWA 无效
//
// 覆盖式 IME(讯飞/搜狗悬浮, 不缩 vv) 收起由"点输入区外 blur"兜底 (与 V1-V7 一致)。
// 诊断: ?kbdebug=1 显示实时数据。
(function(){
  var vv = window.visualViewport;

  // 尽早开启 overlaysContent, 让 env(keyboard-inset-height) 生效 (Chrome 108+, Safari 17.4+)
  try{ if(navigator.virtualKeyboard) navigator.virtualKeyboard.overlaysContent = true; }catch(_){}

  // 特性探测: 浏览器是否支持 env(keyboard-inset-height) - 决定要不要走 JS fallback
  var supportsKbInset = (function(){
    try{
      return CSS.supports('padding-bottom: env(keyboard-inset-height, 0px)');
    }catch(_){ return false; }
  })();

  var composer = null, cin = null, hasFallback = false;
  function getComposer(){ if(!composer) composer = document.querySelector('.composer'); return composer; }
  function getCin(){ if(!cin) cin = document.getElementById('cin'); return cin; }
  function hallOn(){ return document.body.classList.contains('hall-on'); }
  function cinFocused(){ return document.activeElement && document.activeElement.id==='cin'; }

  // JS fallback: 只在无 env 支持时启用
  // 用 innerHeight - vv.height 算键盘高 (不用 vv.offsetTop 避开 iOS PWA WebKit bug #237851)
  var raf = 0;
  function applyFallback(){
    raf = 0;
    var c = getComposer(); if(!c || !vv) return;
    if(!hallOn() || !cinFocused()){
      c.style.transform = '';
      document.documentElement.classList.remove('kb-up');
      hasFallback = false;
      updateDebug(0, false);
      return;
    }
    var kbH = Math.max(0, Math.round(window.innerHeight - vv.height));
    if(kbH > 40){
      c.style.transform = 'translateY(-' + kbH + 'px)';
      c.style.transition = 'transform 180ms ease-out';
      document.documentElement.classList.add('kb-up');
      document.documentElement.setAttribute('data-kb-jsfallback','1');
      hasFallback = true;
    } else {
      c.style.transform = '';
      document.documentElement.classList.remove('kb-up');
      hasFallback = false;
    }
    updateDebug(kbH, true);
  }
  function schedule(){ if(!raf) raf = requestAnimationFrame(applyFallback); }

  if(!supportsKbInset && vv){
    // 只对无 env 支持的浏览器(旧 iOS Safari <17.4) 启动 JS fallback
    vv.addEventListener('resize', schedule, {passive:true});
    vv.addEventListener('scroll', schedule, {passive:true});
    window.addEventListener('orientationchange', function(){ setTimeout(schedule, 300); });
    document.addEventListener('focusin', function(e){
      if(!e.target || e.target.id!=='cin') return;
      try{ if(window.ehArm) ehArm(); }catch(_){}
      schedule(); setTimeout(schedule, 150); setTimeout(schedule, 400);
    }, {capture:true});
    document.addEventListener('focusout', function(e){
      if(!e.target || e.target.id!=='cin') return;
      schedule(); setTimeout(schedule, 300);
    }, {capture:true});
  }

  // 覆盖式 IME 兜底: 键盘态点输入区外主动 blur (全平台生效, 与 CSS/fallback 无关)
  document.addEventListener('touchstart', function(e){
    var c = getCin(); if(!c || document.activeElement !== c) return;
    var t = e.target;
    if(t && (t.id==='cin' || (t.closest && t.closest('.composer')))) return;
    try{ c.blur(); }catch(_){}
  }, {passive:true, capture:true});

  // 兼容旧调用名(goScene 进 hall 时调)
  window.__ehKbReset  = function(){ if(!supportsKbInset) schedule(); };
  window.__ehApplyVVH = window.__ehKbReset;

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
  function updateDebug(fallbackKbH, isFallbackRun){
    if(!DBG_ON) return;
    if(!dbg){
      dbg = document.createElement('div');
      dbg.style.cssText = 'position:fixed;z-index:99999;left:4px;top:4px;font:11px/1.35 monospace;'
        + 'background:rgba(0,0,0,.82);color:#0f0;padding:5px 7px;border-radius:6px;'
        + 'pointer-events:none;white-space:pre;max-width:60vw';
      document.body.appendChild(dbg);
    }
    var envKb = envKbInset();
    var vvInfo = vv ? ('vv.h=' + Math.round(vv.height) + '  vv.top=' + Math.round(vv.offsetTop)) : 'vv=null';
    dbg.textContent =
      'V8 CSS-主导' +
      '\nsupportsEnv=' + supportsKbInset +
      '\nenvKb=' + envKb + '  (0=CSS无源信号)' +
      '\ninnerH=' + window.innerHeight +
      '\n' + vvInfo +
      '\nkb-up class=' + document.documentElement.classList.contains('kb-up') +
      '\ncin.focused=' + cinFocused() + '  hallOn=' + hallOn() +
      (isFallbackRun ? ('\nJS fallback kbH=' + fallbackKbH) : '\nJS fallback: 未启用(有 env 支持)');
  }
  if(DBG_ON){
    setTimeout(function(){ updateDebug(0,false); }, 300);
    if(vv){ vv.addEventListener('resize', function(){ updateDebug(0,false); }); }
    document.addEventListener('focusin', function(){ setTimeout(function(){ updateDebug(0,false); }, 100); }, {capture:true});
    document.addEventListener('focusout', function(){ setTimeout(function(){ updateDebug(0,false); }, 100); }, {capture:true});
  }
})();


// ============ 弹窗输入框通用键盘跟随 EH_KEYBOARD_UNIVERSAL_PATCH ============
// 覆盖: 登录/注册/邀请码/建房/找回密码/改邮箱/个人资料 等所有弹窗输入框
// 已在 #cin 单独处理的场景不受影响(#cin 走 hall 保护,不进 modal 分支)
(function(){
  const KB_THRESH = 120;  // 可视区比 window 矮 >120px 判为键盘开
  const SAFE_PAD  = 20;   // 输入框底部距键盘顶至少 20px
  let activeInput = null;

  function isKbOpen(){
    const vv = window.visualViewport;
    return vv ? (window.innerHeight - vv.height > KB_THRESH) : false;
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
    const vv = window.visualViewport;
    const r = el.getBoundingClientRect();
    const kbTop = vv ? (vv.offsetTop + vv.height) : window.innerHeight;
    // 已完全在可视区(留 SAFE_PAD 余量)则不动
    if(r.bottom <= kbTop - SAFE_PAD && r.top >= 8) return;
    // 先重要: 弹窗本身需要先被压缩到可视区高, 不然算 modal.scrollTo 也没滚动空间
    // EH 的 .modal max-height:90dvh, dvh 不响应键盘, 需手工改成 kbTop 上方的可用高
    const modalHost = el.closest('.modal');
    if(modalHost){
      const hostTop = modalHost.getBoundingClientRect().top;
      const availH = Math.max(200, kbTop - Math.max(0,hostTop) - 8);
      modalHost.style.maxHeight = availH + 'px';
    }
    // 找真实的可滚动祖先(EH 的弹窗真实容器是 #modal.glass, 不是 .modal)
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
      // 有自己的滚动容器(弹窗场景): 在容器内滚,不动 body
      let y = 0, node = el;
      while(node && node !== scrollable){ y += node.offsetTop; node = node.offsetParent; }
      const visibleH = Math.min(scrollable.clientHeight, kbTop - scrollable.getBoundingClientRect().top);
      const target = Math.max(0, y - Math.max(60, visibleH * 0.25));
      try{ scrollable.scrollTo({top:target, behavior:'smooth'}); }
      catch(_){ scrollable.scrollTop = target; }
    } else {
      // 无独立滚动容器(如 loginCollapse 在 enter 场景内): 没有滚动容器, 直接把输入框手动 translate 上推
      // 默认的 scrollIntoView 在 enter 场景里无效(所有层都 overflow:visible/hidden)
      const need = r.bottom - (kbTop - SAFE_PAD);
      if(need > 0){
        const stage = el.closest('.stage') || document.body;
        if(stage){
          // 上推 stage 一个距离, 把输入框露出可视区
          const cur = parseFloat(stage.getAttribute('data-kb-offset')||'0');
          const total = cur + need + 8;
          stage.style.transition = 'transform 0.25s';
          stage.style.transform = `translateY(-${total}px)`;
          stage.setAttribute('data-kb-offset', String(total));
        }
      }
    }
  }

  // 失焦时恢复 modal 的 max-height + stage transform
  function restoreModalHeight(){
    document.querySelectorAll('.modal[style*="max-height"]').forEach(m=>{
      m.style.maxHeight = '';
    });
    document.querySelectorAll('[data-kb-offset]').forEach(s=>{
      s.style.transform = '';
      s.removeAttribute('data-kb-offset');
    });
  }

  // focus 时记录目标输入框,并在键盘弹起过程多次纠正(iOS 键盘弹起有 lag)
  document.addEventListener('focusin', (e)=>{
    const el = e.target;
    if(!isTextInput(el)) return;
    // #cin 已由 hall 保护接管,这里不重复
    if(el.id === 'cin') return;
    activeInput = el;
    const tick = ()=>{ if(activeInput===el && isKbOpen()) ensureVisible(el); };
    // iOS 键盘弹起 ~300ms 内可视区才真正变化,多次纠正抹平 lag
    setTimeout(tick, 80);
    setTimeout(tick, 250);
    setTimeout(tick, 500);
    setTimeout(tick, 900);
  }, {passive:true});

  document.addEventListener('focusout', (e)=>{
    if(e.target === activeInput){
      activeInput = null;
      // 输入完成后延时恢复 modal 高度(给键盘收回时间)
      setTimeout(restoreModalHeight, 300);
    }
  }, {passive:true});

  // visualViewport resize(键盘弹/收) 时,还有 active 输入框就再纠一次
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', ()=>{
      if(activeInput && isKbOpen()) ensureVisible(activeInput);
    });
  }
})();
