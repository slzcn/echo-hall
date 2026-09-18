/*
 * score.js — 游戏积分/筹码本地账本(按 uid)
 * 迁移自 app.js: 跨桌/跨会话累计德州筹码与三游戏生涯 net/plays/wins。
 * app.js 注入 getUid() 后, 兼容旧函数名 bankGet/bankSet/... 继续工作。
 */
(function (root) {
  'use strict';
  var KEY = 'eh_bank_v1';
  var PK_LEGACY = 'eh_pk_chips';
  var DDZ_LEGACY = 'eh_ddz_score';
  var GRANT = 1000;
  var PK_MIN = 100;

  function required(name, v) {
    if (typeof v !== 'function') throw new TypeError('[EH_SCORE] missing ' + name);
    return v;
  }

  function createScoreBank(deps) {
    deps = deps || {};
    var getUid = required('getUid', deps.getUid);
    function uid() {
      var u = getUid() || 'local-anon';
      if (u !== 'local-anon' && !uid._mig) {
        uid._mig = true;
        try { migrateFromLocalAnon(); } catch (e) {}
      }
      return u;
    }
    function all() {
      try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function write(a) {
      try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {}
    }
    function migrateFromLocalAnon() {
      var id = getUid();
      if (!id || id === 'local-anon') return;
      var st = all(), touched = false;
      Object.keys(st).forEach(function (k) {
        var m = /^(.+):local-anon$/.exec(k);
        if (!m) return;
        var dest = m[1] + ':' + id;
        if (!st[dest]) { st[dest] = st[k]; touched = true; }
      });
      if (touched) write(st);
    }
    function get(game) {
      var id = uid();
      var store = all();
      var key = game + ':' + id;
      var rec = store[key];
      if (!rec || typeof rec !== 'object') {
        rec = { chips: null, net: 0, plays: 0, wins: 0 };
        try {
          if (game === 'nlhe') {
            var v = parseInt(localStorage.getItem(PK_LEGACY), 10);
            if (Number.isFinite(v)) rec.chips = v;
          }
          if (game === 'doudizhu') {
            var w = parseInt(localStorage.getItem(DDZ_LEGACY), 10);
            if (Number.isFinite(w)) rec.net = w;
          }
        } catch (e) {}
        store[key] = rec; write(store);
      }
      return rec;
    }
    function set(game, patch) {
      var id = uid();
      var store = all();
      var key = game + ':' + id;
      var prev = get(game);
      var next = Object.assign({}, prev, patch || {});
      store[key] = next; write(store);
      return next;
    }
    function chips(game, grant) {
      var grantN = Number.isFinite(+grant) ? +grant : GRANT;
      var minN = (game === 'nlhe') ? PK_MIN : 0;
      var rec = get(game);
      var c = (rec && typeof rec.chips === 'number') ? rec.chips : null;
      if (c == null && game === 'doudizhu') c = rec.net || 0;
      if (c == null || (game === 'nlhe' && c < minN)) return grantN;
      return Math.max(0, Math.round(c));
    }
    function bump(game, delta, won) {
      var rec = get(game);
      var d = Math.round(Number(delta) || 0);
      var base = (typeof rec.chips === 'number') ? rec.chips : (game === 'doudizhu' ? (rec.net || 0) : GRANT);
      var c = Math.round(base + d);
      var patch = { net: Math.round((rec.net || 0) + d), plays: (rec.plays || 0) + 1 };
      if (won) patch.wins = (rec.wins || 0) + 1;
      if (game === 'nlhe') patch.chips = c < PK_MIN ? GRANT : c;
      else patch.chips = c;
      var next = set(game, patch);
      try {
        if (game === 'doudizhu') localStorage.setItem(DDZ_LEGACY, String(next.chips || 0));
        if (game === 'nlhe') localStorage.setItem(PK_LEGACY, String(next.chips || GRANT));
      } catch (e) {}
      return next;
    }
    function openOpts(game, grant) {
      var c = chips(game, grant);
      return {
        chips: c,
        onWallet: function (v) {
          var n = Math.max(0, Math.round(Number(v) || 0));
          set(game, { chips: n });
          if (game === 'nlhe') { try { localStorage.setItem(PK_LEGACY, String(n)); } catch (e) {} }
          if (game === 'doudizhu') { try { localStorage.setItem(DDZ_LEGACY, String(n)); } catch (e) {} }
        },
      };
    }
    return Object.freeze({
      GRANT: GRANT, PK_MIN: PK_MIN, KEY: KEY,
      uid: uid, get: get, set: set, chips: chips, bump: bump, openOpts: openOpts,
      migrateFromLocalAnon: migrateFromLocalAnon,
    });
  }

  root.EH_SCORE_MODULE = Object.freeze({ createScoreBank: createScoreBank });
})(typeof window !== 'undefined' ? window : this);
