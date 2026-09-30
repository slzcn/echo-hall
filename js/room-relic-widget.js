/* ============================================================
 * room-relic-widget.js — 归档房"查看遗址"入口组件
 * ------------------------------------------------------------
 * 在 index.html 房间列表里，为已归档的公开房追加一个
 * "归档遗址"分区，每张卡片带 [查看遗址] 按钮，点击跳转到
 * room-relic.html?room_id=xxx。
 *
 * 特点：
 *  - 轻量：纯原生 JS，IIFE，无外部依赖。
 *  - 自愈：优先复用 index.html 已建好的全局 Supabase 客户端
 *    (window.sb / window.__sb)；若不存在则用 window.SB_URL /
 *    window.SB_ANON 自建一个；都没有则静默退出。
 *  - 自挂载：DOM 就绪后自动渲染，无需手动调用；也可手动
 *    EHRelicWidget.refresh() 重新拉取。
 *  - 可配：通过 window.EH_RELIC_WIDGET_CFG 覆盖默认配置。
 *  - RLS：仅查 kind='public' 且 archived=true 的房，与大厅
 *    列公开房共用同一 anon SELECT 策略。私密房不对 anon
 *    开放，故不会出现在遗址入口。
 *
 * 用法（index.html 末尾引入即可）：
 *   <script defer src="./room-relic-widget.js"></script>
 *
 * 可选覆盖：
 *   <script>
 *     window.EH_RELIC_WIDGET_CFG = {
 *       mountSelector: '#lobby',        // 挂载点（默认 #lobby → body 兜底）
 *       relicPageUrl: 'room-relic.html',// 遗址页相对地址
 *       limit: 12,                      // 最多展示几条归档房
 *       autoInit: true                  // 是否自动初始化
 *     };
 *   </script>
 * ============================================================ */
