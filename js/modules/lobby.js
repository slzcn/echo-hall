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

  // 带依赖注入的预取工厂：由 app.js 把 sb、缓存对象、调优参数、灵魂预取函数传进来，
  // 避免直接读取 window 隐式全局，后续改变依赖不用改模块。
  function createPrefetch(deps) {
    deps = deps || {};
    var sb = deps.sb;
    var prefetchCache = deps.prefetchCache;
    var prefetchSouls = deps.prefetchSouls;
    var readN = deps.readN;
    var readTtl = deps.readTtl;
    if (!sb || !prefetchCache || typeof prefetchSouls !== 'function' || typeof readN !== 'function' || typeof readTtl !== 'function') {
      throw new TypeError('[EH_LOBBY] createPrefetch missing dependencies');
    }
    function prefetchRoom(rid, kind) {
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

  root.EH_LOBBY_MODULE = Object.freeze({ createLobbyController: createLobbyController, chSkel: chSkel, rmSkel: rmSkel, createPrefetch: createPrefetch });
})(window);
