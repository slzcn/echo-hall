// 最小 Service Worker: 只需存在 + 有 fetch handler, Chrome 才认定可安装
const CACHE = 'pwatest-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  // network-first, 断网回退缓存
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => { try{ c.put(e.request, copy); }catch(_){} });
      return res;
    }).catch(() => caches.match(e.request))
  );
});
