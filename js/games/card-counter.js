// card-counter.js — 记牌器/出牌历史的纯计算内核(斗地主·掼蛋共用, 无 DOM/网络)。
// 数据源【只用已出牌】: 从引擎 state.log 的 {t:'play',cards:[id...]} 累计, 绝不读任何人当前手牌 ——
//   这是"信息辅助"而非开天眼: 记牌器展示的每一张都是全场都看得见的公共出牌(状态忠实, 不泄底)。
//   联机 guest 快照按命门剥离了 log(见 ddz-net/guandan-net), 故上层只在纯单机(mode==='local')挂它。
// 牌 id 约定(见 deck.js): 普通 "<花色><rank>"(如 s14=A), 王 js(小)/jb(大); 掼蛋第二副 id 尾带 'x'。
(function (root) {
  'use strict';

  // id → rank 数值(3..10, J=11 Q=12 K=13 A=14 2=15, 小王=16 大王=17)。尾缀 'x'(第二副)不影响。
  function rankOfId(id) {
    if (!id) return null;
    if (id[0] === 'j') return id[1] === 'b' ? 17 : 16;   // jb=大王, js=小王
    const m = /(\d+)/.exec(id);                          // s14 / s14x → 14
    return m ? +m[1] : null;
  }

  const LABEL = { 3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A',15:'2',16:'小王',17:'大王' };
  // 展示序: 大 → 小(与手牌一致, 玩家扫一眼先看大牌还剩几张)。
  const ORDER = [17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3];

  // 每个 rank 在【一副】牌里的张数: 普通 4, 王 1。decks 副 → ×decks(斗地主 1 副, 掼蛋 2 副)。
  function totalOf(rank, decks) { return (rank >= 16 ? 1 : 4) * decks; }

  // 遍历 log 累计每个 rank 已出的张数。
  function tally(log) {
    const played = {};
    for (const e of (log || [])) {
      if (e && e.t === 'play' && e.cards) {
        for (const id of e.cards) { const r = rankOfId(id); if (r != null) played[r] = (played[r] || 0) + 1; }
      }
    }
    return played;
  }

  // 记牌器数据: 大→小每个 rank 的 {rank,label,remain(未出),total(全副)}。remain 含我自己手牌(经典口径)。
  function remaining(log, decks) {
    const d = decks || 1;
    const played = tally(log);
    return ORDER.map(r => ({ rank: r, label: LABEL[r], remain: totalOf(r, d) - (played[r] || 0), total: totalOf(r, d) }));
  }

  // 出牌历史: 取 play/pass, 倒序(最近在前)取最后 n 条; play 附带出牌的 rank 标签列表。
  function history(log, names, n) {
    const acts = [];
    for (const e of (log || [])) { if (e && (e.t === 'play' || e.t === 'pass')) acts.push(e); }
    return acts.slice(-(n || 8)).reverse().map(e => ({
      seat: e.seat,
      name: (names && names[e.seat]) || ('席' + e.seat),
      kind: e.t,
      labels: e.t === 'play' ? e.cards.map(id => LABEL[rankOfId(id)]) : null,
    }));
  }

  root.EHCardCounter = { rankOfId, LABEL, ORDER, totalOf, remaining, history };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = (typeof window !== 'undefined' ? window : globalThis).EHCardCounter;
