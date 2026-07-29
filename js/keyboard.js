// ============ 聊天页键盘协同 · 钉在 visualViewport (2026-07-29 重写) ============
// 行业调研结论(2026, MDN/caniuse/Chrome DevRel): iOS 至 26.5 仍无 VirtualKeyboard API、
// interactive-widget 只安卓生效, 全平台唯一可靠信号只有 window.visualViewport。
//
// 【上一版为何还坏】上一版(2026-07-28)只写 --vh 高度 + 多分支估算(baseVV/KB_PX=300)。
//   真机症状(主人真机图, Safari+PWA 都坏): 弹键盘时 composer 被甩到屏幕最顶、header+消息流全消失、
//   中间大片空白、键盘在底。两个病因叠加:
//   ① 位置: iOS 弹键盘会把布局视口整体上滚(vv.offsetTop>0), 且在键盘动画结束后"再滚一次",
//      上一版靠 focusin 里 scrollTo(0,0) 抵消 → 管不住二次滚动 → 页面被顶飞。
//   ② 尺寸: baseVV 基线在 focusin 竞态里可能被写成键盘态小值 → #hall 缩成 240px 钉在顶。
//
// 【本版做法】不估算、不 scrollTo, 键盘态直接把 .stage 用 position:fixed 钉在 visualViewport 上:
//   top=vv.offsetTop / left=vv.offsetLeft / width=vv.width, 高度 --vh=vv.height。vv 报什么就贴什么,
//   iOS 二次上滚会触发 vv.scroll → 重新钉正 → 位置永远跟着可视视口, 尺寸永远=可视高。一次解决位置+尺寸。
//   #hall 走既有 CSS height:var(--vh), flex column: .stream(flex:1)内滚, .composer 天然贴可视区底=键盘顶。
// 键盘开判定: gap = innerHeight − vv.height > 120(iOS/PWA innerHeight 不随键盘缩, 差值可靠;
//   安卓 interactive-widget=resizes-content 两者同缩 gap≈0 → 不 pin, 交给 CSS dvh, 其已是内容区高)。
// 覆盖式第三方IME(讯飞/搜狗悬浮, 不缩 vv)不进 pin(gap≈0), 收起由"点输入区外 blur"兜底。
// 诊断: 加 ?kbdebug=1 显示实时 vv 浮层(innerH/vv.h/vv.top/gap/kbUp/--vh)。JS 未跑/无 vv 时 CSS 回落 100dvh。
(function(){
  var vv = window.visualViewport;
  if(!vv){ return; }   // 无 visualViewport(极旧内核): 交给 CSS 100dvh, JS 不介入
  var raf = 0, pinned = false;
  // 键盘开判定: iOS(含PWA)布局视口 window.innerHeight 不随键盘收缩, 只有 vv.height 缩 → 差值可靠。
  // 安卓 interactive-widget=resizes-content 两者同缩(差≈0)→ 不 pin, 交给 CSS dvh(其已缩到内容区)。
  var KB_MIN = 120;
  function cinFocused(){ return document.activeElement && document.activeElement.id==='cin'; }
  function hallOn(){ return document.body.classList.contains('hall-on'); }
  var stage = null;
  function getStage(){ if(!stage) stage = document.querySelector('.stage'); return stage; }
  function apply(){
    raf = 0;
    var s = getStage(); if(!s) return;
    var gap = Math.round(window.innerHeight - vv.height);
    var kbUp = hallOn() && cinFocused() && gap > KB_MIN;
    if(kbUp) pin(s); else unpin(s);
    updateDebug(gap, kbUp);
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
  function updateDebug(gap, kbUp){
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
      '\ngap=' + gap + '  kbUp=' + kbUp + '  pinned=' + pinned +
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
