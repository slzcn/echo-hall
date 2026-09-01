/* 回声厅 Echo Hall — Service Worker v385 (重写)
 * 策略:
 *   1. 导航请求(index.html / ver.txt): network-first, 有网必最新, 断网用缓存兜底
 *   2. Supabase 域名(实时/API/存储): network-only, 绝不缓存聊天/身份/配置
 *   3. 跨域 CDN 静态库: cache-first, 离线也能起
 *   4. 其余同源静态(图标等): stale-while-revalidate
 * 新缓存名 → 换版自动清旧缓存。
 */
const SW_VERSION = 'eh-sw-v425-20260831-slash-groups';
const SHELL_CACHE = 'eh-shell-' + SW_VERSION;
const CDN_CACHE   = 'eh-cdn-' + SW_VERSION;
// BGM 音频专用持久缓存: 【故意不带 SW_VERSION】—— 音频文件不可变(URL 即内容),
// 一天升好几次版本号不该把几 MB 的曲子冲掉。放过一次即长期驻留, 秒开。
const AUDIO_CACHE = 'eh-audio-v1';
const AUDIO_CACHE_MAX_ENTRIES = 12; // 单曲常为数 MB；保留最近落盘的 12 首，避免持久缓存无限增长
let audioCacheTrimChain = Promise.resolve();
async function trimAudioCache(cache) {
  const keys = await cache.keys();
  while (keys.length > AUDIO_CACHE_MAX_ENTRIES) await cache.delete(keys.shift());
}
function cacheAudioResponse(cache, request, response) {
  // Cache.put + keys/delete 串行，避免并发下载各自看见“未超限”而共同突破上限。
  audioCacheTrimChain = audioCacheTrimChain
    .catch(() => {})
    .then(async () => { await cache.put(request, response); await trimAudioCache(cache); });
  return audioCacheTrimChain;
}
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
// 当前 SW 激活时清掉旧 JS_CACHE；每次新 SW 只会多下载一次本地 JS，
// 换来不再出现“旧 index.html → 旧指纹 → 永久命中旧 app.js”的缓存自锁。
const JS_CACHE = 'eh-js-v1';
function isVersionedJs(url) {
  return url.origin === self.location.origin
    && /\/js\/(?:[\w-]+\/)*[\w-]+\.js$/.test(url.pathname)
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

// Extract only executable same-origin dependencies needed by the offline shell.
// HTML parsing is intentionally narrow because DOMParser is not available in every SW runtime.
function extractShellAssets(html, documentUrl) {
  const assets = new Set();
  const tags = html.match(/<(?:script|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const isScript = /^<script\b/i.test(tag);
    const rel = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (!isScript && !/(?:^|\s)stylesheet(?:\s|$)/i.test(rel)) continue;
    const attrMatch = isScript
      ? tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
      : tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    const value = attrMatch && attrMatch[1];
    if (!value) continue;
    try {
      const url = new URL(value, documentUrl);
      if (url.origin === self.location.origin && /^https?:$/.test(url.protocol)) assets.add(url.href);
    } catch (_) {}
  }
  return [...assets];
}

async function installOfflineShell() {
  const shellCache = await caches.open(SHELL_CACHE);
  const jsCache = await caches.open(JS_CACHE);
  const indexUrl = new URL('./index.html', self.location.href);
  const rootUrl = new URL('./', self.location.href);
  let indexResponse;
  try { indexResponse = await fetch(indexUrl.href); } catch (_) {}
  if (!indexResponse || !indexResponse.ok) return;

  const html = await indexResponse.clone().text();
  await Promise.allSettled([
    shellCache.put(indexUrl.href, indexResponse.clone()),
    shellCache.put(rootUrl.href, indexResponse.clone()),
    ...extractShellAssets(html, indexUrl.href).map(async (href) => {
      try {
        const request = new Request(href);
        const response = await fetch(request);
        if (!response || !response.ok) return;
        const targetCache = isVersionedJs(new URL(href)) ? jsCache : shellCache;
        await targetCache.put(request, response);
      } catch (_) {}
    }),
  ]);
}

const NETWORK_ONLY_HOSTS = ['supabase.co', 'supabase.in'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    installOfflineShell()
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 只清 shell/cdn 旧版本。JS_CACHE 的 URL 已带内容指纹，且新指纹落缓存后会按 pathname
    // 删除旧指纹；整库删除会让每次发版后的下一次打开重下约 1.2 MB 本地脚本。
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => (k.startsWith('eh-shell-') || k.startsWith('eh-cdn-')) && k !== SHELL_CACHE && k !== CDN_CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
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

  // ★导航文档(index.html / navigate): network-first + 3s 兜底(2026-08-16 白屏事故修)。
  //   旧策略 stale-while-revalidate: 缓存壳秒返, 后台再更新——若旧壳引用的资源指纹已被新版下线,
  //   或旧 SW 存过一个坏中间态, 页面就会先跑坏壳、看起来"刷不出来", 得强清缓存才回来。
  //   新策略: 3 秒内拿到网络新壳就直接用; 超时/失败才用缓存兜底(保离线可用), 拿到网络时同步更新缓存。
  //   壳很小(<200KB), 3 秒 GH Pages 基本能回; 拉不动才降级到缓存, 不会因单次网络抖动整站白屏。
  // journey-exempt: 事故根因是 SW 缓存策略, 无功能旅程覆盖; 后续如加导航自愈旅程再回填。
  const isNav = req.mode === 'navigate' || req.destination === 'document' ||
    url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
  if (isNav) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = (await cache.match(req)) || (await cache.match('./index.html'));
      const networkPromise = fetch(req).then((res) => {
        if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
        return res;
      });
      if (!cached) return networkPromise.catch(() => Response.error());
      // 3 秒内拿到网络就用网络; 否则用缓存兜底, 后台继续更新缓存
      let settled = false;
      return await new Promise((resolve) => {
        const timer = setTimeout(() => { if (!settled) { settled = true; resolve(cached); } }, 1500);
        networkPromise.then((res) => {
          if (settled) return;
          settled = true; clearTimeout(timer); resolve(res || cached);
        }).catch(() => {
          if (settled) return;
          settled = true; clearTimeout(timer); resolve(cached);
        });
      });
    })());
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

