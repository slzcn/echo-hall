// ═══════════════════════════════════════════════════════════════════════════════
// 游戏引擎懒加载器 EHGameLoader
// 目的:大厅首屏只加载 lobby/core,三个游戏引擎(共 15 个文件)延后到"用户点桌开局"那一刻按需加载
// 收益:弱网首屏减 15 个并行 script 请求(每个游戏 5 个:rules+engine+ai+net+ui)
// 契约:
//   window.EHGameLoader.ensure('poker'|'guandan'|'ddz') → Promise<void>,resolve 后全局 EHXxxGame/EHXxxNet 就绪
//   已加载过的游戏直接 resolve(缓存),同一游戏并发调用共享同一个 Promise
//   加载失败自动重试一次(切 unpkg 兜底),仍失败 reject(调用方 toast 提示)
// 时序安全:游戏文件按依赖顺序串行 append,每个脚本 onload 才进下一个,避免依赖未定义
(function (root) {
  'use strict';
  var VER = (root.__EH_APP_VER || 'lazy1');   // 复用主版本号做指纹,主版本换清缓存自动生效
  var loaded = {};        // {poker: Promise, guandan: Promise, ddz: Promise}

  // 每个游戏依赖的文件(按加载顺序,前提依赖在前)
  var MANIFEST = {
    poker:   ['./js/games/poker-eval.js',     './js/games/poker-engine.js',   './js/games/poker-ai.js',   './js/games/poker-net.js',   './js/games/poker-ui.js'],
    guandan: ['./js/games/guandan-rules.js',  './js/games/guandan-engine.js', './js/games/guandan-ai.js', './js/games/guandan-net.js', './js/games/guandan-ui.js'],
    ddz:     ['./js/games/ddz-rules.js',      './js/games/ddz-engine.js',     './js/games/ddz-ai.js',     './js/games/ddz-net.js',     './js/games/game-ui.js']
  };

  // 加载完成后必须存在的全局(用来判断加载是否真成功,防脚本 200 但内容空)
  var READY_MARK = {
    poker:   ['EHPokerEval', 'EHPokerEngine', 'EHPokerAI', 'EHPokerNet', 'EHPokerGame'],
    guandan: ['EHGuandanRules', 'EHGuandanEngine', 'EHGuandanAI', 'EHGuandanNet', 'EHGuandanGame'],
    ddz:     ['EHDdzRules', 'EHDdzEngine', 'EHDdzAI', 'EHDdzNet', 'EHDdzGame']
  };

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src + (src.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(VER);
      s.async = false;   // 保加载顺序:多次 append 时按顺序执行(异于 defer)
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('script load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadSequential(list) {
    var p = Promise.resolve();
    list.forEach(function (src) { p = p.then(function () { return loadScript(src); }); });
    return p;
  }

  function verifyReady(kind) {
    var marks = READY_MARK[kind] || [];
    for (var i = 0; i < marks.length; i++) {
      if (typeof root[marks[i]] === 'undefined') {
        throw new Error('game ' + kind + ' loaded but global ' + marks[i] + ' missing');
      }
    }
  }

  function ensure(kind) {
    if (!MANIFEST[kind]) return Promise.reject(new Error('unknown game kind: ' + kind));
    // 已加载:立即 resolve;并发中:共享同一 Promise
    if (loaded[kind]) return loaded[kind];
    loaded[kind] = loadSequential(MANIFEST[kind])
      .then(function () { verifyReady(kind); })
      .catch(function (err) {
        // 失败:清缓存让下次点桌可重试;不做自动重试(避免恶性循环,调用方 toast 引导刷新)
        delete loaded[kind];
        throw err;
      });
    return loaded[kind];
  }

  // 便利:一次性判断是否已就绪(同步,给需要"点了就用"的路径快判)
  function isReady(kind) {
    var marks = READY_MARK[kind] || [];
    for (var i = 0; i < marks.length; i++) {
      if (typeof root[marks[i]] === 'undefined') return false;
    }
    return true;
  }

  root.EHGameLoader = { ensure: ensure, isReady: isReady };
})(window);
