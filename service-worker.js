/* 回声厅 Echo Hall — Service Worker
 * 策略:
 *   1. App 外壳(index.html + 图标 + manifest): stale-while-revalidate,秒开且后台更新
 *   2. Supabase 域名(实时/API/存储): 一律 network-only,绝不缓存聊天/身份/配置数据
 *   3. CDN 静态库(jsdelivr supabase.js 等): cache-first,离线也能起
 * 版本号跟随 EH 发布递增,换版自动清旧缓存。
 */
const SW_VERSION = 'eh-sw-v4-20260720';
const SHELL_CACHE = 'eh-shell-' + SW_VERSION;
const CDN_CACHE   = 'eh-cdn-' + SW_VERSION;

// 首屏外壳:安装时预缓存,保证离线可进入
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// 这些域名的请求永远走网络(实时数据不缓存)
const NETWORK_ONLY_HOSTS = [
  'supabase.co',
  'supabase.in',
];

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
      Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== CDN_CACHE)
            .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // 只处理 GET,写操作直通
  const url = new URL(req.url);

  // Supabase 实时/API/存储 —— 一律走网络,不碰缓存
  if (NETWORK_ONLY_HOSTS.some((h) => url.hostname.endsWith(h))) {
    return; // 不拦截,浏览器默认网络
  }
  // Realtime WebSocket 也不拦(fetch 事件本就不含 ws,保险起见跳过非 http)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 跨域 CDN 静态库: cache-first
  if (url.origin !== self.location.origin) {
    e.respondWith(
      caches.open(CDN_CACHE).then((cache) =>
        cache.match(req).then((hit) => {
          if (hit) return hit;
          return fetch(req).then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          }).catch(() => hit);
        })
      )
    );
    return;
  }

  // 导航请求(index.html / ver.txt 等HTML入口): network-first
  // —— 关键: 旧版 stale-while-revalidate 用 `cached||network` 永远先返回旧缓存,
  // 新版要下下次才生效, 安卓卡死在旧版(自愈 location.replace 也被旧缓存应答, 死循环)。
  // 改 network-first: 有网必拿最新, 断网才用缓存兜底 → 主人一开就是新版。
  const isNav = req.mode === 'navigate' ||
    (req.destination === 'document') ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('index.html') ||
    url.pathname.endsWith('ver.txt');
  if (isNav) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() =>
        caches.open(SHELL_CACHE).then((cache) => cache.match(req).then((c) => c || cache.match('./index.html')))
      )
    );
    return;
  }

  // 其余同源静态资源(css内联在html里, 主要是图标等): stale-while-revalidate
  e.respondWith(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    )
  );
});

// 允许页面主动触发 SW 立即接管(发布新版时)
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
