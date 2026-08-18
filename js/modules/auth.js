/*
 * Echo Hall 认证模块契约（第 3 阶段）。
 * 迁移期只负责定义依赖注入边界；实现仍由 app.js 提供。
 * 后续迁移 authApi/awaitSb/resolveSession/ensureAuth 时，不需要改 boot.js、dm.js 的调用方。
 */
(function (root) {
  'use strict';

  function required(name, value) {
    if (typeof value !== 'function') {
      throw new TypeError('[EH_AUTH] missing dependency: ' + name);
    }
    return value;
  }

  function createAuthController(deps) {
    deps = deps || {};
    return Object.freeze({
      api: required('api', deps.api),
      awaitReady: required('awaitReady', deps.awaitReady),
      resolveSession: required('resolveSession', deps.resolveSession),
      ensure: required('ensure', deps.ensure),
      saveIdentity: required('saveIdentity', deps.saveIdentity),
      loadOrRollIdentity: required('loadOrRollIdentity', deps.loadOrRollIdentity),
      logout: required('logout', deps.logout),
    });
  }

  root.EH_AUTH_MODULE = Object.freeze({ createAuthController: createAuthController });
})(window);
