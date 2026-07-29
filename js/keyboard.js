// ============ 聊天页键盘协同 · 钉在 visualViewport (2026-07-29 v2 全平台统一) ============
// 行业调研结论(2026, MDN/caniuse/Chrome DevRel): iOS 至 26.5 仍无 VirtualKeyboard API、
// interactive-widget 只安卓生效且不稳定, 全平台唯一可靠信号只有 window.visualViewport。
//
// 【v1 为何在安卓坏】v1(2026-07-29) 赌 interactive-widget=resizes-content 会让安卓 innerHeight
//   和 vv.height 同缩(gap≈0) → 完全不介入, 交给 CSS 100dvh 自愈。真机症状(主人报安卓浏览器+PWA
//   都坏): #cin 被键盘挡住看不见自己打的字。两条真相打脸:
//   ① interactive-widget=resizes-content 在安卓 PWA standalone 与国产厂商定制 WebView(华为/小米/vivo)
//      经常不生效, innerHeight 不缩 → gap 可以有几十到一两百 px, 但被 v1 硬阈值 120 挡在门外。
//   ② 部分安卓浏览器 100dvh 键盘弹起时不重算(与规范预期相悖) → 即使 gap≈0, .stage 高度也没跟着缩,
//      composer 依然被键盘遮住。
//
// 【v2 做法】不再区分 iOS/安卓、不再赌 dvh, 统一策略: 只要 gap 超过屏高 15%(自适应, 覆盖
//   安卓的低 gap 场景), 就把 .stage 用 position:fixed 钉在 visualViewport 矩形上:
//   top=vv.offsetTop / left=vv.offsetLeft / width=vv.width / height=vv.height。vv 报什么贴什么,
//   iOS 二次上滚触发 vv.scroll → 重新钉正; 安卓键盘尺寸变化触发 vv.resize → 尺寸跟着变。
//   一次解决位置+尺寸+跨平台。#hall 走 CSS height:100% 填满 .stage, flex column: .stream(flex:1)
//   内滚, .composer 天然贴可视区底=键盘顶。
// 覆盖式第三方IME(讯飞/搜狗悬浮, 不缩 vv)仍进不了 pin(gap 不够), 收起由"点输入区外 blur"兜底。
// 诊断: 加 ?kbdebug=1 显示实时 vv 浮层(innerH/vv.h/vv.top/gap/kbMin/kbUp/--vh)。
(function(){
  var vv = window.visualViewport;
  if(!vv){ return; }   // 无 visualViewport(极旧内核): 交给 CSS 100dvh, JS 不介入
  var raf = 0, pinned = false;
  // 键盘开判定: 阈值 = max(80px, 屏高*0.15)。
  //   iOS/多数场景 gap 是屏高的 30-50%, 稳过。
  //   安卓 gap 常在 100-200px(WebView 定制/PWA/竖屏 720+ 高度): 屏高 800*0.15=120, 阈值 120, 覆盖。
  //   非键盘场景(浏览器地址栏收缩、旋转过渡)gap 常 <60px, 高于 80 保底避免误判。
  //   覆盖式悬浮键盘(讯飞/搜狗)不缩 vv, gap≈0, 天然不进 pin(与 v1 一致, 由 blur 兜底)。
  function kbMin(){ return Math.max(80, Math.round(window.innerHeight * 0.15)); }
  function cinFocused(){ return document.activeElement && document.activeElement.id==='cin'; }
  function hallOn(){ return document.body.classList.contains('hall-on'); }
  var stage = null;
  function getStage(){ if(!stage) stage = document.querySelector('.stage'); return stage; }
  function apply(){
    raf = 0;
    var s = getStage(); if(!s) return;
    var gap = Math.round(window.innerHeight - vv.height);
    var thr = kbMin();
    var kbUp = hallOn() && cinFocused() && gap > thr;
    if(kbUp) pin(s); else unpin(s);
    updateDebug(gap, thr, kbUp);
  }
  // ★核心: 键盘态直接把 .stage 钉在 visualViewport 上(top=offsetTop / 高=vv.height),
  //   vv 给什么贴什么 → 同时消除"iOS 布局视口上滚过头"(位置)和"高度估算污染"(尺寸)两类旧病。
  //   #hall 走既有 CSS height:var(--vh)=vv.height, flex column 使 .composer 天然贴可视区底=键盘顶。
  function pin(s){
    var h = Math.round(vv.height);
    document.documentElement.style.setProperty('--vh', h + 'px');
    var st = s.style;
    st.position = 'fixed';
    st.left   = Math.round(vv.offsetLeft) + 'px';
    st.top    = Math.round(vv.offsetTop)  + 'px';
    st.width  = Math.round(vv.width) + 'px';
    st.height = h + 'px';   // 显式兜住高, 不依赖 CSS var(--vh) 生效时序(fixed 不设 height 会塌成内容高)
    if(!pinned){ document.documentElement.classList.add('kb-up'); pinned = true; }
    try{ scrollStream(); }catch(_){}
  }
  function unpin(s){
    if(!pinned && !s.style.position) return;
    document.documentElement.style.removeProperty('--vh');   // 回落 CSS 100dvh
    var st = s.style;
    st.position = ''; st.left = ''; st.top = ''; st.width = ''; st.height = '';
    if(pinned){ document.documentElement.classList.remove('kb-up'); pinned = false; }
  }
  function schedule(){ if(!raf) raf = requestAnimationFrame(apply); }
  vv.addEventListener('resize', schedule, {passive:true});
  vv.addEventListener('scroll', schedule, {passive:true});   // iOS 键盘动画后二次上滚 → vv.scroll 触发, 重新钉正
  window.addEventListener('orientationchange', function(){ setTimeout(schedule,300); });
  document.addEventListener('focusin', function(e){
    var t=e.target; if(!t || t.id!=='cin') return;
    if(!hallOn()) return;
    try{ if(window.ehArm) ehArm(); }catch(_){}
    schedule(); setTimeout(schedule,150); setTimeout(schedule,350); setTimeout(schedule,650);
  }, {capture:true});
  document.addEventListener('focusout', function(e){
    var t=e.target; if(!t || t.id!=='cin') return;
    schedule(); setTimeout(schedule,60); setTimeout(schedule,300);
  }, {capture:true});
  // 覆盖式IME(讯飞/搜狗悬浮, 不缩 vv)收起无 web 信号 → 键盘态点输入区外主动 blur 复位。
  document.addEventListener('touchstart', function(e){
    if(!pinned) return;
    var t=e.target; if(t && (t.id==='cin' || (t.closest && t.closest('.composer')))) return;
    try{ var c=document.getElementById('cin'); if(c) c.blur(); }catch(_){}
  }, {passive:true, capture:true});
  window.__ehKbReset  = function(){ schedule(); };
  window.__ehApplyVVH = schedule;   // 兼容旧调用名(goScene 进 hall 时调)

  // ---- 诊断浮层: 仅 ?kbdebug=1 显示, 不影响其他人。真机念数即可坐实 vv 行为 ----
  var dbg = null;
  var DBG_ON = /[?&]kbdebug=1/.test(location.search);
  function updateDebug(gap, thr, kbUp){
    if(!DBG_ON) return;
    if(!dbg){
      dbg = document.createElement('div');
      dbg.style.cssText = 'position:fixed;z-index:99999;left:4px;font:11px/1.35 monospace;'
        + 'background:rgba(0,0,0,.82);color:#0f0;padding:5px 7px;border-radius:6px;'
        + 'pointer-events:none;white-space:pre;max-width:60vw';
      document.body.appendChild(dbg);
    }
    dbg.style.top = (Math.round(vv.offsetTop) + 4) + 'px';   // 跟随可视视口顶, 键盘态也看得见
    var vh = getComputedStyle(document.documentElement).getPropertyValue('--vh').trim() || '(空)';
    dbg.textContent =
      'innerH=' + window.innerHeight +
      '\nvv.h=' + Math.round(vv.height) +
      '  vv.top=' + Math.round(vv.offsetTop) +
      '  vv.left=' + Math.round(vv.offsetLeft) +
      '\ngap=' + gap + '  kbMin=' + thr +
      '\nkbUp=' + kbUp + '  pinned=' + pinned +
      '\n--vh=' + vh + '  cin=' + cinFocused();
  }

  schedule(); setTimeout(schedule,200); setTimeout(schedule,600);
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
