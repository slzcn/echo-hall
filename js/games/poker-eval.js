// ============================================================
// poker-eval.js — 德州扑克成手牌评估 + 比较（纯函数，无 DOM/网络）
// ------------------------------------------------------------
//   · 输入 5~7 张牌 {rank:2..14, suit:'♠♥♣♦'}(2 最小, A=14 最大 —— 扑克序,
//     与 deck.js「2 大于 A」的甩牌序不同, 故扑克自带一套 rank)。
//   · evaluate(cards) → {cat, tie[], name}: cat 为牌型档(0 高牌…8 同花顺),
//     tie[] 为同档内的破平序(点数降序), 二者按字典序即可比大小。
//   · compare(a,b) → -1/0/1; A-2-3-4-5「轮抽」顺子按 5 高处理。
//   · 7 张里自动取最优 5 张组合(直接按计数/顺/花分析, 统一处理 5~7 张)。
//   双模块:浏览器挂 window.EHPokerEval;node 走 module.exports(供 ci-check 单测)。
// ============================================================
(function(root, factory){
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.EHPokerEval = mod;
})(this, function(){
  'use strict';

  // 牌型档(大→小的数值, 直接比大小)
  const CAT = { SF:8, QUADS:7, FULL:6, FLUSH:5, STRAIGHT:4, TRIPS:3, TWO_PAIR:2, PAIR:1, HIGH:0 };
  const CAT_NAME = { 8:'同花顺', 7:'四条', 6:'葫芦', 5:'同花', 4:'顺子', 3:'三条', 2:'两对', 1:'一对', 0:'高牌' };

  // 给定「出现过的点数集合」, 返回最佳顺子的最高牌(无顺返回 0)。
  //   A 既可作 14(高)也可作 1(轮抽 A-2-3-4-5 → 高牌为 5)。
  function straightHigh(rankSet){
    const p = {};
    rankSet.forEach(r => { p[r] = true; if (r === 14) p[1] = true; });   // A 兼作 1
    for (let hi = 14; hi >= 5; hi--){
      if (p[hi] && p[hi-1] && p[hi-2] && p[hi-3] && p[hi-4]) return hi;
    }
    return 0;
  }

  function mk(cat, tie){ return { cat, tie, name: CAT_NAME[cat] }; }

  // 评估 5~7 张, 返回最优成手牌的 {cat, tie, name}。
  function evaluate(cards){
    if (!cards || cards.length < 5) throw new Error('poker-eval: 至少需要 5 张');
    const byRank = {}, bySuit = {};
    for (const c of cards){
      byRank[c.rank] = (byRank[c.rank] || 0) + 1;
      (bySuit[c.suit] = bySuit[c.suit] || []).push(c.rank);
    }
    // 同花花色(7 张里至多一门能凑齐 5)
    let flushSuit = null;
    for (const s in bySuit){ if (bySuit[s].length >= 5){ flushSuit = s; break; } }

    // ① 同花顺: 只在同花那门里找顺
    if (flushSuit){
      const sf = straightHigh(new Set(bySuit[flushSuit]));
      if (sf) return mk(CAT.SF, [sf]);
    }

    const ranks = Object.keys(byRank).map(Number);
    // 按「张数降序、点数降序」排组: groups[0] 是最多且最大的点
    const groups = ranks.slice().sort((a, b) => (byRank[b] - byRank[a]) || (b - a));
    const c0 = byRank[groups[0]];

    // ② 四条
    if (c0 === 4){
      const quad = groups[0];
      const kicker = Math.max(...ranks.filter(r => r !== quad));
      return mk(CAT.QUADS, [quad, kicker]);
    }
    // ③ 葫芦: 三条 + 另一组(对/第二个三条)
    if (c0 === 3){
      for (let i = 1; i < groups.length; i++){
        if (byRank[groups[i]] >= 2) return mk(CAT.FULL, [groups[0], groups[i]]);
      }
    }
    // ④ 同花(非同花顺): 取该门最大 5 张
    if (flushSuit){
      const top5 = bySuit[flushSuit].slice().sort((a, b) => b - a).slice(0, 5);
      return mk(CAT.FLUSH, top5);
    }
    // ⑤ 顺子(跨花色)
    const sh = straightHigh(new Set(ranks));
    if (sh) return mk(CAT.STRAIGHT, [sh]);
    // ⑥ 三条
    if (c0 === 3){
      const trip = groups[0];
      const ks = ranks.filter(r => r !== trip).sort((a, b) => b - a).slice(0, 2);
      return mk(CAT.TRIPS, [trip, ...ks]);
    }
    // ⑦ 两对 / ⑧ 一对
    const pairs = ranks.filter(r => byRank[r] === 2).sort((a, b) => b - a);
    if (pairs.length >= 2){
      const kicker = Math.max(...ranks.filter(r => r !== pairs[0] && r !== pairs[1]));
      return mk(CAT.TWO_PAIR, [pairs[0], pairs[1], kicker]);
    }
    if (pairs.length === 1){
      const ks = ranks.filter(r => r !== pairs[0]).sort((a, b) => b - a).slice(0, 3);
      return mk(CAT.PAIR, [pairs[0], ...ks]);
    }
    // ⑨ 高牌
    const top5 = ranks.slice().sort((a, b) => b - a).slice(0, 5);
    return mk(CAT.HIGH, top5);
  }

  // 两个 evaluate() 结果比较: a<b→-1, a=b→0, a>b→1。
  function compare(a, b){
    if (a.cat !== b.cat) return a.cat < b.cat ? -1 : 1;
    const n = Math.max(a.tie.length, b.tie.length);
    for (let i = 0; i < n; i++){
      const x = a.tie[i] || 0, y = b.tie[i] || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }
  // 便捷: 直接比两手牌(各 5~7 张)
  function compareCards(ca, cb){ return compare(evaluate(ca), evaluate(cb)); }

  return { CAT, CAT_NAME, straightHigh, evaluate, compare, compareCards };
});
