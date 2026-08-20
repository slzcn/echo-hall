/*
 * Echo Hall 大厅模块契约（第 2 阶段）。
 *
 * 这是迁移期适配层：业务实现仍在 app.js，真正迁移时由 app.js 注入依赖，
 * 这里不直接读取 sb、me、curRoom 等隐式全局，避免新模块继续扩大耦合。
 *
 * 加载方式：当前先由 app.js 通过 createLobbyController 建立契约；
 * 后续完成函数迁移后，可把实现移入本文件而不改调用方。
 */
(function (root) {
  'use strict';

  function required(name, value) {
    if (typeof value !== 'function') {
      throw new TypeError('[EH_LOBBY] missing dependency: ' + name);
    }
    return value;
  }

  function createLobbyController(deps) {
    deps = deps || {};
    var controller = {
      render: required('render', deps.render),
      renderOfficial: required('renderOfficial', deps.renderOfficial),
      renderPublic: required('renderPublic', deps.renderPublic),
      renderMyRooms: required('renderMyRooms', deps.renderMyRooms),
      showRetry: required('showRetry', deps.showRetry),
      fillRoomStats: required('fillRoomStats', deps.fillRoomStats),
      prefetchRoom: required('prefetchRoom', deps.prefetchRoom),
      prefetchAll: required('prefetchAll', deps.prefetchAll),
    };
    return Object.freeze(controller);
  }

  // 已迁入本模块的纯函数（零外部依赖，不需注入）。
  // 房间卡片骨架 HTML 占位：慢网先占位不留空白。
  function chSkel(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += '<div class="ch-skel"><div class="sk-b sk-icon"></div><div class="sk-b sk-h"></div><div class="sk-b sk-d"></div><div class="sk-b sk-l"></div></div>';
    return s;
  }
  function rmSkel(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += '<div class="rm-skel"><div class="sk-b sk-ric"></div><div class="sk-b sk-rnm"></div></div>';
    return s;
  }

  // 相对时间显示：纯函数，无需注入运行时依赖。
  function fmtAgo(ts) {
    var s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + '分钟前';
    if (s < 86400) return Math.floor(s / 3600) + '小时前';
    return Math.floor(s / 86400) + '天前';
  }

  // 进房瞬间的乐观在线数文案：已知数(你自己刚进 +1)先顶上，真实 presence 回来再精确覆盖。
  // 纯函数：仅依赖入参 room.knownOnline，无外部运行时耦合。
  function optimisticCnt(room) {
    var k = room && room.knownOnline;
    if (k != null && k >= 0) {
      var n = k + 1;
      return '<span class="cnt-led" id="cntLed"></span>~ <b>' + n + '</b> 人在线';
    }
    return '<span class="cnt-led" id="cntLed"></span>连接中…';
  }

  // 从房间卡 .cnt 文案读取已知在线数：纯 DOM 辅助，不依赖大厅运行时状态。
  function readKnownOnline(cardEl) {
    try {
      var cnt = cardEl.querySelector('.cnt');
      var text = cnt && cnt.textContent || '';
      var match = text.match(/(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    } catch (e) { return null; }
  }

  // 大厅加载多次失败后的手动重试入口。身份和 renderLobby 都可能晚于模块初始化，点击时再通过 getter 读取。
  function createLobbyShowRetry(deps) {
    deps = deps || {};
    var getBox = deps.getBox, makeSkeleton = deps.chSkel, awaitReady = deps.awaitReady;
    var getMyUid = deps.getMyUid, ensureAuth = deps.ensureAuth, getRenderLobby = deps.getRenderLobby;
    if (typeof getBox !== 'function' || typeof makeSkeleton !== 'function' || typeof awaitReady !== 'function' || typeof getMyUid !== 'function' || typeof ensureAuth !== 'function' || typeof getRenderLobby !== 'function') {
      throw new TypeError('[EH_LOBBY] createLobbyShowRetry missing dependencies');
    }
    function showRetry() {
      var box = getBox();
      if (!box || box.querySelector('.lobby-retry')) return;
      box.innerHTML = '<div class="lobby-retry" style="grid-column:1/-1;text-align:center;padding:22px 16px;color:var(--sub);font-size:13px;cursor:pointer;border:1px dashed var(--line2);border-radius:14px">网络较慢，点击重试 ↻</div>';
      var el = box.querySelector('.lobby-retry');
      if (!el) return;
      el.onclick = async function () {
        var renderLobby = getRenderLobby();
        if (typeof renderLobby !== 'function') return;
        renderLobby.resetRetry();
        box.innerHTML = makeSkeleton(4);
        try {
          await awaitReady(8000);
          if (!getMyUid()) ensureAuth().then(function () { return getRenderLobby()(true); }).catch(function () {});
          getRenderLobby()(false);
        } catch (e) {
          showRetry();
        }
      };
    }
    return showRetry;
  }

  // 带依赖注入的预取工厂：sb 是延迟初始化资源，必须在每次预取时通过 getSb() 读取最新值，
  // 不能在 app.js 解析阶段捕获当时仍为 null 的 sb。
  function createPrefetch(deps) {
    deps = deps || {};
    var getSb = deps.getSb;
    var prefetchCache = deps.prefetchCache;
    var prefetchSouls = deps.prefetchSouls;
    var readN = deps.readN;
    var readTtl = deps.readTtl;
    if (typeof getSb !== 'function' || !prefetchCache || typeof prefetchSouls !== 'function' || typeof readN !== 'function' || typeof readTtl !== 'function') {
      throw new TypeError('[EH_LOBBY] createPrefetch missing dependencies');
    }
    function prefetchRoom(rid, kind) {
      var sb = getSb();
      if (!sb) return Promise.resolve([]);   // Supabase 尚未 boot：不抛错、不阻断 app.js，渲染链路稍后会重试。
      prefetchSouls(rid);   // 灵魂列表随消息历史一起预取(列表页错峰,不拖慢首屏)
      var hit = prefetchCache[rid];
      if (hit && Date.now() - hit.at < readTtl()) return hit.p;
      var p;
      if (kind === 'official' || kind === 'public') {
        p = sb.rpc('eh_public_recent', { rid: rid, lim: readN() }).then(function (r) { return r && r.data || []; }).catch(function () { return []; });
      } else {
        // 私密房: 我的房间都是已加入的，直查最近(成员RLS放行)
        p = sb.from('eh_messages').select('*').eq('room_id', rid).order('id', { ascending: false }).limit(readN())
            .then(function (r) { return r && r.data || []; }).catch(function () { return []; });
      }
      prefetchCache[rid] = { at: Date.now(), p: p };
      return p;
    }
    // 列表渲染后主动错峰预取(避免十几房同时打请求拖慢首屏在线数/预览)
    function prefetchAll(rooms) {
      rooms.forEach(function (r, i) {
        setTimeout(function () { prefetchRoom(r.id, r.kind); }, 120 * i);
      });
    }
    return { prefetchRoom: prefetchRoom, prefetchAll: prefetchAll };
  }

  // 统一房间强调色：配置与房间主题解析器均通过 getter 延迟读取，兼容配置／运行时依赖晚于模块装配。
  function createRoomAccentC(deps) {
    deps = deps || {};
    var getConfig = deps.getConfig;
    var getRoomThemeFor = deps.getRoomThemeFor;
    if (typeof getConfig !== 'function' || typeof getRoomThemeFor !== 'function') {
      throw new TypeError('[EH_LOBBY] createRoomAccentC missing dependencies');
    }
    return function roomAccentC(room) {
      var cfg = getConfig() || {};
      var kindColors = cfg.roomKindC || { public: '#1DE9B6', private: '#B57EDC', official: '#0ABAB5' };
      var officialFallback = cfg.officialFallbackC || {};
      var nameColors = cfg.roomNameC || {};
      var accentForTheme = function (themeId) {
        try {
          var palette = (cfg.themePalettes || {})[themeId];
          return palette && palette['--accent'] || null;
        } catch (e) { return null; }
      };
      if (!room) return kindColors.official;
      if (room.name && nameColors[room.name]) return nameColors[room.name];
      if (room.kind === 'official') {
        var themeId = (cfg.roomTheme || {})[room.name];
        return accentForTheme(themeId) || officialFallback[room.name] || kindColors.official;
      }
      try {
        var roomThemeFor = getRoomThemeFor();
        var resolvedTheme = typeof roomThemeFor === 'function' ? roomThemeFor(room) : null;
        var accent = accentForTheme(resolvedTheme);
        if (accent) return accent;
      } catch (e) {}
      return kindColors[room.kind] || kindColors.official;
    };
  }

  // 大厅房间查询超时包装：withTimeout 通过 getter 在调用时读取，避免模块装配阶段捕获尚未就绪的实现。
  function createRoomsQuery(deps) {
    deps = deps || {};
    var getWithTimeout = deps.getWithTimeout;
    var defaultTimeout = Number.isFinite(+deps.defaultTimeout) ? +deps.defaultTimeout : 8000;
    if (typeof getWithTimeout !== 'function') {
      throw new TypeError('[EH_LOBBY] createRoomsQuery missing dependencies');
    }
    return function roomsQuery(query, timeout) {
      var withTimeout = getWithTimeout();
      if (typeof withTimeout !== 'function') return Promise.resolve({ data: null, __timeout: true });
      var ms = Number.isFinite(+timeout) ? +timeout : defaultTimeout;
      return withTimeout(query, ms).catch(function () { return { data: null, __timeout: true }; });
    };
  }

  // 动态房间卡片统计：Supabase 通过 getter 延迟读取，避免 app.js 解析时捕获 null。
  function createFillRoomStats(deps) {
    deps = deps || {};
    var getSb = deps.getSb;
    var prefetchRoom = deps.prefetchRoom;
    var msgPreview = deps.msgPreview;
    var roomAccentC = deps.roomAccentC;
    var esc = deps.esc;
    var fmtAgo = deps.fmtAgo;
    var onError = deps.onError || function () {};
    if (typeof getSb !== 'function' || typeof prefetchRoom !== 'function' || typeof msgPreview !== 'function' || typeof roomAccentC !== 'function' || typeof esc !== 'function' || typeof fmtAgo !== 'function') {
      throw new TypeError('[EH_LOBBY] createFillRoomStats missing dependencies');
    }
    return async function fillRoomStats(box, rid) {
      var card = box.querySelector('.ch[data-rid="' + rid + '"]');
      if (!card) return;
      var sb = getSb();
      if (!sb) return;
      var since = new Date(Date.now() - 35000).toISOString();
      var result = await Promise.all([
        sb.from('eh_presence').select('*', { count: 'exact', head: true }).eq('room_id', rid).gte('last_seen', since),
        prefetchRoom(rid, card.dataset.kind || 'official')
      ]);
      var count = result[0] && result[0].count;
      var recent = result[1];
      var online = count || 0;
      var cnt = card.querySelector('.cnt');
      if (cnt) cnt.textContent = online > 0 ? online + ' 人在线' : '暂无人在线';
      var last = (Array.isArray(recent) ? recent.find(function (m) { return m && m.kind !== 'enter'; }) : null) || null;
      var prev = card.querySelector('[data-prev]');
      var tm = card.querySelector('.tm');
      if (last) {
        prev.classList.remove('empty');
        var txt = msgPreview(last);
        var isIx = last.kind === 'interact';
        var nm = isIx ? '' : (last.anon ? '🕳️ 某个回声' : esc(last.name) + ':');
        var nmC = '';
        try {
          if (!last.anon) {
            var roomC = roomAccentC({ name: card.dataset.nm, kind: card.dataset.kind || 'official' });
            var userC = last.color && /^#[0-9a-fA-F]{3,8}$/.test(last.color) ? last.color : null;
            var c = last.is_bot ? roomC : (userC || roomC);
            if (c) nmC = ' style="color:' + c + '"';
          }
        } catch (e) { onError('fillRoomStats', e); }
        prev.innerHTML = (nm ? '<b' + nmC + '>' + nm + '</b> ' : '') + esc(String(txt).slice(0, 40));
        if (tm) tm.textContent = fmtAgo(last.created_at);
      } else {
        prev.classList.add('empty');
        prev.textContent = '还没有人说话，来当第一个';
      }
    };
  }

  // 官方房间列表渲染：Supabase 通过 getter 延迟读取，避免模块初始化早于 bootSupabase。
  function createRenderOfficial(deps) {
    deps = deps || {};
    var getSb = deps.getSb;
    var roomsQuery = deps.roomsQuery;
    var getBox = deps.getBox;
    var chSkel = deps.chSkel;
    var fillRoomStats = deps.fillRoomStats;
    var prefetchAll = deps.prefetchAll;
    var getConfig = deps.getConfig;
    var roomAccentC = deps.roomAccentC;
    var esc = deps.esc;
    var safeEmoji = deps.safeEmoji;
    var bindRoomCards = deps.bindRoomCards;
    if (typeof getSb !== 'function' || typeof roomsQuery !== 'function' || typeof getBox !== 'function' || typeof chSkel !== 'function' || typeof fillRoomStats !== 'function' || typeof prefetchAll !== 'function' || typeof getConfig !== 'function' || typeof roomAccentC !== 'function' || typeof esc !== 'function' || typeof safeEmoji !== 'function' || typeof bindRoomCards !== 'function') {
      throw new TypeError('[EH_LOBBY] createRenderOfficial missing dependencies');
    }
    return async function renderOfficial(soft) {
      var box = getBox();
      if (!box) return { failed: true };
      if (soft && box.querySelector('.ch[data-rid]')) {
        box.querySelectorAll('.ch[data-rid]').forEach(function (c) { fillRoomStats(box, c.dataset.rid); });
        prefetchAll(Array.from(box.querySelectorAll('.ch[data-rid]')).map(function (c) { return { id: c.dataset.rid, kind: 'official' }; }));
        return;
      }
      if (!box.children.length) box.innerHTML = chSkel(4);
      var sb = getSb();
      if (!sb) return { failed: true };
      var result = await roomsQuery(sb.from('eh_rooms').select('id,name,emoji,topic').eq('kind', 'official').order('created_at'));
      if (result.__timeout) return { failed: true };
      var data = result.data;
      var cfg = (getConfig() && getConfig().lobbyDisplay) || {};
      var om = (cfg.official && typeof cfg.official === 'object') ? cfg.official : {};
      var visible = (data || []).map(function (r) { return { r: r, o: om[r.name] || {} }; }).filter(function (x) { return x.o.visible !== false; });
      visible.sort(function (a, b) { return (Number.isFinite(+a.o.order) ? +a.o.order : 9999) - (Number.isFinite(+b.o.order) ? +b.o.order : 9999); });
      box.innerHTML = visible.map(function (x) {
        var r = x.r, o = x.o;
        var c = roomAccentC(Object.assign({}, r, { kind: 'official' }));
        var title = o.title || r.name, desc = o.desc != null ? o.desc : (r.topic || '');
        return '<div class="ch" data-rid="' + r.id + '" data-nm="' + esc(r.name) + '" data-em="' + safeEmoji(r.emoji) + '" data-kind="official" style="--ch-c:' + c + '">' +
          '<div class="tagk">官方</div><div class="icon">' + safeEmoji(r.emoji) + '</div><h3>' + esc(title) + '</h3>' +
          '<div class="desc">' + esc(desc) + '</div><div class="live"><span class="pulse"></span><span class="cnt">…</span><span class="tm"></span></div>' +
          '<div class="preview empty" data-prev>加载中…</div></div>';
      }).join('');
      bindRoomCards(box);
      (data || []).forEach(function (r) { fillRoomStats(box, r.id); });
      prefetchAll((data || []).map(function (r) { return { id: r.id, kind: 'official' }; }));
    };
  }

  // 公开房间列表渲染：Supabase 通过 getter 延迟读取，避免模块初始化早于 bootSupabase。
  function createRenderPublic(deps) {
    deps = deps || {};
    var getSb = deps.getSb;
    var roomsQuery = deps.roomsQuery;
    var getBox = deps.getBox;
    var getEmpty = deps.getEmpty;
    var chSkel = deps.chSkel;
    var fillRoomStats = deps.fillRoomStats;
    var prefetchAll = deps.prefetchAll;
    var getConfig = deps.getConfig;
    var roomAccentC = deps.roomAccentC;
    var esc = deps.esc;
    var safeEmoji = deps.safeEmoji;
    var autoTopic = deps.autoTopic;
    var bindRoomCards = deps.bindRoomCards;
    if (typeof getSb !== 'function' || typeof roomsQuery !== 'function' || typeof getBox !== 'function' || typeof getEmpty !== 'function' || typeof chSkel !== 'function' || typeof fillRoomStats !== 'function' || typeof prefetchAll !== 'function' || typeof getConfig !== 'function' || typeof roomAccentC !== 'function' || typeof esc !== 'function' || typeof safeEmoji !== 'function' || typeof autoTopic !== 'function' || typeof bindRoomCards !== 'function') {
      throw new TypeError('[EH_LOBBY] createRenderPublic missing dependencies');
    }
    return async function renderPublic(soft) {
      var box = getBox();
      var empty = getEmpty();
      if (!box || !empty) return { failed: true };
      if (soft && box.querySelector('.ch[data-rid]')) {
        box.querySelectorAll('.ch[data-rid]').forEach(function (c) { fillRoomStats(box, c.dataset.rid); });
        prefetchAll(Array.from(box.querySelectorAll('.ch[data-rid]')).map(function (c) { return { id: c.dataset.rid, kind: 'public' }; }));
        return;
      }
      if (!box.children.length) box.innerHTML = chSkel(2);
      var sb = getSb();
      if (!sb) return { failed: true };
      var result = await roomsQuery(sb.from('eh_rooms').select('id,name,emoji,topic').eq('kind', 'public').eq('archived', false).order('created_at', { ascending: false }));
      if (result.__timeout) return { failed: true };
      var data = result.data;
      var cfg = (getConfig() && getConfig().lobbyDisplay) || {};
      if (cfg.publicVisible === false) { box.innerHTML = ''; empty.style.display = 'none'; return; }
      if (!data || !data.length) { box.innerHTML = ''; empty.style.display = 'block'; return; }
      empty.style.display = 'none';
      box.innerHTML = data.map(function (r) {
        return '<div class="ch" data-rid="' + r.id + '" data-nm="' + esc(r.name) + '" data-em="' + safeEmoji(r.emoji) + '" data-kind="public" style="--ch-c:' + roomAccentC(Object.assign({}, r, { kind: 'public' })) + '">' +
          '<div class="tagk">公开</div><div class="icon">' + safeEmoji(r.emoji) + '</div><h3>' + esc(r.name) + '</h3>' +
          '<div class="desc">' + esc(r.topic || autoTopic(r.name)) + '</div>' +
          '<div class="live"><span class="pulse"></span><span class="cnt">…</span><span class="tm"></span></div>' +
          '<div class="preview empty" data-prev>加载中…</div></div>';
      }).join('');
      bindRoomCards(box);
      data.forEach(function (r) { fillRoomStats(box, r.id); });
      prefetchAll(data.map(function (r) { return { id: r.id, kind: 'public' }; }));
    };
  }

  // 我的私密房间列表：所有运行时资源均通过 getter／注入依赖读取，避免模块初始化时捕获未 boot 的 sb。
  function createRenderMyRooms(deps) {
    deps = deps || {};
    var getSb = deps.getSb, roomsQuery = deps.roomsQuery, getMyUid = deps.getMyUid;
    var getBox = deps.getBox, getEmpty = deps.getEmpty, rmSkel = deps.rmSkel;
    var prefetchAll = deps.prefetchAll, getConfig = deps.getConfig;
    var esc = deps.esc, safeEmoji = deps.safeEmoji, readKnownOnline = deps.readKnownOnline;
    var enterRoom = deps.enterRoom, copyInvite = deps.copyInvite;
    if (typeof getSb !== 'function' || typeof roomsQuery !== 'function' || typeof getMyUid !== 'function' || typeof getBox !== 'function' || typeof getEmpty !== 'function' || typeof rmSkel !== 'function' || typeof prefetchAll !== 'function' || typeof getConfig !== 'function' || typeof esc !== 'function' || typeof safeEmoji !== 'function' || typeof readKnownOnline !== 'function' || typeof enterRoom !== 'function' || typeof copyInvite !== 'function') {
      throw new TypeError('[EH_LOBBY] createRenderMyRooms missing dependencies');
    }
    return async function renderMyRooms(soft) {
      var myUid = getMyUid(), box = getBox();
      if (!box) return { failed: true };
      if (!myUid) { box.innerHTML = ''; return; }
      if (soft && box.querySelector('.rm[data-rid]')) {
        prefetchAll(Array.from(box.querySelectorAll('.rm[data-rid]')).map(function (c) { return { id: c.dataset.rid, kind: 'private' }; }));
        return;
      }
      if (!box.children.length) box.innerHTML = rmSkel(2);
      var sb = getSb();
      if (!sb) return { failed: true };
      var result = await roomsQuery(sb.from('eh_rooms').select('id,name,emoji,invite_code,owner').eq('kind', 'private').order('created_at', { ascending: false }));
      if (result.__timeout) return { failed: true };
      var data = result.data, cfg = (getConfig() && getConfig().lobbyDisplay) || {}, empty = getEmpty();
      if (cfg.privateVisible === false) { box.innerHTML = ''; if (empty) empty.style.display = 'none'; return; }
      if (!data || !data.length) { box.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
      if (empty) empty.style.display = 'none';
      box.innerHTML = data.map(function (r) {
        return '<div class="rm" data-rid="' + r.id + '" data-nm="' + esc(r.name) + '" data-em="' + safeEmoji(r.emoji) + '" data-kind="private">' +
          '<span class="rm-ic">' + safeEmoji(r.emoji) + '</span><span class="rm-nm">' + esc(r.name) + '</span>' +
          (r.owner === myUid ? '<span class="rm-badge">房主</span>' : '') +
          (r.invite_code ? '<span class="rm-code" data-code="' + esc(r.invite_code) + '" title="点击复制邀请码">' + esc(r.invite_code) + '<svg class="rm-copy-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></span>' : '') +
          '<span class="rm-arr">→</span></div>';
      }).join('');
      box.querySelectorAll('.rm').forEach(function (el) { el.onclick = function () { enterRoom({ id: el.dataset.rid, name: el.dataset.nm, emoji: el.dataset.em, kind: 'private', knownOnline: readKnownOnline(el) }); }; });
      box.querySelectorAll('.rm-code[data-code]').forEach(function (el) { el.onclick = function (e) { e.stopPropagation(); copyInvite(el.dataset.code, el); }; });
      prefetchAll(data.map(function (r) { return { id: r.id, kind: 'private' }; }));
    };
  }

  // 大厅总协调器：身份与 DOM 都在每次渲染时读取，兼容认证和页面元素延迟就绪。
  function createRenderLobby(deps) {
    deps = deps || {};
    var initThemeUI = deps.initThemeUI, getMe = deps.getMe, getNameEl = deps.getNameEl;
    var renderOfficial = deps.renderOfficial, renderPublic = deps.renderPublic, renderMyRooms = deps.renderMyRooms;
    var isLobbyActive = deps.isLobbyActive, showRetry = deps.showRetry;
    var schedule = deps.schedule || setTimeout;
    var retryMax = Number.isFinite(+deps.retryMax) ? +deps.retryMax : 4;
    var retryDelay = Number.isFinite(+deps.retryDelay) ? +deps.retryDelay : 2500;
    if (typeof initThemeUI !== 'function' || typeof getMe !== 'function' || typeof getNameEl !== 'function' || typeof renderOfficial !== 'function' || typeof renderPublic !== 'function' || typeof renderMyRooms !== 'function' || typeof isLobbyActive !== 'function' || typeof showRetry !== 'function' || typeof schedule !== 'function') {
      throw new TypeError('[EH_LOBBY] createRenderLobby missing dependencies');
    }
    var themeUIInit = false, retryTimer = null, retryN = 0;
    async function renderLobby(soft) {
      if (!themeUIInit) { initThemeUI(); themeUIInit = true; }
      var me = getMe() || {};
      var nameEl = getNameEl();
      if (nameEl) { nameEl.textContent = me.name || ''; nameEl.style.color = me.color || ''; }
      var rs = await Promise.all([renderOfficial(soft), renderPublic(soft), renderMyRooms(soft)]);
      var anyFail = rs.some(function (x) { return x && x.failed; });
      if (!anyFail) { retryN = 0; return; }
      if (retryTimer) return;
      if (retryN < retryMax) {
        retryN++;
        retryTimer = schedule(function () {
          retryTimer = null;
          if (isLobbyActive()) renderLobby(false);
        }, retryDelay);
      } else {
        showRetry();
      }
    }
    renderLobby.resetRetry = function () { retryN = 0; };
    return renderLobby;
  }

  // 复制邀请码：浏览器能力与提示函数均通过 getter 延迟读取，兼容非安全上下文及页面初始化顺序。
  function createCopyInvite(deps) {
    deps = deps || {};
    var getNavigator = deps.getNavigator, getDocument = deps.getDocument;
    var getToast = deps.getToast, getConfig = deps.getConfig, getSchedule = deps.getSchedule;
    if (typeof getNavigator !== 'function' || typeof getDocument !== 'function' || typeof getToast !== 'function' || typeof getConfig !== 'function' || typeof getSchedule !== 'function') {
      throw new TypeError('[EH_LOBBY] createCopyInvite missing dependencies');
    }
    function fallbackCopy(text) {
      try {
        var doc = getDocument(), ta = doc.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-999px;opacity:0';
        doc.body.appendChild(ta); ta.select();
        var ok = doc.execCommand('copy');
        doc.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    return function copyInvite(code, el) {
      var cfg = getConfig() || {}, text = cfg.text || {};
      var done = function () {
        if (el) {
          el.classList.add('copied');
          getSchedule()(function () { el.classList.remove('copied'); }, 1200);
        }
        getToast()(text.ok_codeCopied || '邀请码已复制');
      };
      var fail = function () { getToast()(text.err_copyFail || '复制失败，请手动长按'); };
      var nav = getNavigator();
      if (nav && nav.clipboard && nav.clipboard.writeText) {
        nav.clipboard.writeText(code).then(done, function () { fallbackCopy(code) ? done() : fail(); });
      } else { fallbackCopy(code) ? done() : fail(); }
    };
  }

  // 房间卡交互绑定：预取与进房实现可能晚于大厅模块初始化，事件触发时再通过 getter 读取。
  function createBindRoomCards(deps) {
    deps = deps || {};
    var readKnownOnline = deps.readKnownOnline;
    var getPrefetchRoom = deps.getPrefetchRoom;
    var getEnterRoom = deps.getEnterRoom;
    if (typeof readKnownOnline !== 'function' || typeof getPrefetchRoom !== 'function' || typeof getEnterRoom !== 'function') {
      throw new TypeError('[EH_LOBBY] createBindRoomCards missing dependencies');
    }
    return function bindRoomCards(box) {
      box.querySelectorAll('.ch').forEach(function (el) {
        var room = { id: el.dataset.rid, name: el.dataset.nm, emoji: el.dataset.em, kind: el.dataset.kind };
        room.knownOnline = readKnownOnline(el);
        var prefetch = function () {
          var prefetchRoom = getPrefetchRoom();
          if (typeof prefetchRoom === 'function') prefetchRoom(room.id, room.kind);
        };
        el.addEventListener('pointerenter', prefetch);
        el.addEventListener('touchstart', prefetch, { passive: true });
        el.onclick = function () {
          var enterRoom = getEnterRoom();
          if (typeof enterRoom === 'function') enterRoom(room);
        };
      });
    };
  }

  root.EH_LOBBY_MODULE = Object.freeze({ createLobbyController: createLobbyController, chSkel: chSkel, rmSkel: rmSkel, fmtAgo: fmtAgo, optimisticCnt: optimisticCnt, readKnownOnline: readKnownOnline, createLobbyShowRetry: createLobbyShowRetry, createPrefetch: createPrefetch, createRoomAccentC: createRoomAccentC, createRoomsQuery: createRoomsQuery, createFillRoomStats: createFillRoomStats, createRenderOfficial: createRenderOfficial, createRenderPublic: createRenderPublic, createRenderMyRooms: createRenderMyRooms, createRenderLobby: createRenderLobby, createCopyInvite: createCopyInvite, createBindRoomCards: createBindRoomCards });
})(window);
