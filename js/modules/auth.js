/*
 * auth.js — 认证纯逻辑(第 3 阶段实现)
 * journey-exempt: journey-auth-bgm-features.js
 */
(function (root) {
  'use strict';
  function required(name, value) {
    if (typeof value !== 'function') throw new TypeError('[EH_AUTH] missing ' + name);
    return value;
  }
  function isRegisteredSession(session) {
    return !!(session && session.user && session.user.email);
  }
  function sessionUid(session) {
    return (session && session.user && session.user.id) || null;
  }
  // 纯临时身份(登录前选好的名字)是否应重掷: 残留正式账号标记才重掷
  function shouldRerollIdentity(me) {
    if (!me) return false;
    return !!(me.registered || me.username || me.email);
  }
  function stripRegFlags(me) {
    if (!me || typeof me !== 'object') return me || {};
    var out = Object.assign({}, me);
    delete out.registered;
    delete out.username;
    delete out.email;
    return out;
  }
  function canResumeAfterAuth(opts) {
    opts = opts || {};
    return !!(opts.myUid && opts.enterOrHall);
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
      isRegisteredSession: isRegisteredSession,
      sessionUid: sessionUid,
      shouldRerollIdentity: shouldRerollIdentity,
      stripRegFlags: stripRegFlags,
      canResumeAfterAuth: canResumeAfterAuth,
    });
  }
  var api = Object.freeze({
    createAuthController: createAuthController,
    isRegisteredSession: isRegisteredSession,
    sessionUid: sessionUid,
    shouldRerollIdentity: shouldRerollIdentity,
    stripRegFlags: stripRegFlags,
    canResumeAfterAuth: canResumeAfterAuth,
  });
  if (root) root.EH_AUTH_MODULE = api;
  return api;
})((typeof window !== 'undefined') ? window : ((typeof globalThis !== 'undefined') ? globalThis : this));
if (typeof module !== 'undefined' && module.exports) module.exports = (typeof window !== 'undefined' ? window.EH_AUTH_MODULE : null) || (typeof globalThis !== 'undefined' ? globalThis.EH_AUTH_MODULE : null);
