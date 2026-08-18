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

  root.EH_LOBBY_MODULE = Object.freeze({ createLobbyController: createLobbyController, chSkel: chSkel, rmSkel: rmSkel });
})(window);
