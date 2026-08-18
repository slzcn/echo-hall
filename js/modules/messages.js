/*
 * Echo Hall 消息模块契约（第 5 阶段）。
 * 迁移期由 app.js 注入实现；统一实时订阅、历史加载和快照尾部刷新边界。
 */
(function (root) {
  'use strict';
  function required(name, value) {
    if (typeof value !== 'function') throw new TypeError('[EH_MESSAGES] missing dependency: ' + name);
    return value;
  }
  function createMessagesController(deps) {
    deps = deps || {};
    return Object.freeze({
      subscribe: required('subscribe', deps.subscribe),
      loadHistory: required('loadHistory', deps.loadHistory),
      refreshSnapshotTail: required('refreshSnapshotTail', deps.refreshSnapshotTail),
      buildMessage: required('buildMessage', deps.buildMessage),
      persistSnapshot: required('persistSnapshot', deps.persistSnapshot),
    });
  }
  root.EH_MESSAGES_MODULE = Object.freeze({ createMessagesController: createMessagesController });
})(window);
