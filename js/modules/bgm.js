/*
 * Echo Hall BGM 模块契约（第 4 阶段）。
 * 迁移期只定义依赖注入边界；播放实现仍由 app.js 提供。
 * 目标：后续迁移时不再让 BGM 直接读取 curRoom、EH_CONFIG、AudioEngine 等隐式全局。
 */
(function (root) {
  'use strict';

  function required(name, value) {
    if (typeof value !== 'function' && value == null) {
      throw new TypeError('[EH_BGM] missing dependency: ' + name);
    }
    return value;
  }

  function createBgmController(deps) {
    deps = deps || {};
    return Object.freeze({
      on: required('on', deps.on),
      set: required('set', deps.set),
      init: required('init', deps.init),
      buildMenu: required('buildMenu', deps.buildMenu),
      startLobby: required('startLobby', deps.startLobby),
      startRoom: required('startRoom', deps.startRoom),
      playAI: required('playAI', deps.playAI),
      playLegacy: required('playLegacy', deps.playLegacy),
      generate: required('generate', deps.generate),
    });
  }

  root.EH_BGM_MODULE = Object.freeze({ createBgmController: createBgmController });
})(window);
