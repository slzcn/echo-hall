/* 回声厅 Echo Hall — Service Worker v2 (重写)
 * 策略:
 *   1. 导航请求(index.html / ver.txt): network-first, 有网必最新, 断网用缓存兜底
 *   2. Supabase 域名(实时/API/存储): network-only, 绝不缓存聊天/身份/配置
 *   3. 跨域 CDN 静态库: cache-first, 离线也能起
 *   4. 其余同源静态(图标等): stale-while-revalidate
 * 新缓存名 → 换版自动清旧缓存。
 */
const SW_VERSION = 'eh-sw-v201-20260805-karaokeWarpGateChorus';
const SHELL_CACHE = 'eh-shell-' + SW_VERSION;
const CDN_CACHE   = 'eh-cdn-' + SW_VERSION;
// BGM 音频专用持久缓存: 【故意不带 SW_VERSION】—— 音频文件不可变(URL 即内容),
// 一天升好几次版本号不该把几 MB 的曲子冲掉。放过一次即长期驻留, 秒开。
const AUDIO_CACHE = 'eh-audio-v1';
// ★第三方库持久缓存【故意不带 SW_VERSION】: supabase-js 版本锁死在 URL 里(@2.45.4), 内容永不变。
//   若跟着 CDN_CACHE 走 SW_VERSION, 每次升版本号(改 bug 常有)都会连它一起删 → 用户下次刷新在弱网
//   重下 120KB UMD 库 = "刷新等很久"的真凶(实测 Slow3G 下库就绪要 14s)。放进独立持久缓存, 下一次
//   即长期驻留, 之后任何版本升级都秒取。仅拦第三方 lib CDN, 不碰其他跨域资源。
const LIB_CACHE = 'eh-lib-v1';
function isVendorLib(url) {
  return (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'unpkg.com' || url.hostname === 'cdnjs.cloudflare.com')
    && /@supabase\/supabase-js@[\d.]+\//.test(url.pathname);
}
// ★本地 js/*.js 带 ?v= 指纹的持久缓存【故意不带 SW_VERSION】: 引用 URL 里的 ?v= 指纹随内容变,
//   URL 即内容标识。此前同源 script 走 network-first(见旧注释), 每次刷新全量重下 app.js(167KB gzip)
//   +其余 = "刷新慢"的结构性根因。有了指纹, 换版时 URL 必变 → cache-first 绝不会混版本:
//   命中秒返, 指纹一变即 miss 下载一次并清同名旧版。仅拦 /js/*.js?v=, 不碰 sw.js/config 无指纹场景。
const JS_CACHE = 'eh-js-v1';
function isVersionedJs(url) {
  return url.origin === self.location.origin
    && /\/js\/[\w-]+\.js$/.test(url.pathname)
    && /[?&]v=/.test(url.search);
}
// 命中即返, miss 下载存入, 并顺手删掉【同一 pathname 的旧指纹】条目(避免缓存无限膨胀)
async function serveVersionedJs(req, url) {
  const cache = await caches.open(JS_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  let res;
  try { res = await fetch(req); }
  catch (e) { const any = await cache.match(url.pathname, { ignoreSearch: true }); if (any) return any; throw e; }
  if (res && res.status === 200) {
    cache.put(req, res.clone()).catch(() => {});
    // 清掉同 pathname 的旧指纹版本(只保留本次这条)
    cache.keys().then((keys) => keys.forEach((k) => {
      const ku = new URL(k.url);
      if (ku.pathname === url.pathname && ku.search !== url.search) cache.delete(k);
    })).catch(() => {});
  }
  return res;
}
// 命中即缓存的音频路径(Supabase Storage 的官方/灵魂 BGM 与神曲)。这些是 supabase.co 域,
// 本会被下面的 NETWORK_ONLY_HOSTS 判成 network-only(每次全量重下 3~7MB = 点开慢的根因),
// 故在 network-only 之前先拦成 cache-first。仅拦音频对象, 不碰 rest/realtime/auth 等 API。
function isBgmAudio(url) {
  return /supabase\.(co|in)$/.test(url.hostname)
    && /\/storage\/v1\/object\/public\/eh-song\/.*\.mp3$/.test(url.pathname);
}

// 不 precache manifest/图标: 让它们始终走网络最新, 避免 SW 缓存旧 manifest 导致 Chrome 判不可安装
// ★不再 precache /js/*.js: 页面引用全带 ?v= 指纹, 实际请求走 JS_CACHE(cache-first, 见 isVersionedJs);
//   这里 precache 的是【无指纹】URL, 页面从不请求 = install 时白下一份 app.js(167KB)。只留导航入口壳。
const SHELL_ASSETS = [
  './',
  './index.html',
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
      // 强制清光所有 eh-shell-* 和 eh-cdn-* 旧缓存，只保留当前版 SHELL_CACHE/CDN_CACHE
      // 避免旧 SW 缓存的 index.html 被新 SW 听用导致样式不同步（bgm30→bgm31 踩雷）
      Promise.all(keys.filter((k) => (k.startsWith('eh-shell-') || k.startsWith('eh-cdn-')) && k !== SHELL_CACHE && k !== CDN_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ★BGM 音频: 先于 network-only 拦截, 走【持久】cache-first(见 AUDIO_CACHE 注释)。
  //   音频常带 Range 请求(Supabase 回 206), 而缓存里存的是完整 200 —— 需自己按 Range 切片。
  if (isBgmAudio(url)) {
    e.respondWith(serveAudio(req));
    return;
  }

  // ★第三方 lib CDN(supabase-js): 持久 cache-first, 命中秒返, miss 时下载并存入不失效的 LIB_CACHE。
  //   放在跨域 CDN 通用分支之前, 让它走独立持久缓存(不随 SW_VERSION 清)。
  if (isVendorLib(url)) {
    e.respondWith(
      caches.open(LIB_CACHE).then((cache) =>
        cache.match(req).then((hit) => hit || fetch(req).then((res) => {
          // ★<script defer src> 无 crossorigin → no-cors 请求 → 响应是 opaque(status=0, type='opaque')。
          //   只认 status===200 会漏存 opaque(这正是首版 LIB_CACHE 一直空的原因)。opaque 可缓存也可回放执行。
          if (res && (res.status === 200 || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  // ★本地带指纹 js: 持久 cache-first(见 JS_CACHE 注释)。放在 isPwaCore(script→network-first)之前,
  //   让带 ?v= 的 /js/*.js 命中秒返, 不再每次刷新全量重下。指纹保证换版必拉新, 不会混版本。
  if (isVersionedJs(url)) {
    e.respondWith(serveVersionedJs(req, url));
    return;
  }

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

  // ★ manifest / 图标 / SW自身: 一律 network-first, 绝不返回可能过期的缓存
  //   (Chrome 检查可安装性时抓 manifest, 若 SW 给回旧缓存版本会导致'装了不出图标'/判不可安装)
  const isPwaCore = req.destination === 'script' || /manifest\.json$|\.webmanifest$|\/icons\/|icon-\d+\.png$|sw\.js$/.test(url.pathname);
  if (isPwaCore) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // ★ver.txt: network-first —— 版本自愈命脉(31B, 必须拿最新, 不慢)。绝不先返缓存, 否则永远发现不了新版。
  if (url.pathname.endsWith('ver.txt')) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // ★导航文档(index.html / navigate): stale-while-revalidate(2026-08-03 下拉刷新提速)。
  //   旧策略 network-first: reload 后死等 fetch(index.html) 从 GitHub Pages 返回才换页 —— 国内访问 Pages
  //   慢/不稳时, 下拉刷新"刷新中"就一直卡着(每次都重下整份 ~196KB HTML)。改 SWR: 缓存壳秒返, 页面立即
  //   换新、"刷新中"立即消失; 后台拉最新写缓存。壳只是容器, 聊天/房间数据运行时从 Supabase 实时拉、不靠它;
  //   真有新版由页面内 BUILD_VER 比对 ver.txt(仍 network-first)自愈再 reload 一次, 那次已被本次后台 fetch
  //   暖好缓存 → 秒拿新壳。稳态(无新版)下拉刷新即秒切, 不再等 Pages。
  const isNav = req.mode === 'navigate' || req.destination === 'document' ||
    url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
  if (isNav) {
    e.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = (await cache.match(req)) || (await cache.match('./index.html'));
        const fresh = fetch(req).then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
          return res;
        }).catch(() => cached);
        return cached || fresh;   // 有缓存: 秒返 + 后台更新; 无缓存(首访): 等网络
      })
    );
    return;
  }

  // ★同源 JS 改 network-first (2026-07-30 P0 修): 避免"新 index + 旧 keyboard.js"混版本
  //   SWR 会先返回缓存旧文件, 后台再更新 -> 用户第一次访问总跑旧代码, 只有刷新才拿新的
  //   -> 这正是主人反馈"改了代码但没变化"的机制根因
  if (req.destination === 'script'){
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200){
          const clone = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, clone)).catch(()=>{});
        }
        return res;
      }).catch(() => caches.open(SHELL_CACHE).then((cache) => cache.match(req)))
    );
    return;
  }

  // 其余同源静态(CSS/图片/字体等): stale-while-revalidate
  e.respondWith(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req).then((res) => { if (res && res.status === 200) cache.put(req, res.clone()); return res; }).catch(() => cached);
        return cached || network;
      })
    )
  );
});

