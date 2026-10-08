/*
 * gt-net.js — 联机牌桌同步内核(纯逻辑, 从 app.js 迁出)
 * stamp: 快照单调 seq; acceptMove: host 侧 act 授权(DB 现算 remoteSeats + uid);
 * resumeSeat: 从 remoteSeats 放回超时席。
 * app.js 注入 getSeats/getGame/myUid/toast 后使用。
 */
(function (root) {
  'use strict';
  function createGtNet(deps) {
    deps = deps || {};
    var seq = 0;
    function stamp(snap) {
      if (snap && typeof snap === 'object') {
        try { snap.seq = ++seq; } catch (e) {}
      }
      return snap;
    }
    function resetSeq() { seq = 0; }
    function setSeq(v) { if (typeof v === 'number' && v > seq) seq = v; }
    // seats: { remoteSeats:[], ids:[], mySeat, names[] }
    function acceptMove(seats, seat, move, payloadUid) {
      if (!seats || typeof seat !== 'number') return { ok: false, reason: 'bad_seat' };
      var remote = seats.remoteSeats;
      if (!Array.isArray(remote) || remote.indexOf(seat) < 0) return { ok: false, reason: 'not_remote' };
      var seatUid = seats.ids && seats.ids[seat];
      if (payloadUid && seatUid && String(payloadUid) !== String(seatUid)) return { ok: false, reason: 'uid_mismatch' };
      return { ok: true, seat: seat };
    }
    function resumeRemote(game, seat, mySeat) {
      if (!game || typeof game.resumeRemote !== 'function') return false;
      if (typeof seat !== 'number' || seat === mySeat) return false;
      try { return !!game.resumeRemote(seat); } catch (e) { return false; }
    }
    function sendAct(chan, tableId, seat, move, uid, rpc, toast) {
      var sendBc = function (via) {
        try {
          chan.send({ type: 'broadcast', event: 'act', payload: { seat: seat, move: move, uid: uid, via: via || 'bc' } });
        } catch (e) {}
      };
      try {
        if (!rpc || !tableId) { sendBc('bc'); return; }
        // ★T95 乐观发送: 广播先行(消掉 RPC 往返的串行延迟, guest 出牌体感减半),
        //   RPC 放后台跑做 JWT→座位绑定校验 + eh_logs 审计。host 的 acceptMove 用 uid 重映射兜底
        //   (gtAcceptRemoteAct 先按 uid 认座位, 合法玩家 uid 必匹配 → 立即放行), 非伪造者零等待。
        sendBc('bc');
        rpc(tableId, seat, move).then(function (res) {
          var data = res && res.data;
          var err = res && res.error;
          if (err) return;                       // RPC 失败只丢审计, 动作已送达 host(已校验), 不回滚
          if (data && data.ok === false) {
            // JWT 绑座失败(真正伪造/席位已重分配): host 端 uid 重映射已拦伪造, 这里仅审计记录
            try { if (console && console.debug) console.debug('[gt-net] act audit rejected', data.error); } catch (e) {}
            return;
          }
          // RPC 成功: 审计记账完成(动作已即时生效, 无需补发)
        }, function () { /* RPC 网络失败: 同上, 动作已送达, 静默丢审计 */ });
      } catch (e) { sendBc('bc'); }
    }
    // host 侧 act 授权(支持 requireViaRpc: 有 via 字段时只认 rpc, 兼容旧客户端无 via)
    function acceptMove(seats, seat, move, payloadUid, opts) {
      opts = opts || {};
      if (!seats || typeof seat !== 'number') return { ok: false, reason: 'bad_seat' };
      var remote = seats.remoteSeats;
      if (!Array.isArray(remote) || remote.indexOf(seat) < 0) return { ok: false, reason: 'not_remote' };
      var seatUid = seats.ids && seats.ids[seat];
      if (payloadUid && seatUid && String(payloadUid) !== String(seatUid)) return { ok: false, reason: 'uid_mismatch' };
      // via=rpc 是首选(服务端 JWT 绑座位)。但 RPC 挂掉/日志表炸过会让客人只能走 broadcast:
      //   此时若一刀切 requireViaRpc 拒掉, 该客人【整局都出不了牌】。双方 uid 都在且一致的 bc 降级放行。
      if (opts.via && opts.via !== 'rpc' && opts.requireViaRpc) {
        var uidVerified = !!(payloadUid && seatUid && String(payloadUid) === String(seatUid));
        if (!uidVerified) return { ok: false, reason: 'via_not_rpc' };
      }
      return { ok: true, seat: seat, via: opts.via || 'unknown' };
    }
    return Object.freeze({
      stamp: stamp,
      resetSeq: resetSeq,
      setSeq: setSeq,
      acceptMove: acceptMove,
      resumeRemote: resumeRemote,
      sendAct: sendAct,
    });
  }
  root.EH_GT_NET_MODULE = Object.freeze({ createGtNet: createGtNet });
})(typeof window !== 'undefined' ? window : this);
