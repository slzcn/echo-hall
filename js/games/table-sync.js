/* table-sync.js — 联机牌桌 host 权威同步内核(斗地主/掼蛋通用)
 *
 * 为什么存在: 引擎(ddz/guandan-engine)是纯权威裁判, 它的 log 能被 replay 完整复现整局。
 * 但 log 里带 seed —— 谁把 log replay 一遍就能算出所有人的底牌。所以【不能把 log/seed 发给客户端】。
 * 联机必须走 host 权威:
 *   · host 本机跑真引擎, 每次状态变更后, 给每个座位生成一份【脱敏快照】广播出去;
 *   · 快照里公共信息(轮到谁/地主/倍数/桌面最后一手/各家剩牌数)人人可见,
 *     但【手牌只给本人】, 别家只留张数, seed/log 一律剥离 —— 客户端无从推牌;
 *   · 客户端要出牌 → 把动作(叫分/出牌/过)发回 host, host 用引擎校验(是不是你的回合、
 *     牌型合不合法、压不压得过), 通过才应用并广播新快照。非法动作被拒, 客户端无权改状态。
 *
 * 本模块是纯逻辑(无 DOM), 可在 node 下用内存总线跑联机旅程测试(见 journey-table-sync.js):
 *   host + 多个 guest 完整发一局, 断言 (1)公共态收敛一致 (2)手牌隔离(A 看不到 B 的牌)。
 * UI 层(game-ui / guandan-ui)只负责: host 模式驱动 AI/超时 + 广播; guest 模式渲染快照 + 回传动作。
 */
