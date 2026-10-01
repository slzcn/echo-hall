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
  var GRANT = 5000;
  var PK_MIN = 1000;
  var DAY_KEY = 'eh_daily_plays_v1';
  var DAY_MAX = 5;

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
    function keyOf(game, subject) {
      return game + ':' + (subject || uid());
    }
    function get(game) { return getOf(game, uid()); }
    function getOf(game, subject) {
      var store = all();
      var key = keyOf(game, subject);
      var rec = store[key];
      if (!rec || typeof rec !== 'object') {
        rec = { chips: null, net: 0, plays: 0, wins: 0 };
        try {
          // 仅本人兼容旧全局键; 灵魂/其他真人从 GRANT 起
          if (!subject || subject === uid()) {
            if (game === 'nlhe') {
              var v = parseInt(localStorage.getItem(PK_LEGACY), 10);
              if (Number.isFinite(v)) rec.chips = v;
            }
            if (game === 'doudizhu') {
              var w = parseInt(localStorage.getItem(DDZ_LEGACY), 10);
              if (Number.isFinite(w)) rec.net = w;
            }
          }
        } catch (e) {}
        store[key] = rec; write(store);
      }
      return rec;
    }
    function set(game, patch) { return setOf(game, uid(), patch); }
    function setOf(game, subject, patch) {
      var store = all();
      var key = keyOf(game, subject);
      var prev = getOf(game, subject);
      var next = Object.assign({}, prev, patch || {});
      store[key] = next; write(store);
      var self = !subject || subject === uid();
      if (self) {
        try {
          if (game === 'doudizhu') localStorage.setItem(DDZ_LEGACY, String(next.chips || 0));
          // ★v57 Bug7: nlhe 筹码改为 Supabase 全局账户(eh_user_stats.chips), 不再写 localStorage eh_pk_chips
        } catch (e) {}
      }
      return next;
    }
    function chips(game, grant) { return chipsOf(game, uid(), grant); }
    function chipsOf(game, subject, grant) {
      var grantN = Number.isFinite(+grant) ? +grant : GRANT;
      var minN = (game === 'nlhe') ? PK_MIN : 0;
      var rec = getOf(game, subject);
      var c = (rec && typeof rec.chips === 'number') ? rec.chips : null;
      if (c == null && game === 'doudizhu') c = rec.net || 0;
      // 清零/破产: nlhe 低于买入门槛 → 回补 GRANT(1000); 其他游戏允许 0 分继续累计
      if (c == null || (game === 'nlhe' && c < minN)) return grantN;
      return Math.max(0, Math.round(c));
    }
    function bump(game, delta, won) { return bumpOf(game, uid(), delta, won); }
    function bumpOf(game, subject, delta, won) {
      var rec = getOf(game, subject);
      var d = Math.round(Number(delta) || 0);
      var base = (typeof rec.chips === 'number') ? rec.chips : (game === 'doudizhu' ? (rec.net || 0) : GRANT);
      var c = Math.round(base + d);
      var patch = { net: Math.round((rec.net || 0) + d), plays: (rec.plays || 0) + 1 };
      if (won) patch.wins = (rec.wins || 0) + 1;
      if (game === 'nlhe') patch.chips = c < PK_MIN ? GRANT : c;
      else patch.chips = c;
      return setOf(game, subject, patch);
    }
    function openOpts(game, grant) {
      var c = chips(game, grant);
      return {
        chips: c,
        onWallet: function (v) {
          var n = Math.max(0, Math.round(Number(v) || 0));
          set(game, { chips: n });
          // ★v57 Bug7: nlhe 筹码走 Supabase 全局账户(app.js gtSettleChipsToGlobal), 不再写 localStorage eh_pk_chips
          if (game === 'doudizhu') { try { localStorage.setItem(DDZ_LEGACY, String(n)); } catch (e) {} }
        },
      };
    }
    function dayKey() {
      var d = new Date();
      return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }
    // ★主人反馈: 德州打满/输光 5 次后斗地主/掼蛋也被锁 — 每日上限改为【分游戏】独立计数。
    //   服务端 eh_game_plays 为权威；app.js 用 setDailyFromServer 按天灌入本地缓存供同步读取。
    //   { date, nlhe:n, doudizhu:n, guandan:n }; 兼容旧 {date,n} 视作 nlhe。
    var _serverDaily = null;   // { date:'YYYY-MM-DD', nlhe:n, doudizhu:n, guandan:n }
    function setDailyFromServer(map) {
      var d = dayKey();
      _serverDaily = { date: d, nlhe: 0, doudizhu: 0, guandan: 0 };
      if (map && typeof map === 'object') {
        ['nlhe', 'doudizhu', 'guandan'].forEach(function (g) {
          var n = parseInt(map[g], 10);
          if (Number.isFinite(n) && n >= 0) _serverDaily[g] = n;
        });
      }
      return _serverDaily;
    }
    function _dailyStore() {
      if (_serverDaily && _serverDaily.date === dayKey()) return _serverDaily;
      try {
        var o = JSON.parse(localStorage.getItem(DAY_KEY) || 'null');
        if (o && o.date === dayKey() && typeof o === 'object') return o;
      } catch (e) {}
      return { date: dayKey() };
    }
    function dailyPlays(game) {
      var o = _dailyStore();
      var g = game || 'nlhe';
      if (typeof o[g] === 'number') return o[g];
      if (typeof o.n === 'number') return o.n;   // 旧全局计数仅归 nlhe
      return 0;
    }
    function dailyPlayBump(game) {
      // 服务端 insert 后由 setDailyFromServer 回填；这里只乐观 +1, 免 UI 要等一轮网络。
      // 基于当前 _dailyStore() 复制再 +1, 不新建空对象 —— 否则刷新前 bump 会把其它游戏计数清零。
      var g = game || 'nlhe';
      var base = _dailyStore();
      var next = { date: dayKey(), nlhe: 0, doudizhu: 0, guandan: 0 };
      ['nlhe', 'doudizhu', 'guandan'].forEach(function (k) {
        var n = parseInt(base[k], 10);
        if (!Number.isFinite(n) && k === 'nlhe') n = parseInt(base.n, 10);
        if (Number.isFinite(n) && n > 0) next[k] = n;
      });
      if (typeof next[g] !== 'number') next[g] = 0;
      next[g] += 1;
      _serverDaily = next;
      return next[g];
    }
    function dailyPlayReached(game) { return dailyPlays(game) >= DAY_MAX; }
    function dailyPlayLeft(game) { return Math.max(0, DAY_MAX - dailyPlays(game)); }
    return Object.freeze({
      GRANT: GRANT, PK_MIN: PK_MIN, KEY: KEY, DAY_MAX: DAY_MAX, DAY_KEY: DAY_KEY,
      uid: uid, get: get, set: set, chips: chips, bump: bump, openOpts: openOpts,
      getOf: getOf, setOf: setOf, chipsOf: chipsOf, bumpOf: bumpOf,
      dailyPlays: dailyPlays, dailyPlayBump: dailyPlayBump,
      dailyPlayReached: dailyPlayReached, dailyPlayLeft: dailyPlayLeft,
      setDailyFromServer: setDailyFromServer,
      migrateFromLocalAnon: migrateFromLocalAnon,
    });
  }

  root.EH_SCORE_MODULE = Object.freeze({ createScoreBank: createScoreBank });
})(typeof window !== 'undefined' ? window : this);
