// ============================================================
// poker-net.js — 德州扑克联机传输层（host 权威 · 脱敏快照 · 防作弊命门）
// ------------------------------------------------------------
// 为什么存在: poker-engine 的 state 里带 _deck(含未来公共牌)与 seed(能推出所有底牌),
// 直接把 state 发给客户端 = 谁都能算穿别人的底牌。联机必须走 host 权威:
//   · host 本机跑真引擎当裁判; 每次状态变更后, 产出一份【脱敏公共快照】广播给所有人;
//   · 快照里公共信息(轮到谁/底池/公共牌/各家投入/筹码/是否弃牌全下)人人可见,
//     但【任何人的底牌都不下发】(reveal 只在摊牌后由引擎 result 给出, 那是本就该公开的);
//     _deck / seed / log 一律剥离 —— 客户端无从推牌。
//   · 每家自己的两张底牌走 eh_gt_hands 表(RLS 保证只有本人 select 到), 与公共快照分开传。
//   · 客户端出牌 → 把动作发回 host, host 用引擎 applyAction 校验(是不是你的回合/合不合法/够不够筹码),
//     通过才应用并广播新快照; 非法/越权动作被引擎拒, 客户端无权改权威状态。
//
// 本模块纯逻辑(无 DOM/网络), 可在 node 下用内存总线跑联机旅程测试(journey-poker-online.js):
//   host + 多个 guest 完整发一手, 断言 (1)快照永不外泄底牌/牌堆/种子 (2)客人仅凭自己底牌能算合法动作
//   (3)host 拒非本人回合/非法动作 (4)双方公共态收敛一致。
//
// 依赖: 无(纯数据变换)。engine 的 legalActions 只读公共字段, 客人可直接对 pseudoState 调它算合法动作。
// ============================================================
(function(root, factory){
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.EHPokerNet = mod;
})(this, function(){
  'use strict';

  // 牌对象是纯公共数据(rank/suit/label/id), 但只克隆这四个字段, 杜绝把引擎内部引用/多余字段带出去。
  function cardPlain(c){ return c ? { rank:c.rank, suit:c.suit, label:c.label, id:c.id } : c; }

  // result 是引擎结算产物: delta/stacks/pots/winnersBySeat/board 都是公共信息;
  // reveal(摊牌各家底牌+成手牌型)在摊牌后本就该公开 —— 弃牌收池(wentToShowdown=false)时引擎不给 reveal, 天然不泄露。
  function sanitizeResult(res){
    if (!res) return null;
    var out = {
      wentToShowdown: !!res.wentToShowdown,
      board: (res.board || []).slice(),
      pots: (res.pots || []).map(function(p){
        return { amount:p.amount, eligible:(p.eligible||[]).slice(), winners:(p.winners||[]).slice(), handName:p.handName };
      }),
      winnersBySeat: (res.winnersBySeat || []).slice(),
      delta: Object.assign({}, res.delta),
      stacks: Object.assign({}, res.stacks),
      button: res.button,
    };
    if (res.reveal){                        // 摊牌才有: 各未盖牌者底牌(id 串)+成手牌型 —— 公开信息
      out.reveal = {};
      Object.keys(res.reveal).forEach(function(s){
        out.reveal[s] = { hole:(res.reveal[s].hole||[]).slice(), hand:res.reveal[s].hand, cat:res.reveal[s].cat };
      });
    }
    return out;
  }

  // ── 脱敏公共快照: host 每次状态变更后广播这一份给【所有人】(含 handNo 便于客户端识别新一手去拉底牌) ──
  // 原则: 公共信息全给; 任何人的 hole 都不给([]); _deck/seed/log 由"只拷白名单字段"天然剥离。
  function snapshot(state, handNo){
    return {
      v: 'nlhe',
      handNo: (typeof handNo === 'number') ? handNo : 0,
      phase: state.phase, street: state.street,
      n: state.n, button: state.button, sb: state.sb, bb: state.bb,
      currentBet: state.currentBet, minRaise: state.minRaise, aggressor: state.aggressor,
      toAct: state.toAct, pot: state.pot,
      board: (state.board || []).map(cardPlain),
      players: (state.players || []).map(function(p){
        return {
          seat: p.seat, name: p.name, isAI: !!p.isAI,
          stack: p.stack, start: p.start,
          folded: !!p.folded, allin: !!p.allin,
          committed: p.committed, street: p.street, acted: !!p.acted,
          hole: [],                    // 命门: 公共快照里任何人底牌都不带
        };
      }),
      result: state.result ? sanitizeResult(state.result) : null,
    };
  }

  // ── 客户端: 把公共快照 + 自己的两张底牌, 组装成一个"够像引擎 state"的伪状态, 直接喂 UI 渲染 + engine.legalActions ──
  // myHole 是牌对象数组(客户端自己那副牌, 从 eh_gt_hands 拉到); 摊牌后 UI 走 result.reveal, 与此不冲突。
  function pseudoState(snap, mySeat, myHole){
    var st = {
      variant: 'nlhe', phase: snap.phase, street: snap.street,
      n: snap.n, button: snap.button, sb: snap.sb, bb: snap.bb,
      currentBet: snap.currentBet, minRaise: snap.minRaise, aggressor: snap.aggressor,
      toAct: snap.toAct, pot: snap.pot,
      board: (snap.board || []).map(cardPlain),
      players: (snap.players || []).map(function(p){ return Object.assign({}, p, { hole: [] }); }),
      result: snap.result || null,
      _guest: true, handNo: snap.handNo,
    };
    if (typeof mySeat === 'number' && st.players[mySeat] && Array.isArray(myHole))
      st.players[mySeat].hole = myHole.map(cardPlain);
    return st;
  }

  // 校验一条快照"确实没漏底牌/牌堆/种子"(测试与运行期防御双用)。
  // 返回 {ok, leaks:[...]}——leaks 空即安全。摊牌 reveal 属公开, 不算泄露。
  function assertNoLeak(snap){
    var leaks = [];
    if (snap == null || typeof snap !== 'object') return { ok:false, leaks:['snapshot 非对象'] };
    if ('_deck' in snap) leaks.push('_deck 外泄');
    if ('seed' in snap) leaks.push('seed 外泄');
    if ('log' in snap) leaks.push('log 外泄');
    (snap.players || []).forEach(function(p){
      if (Array.isArray(p.hole) && p.hole.length > 0) leaks.push('席' + p.seat + ' 底牌外泄');
    });
    return { ok: leaks.length === 0, leaks: leaks };
  }

  return {
    snapshot: snapshot,
    pseudoState: pseudoState,
    sanitizeResult: sanitizeResult,
    assertNoLeak: assertNoLeak,
    cardPlain: cardPlain,
  };
});
