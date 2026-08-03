/* ============ EH_PULL_REFRESH_GLOBAL 全局下拉刷新 (PWA 全屏无地址栏时刷新) ============
   任何场景(入口/大厅/聊天)在页面顶部下拉超阈值即触发刷新, 松手 reload.
   判定「顶部」: 当前活动场景的滚动容器 scrollTop<=0 (或场景本身不可滚)。
   与 longpress(绑 .msg)/曲风条拖拽(绑 strip)/聊天流滚动 无冲突: 只在真顶部下拉才拦。 */
(function(){
  var ind = document.getElementById('pullRefresh');
  if(!ind) return;
  var THRESH = 66;
  var MAX = 96;
  var startY = 0, startX = 0, pulling = false, dist = 0, armed = false;
  var txt = ind.querySelector('.pr-txt');

  // 找当前活动场景里可能的滚动容器, 判断是否已在顶部
  function atTop(target){
    // 从触摸目标往上找有滚动的祖先, 若其 scrollTop>0 说明不在顶, 不触发下拉刷新
    var el = target;
    while(el && el !== document.body && el.nodeType === 1){
      var oy = getComputedStyle(el).overflowY;
      if((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight){
        return el.scrollTop <= 0;   // 该滚动容器在顶部才允许
      }
      el = el.parentElement;
    }
    // 没有可滚内层祖先: 大厅"整文档滚动"模式下要看文档本身是否在顶(否则滑到大厅中段下拉会误触发刷新)
    var docTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    return docTop <= 0;
  }

  function reset(){
    ind.classList.remove('active','ready');
    ind.style.opacity = '0';
    ind.style.transform = 'translateY(-56px)';
    if(txt) txt.textContent = '下拉刷新';
  }

  document.addEventListener('touchstart', function(e){
    if(e.touches.length !== 1){ armed = false; return; }
    var t = e.touches[0];
    // 输入框聚焦时(键盘弹起)不触发, 避免误触
    var ae = document.activeElement;
    if(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)){ armed = false; return; }
    if(atTop(e.target)){
      startY = t.clientY; startX = t.clientX;
      armed = true; pulling = false; dist = 0;
    } else {
      armed = false;
    }
  }, {passive:true});

  document.addEventListener('touchmove', function(e){
    if(!armed || e.touches.length !== 1) return;
    var t = e.touches[0];
    var dy = t.clientY - startY;
    var dx = t.clientX - startX;
    // 必须是明确的竖直下拉(dy>0 且竖直分量占主导), 否则交还横滑/斜滑
    if(dy > 0 && Math.abs(dy) > Math.abs(dx) && atTop(e.target)){
      pulling = true;
      dist = Math.min(dy * 0.5, MAX);
      ind.classList.add('active');
      ind.style.opacity = '1';
      ind.style.transform = 'translateY(' + (dist - 56) + 'px)';
      if(dist >= THRESH){ ind.classList.add('ready'); if(txt) txt.textContent = '松开刷新'; }
      else { ind.classList.remove('ready'); if(txt) txt.textContent = '下拉刷新'; }
    } else if(dy <= 0){
      pulling = false; armed = false; reset();
    }
  }, {passive:true});

  document.addEventListener('touchend', function(){
    if(!armed){ return; }
    if(pulling && dist >= THRESH){
      ind.classList.add('spinning');
      ind.classList.remove('ready');
      ind.style.transform = 'translateY(0px)';
      if(txt) txt.textContent = '刷新中…';
      /* ★打标记: 下拉刷新是 reload 而非冷启动, 让开屏脚本(index.html)读到后跳过 1.4s 仪式动画, 直接秒隐。 */
      try{ sessionStorage.setItem('eh_pull_reload','1'); }catch(_){}
      /* 350→120ms: 只留一点动画收尾就刷, 不再白等大半秒。 */
      setTimeout(function(){
        try{
          if(navigator.serviceWorker && navigator.serviceWorker.getRegistration){
            navigator.serviceWorker.getRegistration().then(function(reg){
              if(reg && reg.waiting){ reg.waiting.postMessage('SKIP_WAITING'); }
              location.reload();
            }, function(){ location.reload(); });
          } else { location.reload(); }
        }catch(_){ location.reload(); }
      }, 120);
    } else { reset(); }
    armed = false; pulling = false; dist = 0;
  }, {passive:true});

  document.addEventListener('touchcancel', function(){ armed=false; pulling=false; dist=0; reset(); }, {passive:true});
})();
