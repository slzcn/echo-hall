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

  /* 硬刷新: 整页 reload(拿新壳)。打 sessionStorage 标记让开屏脚本跳过 1.4s 仪式, 松手动画收尾 120ms 后刷。 */
  function hardReload(){
    try{ sessionStorage.setItem('eh_pull_reload','1'); }catch(_){}
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
  }

  /* 下拉刷新主流程(2026-08-03 软刷新):
     1. 先 check 版本 —— 拉 ver.txt(2.5s 超时) 比对页面内 BUILD_VER。不一致=有新代码 → 必须硬 reload 拿新壳。
     2. 版本一致(常态) → 调 app.js 暴露的 EH_SOFT_REFRESH 软刷新(只重拉数据, 不重建应用), 近乎瞬时。
     3. 软刷新不可用(函数缺失/返回 ok:false/抛错) → 兜底硬 reload, 保证下拉永远有效。
     这样既拿到"不 reload 的秒刷", 又不牺牲版本自愈(有新版仍会整页换新)。 */
  function doRefresh(){
    var soft = window.EH_SOFT_REFRESH;
    if(typeof soft !== 'function'){ hardReload(); return; }   // app.js 还没就绪 → 硬刷兜底
    var settled = false;
    // 版本 check: 有新版硬 reload; 无新版或 check 失败(不该因网络抖动就退化成硬刷)→ 软刷新
    var ver = fetchVer();
    ver.then(function(latest){
      if(settled) return;
      var cur = window.__EH_BUILD_VER || '';
      if(latest && cur && latest !== cur){ settled = true; hardReload(); return; }   // 有新代码 → 拿新壳
      runSoft();
    }, function(){ if(!settled) runSoft(); });   // check 失败也软刷(内容重拉本就走网络, 失败会自己兜底)

    function runSoft(){
      if(settled) return; settled = true;
      // 软刷极快(可能几十 ms), 给指示器一个最短可见时长(400ms), 让"刷新中→完成"有反馈, 不至于闪一下像没触发
      var t0 = Date.now();
      Promise.resolve().then(function(){ return soft(); }).then(function(res){
        if(res && res.ok){
          var wait = Math.max(0, 400 - (Date.now() - t0));
          setTimeout(reset, wait);       // 软刷成功: 收起指示器, 页面已就地更新
        } else { hardReload(); }         // 入口态/未知场景 → 硬刷兜底
      }).catch(function(){ hardReload(); });
    }
  }

  /* 轻量拉 ver.txt(no-store, 2.5s 超时)。超时/失败返回 null → 上层按"无新版"软刷。 */
  function fetchVer(){
    return new Promise(function(resolve, reject){
      var done = false;
      var to = setTimeout(function(){ if(!done){ done = true; reject(new Error('ver timeout')); } }, 2500);
      fetch('ver.txt?_=' + Date.now(), { cache:'no-store' }).then(function(r){
        return r.ok ? r.text() : null;
      }).then(function(t){ if(done) return; done = true; clearTimeout(to); resolve((t||'').trim()); },
        function(e){ if(done) return; done = true; clearTimeout(to); reject(e); });
    });
  }

  document.addEventListener('touchend', function(){
    if(!armed){ return; }
    if(pulling && dist >= THRESH){
      ind.classList.add('spinning');
      ind.classList.remove('ready');
      ind.style.transform = 'translateY(0px)';
      if(txt) txt.textContent = '刷新中…';
      doRefresh();
    } else { reset(); }
    armed = false; pulling = false; dist = 0;
  }, {passive:true});

  document.addEventListener('touchcancel', function(){ armed=false; pulling=false; dist=0; reset(); }, {passive:true});
})();
