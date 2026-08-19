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

  root.EH_LOBBY_MODULE = Object.freeze({ createLobbyController: createLobbyController, chSkel: chSkel, rmSkel: rmSkel, createPrefetch: createPrefetch, createFillRoomStats: createFillRoomStats, createRenderOfficial: createRenderOfficial, createRenderPublic: createRenderPublic });
})(window);
