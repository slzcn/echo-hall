// ============================================================
// ddz-net.js — 斗地主联机传输层（host 权威 · 脱敏快照 · 防作弊命门）
// ------------------------------------------------------------
// 为什么存在: ddz-engine 的 state 里带 seed(能重推 3 家 + 底牌全部手牌)、
// players[].hand(各家当前手牌)、log(含 deal.seed + 抢地主/出牌全序列) —— 直接把 state
// 发给客户端 = 谁都能算穿别家手牌与底牌。联机必须走 host 权威:
//   · host 本机跑真引擎当裁判; 每次状态变更后, 产出一份【脱敏公共快照】广播给所有人;
//   · 快照里公共信息(阶段/轮到谁/地主是谁/倍数/炸弹数/叫分记录/桌面已出的牌/各家剩几张)人人可见,
//     但【任何人的当前手牌都不下发】(只给 handCount 张数); seed / log 一律剥离 —— 客户端无从推牌。
//   · 底牌【定地主前】只给张数(bottomCount), 谁都看不到; 【定地主后】随快照明置(公开信息)。
//   · 每家自己的手牌走 eh_gt_hands 表(RLS 保证只有本人 select 到), 与公共快照分开传。
//     斗地主手牌是【动态】的(地主定后 +3 底牌 / 出一张少一张), 故每次该家手牌变化 host 都要重写其私牌行
//     —— 这正是 eh_gt_set_hands 批量重写 RPC 的用途(见 sql/eh_gt_hands.sql)。
//   · 客户端叫分/出牌/不出 → 把动作发回 host, host 用引擎 applyCall/applyPlay/applyPass 校验
//     (是不是你的回合/合不合法/压不压得过/牌在不在手上), 通过才应用并广播新快照;
//     非法/越权动作被引擎拒, 客户端无权改权威状态。
//
// 本模块纯逻辑(无 DOM/网络), 可在 node 下用内存总线跑联机旅程测试(journey-ddz-online.js):
//   host + 多个 guest 完整打若干局(含叫分), 断言 (1)快照永不外泄手牌/种子/log(定地主前连底牌都不给)
//   (2)客人仅凭自己手牌能算合法出牌 (3)私牌 RLS 隔离 (4)host 拒非本人回合/非法出牌 (5)双方公共态收敛一致。
//
// 依赖: 无(纯数据变换)。台面牌以 id 数组下发, 客户端用整副牌表(Deck.standardDeck)按 id 还原牌面;
//   合法性判断(Rules.parse/beats)只需【自己手牌 + 台面牌型 parse】, 全在公共快照里。
// ============================================================
(function(root, factory){
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.EHDdzNet = mod;
})(this, function(){
  'use strict';

  // 牌对象是公共数据(定地主后的底牌 / 已出牌), 但只克隆判牌/渲染真正要用的字段, 杜绝把引擎内部引用带出去。
  // 斗地主牌: rank(数值)/suit(♠♥♣♦或null)/joker(big|small|null)/label/id。
  function cardPlain(c){
    return c ? { rank:c.rank, suit:c.suit, joker:(c.joker||null), label:c.label, id:c.id } : c;
  }

  // 台面"上一手"是公开信息: 谁出的(seat) + 出了哪些牌(id 数组, 客户端按 id 还原) + 牌型解析(parse: {type,...})。
  function lastPlayPlain(lp){
    if (!lp) return null;
    return { seat: lp.seat, cards: (lp.cards||[]).slice(), parse: lp.parse ? Object.assign({}, lp.parse) : null };
  }

  // result 是引擎结算产物: 地主/胜负/倍数/账变都是公开信息, 且不含任何人的当前手牌。
  function sanitizeResult(res){
    if (!res) return null;
    return {
      landlord: res.landlord, landlordWon: !!res.landlordWon, winnerSeat: res.winnerSeat,
      base: res.base, multiplier: res.multiplier, spring: !!res.spring,
      finalMultiplier: res.finalMultiplier, score: res.score,
      delta: Object.assign({}, res.delta),
      winners: (res.winners||[]).slice(), losers: (res.losers||[]).slice(),
      bombs: res.bombs,
    };
  }

  // 叫分是斗地主里【明置】的公开动作(大家都看到谁叫了几分), 不泄露任何人手牌。
  function sanitizeBid(bid){
    if (!bid) return null;
    return { turn: bid.turn, calls: (bid.calls||[]).slice(),
      max: bid.max, maxSeat: (bid.maxSeat==null?null:bid.maxSeat), firstBid: bid.firstBid };
  }

  // ── 脱敏公共快照: host 每次状态变更后广播这一份给【所有人】 ──
  // dealNo: 本桌第几局(每 createGame 递增), 客户端据此识别"新一局"去重置/拉自己的手牌。
  // 原则: 公共信息全给; 任何人的当前手牌都只给张数(handCount); 底牌定地主前只给张数; seed/log 天然剥离(只拷白名单)。
  function snapshot(state, dealNo){
    var landlordSet = (state.landlord !== null && state.landlord !== undefined);
    var snap = {
      v: 'ddz',
      dealNo: (typeof dealNo === 'number') ? dealNo : 0,
      phase: state.phase,
      turn: state.turn,
      landlord: (state.landlord==null ? null : state.landlord),
      multiplier: state.multiplier,
      bombs: state.bombs,
      base: state.base,
      bid: sanitizeBid(state.bid),
      bottomCount: (state.bottom ? state.bottom.length : 0),
      table: { lastPlay: lastPlayPlain(state.table && state.table.lastPlay),
               passesInRow: state.table ? state.table.passesInRow : 0 },
      players: (state.players||[]).map(function(p){
        return {
          seat: p.seat, name: p.name, isAI: !!p.isAI,
          handCount: (p.hand ? p.hand.length : 0),   // 命门: 只给张数, 不给具体牌
        };
      }),
      result: state.result ? sanitizeResult(state.result) : null,
    };
    // 底牌: 定地主后才明置(公开); 定之前连牌面都不给(只留 bottomCount)。
    if (landlordSet && state.bottom) snap.bottom = state.bottom.map(cardPlain);
    return snap;
  }

  // ── 客户端: 把公共快照 + 自己的手牌, 组装成一个"够像引擎 state"的伪状态, 直接喂 UI 渲染 + Rules 判合法性 ──
  // myHand 是牌对象数组(客户端自己那副牌, 从 eh_gt_hands 拉到); 别家手牌用占位补足张数(UI 只读 .length 画背面/报牌数)。
  function pseudoState(snap, mySeat, myHand){
    var lp = snap.table && snap.table.lastPlay ? lastPlayPlain(snap.table.lastPlay) : null;
    var st = {
      phase: snap.phase,
      seed: undefined,                       // 明确不带: 客户端无从重推
      turn: snap.turn,
      landlord: (snap.landlord==null ? null : snap.landlord),
      multiplier: snap.multiplier || 1,
      bombs: snap.bombs || 0,
      base: snap.base || 1,
      bid: snap.bid ? { turn:snap.bid.turn, calls:(snap.bid.calls||[]).slice(),
        max:snap.bid.max, maxSeat:snap.bid.maxSeat, firstBid:snap.bid.firstBid } : null,
      table: { lastPlay: lp, passesInRow: (snap.table ? snap.table.passesInRow : 0) || 0 },
      // 底牌: 定后给真牌(渲染明置), 定前只占位到张数(UI 在 bid 阶段画成背面)。
      bottom: snap.bottom ? snap.bottom.map(cardPlain) : new Array(Math.max(0, snap.bottomCount|0)).fill(null),
      players: (snap.players||[]).map(function(p){
        return {
          id: 'p'+p.seat, seat: p.seat, name: p.name, isAI: !!p.isAI,
          hand: new Array(Math.max(0, p.handCount|0)).fill(null),   // 别家: 只占位到正确张数
        };
      }),
      result: snap.result || null,
      _guest: true, dealNo: snap.dealNo,
    };
    if (typeof mySeat === 'number' && st.players[mySeat] && Array.isArray(myHand))
      st.players[mySeat].hand = myHand.map(cardPlain);
    return st;
  }

  // 校验一条快照"确实没漏手牌/种子/log"(测试与运行期防御双用)。
  // 返回 {ok, leaks:[...]}——leaks 空即安全。
  function assertNoLeak(snap){
    var leaks = [];
    if (snap == null || typeof snap !== 'object') return { ok:false, leaks:['snapshot 非对象'] };
    if ('seed' in snap) leaks.push('seed 外泄');
    if ('log' in snap) leaks.push('log 外泄');
    // 定地主前底牌不该出现(连牌面都不能给, 否则能推地主手牌走向)
    if (('bottom' in snap) && (snap.landlord === null || snap.landlord === undefined)) leaks.push('定地主前底牌外泄');
    (snap.players || []).forEach(function(p){
      if ('hand' in p) leaks.push('席' + p.seat + ' 手牌外泄');   // 只该有 handCount, 不该有 hand
    });
    return { ok: leaks.length === 0, leaks: leaks };
  }

  return {
    snapshot: snapshot,
    pseudoState: pseudoState,
    sanitizeResult: sanitizeResult,
    sanitizeBid: sanitizeBid,
    lastPlayPlain: lastPlayPlain,
    assertNoLeak: assertNoLeak,
    cardPlain: cardPlain,
  };
});
