if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      // 新文件名 sw.js + 新缓存名, 让浏览器当成全新 SW 注册(旧 service-worker.js 已删)
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing; if (!nw) return;
          nw.addEventListener('statechange', function () {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) nw.postMessage('SKIP_WAITING');
          });
        });
      }).catch(function (e) { console.warn('SW register failed:', e && e.message); });
      // SW 更新只接管缓存；页面版本自愈脚本负责唯一一次整页导航。
      // 若这里也在 controllerchange 时 reload，会和版本自愈的 location.replace
      // （以及下拉刷新里已经发起的 location.reload）叠加，表现为首页刷新两次。
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        console.info('[EH SW] controller changed; skip implicit reload');
      });
    });
  }