(function (root) {
  'use strict';

  // 牌的【身份】(id/rank/suit/joker/百搭/点数)不是秘密 —— 秘密的是【谁握着它】。
  // 所以给本人手牌 / 已出牌时整张克隆(AI/提示要用 joker/value 等字段), 脱敏只体现在"别家 hand 根本不下发"。
  function cloneCard(c) { return Object.assign({}, c); }
  function deepClone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

  // ── 脱敏快照: host 每次状态变更后, 为 forSeat 生成一份可安全下发的视图 ──
  // 原则: 公共信息全给; players[forSeat].hand 给真牌, 其余席只给 count; seed/log 永不外泄。
  function makeSnapshot(state, forSeat) {
    const snap = {
      forSeat: forSeat,
      phase: state.phase,
      turn: state.turn,
      result: state.result || null,
      players: state.players.map(function (p) {
        const view = {
          seat: p.seat,
          name: p.name,
          isAI: !!p.isAI,
          count: p.hand ? p.hand.length : (p.count || 0),
        };
        if (p.seat === forSeat && p.hand) view.hand = p.hand.map(cloneCard);   // 只有本人拿真牌
        if (p.finished !== undefined) view.finished = p.finished;
        if (p.rank !== undefined) view.rank = p.rank;
        return view;
      }),
      table: {
        lastPlay: (state.table && state.table.lastPlay) ? {
          seat: state.table.lastPlay.seat,
          cards: state.table.lastPlay.cards.slice(),           // 引擎里已出牌存的是 id 串(公共), 客户端用自己那副牌复原牌面
          parse: deepClone(state.table.lastPlay.parse),        // 牌型解析(公共, 供客户端算提示/校验压得过)
        } : null,
        passesInRow: state.table ? state.table.passesInRow : 0,
      },
    };
    if (state.table && state.table.leader !== undefined) snap.table.leader = state.table.leader;

    // 斗地主公共字段
    if (state.landlord !== undefined) snap.landlord = state.landlord;
    if (state.multiplier !== undefined) snap.multiplier = state.multiplier;
    if (state.bombs !== undefined) snap.bombs = state.bombs;
    if (state.base !== undefined) snap.base = state.base;
    if (state.bid) {
      snap.bid = {
        turn: state.bid.turn, calls: state.bid.calls.slice(),
        max: state.bid.max, maxSeat: state.bid.maxSeat, firstBid: state.bid.firstBid,
      };
    }
    // 底牌: 定地主前隐藏(只给张数), 定后公开
    if (state.bottom !== undefined) {
      snap.bottomCount = state.bottom.length;
      if (state.landlord !== null && state.landlord !== undefined) snap.bottom = state.bottom.map(cloneCard);
    }

    // 掼蛋公共字段
    if (state.level !== undefined) snap.level = state.level;
    if (state.teamLevels !== undefined) snap.teamLevels = state.teamLevels.slice();
    if (state.dealerTeam !== undefined) snap.dealerTeam = state.dealerTeam;
    if (state.tribute !== undefined) snap.tribute = state.tribute ? JSON.parse(JSON.stringify(state.tribute)) : state.tribute;
    if (state.finishOrder !== undefined) snap.finishOrder = state.finishOrder ? state.finishOrder.slice() : state.finishOrder;

    return snap;
  }

  // guest 侧: 把快照当作可渲染视图。附一个 handCount 便于 UI 统一取"某席剩几张"(自己=hand.length, 别家=count)。
  function handCount(snap, seat) {
    const p = snap.players[seat];
    if (!p) return 0;
    return p.hand ? p.hand.length : (p.count || 0);
  }

  // ── 动作编码: 客户端→host 的线格式。play 只带 id(防夹带完整对象/减小体积), host 从手牌按 id 复原 ──
  function encodeMove(move) {
    if (!move || !move.action) return null;
    if (move.action === 'call') return { action: 'call', val: move.val };
    if (move.action === 'pass') return { action: 'pass' };
    if (move.action === 'play') return { action: 'play', cards: (move.cards || []).map(function (c) { return { id: c.id }; }) };
    return null;
  }

  // ── Host 权威控制器: 包住引擎 + 状态。submit() 校验并应用一个座位的动作, 成功后 seq 自增。 ──
  // 不负责定时/AI(那在 UI 层), 只做"合法性裁决 + 快照产出"这块可确定性测试的核心。
  function HostController(Engine, state) {
    let seq = 0;
    return {
      get state() { return state; },
      seq: function () { return seq; },
      // 为某席产出当前脱敏快照(带 seq, 便于客户端丢弃乱序旧包)
      snapshotFor: function (seat) {
        const s = makeSnapshot(state, seat);
        s.seq = seq;
        return s;
      },
      // 提交一个动作。返回 {ok, result?} 或 {ok:false, error}。非本人回合/非法牌型一律被引擎拒。
      submit: function (seat, move) {
        if (state.phase === 'over') return { ok: false, error: 'game_over' };
        move = encodeMove(move);
        if (!move) return { ok: false, error: 'bad_move' };
        try {
          let r;
          if (move.action === 'call') r = Engine.applyCall(state, seat, move.val);
          else if (move.action === 'pass') r = Engine.applyPass(state, seat);
          else if (move.action === 'play') {
            // host 权威: 客户端只送 id, 一律从【host 自己那副手牌】按 id 复原成真牌 ——
            // 绝不采信客户端送来的牌面(否则能伪造不在手里的牌)。任一 id 不在手牌 → 拒。
            const hand = (state.players[seat] && state.players[seat].hand) || [];
            const byId = {};
            for (let i = 0; i < hand.length; i++) byId[hand[i].id] = hand[i];
            const resolved = [];
            for (let i = 0; i < move.cards.length; i++) {
              const real = byId[move.cards[i].id];
              if (!real) return { ok: false, error: 'not_in_hand' };
              resolved.push(real);
            }
            r = Engine.applyPlay(state, seat, resolved);
          }
          else return { ok: false, error: 'bad_action' };
          seq++;
          return { ok: true, result: r };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      },
    };
  }

  const api = { makeSnapshot: makeSnapshot, handCount: handCount, encodeMove: encodeMove, HostController: HostController };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EHTableSync = api;
})(typeof self !== 'undefined' ? self : this);
