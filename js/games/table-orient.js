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
  root.EHTableOrient = { toggle:toggle, clear:clear, isRot:isRot };
})(typeof window !== 'undefined' ? window : this);