// BGM 音频取用: 缓存优先, 缓存里始终存【完整 200】; 命中后若请求带 Range 则手工切片回 206。
//   miss 时抓一份【不带 Range 的完整体】存缓存, 再据本次请求是否 Range 决定返回整体还是切片。
//   任何网络失败都静默降级(BGM 非必需), 不 throw 以免打断 audio 元素。
async function serveAudio(req) {
  const cache = await caches.open(AUDIO_CACHE);
  const rangeHeader = req.headers.get('range');
  // 用不带 Range/无 query 的规范 URL 做 key, 保证同一首只存一份完整体
  const keyReq = new Request(new URL(req.url).origin + new URL(req.url).pathname);

  let full = await cache.match(keyReq);
  if (!full) {
    try {
      const res = await fetch(keyReq);           // 主动请求完整体(不透传 Range)
      if (res && res.status === 200) {
        cache.put(keyReq, res.clone()).catch(() => {});
        full = res;
      } else {
        return fetch(req);                        // 拿不到完整体, 直接透传原请求
      }
    } catch (_) {
      return fetch(req).catch(() => new Response('', { status: 504 }));
    }
  }
  if (!rangeHeader) return full;                  // 无 Range: 直接给完整 200

  // 有 Range: 从完整体切片, 手工构造 206
  try {
    const buf = await full.clone().arrayBuffer();
    const total = buf.byteLength;
    const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    if (start > end) { start = 0; end = total - 1; }
    const slice = buf.slice(start, end + 1);
    return new Response(slice, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': full.headers.get('Content-Type') || 'audio/mpeg',
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (_) {
    return full;                                  // 切片失败退回完整体
  }
}

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
