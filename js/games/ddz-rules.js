// ============================================================
// ddz-rules.js — 斗地主牌型识别 / 合法性 / 大小比较（纯函数内核）
// ------------------------------------------------------------
// 这是「权威裁判」的核心:一切合法性判定只经此文件,客户端与 Edge 共用同一份。
// 牌型(type):
//   single      单张
//   pair        对子
//   trio        三张(不带)
//   trio_single 三带一
//   trio_pair   三带一对
//   straight    顺子(≥5 连,不含 2/王)
//   pairs       连对(≥3 连对,不含 2/王)
//   plane       飞机(≥2 连三)
//   plane_single飞机带单(每组三带一单,翼数=组数)
//   plane_pair  飞机带对(每组三带一对)
//   bomb        炸弹(四张同点)
//   rocket      王炸(双王)——最大
//   quad_single 四带二单
//   quad_pair   四带两对
// 比较规则:同型同长才可比;炸弹>所有非炸弹;王炸>所有。
// ============================================================
(function(root, factory){
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.EHDdzRules = mod;
})(this, function(){
  'use strict';

  // 统计 rank→count。cards:[{rank,...}]
  function countByRank(cards){
    const m = new Map();
    for (const c of cards) m.set(c.rank, (m.get(c.rank) || 0) + 1);
    return m;
  }
  // 取所有 count===n 的 rank 升序数组
  function ranksWithCount(m, n){
    const out = [];
    for (const [r, c] of m) if (c === n) out.push(r);
    return out.sort((a,b)=>a-b);
  }
  // 判断升序 rank 数组是否连续(步长 1)
  function isConsecutive(ranks){
    for (let i = 1; i < ranks.length; i++) if (ranks[i] !== ranks[i-1] + 1) return false;
    return true;
  }
  // 顺子/连对/飞机的连续段不能含 2(15) 和王(16/17)
  const MAX_CHAIN_RANK = 14; // A
  function chainValid(ranks){
    return ranks.length > 0 && ranks[ranks.length-1] <= MAX_CHAIN_RANK && isConsecutive(ranks);
  }

  // 解析一组牌 → {type, key, len} 或 null(非法牌型)。
  //   key = 用于同型比较的主 rank(顺子/飞机取最小连续 rank 起点的“主点”,统一取序列最大点便于比较)。
  //   为避免歧义,key 一律取「决定大小的那个点」:
  //     single/pair/trio* → 三/对/单的点;straight/pairs → 最大点;plane* → 三连的最大点;
  //     bomb → 四张点;rocket → 固定 Infinity 级。
  function parse(cards){
    if (!cards || !cards.length) return null;
    const n = cards.length;
    const m = countByRank(cards);
    const distinct = m.size;

    // 王炸
    if (n === 2){
      const rs = [...m.keys()].sort((a,b)=>a-b);
      if (rs.length === 2 && rs[0] === 16 && rs[1] === 17) return { type:'rocket', key: 1000, len:2 };
    }
    // 单张
    if (n === 1) return { type:'single', key: cards[0].rank, len:1 };
    // 对子
    if (n === 2 && distinct === 1) return { type:'pair', key: cards[0].rank, len:2 };
    // 炸弹(四张同点)
    if (n === 4 && distinct === 1) return { type:'bomb', key: cards[0].rank, len:4 };
    // 三张系列
    if (distinct >= 1){
      const trips = ranksWithCount(m, 3);
      const pairs = ranksWithCount(m, 2);
      const singles = ranksWithCount(m, 1);
      const quads = ranksWithCount(m, 4);

      // 三张(不带)
      if (n === 3 && trips.length === 1) return { type:'trio', key: trips[0], len:3 };
      // 三带一
      if (n === 4 && trips.length === 1 && singles.length === 1)
        return { type:'trio_single', key: trips[0], len:4 };
      // 三带一对
      if (n === 5 && trips.length === 1 && pairs.length === 1)
        return { type:'trio_pair', key: trips[0], len:5 };

      // 四带二(单):四张 + 两张单(不能是对,允许两单不同点;也允许其中含王作单)
      if (n === 6 && quads.length === 1 && singles.length === 2 && trips.length === 0)
        return { type:'quad_single', key: quads[0], len:6 };
      // 四带两对
      if (n === 8 && quads.length === 1 && pairs.length === 2)
        return { type:'quad_pair', key: quads[0], len:8 };

      // 顺子(≥5 单连)
      if (n >= 5 && singles.length === n && trips.length === 0 && pairs.length === 0 && quads.length === 0){
        const rs = singles.slice();
        if (chainValid(rs)) return { type:'straight', key: rs[rs.length-1], len:n };
      }
      // 连对(≥3 对连)
      if (n >= 6 && n % 2 === 0 && pairs.length === n/2 && trips.length === 0 && singles.length === 0 && quads.length === 0){
        const rs = pairs.slice();
        if (rs.length >= 3 && chainValid(rs)) return { type:'pairs', key: rs[rs.length-1], len:n };
      }

      // 飞机:≥2 连三。翼数决定形态。
      if (trips.length >= 2){
        const t = trips.slice(); // 升序
        if (chainValid(t)){
          const groups = t.length;
          const key = t[t.length-1];
          // 纯飞机(不带)
          if (n === groups * 3 && singles.length === 0 && pairs.length === 0 && quads.length === 0)
            return { type:'plane', key, len:n };
          // 飞机带单:翼 = groups 个单(可含对拆成的?不允许——带牌须恰好 groups 单)。
          //   实现:非三的牌全部视为单翼,数量须 == groups,且不得再形成三/四。
          const wingCount = n - groups * 3;
          if (wingCount === groups){
            // 带单:除三连外剩余 groups 张,任何点数不得达到 3(否则应归入更长飞机)
            // 允许剩余里有对(对拆成两单也可当翼) → 只要总翼数对,且没有 4 张同点混入
            if (quads.length === 0) return { type:'plane_single', key, len:n };
          }
          // 飞机带对:翼 = groups 个对
          if (wingCount === groups * 2 && pairs.length === groups && singles.length === 0 && quads.length === 0)
            return { type:'plane_pair', key, len:n };
        }
      }
    }
    return null; // 非法组合
  }

  const BOMB_TYPES = new Set(['bomb','rocket']);
  function isBomb(p){ return !!p && BOMB_TYPES.has(p.type); }

  // a 能否压过 b(a 后手,b 桌面当前)。b 为 null → a 只需是合法牌型即可(新一轮首出)。
  function beats(a, b){
    if (!a) return false;
    if (!b) return true;                       // 首出:任意合法型
    if (a.type === 'rocket') return true;       // 王炸通杀
    if (b.type === 'rocket') return false;
    if (a.type === 'bomb' && b.type !== 'bomb') return true;   // 炸弹压非炸
    if (b.type === 'bomb' && a.type !== 'bomb') return false;
    if (a.type === 'bomb' && b.type === 'bomb') return a.key > b.key; // 炸弹比点
    // 非炸弹:必须同型且同长
    if (a.type !== b.type || a.len !== b.len) return false;
    return a.key > b.key;
  }

  // 便捷:一组牌能否压过桌面(桌面用 parse 结果或 cards)。
  function canPlayBeat(cards, tableCards){
    const p = parse(cards);
    if (!p) return false;
    const t = tableCards ? parse(tableCards) : null;
    return beats(p, t);
  }

  return {
    parse, beats, isBomb, canPlayBeat,
    // 暴露内部工具便于单测与 AI 复用
    countByRank, ranksWithCount, isConsecutive, chainValid,
  };
});
