// ============================================================
// guandan-rules.js — 掼蛋牌型识别 / 合法性 / 大小比较（纯函数内核）
// ------------------------------------------------------------
// 「权威裁判」核心, 客户端与 Edge 共用同一份。本文件锁定所采用的规则口径
// (地方规则众多, 这里选一套自洽、完整、好玩的主流打法, 全程按此判定):
//
// 【座位与队伍】4 人, 对家成队: 0&2 一队, 1&3 一队。两副牌共 108 张。
// 【级牌 level】用自然点数表示(2..14, A=14)。级牌抬权到「比 A 大、比王小」,
//   即比较用点力 power: 大王17 小王16 级牌15 A14 K13 ... 3→3 2→2。
//   注意: 掼蛋里 2 是最小的自然牌(2<3<...<A), 与斗地主相反。
// 【逢人配 / 百搭】红桃级牌(♥+level)是万能牌, 两副共 2 张。可替任意「非王」牌
//   凑牌型; 不替王。不当百搭用时它就是普通级牌。
// 【牌型 type】
//   single 单 / pair 对 / trio 三张 / fullhouse 三带二(三+一对,5) /
//   straight 顺子(5 连单, A 可作 1 走 A2345, 也可 10JQKA; 顺子里级牌按自然点不抬权) /
//   pairline 连对/木板(3 连对,6) / trioline 钢板/二连三(2 连三,6)。
// 【炸弹与大小】(低→高):
//   4 张炸 < 5 张炸 < 同花顺(straightflush,5 同花连张) < 6 张炸 < 7 张炸 < 8 张炸 < 四大天王(2大2小)。
//   炸弹>一切非炸; 同型炸按张数, 同张数按点力; 同花顺按最大点。
// 【比较】非炸: 必同型同长, 比 key; 炸弹另走 bombStrength。
// ============================================================
(function(root, factory){
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.EHGuandanRules = mod;
})(this, function(){
  'use strict';

  // deck rank(3..14=3..A, 15='2', 16小王,17大王) → 掼蛋自然点(2..14; 王返回 null)
  function naturalRank(card){
    if (card.joker) return null;
    return card.rank === 15 ? 2 : card.rank;   // '2' 是最小自然牌
  }
  // 红桃级牌 = 百搭
  function isWild(card, level){
    return !card.joker && card.suit === '♥' && naturalRank(card) === level;
  }
  // 比较点力: 大王17 小王16 级牌15 其余=自然点(2..14)
  function powerOf(card, level){
    if (card.joker) return card.joker === 'big' ? 17 : 16;
    const nr = naturalRank(card);
    return nr === level ? 15 : nr;
  }

  // ── 手牌分解 ───────────────────────────────────────────────
  function decompose(cards, level){
    const wilds = [], jokers = [], nats = [];
    for (const c of cards){
      if (isWild(c, level)) wilds.push(c);
      else if (c.joker) jokers.push(c);
      else nats.push(c);
    }
    const natMap = new Map();     // 自然点 → 张数
    for (const c of nats){ const r = naturalRank(c); natMap.set(r, (natMap.get(r)||0)+1); }
    let bigJ = 0, smallJ = 0;
    for (const j of jokers){ if (j.joker === 'big') bigJ++; else smallJ++; }
    return { wilds, jokers, nats, natMap, w: wilds.length, bigJ, smallJ };
  }

  const BOMB_TYPES = new Set(['bomb','straightflush','jokerbomb']);
  function isBomb(p){ return !!p && BOMB_TYPES.has(p.type); }

  // 炸弹强度(可比数值): 4张4xxx 5张5xxx 同花顺5500+ 6张6xxx 7张7xxx... 四大天王最大
  function bombStrength(p){
    if (!p) return -1;
    if (p.type === 'jokerbomb') return 100000;
    if (p.type === 'straightflush') return 5500 + p.key;
    if (p.type === 'bomb') return p.size * 1000 + p.key;
    return -1;
  }

  // ── 连续段可行性(顺子/连对/钢板 共用) ─────────────────────
  // 位置轴: 1=A低位, 2..14=点数2..A。级牌在顺子里按自然点(不抬权)。
  // groupSize=每档需要张数(顺1/连对2/钢板3), groups=档数。返回 {ok, top} 或 {ok:false}。
  //   条件: 全部自然牌能落进这条连续段、每档不超 groupSize、无王; 缺口自动由 w 张百搭补齐
  //   (因 naturals + w === n, 只要自然牌合法落位且不超额, 缺口必恰为 w)。
  function fitRun(dc, groupSize, groups, n, level){
    if (dc.jokers.length) return { ok:false };
    if (dc.nats.length + dc.w !== n) return { ok:false };
    for (let start = 1; start + groups - 1 <= 14; start++){
      const run = [];
      for (let k = 0; k < groups; k++) run.push(start + k);
      const runSet = new Set(run);
      const cap = new Map();
      let ok = true;
      for (const [r, cnt] of dc.natMap){
        let pos = null;
        if (runSet.has(r)) pos = r;
        else if (r === 14 && runSet.has(1)) pos = 1;   // A 可当低位 1
        if (pos === null){ ok = false; break; }
        cap.set(pos, (cap.get(pos)||0) + cnt);
      }
      if (!ok) continue;
      for (const [, c] of cap) if (c > groupSize){ ok = false; break; }
      if (ok) return { ok:true, top: run[run.length-1] };
    }
    return { ok:false };
  }

  // 同花顺: 5 张同花连张。百搭是♥, 若用百搭则花色必须♥。
  function fitStraightFlush(cards, dc, level){
    if (dc.jokers.length) return { ok:false };
    // 非百搭牌须同一花色
    let suit = null;
    for (const c of dc.nats){ if (suit === null) suit = c.suit; else if (c.suit !== suit) return { ok:false }; }
    if (dc.w > 0 && suit !== null && suit !== '♥') return { ok:false }; // 掺了♥百搭, 花色须♥
    // 复用 fitRun 的落位逻辑(同花下自然牌点位分布一致)
    const run = fitRun(dc, 1, 5, 5, level);
    return run.ok ? { ok:true, top: run.top } : { ok:false };
  }

  // 三带二: 三张 a + 一对 b(a≠b), 百搭补齐。
  function fitFullhouse(dc, level){
    if (dc.jokers.length) return null;
    const ranks = [...dc.natMap.keys()];
    if (ranks.length > 2) return null;
    const cand = [];
    if (ranks.length === 2){
      cand.push([ranks[0], ranks[1]]);
      cand.push([ranks[1], ranks[0]]);
    } else if (ranks.length === 1){
      cand.push([ranks[0], level]);   // 单点作三, 百搭凑对(对点=级)
      if (ranks[0] !== level) cand.push([level, ranks[0]]); // 百搭作三(级), 单点作对
    } else {
      cand.push([level, level]); // 全百搭, a=b 不合法, 下面会被 a!==b 挡掉
    }
    for (const [a, b] of cand){
      if (a === b) continue;
      const ca = dc.natMap.get(a) || 0, cb = dc.natMap.get(b) || 0;
      if (ca > 3 || cb > 2) continue;
      const deficit = (3 - ca) + (2 - cb);
      if (deficit === dc.w) return { trio: a, pair: b };
    }
    return null;
  }

  // 全同点判定(炸弹用): 非王、自然点≤1 种, 且 count+w===n
  function fitBomb(dc, n){
    if (dc.jokers.length) return null;
    const ranks = [...dc.natMap.keys()];
    if (ranks.length > 1) return null;
    const r = ranks.length === 1 ? ranks[0] : null; // 全百搭时 r=null → 级
    const natCnt = ranks.length === 1 ? dc.natMap.get(r) : 0;
    if (natCnt + dc.w !== n) return null;
    return { rank: r };  // r=null 表示级牌炸
  }

  // ── 解析: cards → {type,key,len,...} 或 null ───────────────
  function parse(cards, level){
    if (!cards || !cards.length) return null;
    if (typeof level !== 'number') level = 2;
    const n = cards.length;
    const dc = decompose(cards, level);
    const powOfRank = (r)=> r === null ? 15 : (r === level ? 15 : r); // 级牌炸 r=null→力15

    // 单张
    if (n === 1){ return { type:'single', key: powerOf(cards[0], level), len:1, deckRank: cards[0].rank }; }

    // 对子
    if (n === 2){
      // 王对: 两张同类王成对——双小王(力16)、双大王(力17), 均压过级牌对(力15)。
      //   一大一小点数不同, 不成对; 百搭不替王, 故王+百搭也不成王对。
      if (dc.jokers.length){
        if (dc.w === 0 && dc.nats.length === 0 && (dc.bigJ === 2 || dc.smallJ === 2))
          return { type:'pair', key: dc.bigJ === 2 ? 17 : 16, len:2, nat: null };
        return null;
      }
      const ranks = [...dc.natMap.keys()];
      if (ranks.length > 1) return null;
      const r = ranks.length ? ranks[0] : level;   // 全百搭 → 级对
      return { type:'pair', key: powOfRank(r), len:2, nat: r };
    }

    // 三张
    if (n === 3){
      if (dc.jokers.length) return null;
      const ranks = [...dc.natMap.keys()];
      if (ranks.length > 1) return null;
      const r = ranks.length ? ranks[0] : level;
      return { type:'trio', key: powOfRank(r), len:3, nat: r };
    }

    // 四大天王
    if (n === 4 && dc.bigJ === 2 && dc.smallJ === 2 && dc.w === 0 && dc.nats.length === 0)
      return { type:'jokerbomb', key:100000, len:4 };

    // 炸弹(n≥4 全同点)
    if (n >= 4){
      const b = fitBomb(dc, n);
      if (b){ return { type:'bomb', size:n, key: powOfRank(b.rank), len:n, nat: (b.rank==null?level:b.rank) }; }
    }

    if (n === 5){
      const sf = fitStraightFlush(cards, dc, level);
      if (sf.ok) return { type:'straightflush', key: sf.top, len:5, suit:'flush', topRank: sf.top, botRank: sf.top-4 };
      const fh = fitFullhouse(dc, level);
      if (fh) return { type:'fullhouse', key: powOfRank(fh.trio), len:5, trioRank: fh.trio, pairRank: fh.pair };
      const st = fitRun(dc, 1, 5, 5, level);
      if (st.ok) return { type:'straight', key: st.top, len:5, topRank: st.top, botRank: st.top-4 };
      return null;
    }

    if (n === 6){
      const tl = fitRun(dc, 3, 2, 6, level);          // 钢板(2 连三)
      if (tl.ok) return { type:'trioline', key: tl.top, len:6, topRank: tl.top, botRank: tl.top-1 };
      const pl = fitRun(dc, 2, 3, 6, level);          // 连对(3 连对)
      if (pl.ok) return { type:'pairline', key: pl.top, len:6, topRank: pl.top, botRank: pl.top-2 };
      return null;
    }

    return null;
  }

  // a 能否压过 b(a 后手, b 桌面; b=null → 首出任意合法)。level 影响点力。
  function beats(a, b, level){
    if (!a) return false;
    if (!b) return true;
    const aB = isBomb(a), bB = isBomb(b);
    if (aB && !bB) return true;
    if (!aB && bB) return false;
    if (aB && bB) return bombStrength(a) > bombStrength(b);
    if (a.type !== b.type || a.len !== b.len) return false;
    return a.key > b.key;
  }

  function canPlayBeat(cards, tableCards, level){
    const p = parse(cards, level);
    if (!p) return false;
    const t = tableCards ? parse(tableCards, level) : null;
    return beats(p, t, level);
  }

  // 手牌按点力降序排序(级牌抬到 A 之上, 王最大), 便于渲染/AI。同点力按花色。
  function sortHand(cards, level){
    if (typeof level !== 'number') level = 2;
    const suitOrder = {'♠':0,'♥':1,'♣':2,'♦':3};
    return cards.slice().sort((a,b)=>{
      const pa = powerOf(a, level), pb = powerOf(b, level);
      if (pb !== pa) return pb - pa;
      // 同点力: 级牌(自然点相同)按花色; 王按大小已在 power 区分
      const sa = a.suit ? suitOrder[a.suit] : -1, sb = b.suit ? suitOrder[b.suit] : -1;
      return sa - sb;
    });
  }

  return {
    parse, beats, isBomb, bombStrength, canPlayBeat,
    naturalRank, isWild, powerOf, decompose, sortHand,
    // 暴露内部工具便于单测/AI
    fitRun, fitBomb, fitFullhouse, fitStraightFlush,
  };
});
