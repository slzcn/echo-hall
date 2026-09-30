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
      // ★8/19 修二次刷新: controllerchange 不再无脑 reload。
      //   老逻辑「新 SW 一接管就整页 reload」会跟下拉刷新的 hardReload / 版本自愈的 location.replace 打架,
      //   出现「刷新一次 → SW 切换 → 又 reload 一次」的二次刷新。
      //   新策略: 记录 controller 已切换(缓存已是新版), 但不主动 reload;
      //     - 如果本次页面是刚被硬刷/版本自愈拉起(带 __ehJustReloaded 标记), 直接吞掉;
      //     - 否则由「版本自愈 check」或下次自然刷新拿新壳, 不打断当前会话。
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        window.__ehSwClaimed = true;
        console.info('[EH SW] controller changed (silent, no reload)');
      });
    });
  }
