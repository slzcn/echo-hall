/* 回声厅 Echo Hall — Service Worker v2 (重写)
 * 策略:
 *   1. 导航请求(index.html / ver.txt): network-first, 有网必最新, 断网用缓存兜底
 *   2. Supabase 域名(实时/API/存储): network-only, 绝不缓存聊天/身份/配置
 *   3. 跨域 CDN 静态库: cache-first, 离线也能起
 *   4. 其余同源静态(图标等): stale-while-revalidate
 * 新缓存名 → 换版自动清旧缓存。
 */
const SW_VERSION = 'eh-sw-v2-2026072x';
const SHELL_CACHE = 'eh-shell-' + SW_VERSION;
const CDN_CACHE   = 'eh-cdn-' + SW_VERSION;

const SHELL_ASSETS = [
  './',
  './index.html',
  './app.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const NETWORK_ONLY_HOSTS = ['supabase.co', 'supabase.in'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== CDN_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (NETWORK_ONLY_HOSTS.some((h) => url.hostname.endsWith(h))) return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 跨域 CDN: cache-first
  if (url.origin !== self.location.origin) {
    e.respondWith(
      caches.open(CDN_CACHE).then((cache) =>
        cache.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(() => hit))
      )
    );
    return;
  }

  // 导航/入口: network-first
  const isNav = req.mode === 'navigate' || req.destination === 'document' ||
    url.pathname.endsWith('/') || url.pathname.endsWith('index.html') || url.pathname.endsWith('ver.txt');
  if (isNav) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.open(SHELL_CACHE).then((cache) => cache.match(req).then((c) => c || cache.match('./index.html'))))
    );
    return;
  }

  // 其余同源静态: stale-while-revalidate
  e.respondWith(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req).then((res) => { if (res && res.status === 200) cache.put(req, res.clone()); return res; }).catch(() => cached);
        return cached || network;
      })
    )
  );
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
