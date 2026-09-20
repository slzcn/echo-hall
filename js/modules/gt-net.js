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
      var sendBc = function () {
        try {
          chan.send({ type: 'broadcast', event: 'act', payload: { seat: seat, move: move, uid: uid } });
        } catch (e) {}
      };
      try {
        if (!rpc || !tableId) { sendBc(); return; }
        rpc(tableId, seat, move).then(function (res) {
          var data = res && res.data;
          var err = res && res.error;
          if (err) { sendBc(); return; }
          if (data && data.ok === false) {
            if (toast) { try { toast('出牌未通过座位校验，请刷新牌桌'); } catch (e) {} }
            return;
          }
          sendBc();
        }, function () { sendBc(); });
      } catch (e) { sendBc(); }
    }
    return Object.freeze({
      stamp: stamp,
      resetSeq: resetSeq,
      acceptMove: acceptMove,
      resumeRemote: resumeRemote,
      sendAct: sendAct,
    });
  }
  root.EH_GT_NET_MODULE = Object.freeze({ createGtNet: createGtNet });
})(typeof window !== 'undefined' ? window : this);
