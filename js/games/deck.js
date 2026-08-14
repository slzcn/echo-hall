// ============================================================
// deck.js — 牌模型 + 可复现洗牌 + 发牌（纯函数，无 DOM/网络）
// ------------------------------------------------------------
// 设计要点（权威引擎地基）：
//   · 洗牌确定性:给定同一 seed → 同一牌序。客户端用 crypto 生成真随机 seed,
//     但洗牌本身可复现 → 只需存 seed 即可服务端复核记分 + 回看重放。
//   · 纯函数、无副作用:同一份代码既跑浏览器(vs AI),又搬进 Edge(真人裁判)。
//   · 双模块:浏览器挂 window.EHDeck;node 走 module.exports(供 ci-check 单测)。
// ============================================================
(function(root, factory){
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;   // node/单测
  if (typeof window !== 'undefined') window.EHDeck = mod;                       // 浏览器
})(this, function(){
  'use strict';

  // ── 牌面常量 ───────────────────────────────────────────────
  // rank 数值化便于比较:3..10 → 3..10, J=11 Q=12 K=13 A=14 2=15, 小王=16 大王=17
  // 斗地主/掼蛋都用「2 大于 A」这套；掼蛋级牌另在其引擎里动态抬权,不改这里。
  const RANKS = [3,4,5,6,7,8,9,10,11,12,13,14,15]; // 3..2
  const RANK_LABEL = {3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A',15:'2',16:'w',17:'W'};
  const SUITS = ['♠','♥','♣','♦'];
  const SUIT_KEY = {'♠':'s','♥':'h','♣':'c','♦':'d'};

  // 唯一 id:普通牌 "<suitKey><rank>"(如 s14=黑桃A);王 "js"(小)/"jb"(大)。
  // 掼蛋两副牌 → id 再带副次后缀(在掼蛋发牌里加),这里给单副牌基础。
  function makeCard(rank, suit){
    const isJoker = rank >= 16;
    return {
      rank,
      suit: isJoker ? null : suit,
      joker: isJoker ? (rank === 17 ? 'big' : 'small') : null,
      label: RANK_LABEL[rank],
      id: isJoker ? (rank === 17 ? 'jb' : 'js') : (SUIT_KEY[suit] + rank),
    };
  }

  // 一副标准 54 张(52 + 大小王)
  function standardDeck(){
    const cards = [];
    for (const r of RANKS) for (const s of SUITS) cards.push(makeCard(r, s));
    cards.push(makeCard(16, null)); // 小王
    cards.push(makeCard(17, null)); // 大王
    return cards;
  }

  // ── 可复现随机源 ───────────────────────────────────────────
  // mulberry32:32 位确定性 PRNG。种子相同 → 序列相同(复核/回看的根)。
  function mulberry32(seed){
    let a = seed >>> 0;
    return function(){
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 生成一个真随机种子:浏览器/Deno 用 crypto,node 用 crypto,兜底 Date+Math。
  //   注意:引擎内部绝不调 Math.random 做洗牌(不可复现);仅这里取一次性 seed。
  function freshSeed(){
    try {
      const g = (typeof globalThis !== 'undefined') ? globalThis : {};
      if (g.crypto && g.crypto.getRandomValues){
        const buf = new Uint32Array(1); g.crypto.getRandomValues(buf); return buf[0] >>> 0;
      }
      // node 环境
      if (typeof require === 'function'){
        const nc = require('crypto');
        return nc.randomBytes(4).readUInt32LE(0) >>> 0;
      }
    } catch (_){}
    // 兜底(仅极端环境;复现性仍靠返回的 seed 保证)
    return ((Date.now() ^ (Math.random()*0xffffffff)) >>> 0);
  }

  // Fisher-Yates,用给定 seed 的 PRNG。返回 {seed, cards} 便于持久化。
  function shuffle(cards, seed){
    const s = (typeof seed === 'number') ? (seed >>> 0) : freshSeed();
    const rng = mulberry32(s);
    const out = cards.slice();
    for (let i = out.length - 1; i > 0; i--){
      const j = Math.floor(rng() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return { seed: s, cards: out };
  }

  // ── 斗地主发牌 ─────────────────────────────────────────────
  // 3 家各 17 张 + 3 张底牌(地主拿)。返回 {seed, hands:[17,17,17], bottom:[3]}。
  //   传入 seed → 完全复现该局牌局(复核/回看)。
  function dealDoudizhu(seed){
    const { seed: s, cards } = shuffle(standardDeck(), seed);
    const hands = [[], [], []];
    for (let i = 0; i < 51; i++) hands[i % 3].push(cards[i]);
    const bottom = cards.slice(51); // 最后 3 张
    return { seed: s, hands, bottom };
  }

  // 手牌规范排序:大在前(rank 降序),同 rank 按固定花色序,便于渲染与 AI。
  function sortHand(cards){
    const suitOrder = {'♠':0,'♥':1,'♣':2,'♦':3};
    return cards.slice().sort((a,b)=>{
      if (b.rank !== a.rank) return b.rank - a.rank;
      const sa = a.suit ? suitOrder[a.suit] : -1, sb = b.suit ? suitOrder[b.suit] : -1;
      return sa - sb;
    });
  }

  return {
    RANKS, RANK_LABEL, SUITS, SUIT_KEY,
    makeCard, standardDeck,
    mulberry32, freshSeed, shuffle,
    dealDoudizhu, sortHand,
  };
});
