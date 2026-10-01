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
        rpc(tableId, seat, move).then(function (res) {
          var data = res && res.data;
          var err = res && res.error;
          if (err) { sendBc('bc'); return; }
          if (data && data.ok === false) {
            // RPC 校验没过(座位写错/状态漂移)也回退 broadcast: uid 还会对, host 按 uid 认座位;
            //   一刀切 return 会让客人干等 8s 超时再弹「出牌没成功」。
            sendBc('bc');
            return;
          }
          // RPC 成功: 标记 via=rpc, host 可据此收紧密性
          sendBc('rpc');
        }, function () { sendBc('bc'); });
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
