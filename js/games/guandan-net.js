// ============================================================
// guandan-net.js — 掼蛋联机传输层（host 权威 · 脱敏快照 · 防作弊命门）
// ------------------------------------------------------------
// 为什么存在: guandan-engine 的 state 里带 seed(能重推 4 家 27 张全部手牌)、
// players[].hand(各家当前手牌)、log(含 deal.seed + 进贡牌 id) —— 直接把 state
// 发给客户端 = 谁都能算穿别家手牌。联机必须走 host 权威:
//   · host 本机跑真引擎当裁判; 每次状态变更后, 产出一份【脱敏公共快照】广播给所有人;
//   · 快照里公共信息(轮到谁/台面已出的牌/各家剩几张/级牌/名次/进贡明置)人人可见,
//     但【任何人的当前手牌都不下发】(只给 handCount 张数); seed / log 一律剥离 —— 客户端无从推牌。
//   · 每家自己的手牌走 eh_gt_hands 表(RLS 保证只有本人 select 到), 与公共快照分开传。
//     掼蛋手牌是【动态】的(出一张少一张 / 进贡还贡后变), 故每次该家手牌变化 host 都要重写其私牌行
//     —— 这正是 eh_gt_update_hand 单座重写 RPC 的用途(见 sql/eh_gt_hands.sql)。
//   · 客户端出牌/不出 → 把动作发回 host, host 用引擎 applyPlay/applyPass 校验
//     (是不是你的回合/合不合法/压不压得过/牌在不在手上), 通过才应用并广播新快照;
//     非法/越权动作被引擎拒, 客户端无权改权威状态。
//
// 本模块纯逻辑(无 DOM/网络), 可在 node 下用内存总线跑联机旅程测试(journey-guandan-online.js):
//   host + 多个 guest 完整打若干副, 断言 (1)快照永不外泄手牌/种子/log (2)客人仅凭自己手牌能算合法出牌
//   (3)私牌 RLS 隔离 (4)host 拒非本人回合/非法出牌 (5)双方公共态收敛一致。
//
// 依赖: 无(纯数据变换)。台面牌以 id 数组下发, 客户端用整两副牌表(Deck.doubleDeck)按 id 还原牌面;
//   合法性判断(Rules.parse/beats)只需【自己手牌 + 台面牌型 parse + 级牌 level】, 全在公共快照里。
// ============================================================
(function(root, factory){
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.EHGuandanNet = mod;
})(this, function(){
  'use strict';

  // 牌对象是公共数据, 但只克隆判牌/渲染真正要用的字段, 杜绝把引擎内部引用/多余字段带出去。
  // 掼蛋牌: rank(数值)/suit(♠♥♣♦或null)/joker(big|small|null)/label/id/deck(0|1 双副区分)。
  function cardPlain(c){
    return c ? { rank:c.rank, suit:c.suit, joker:(c.joker||null), label:c.label, id:c.id, deck:(c.deck||0) } : c;
  }

  // 台面"上一手"是公开信息: 谁出的(seat) + 出了哪些牌(id 数组, 客户端按 id 还原) + 牌型解析(parse: {type,key,len,...})。
  // parse 只描述这几张已出的牌, 不含任何隐藏信息; 客户端凭它算自己能不能压得过。
  function lastPlayPlain(lp){
    if (!lp) return null;
    return { seat: lp.seat, cards: (lp.cards||[]).slice(), parse: lp.parse ? Object.assign({}, lp.parse) : null };
  }

  // result 是引擎结算产物: 名次/升级/账变/进贡明细都是公开信息, 且不含任何人的当前手牌。
  function sanitizeResult(res){
    if (!res) return null;
    var out = {
      finishOrder: (res.finishOrder||[]).slice(),
      winnerTeam: res.winnerTeam, loserTeam: res.loserTeam, advance: res.advance,
      teamLevelsBefore: (res.teamLevelsBefore||[]).slice(),
      teamLevelsAfter: (res.teamLevelsAfter||[]).slice(),
      activeLevel: res.activeLevel, dealerTeam: res.dealerTeam,
      nextDealerTeam: res.nextDealerTeam, nextLevel: res.nextLevel,
      matchWon: !!res.matchWon, matchWinnerTeam: (res.matchWinnerTeam==null?null:res.matchWinnerTeam),
      doubleDown: !!res.doubleDown, bombs: res.bombs,
      delta: Object.assign({}, res.delta),
      tribute: sanitizeTribute(res.tribute),
    };
    return out;
  }

  // 进贡是掼蛋里【明置】的公开动作(大家都看到贡了哪张牌), 贡出的牌已易主, 不泄露任何人当前隐藏手牌。
  // 故 transfers 的 give/back(id) 可给, 客户端用来渲染进贡横幅。
  function sanitizeTribute(t){
    if (!t) return null;
    var out = { refused: !!t.refused, doubleDown: !!t.doubleDown };
    if (Array.isArray(t.transfers))
      out.transfers = t.transfers.map(function(x){ return { from:x.from, to:x.to, give:x.give, back:(x.back==null?null:x.back) }; });
    else out.transfers = [];
    if (Array.isArray(t.pairs)) out.pairs = t.pairs.slice();
    return out;
  }

  // ── 脱敏公共快照: host 每次状态变更后广播这一份给【所有人】 ──
  // dealNo: 本桌第几副(每 newDeal 递增), 客户端据此识别"新一副"去拉自己的手牌。
  // 原则: 公共信息全给; 任何人的当前手牌都只给张数(handCount), 不给具体牌; seed/log 由"只拷白名单字段"天然剥离。
  function snapshot(state, dealNo){
    return {
      v: 'gd',
      dealNo: (typeof dealNo === 'number') ? dealNo : 0,
      phase: state.phase,
      level: state.level,
      teamLevels: (state.teamLevels||[]).slice(),
      dealerTeam: state.dealerTeam,
      turn: state.turn,
      bombs: state.bombs,
      finished: (state.finished||[]).slice(),
      passesInRow: state.table ? state.table.passesInRow : 0,
      table: { lastPlay: lastPlayPlain(state.table && state.table.lastPlay), passesInRow: state.table ? state.table.passesInRow : 0 },
      players: (state.players||[]).map(function(p){
        return {
          seat: p.seat, name: p.name, team: p.team, isAI: !!p.isAI,
          handCount: (p.hand ? p.hand.length : 0),   // 命门: 只给张数, 不给具体牌
        };
      }),
      tribute: sanitizeTribute(state.tribute),
      result: state.result ? sanitizeResult(state.result) : null,
    };
  }

  // ── 客户端: 把公共快照 + 自己的手牌, 组装成一个"够像引擎 state"的伪状态, 直接喂 UI 渲染 + Rules 判合法性 ──
  // myHand 是牌对象数组(客户端自己那副牌, 从 eh_gt_hands 拉到); 别家手牌用占位补足张数(UI 只读 .length 画背面/报牌数)。
  function pseudoState(snap, mySeat, myHand){
    var lp = snap.table && snap.table.lastPlay ? lastPlayPlain(snap.table.lastPlay) : null;
    var st = {
      phase: snap.phase,
      seed: undefined,                       // 明确不带: 客户端无从重推
      level: snap.level,
      teamLevels: (snap.teamLevels||[]).slice(),
      dealerTeam: snap.dealerTeam,
      turn: snap.turn,
      bombs: snap.bombs,
      finished: (snap.finished||[]).slice(),
      table: { lastPlay: lp, passesInRow: (snap.table ? snap.table.passesInRow : snap.passesInRow) || 0 },
      players: (snap.players||[]).map(function(p){
        return {
          id: 'p'+p.seat, seat: p.seat, name: p.name, team: p.team, isAI: !!p.isAI,
          hand: new Array(Math.max(0, p.handCount|0)).fill(null),   // 别家: 只占位到正确张数
        };
      }),
      tribute: snap.tribute || null,
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
    (snap.players || []).forEach(function(p){
      if ('hand' in p) leaks.push('席' + p.seat + ' 手牌外泄');   // 只该有 handCount, 不该有 hand
    });
    return { ok: leaks.length === 0, leaks: leaks };
  }

  return {
    snapshot: snapshot,
    pseudoState: pseudoState,
    sanitizeResult: sanitizeResult,
    sanitizeTribute: sanitizeTribute,
    lastPlayPlain: lastPlayPlain,
    assertNoLeak: assertNoLeak,
    cardPlain: cardPlain,
  };
});
