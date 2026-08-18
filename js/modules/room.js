/*
 * Echo Hall 房间模块契约（第 5 阶段）。
 * 迁移期由 app.js 注入实现；统一进房、离房和房间状态边界。
 */
(function (root) {
  'use strict';
  function required(name, value) {
    if (typeof value !== 'function') throw new TypeError('[EH_ROOM] missing dependency: ' + name);
    return value;
  }
  function createRoomController(deps) {
    deps = deps || {};
    return Object.freeze({
      enter: required('enter', deps.enter),
      back: required('back', deps.back),
      leave: required('leave', deps.leave),
      clearLast: required('clearLast', deps.clearLast),
    });
  }
  root.EH_ROOM_MODULE = Object.freeze({ createRoomController: createRoomController });
})(window);
