if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      // 新文件名 sw.js + 新缓存名, 让浏览器当成全新 SW 注册(旧 service-worker.js 已删)
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        // ★V36+：小米浏览器 PWA 不主动检查 SW 更新——页面初加载与切回前台时主动 update。
        var tryUpdate = function () { try { reg.update(); } catch (_) {} };
        tryUpdate();
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') tryUpdate();
        });
        // 已处于 waiting 的 SW 直接推 SKIP_WAITING（新版安装完但旧页还在）
        if (reg.waiting && navigator.serviceWorker.controller) {
          reg.waiting.postMessage('SKIP_WAITING');
        }
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing; if (!nw) return;
          nw.addEventListener('statechange', function () {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) nw.postMessage('SKIP_WAITING');
          });
        });
      }).catch(function (e) { console.warn('SW register failed:', e && e.message); });
      // ★V36+：controller 切换后抗 SW【月销】很强的小米浏览器环境，主动重载页面拿新 HTML。
      // 旧机制留了一个 `_ehSwClaimed` 句柄防循环（同一 controller 只重载一次）。
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (window.__ehSwClaimed) return;
        window.__ehSwClaimed = true;
        console.info('[EH SW] controller changed → reload for fresh shell');
        try { location.reload(); } catch (_) {}
      });
    });
  }