// Parse one RFC 7233 byte range against a known complete length.
// Multiple ranges are deliberately unsupported; a 416 is safer than fabricating multipart data.
function parseAudioRange(header, total) {
  if (!header || !Number.isSafeInteger(total) || total < 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || total === 0) return null;
    start = Math.max(total - suffixLength, 0);
    end = total - 1;
  } else {
    start = Number(match[1]);
    if (!Number.isSafeInteger(start) || start >= total) return null;
    if (!match[2]) end = total - 1;
    else {
      end = Number(match[2]);
      if (!Number.isSafeInteger(end) || start > end) return null;
      end = Math.min(end, total - 1);
    }
  }
  return { start, end };
}

function audioRangeNotSatisfiable(total) {
  return new Response('', {
    status: 416,
    statusText: 'Range Not Satisfiable',
    headers: {
      'Content-Range': `bytes */${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': '0',
    },
  });
}

async function serveCachedAudioRange(full, rangeHeader) {
  const blob = await full.clone().blob();
  const total = blob.size;
  const range = parseAudioRange(rangeHeader, total);
  if (!range) return audioRangeNotSatisfiable(total);
  const part = blob.slice(range.start, range.end + 1, full.headers.get('Content-Type') || 'audio/mpeg');
  return new Response(part, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': full.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
      'Content-Length': String(range.end - range.start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

// Range requests are network-first so the origin can stream only the requested bytes. A complete
// cached response is used only after network failure; Blob.slice avoids an ArrayBuffer plus copy.
// Non-Range playback remains complete-response cache-first and populates the persistent cache.
async function serveAudio(req) {
  const cache = await caches.open(AUDIO_CACHE);
  const rangeHeader = req.headers.get('range');
  const requestUrl = new URL(req.url);
  const keyReq = new Request(requestUrl.origin + requestUrl.pathname);

  if (rangeHeader) {
    try { return await fetch(req); }
    catch (_) {
      const full = await cache.match(keyReq);
      if (!full) return new Response('', { status: 504 });
      try { return await serveCachedAudioRange(full, rangeHeader); }
      catch (_) { return full; }
    }
  }

  const full = await cache.match(keyReq);
  if (full) return full;
  try {
    const response = await fetch(req);
    if (response && response.status === 200) cacheAudioResponse(cache, keyReq, response.clone()).catch(() => {});
    return response;
  } catch (_) {
    return new Response('', { status: 504 });
  }
}

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
