// ============ 聊天页键盘协同 · 永远跟随 visualViewport (2026-07-29 v7 极简重构) ============
// 【重构动机】v1-v6 都在做"识别键盘弹起/收起"的判定, 累积了 gap/shrink/vkUp/envUp 四信号 + baseVV
//   基线 + kbMin 阈值 + 分场景 usableH 计算, 一共 160 行。真机每换一台设备都发现新的信号死角
//   (vv 不缩 / VK API 不实现 / env 不暴露 / vv 含键盘边缘余量), 反复回归。
//
// 【v7 洞察】不要判"键盘开没开", 因为浏览器早就在 visualViewport 里告诉你可视区在哪。
//   核心策略: .hall-on 状态下永远把 .stage 用 position:fixed 钉到 vv 当前矩形上。
//     · 无键盘: vv 满屏 → 贴满屏
//     · 键盘弹起(vv 缩): vv 变小 → .stage 跟着变小 → composer 贴 .stage 底 = 键盘顶
//     · 键盘收起(vv 恢复): vv 恢复 → .stage 跟着恢复
//     · 覆盖式 IME(vv 不缩, 讯飞/搜狗悬浮): 由"点输入区外 blur"兜底 (与 v1-v6 相同)
//   底部 composer 底距走 CSS env(keyboard-inset-height) + safe-area-inset-bottom, JS 不算冗余。
//
// 【为什么这次能一次到位】主人真机数据(V6 稳态截图)已证明 vv.height 就是可用区; 之前坏是因为
//   有"识别→pin"的门槛, 门槛任何一档失败都会漏 pin。v7 无门槛, 无条件 pin, 不存在漏 pin。
//   vv.height 含键盘边缘余量的问题(V6 症状)由 CSS composer padding-bottom 兜住, 而不是 JS 扣冗余。
//
// 诊断: ?kbdebug=1 显示实时 vv 浮层(innerH/vv.h/vv.top/vv.left/kbInset/pinned/cin)。
(function(){
  var vv = window.visualViewport;
  if(!vv){ return; }   // 无 visualViewport(极旧内核): 交给 CSS 100dvh, JS 不介入
  var raf = 0, pinned = false, stage = null;

  // 尽早启用 VirtualKeyboard overlay 模式, 让浏览器把键盘几何通过 CSS env 暴露给页面
  try{ if(navigator.virtualKeyboard) navigator.virtualKeyboard.overlaysContent = true; }catch(_){}

  function getStage(){ if(!stage) stage = document.querySelector('.stage'); return stage; }
  function hallOn(){ return document.body.classList.contains('hall-on'); }
  function cinFocused(){ return document.activeElement && document.activeElement.id==='cin'; }

  function apply(){
    raf = 0;
    var s = getStage(); if(!s) return;
    // 只在 hall 场景且 #cin 聚焦时接管布局。非聊天场景 / 非输入态由 CSS 100dvh 自然铺满,
    // JS 不动 → 避免 pin 副作用污染其它场景。
    var shouldPin = hallOn() && cinFocused();
    if(shouldPin) pin(s); else unpin(s);
    updateDebug();
  }
  // ★核心: 无条件把 .stage 钉在 visualViewport 当前矩形。vv 报什么就贴什么。
  //   #hall 走 CSS height:100% 填满 .stage, flex column → composer 天然贴可视区底=键盘顶。
  function pin(s){
    var h = Math.round(vv.height);
    document.documentElement.style.setProperty('--vh', h + 'px');
    var st = s.style;
    st.position = 'fixed';
    st.left   = Math.round(vv.offsetLeft) + 'px';
    st.top    = Math.round(vv.offsetTop)  + 'px';
    st.width  = Math.round(vv.width) + 'px';
    st.height = h + 'px';
    if(!pinned){ document.documentElement.classList.add('kb-up'); pinned = true; }
    try{ scrollStream(); }catch(_){}
  }
  function unpin(s){
    if(!pinned && !s.style.position) return;
    document.documentElement.style.removeProperty('--vh');
    var st = s.style;
    st.position = ''; st.left = ''; st.top = ''; st.width = ''; st.height = '';
    if(pinned){ document.documentElement.classList.remove('kb-up'); pinned = false; }
  }
  function schedule(){ if(!raf) raf = requestAnimationFrame(apply); }

  vv.addEventListener('resize', schedule, {passive:true});
  vv.addEventListener('scroll', schedule, {passive:true});
  window.addEventListener('orientationchange', function(){ setTimeout(schedule, 300); });

  // focusin/focusout 只是触发一次重算 - 不做特殊判定, apply() 里根据 cinFocused() 自己决定 pin/unpin
  document.addEventListener('focusin', function(e){
    if(!e.target || e.target.id!=='cin' || !hallOn()) return;
    try{ if(window.ehArm) ehArm(); }catch(_){}
    // 键盘弹起动画期间 vv 会多次变化, 让 apply 跟着 resize 事件自然刷新即可; 补两次覆盖 iOS 初次 lag
    schedule(); setTimeout(schedule, 120); setTimeout(schedule, 400);
  }, {capture:true});
  document.addEventListener('focusout', function(e){
    if(!e.target || e.target.id!=='cin') return;
    schedule(); setTimeout(schedule, 300);
  }, {capture:true});
  // 覆盖式 IME(讯飞/搜狗悬浮, 不缩 vv) 收起无 web 信号 → 键盘态点输入区外主动 blur 复位。
  document.addEventListener('touchstart', function(e){
    if(!pinned) return;
    var t=e.target; if(t && (t.id==='cin' || (t.closest && t.closest('.composer')))) return;
    try{ var c=document.getElementById('cin'); if(c) c.blur(); }catch(_){}
  }, {passive:true, capture:true});
  window.__ehKbReset  = function(){ schedule(); };
  window.__ehApplyVVH = schedule;  // 兼容旧调用名 (goScene 进 hall 时调)

  // ---- 诊断浮层: 仅 ?kbdebug=1 显示。极简 - 只显示 vv 原始值 + pinned 状态 ----
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
      dbg.style.cssText = 'position:fixed;z-index:99999;left:4px;font:11px/1.35 monospace;'
        + 'background:rgba(0,0,0,.82);color:#0f0;padding:5px 7px;border-radius:6px;'
        + 'pointer-events:none;white-space:pre;max-width:60vw';
      document.body.appendChild(dbg);
    }
    dbg.style.top = (Math.round(vv.offsetTop) + 4) + 'px';
    var vh = getComputedStyle(document.documentElement).getPropertyValue('--vh').trim() || '(空)';
    dbg.textContent =
      'innerH=' + window.innerHeight +
      '\nvv.h=' + Math.round(vv.height) +
      '  vv.top=' + Math.round(vv.offsetTop) +
      '  vv.left=' + Math.round(vv.offsetLeft) +
      '\nvv.w=' + Math.round(vv.width) +
      '\nkbInset(env)=' + envKbInset() +
      '\npinned=' + pinned + '  cin=' + cinFocused() +
      '\n--vh=' + vh;
  }

  schedule(); setTimeout(schedule, 200); setTimeout(schedule, 600);
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
