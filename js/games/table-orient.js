// ============================================================
// table-orient.js — 牌桌横竖屏切换(仍在聊天室内, 非全屏/非物理旋转)
// ------------------------------------------------------------
//   主人反馈: 手机竖持时牌桌偏挤, 想一键切成横屏视图但别离开聊天室。
//   做法: 对牌桌浮层(.ddz-room/.gd-room/.pk-room)施加 CSS transform:rotate(90deg),
//   把它按【挂载容器 #hall 的盒子】旋成横向 —— 宽=容器高、高=容器宽, 平移回原位,
//   旋转后仍恰好铺满并被 #hall(overflow:hidden)裁在聊天室内。浏览器会把触摸/点击
//   坐标经 transform 正确反算, 出牌/点按仍命中(现代内核标准行为)。
//   尺寸走【容器 rect 的像素值】而非 vw/vh: 桌面 #hall 是居中盒子(非全屏)也不溢出。
//   窗口/设备旋转时重算; 折叠(返回聊天)或散桌时由调用方 clear() 复位, 避免与折叠动画的
//   transform 打架(折叠自带 scale 位移, 内联 transform 会盖掉它)。
// ============================================================
(function(root){
  'use strict';
  function mountBox(room){
    var mount = room.parentElement || (root.document && root.document.getElementById('hall')) || (root.document && root.document.body);
    if (mount && mount.getBoundingClientRect){
      var r = mount.getBoundingClientRect();
      var w = Math.round(r.width), h = Math.round(r.height);
      if (w > 0 && h > 0) return { w:w, h:h };
    }
    return { w: root.innerWidth||0, h: root.innerHeight||0 };
  }
  function apply(room){
    var b = mountBox(room);
    // 旋成横向: 视觉宽=容器高, 视觉高=容器宽; 先旋后平移回正
    room.style.width = b.h + 'px';
    room.style.height = b.w + 'px';
    room.style.transformOrigin = '0 0';
    room.style.transform = 'translateX(' + b.w + 'px) rotate(90deg)';
  }
  function isRot(room){ return !!(room && room.classList && room.classList.contains('eh-rot')); }
  // 横屏态识别: 牌桌盒子"宽 > 高且矮"时挂 .is-land, 让各桌套用横屏专属布局。
  //   —— 三桌响应式断点都要求 min-height≥620, 横屏(高 375)全落到竖屏基础布局→挤成一团。
  //   物理横屏(视口即 812×375, 媒体查询能命中) 与 ⟳ 旋转态(transform 旋转, 视口仍竖 375×812
  //   媒体查询看不到) 都只认"盒子实测宽高比": 用同一个 JS 信号统一覆盖两种横屏。
  //   矮度门槛(h<560)排除平板横屏/桌面宽盒(它们有足够高度走既有大屏断点, 不该套手机横屏布局)。
  //   .gd-room 等是 position:absolute;inset:0, 外框尺寸只由 #hall 决定, 与内部布局无关→不会回流打架。
  function reflect(room){
    if (!room || !room.classList) return false;
    var w = room.clientWidth || 0, h = room.clientHeight || 0;
    var land = w > 0 && h > 0 && (w / h) >= 1.35 && h < 560;
    room.classList.toggle('is-land', land);
    return land;
  }
  function clear(room){
    if (!room) return;
    if (room.classList) room.classList.remove('eh-rot');
    room.style.width = ''; room.style.height = '';
    room.style.transform = ''; room.style.transformOrigin = '';
    if (room._ehOrientResize){ try{ root.removeEventListener('resize', room._ehOrientResize); }catch(_){}
      try{ root.removeEventListener('orientationchange', room._ehOrientResize); }catch(_){}
      room._ehOrientResize = null; }
  }
  // 切换; 返回切换后是否为横屏态。
  function toggle(room){
    if (!room) return false;
    if (isRot(room)){ clear(room); return false; }
    room.classList.add('eh-rot');
    apply(room);
    room._ehOrientResize = function(){ if (isRot(room)) apply(room); };
    try{ root.addEventListener('resize', room._ehOrientResize); }catch(_){}
    try{ root.addEventListener('orientationchange', room._ehOrientResize); }catch(_){}
    return true;
  }
  root.EHTableOrient = { toggle:toggle, clear:clear, isRot:isRot, reflect:reflect };
})(typeof window !== 'undefined' ? window : this);