(function (root) {
  'use strict';

  var DEFAULTS = {
    mountSelector: '#lobby',     // 挂载容器选择器（找不到则退到 body）
    relicPageUrl: 'room-relic.html',
    limit: 12,
    autoInit: true,
    sectionTitle: '🗄 归档遗址',
    sectionSub: 'ARCHIVE RELICS · 信号已静默的房间'
  };

  // 合并用户覆盖
  var CFG = Object.assign({}, DEFAULTS, root.EH_RELIC_WIDGET_CFG || {});

  var state = { sb: null, data: [], mounted: false };

  // ---- 工具 ----
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeEmoji(e) { return esc(String(e || '').slice(0, 8)); }

  function fmtAgo(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var diff = Date.now() - d.getTime();
    var min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + ' 小时前';
    var day = Math.floor(hr / 24);
    if (day < 30) return day + ' 天前';
    var mo = Math.floor(day / 30);
    if (mo < 12) return mo + ' 个月前';
    return Math.floor(mo / 12) + ' 年前';
  }

  // ---- 获取 Supabase 客户端（复用 / 自建 / 退出） ----
  function getSb() {
    if (state.sb) return state.sb;
    // 1) 优先复用 index.html 全局客户端
    var existing = root.sb || root.__sb || (root.window && root.window.sb);
    if (existing && existing.from) { state.sb = existing; return existing; }
    // 2) 用全局 SB_URL/SB_ANON 自建（room-relic.html 场景或简单页）
    if (root.supabase && root.supabase.createClient && root.SB_URL && root.SB_ANON) {
      try {
        state.sb = root.supabase.createClient(root.SB_URL, root.SB_ANON, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
        return state.sb;
      } catch (e) { console.warn('[EHRelicWidget] 自建客户端失败', e); }
    }
    return null;
  }

  // ---- 拉取归档公开房 ----
  async function fetchArchived() {
    var sb = getSb();
    if (!sb) return { error: 'no_sb' };
    try {
      var res = await sb.from('eh_rooms')
        .select('id,name,emoji,topic,created_at,archived_at,peak_online')
        .eq('kind', 'public')
        .eq('archived', true)
        .order('archived_at', { ascending: false })
        .limit(CFG.limit);
      if (res.error) return { error: res.error };
      return { data: res.data || [] };
    } catch (e) {
      return { error: e };
    }
  }

  // ---- 注入样式（一次性，scoped 前缀 .eh-relic 防污染） ----
  function injectStyle() {
    if (document.getElementById('eh-relic-widget-style')) return;
    var css = '' +
      '.eh-relic{margin:22px 0 8px;padding:0 0 6px}' +
      '.eh-relic-head{display:flex;align-items:baseline;gap:10px;margin-bottom:4px}' +
      '.eh-relic-head h2{font-size:14px;font-weight:800;letter-spacing:.08em;color:var(--sub,#86cbc6)}' +
      '.eh-relic-head .sub{font-size:10px;letter-spacing:.18em;color:var(--dim,#498d88);text-transform:uppercase}' +
      '.eh-relic-head .sub::after{content:"";display:inline-block;width:0;height:1px;vertical-align:middle;background:var(--line,rgba(0,229,212,.24));margin-left:8px;}' +
      '.eh-relic-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:10px}' +
      '.eh-relic-card{position:relative;background:var(--card-bg,rgba(10,12,24,.5));border:1px solid var(--line,rgba(0,229,212,.24));border-left:3px solid var(--dim,#498d88);padding:12px 12px 10px;border-radius:8px;opacity:.82;transition:.2s}' +
      '.eh-relic-card:hover{opacity:1;border-left-color:var(--cyan,#00E5D4);box-shadow:0 0 14px rgba(0,229,212,.18)}' +
      '.eh-relic-card .ic{font-size:20px;line-height:1}' +
      '.eh-relic-card .nm{font-size:13px;font-weight:700;color:var(--ink,#EAF6FF);margin:4px 0 2px;word-break:break-all}' +
      '.eh-relic-card .meta{font-size:10px;color:var(--dim,#498d88);margin-bottom:8px}' +
      '.eh-relic-card .meta .pk{color:var(--amber,#FFC24D)}' +
      '.eh-relic-btn{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.1em;padding:6px 12px;border:1px solid var(--cyan,#00E5D4);color:var(--cyan,#00E5D4);background:transparent;border-radius:4px;cursor:pointer;text-decoration:none;transition:.2s}' +
      '.eh-relic-btn:hover{background:rgba(0,229,212,.12);box-shadow:0 0 10px rgba(0,229,212,.2)}' +
      '.eh-relic-empty{font-size:12px;color:var(--dim,#498d88);padding:14px 2px;font-style:italic}' +
      '.eh-relic-fail{font-size:11px;color:var(--dim,#498d88);padding:10px 2px}' +
      '@media(max-width:520px){.eh-relic-grid{grid-template-columns:repeat(2,1fr)}}';
    var st = document.createElement('style');
    st.id = 'eh-relic-widget-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---- 渲染分区 ----
  function render(data, errMsg) {
    injectStyle();
    var mount = document.querySelector(CFG.mountSelector) || document.body;
    var sec = document.getElementById('eh-relic-section');
    if (!sec) {
      sec = document.createElement('section');
      sec.id = 'eh-relic-section';
      sec.className = 'eh-relic';
      mount.appendChild(sec);
    }

    var head = '<div class="eh-relic-head"><h2>' + esc(CFG.sectionTitle) +
      '</h2><span class="sub">' + esc(CFG.sectionSub) + '</span></div>';

    if (errMsg) {
      sec.innerHTML = head + '<div class="eh-relic-fail">归档信号解码失败' +
        (errMsg === 'no_sb' ? '（Supabase 未就绪）' : '') + '</div>';
      return;
    }
    if (!data || !data.length) {
      sec.innerHTML = head + '<div class="eh-relic-empty">虚空寂静，暂无归档遗址。</div>';
      return;
    }

    var cards = data.map(function (r) {
      var peak = (r.peak_online != null) ? r.peak_online : '—';
      var ago = fmtAgo(r.archived_at || r.created_at);
      var href = CFG.relicPageUrl + '?room_id=' + encodeURIComponent(r.id);
      return '<div class="eh-relic-card">' +
        '<div class="ic">' + safeEmoji(r.emoji) + '</div>' +
        '<div class="nm">' + esc(r.name || '未命名信号站') + '</div>' +
        '<div class="meta">归档 ' + esc(ago) + ' · 峰值 <span class="pk">' + esc(peak) + '</span> 灵魂</div>' +
        '<a class="eh-relic-btn" href="' + href + '">🏛 查看遗址</a>' +
        '</div>';
    }).join('');

    sec.innerHTML = head + '<div class="eh-relic-grid">' + cards + '</div>';
  }

  // ---- 刷新 ----
  async function refresh() {
    var res = await fetchArchived();
    if (res.error) {
      render(null, typeof res.error === 'string' ? res.error : 'fetch_error');
      return false;
    }
    state.data = res.data;
    render(res.data, null);
    return true;
  }

  // ---- 自动初始化 ----
  function init() {
    if (state.mounted) return;
    state.mounted = true;
    // 等 Supabase 客户端就绪（轮询，最多 ~6s）
    var tries = 0;
    function wait() {
      if (getSb()) { refresh(); return; }
      if (tries++ < 30) { setTimeout(wait, 200); return; }
      // 超时仍未就绪：渲染空态（不阻塞大厅）
      render(null, 'no_sb');
    }
    wait();
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else { fn(); }
  }

  // ---- 对外 API ----
  var api = Object.freeze({
    version: '1.0.0',
    config: CFG,
    init: init,
    refresh: refresh,
    render: render
  });
  root.EHRelicWidget = api;

  // 自动启动
  if (CFG.autoInit) { onReady(init); }

})(typeof window !== 'undefined' ? window : this);
