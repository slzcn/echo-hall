// poker-server-mode.js — 德州服务端 Edge Function 模式(暂不使用, 未来一键启用)
// 启用方法: 在 index.html 引入本文件, 然后设置 window.EH_SERVER_HOST = true
// 本文件包含 _gtEnterPokerServer 和 gtPokerAction, 完整的服务端德州逻辑。
// 当前架构: 真人 host 模式(引擎跑浏览器), 本文件不参与运行。
(function(root){
  'use strict';
async function gtPokerAction(tableId, action, amount) {
  try {
    var body = { table_id: tableId, action: action, uid: myUid };
    if (amount != null) body.amount = amount;
    var res = await sb.functions.invoke('eh-poker-action', { body: body });
    if (res.error) {
      console.warn('[nlhe] poker action error', res.error.message);
      toast('操作失败: ' + (res.error.message || '未知错误'));
    }
  } catch(e) {
    _ehCatch('gtPokerAction', e);
    toast('网络错误, 请重试');
  }
}

async function _gtEnterPokerServer(row) {
  if (!(window.EHGameLoader && window.EHGameLoader.isReady('poker'))) {
    var __args = arguments, __self = _gtEnterPokerServer;
    toast('牌桌加载中…');
    if (window.EHGameLoader) {
      window.EHGameLoader.ensure('poker').then(function() {
        try { __self.apply(null, __args); } catch(e) { try { console.warn('relaunch fail', e); } catch(_) {} _ehCatch('gameRelaunch', e); }
      }).catch(function(e) { try { console.warn('game load failed', e); } catch(_) {} _ehCatch('gameLoad', e); toast('游戏加载失败，请刷新页面'); });
    } else { toast('游戏加载器未初始化，请刷新页面'); }
    return;
  }
  if (!ehDailyPlayGate('nlhe')) return;

  try {
    var _preA = gtSeatArrays(row);
    if (row.status === 'playing' && _preA.mySeat < 0) {
      try { toast('当前手牌进行中 · 旁观等下一手再入座', 2500); } catch(_) {}
      if (!_gtWaitingHumans.includes(myUid)) { _gtWaitingHumans.push(myUid); }
      try {
        var _waitChan = sb.channel('gt-play:' + row.id);
        _waitChan.send({type:'broadcast', event:'waiting_seat', payload:{uid: myUid, tableId: row.id}});
      } catch(_) {}
      gtSpectatePoker(row);
      return;
    }
  } catch(_) {}

  row = await gtEnsureSeated(row);
  var A = gtSeatArrays(row);
  if (A.mySeat < 0) {
    try { const fresh = await gtEnsureRow(row.id); if (fresh) { row = fresh; _gtTables.set(row.id, row); A = gtSeatArrays(row); } } catch(_) {}
  }
  if (A.mySeat < 0) { try { toast('暂时没座，点空位入座'); } catch(_) {} gtSpectatePoker(row); return; }

  var inLobby = row.status === 'lobby';
  _gtCleanupPlay();
  var lastPulled = -1;
  var chan = sb.channel('gt-play:' + row.id); _gtPlayChan = chan;
  var tableId = row.id;

  var pull = function(tries) { gtPullHoleCards(tableId, tries); };

  chan.on('broadcast', {event:'snap'}, function(payload) {
    var snap = payload && payload.payload;
    gtMarkHumanAct();   // ★v87 fix Bug2: 快照广播=桌上在动, 刷新 idleClose 时钟(覆盖 AI/灵魂出牌+resync)
    if (!_ehGame || !_ehGame.applySnapshot || !snap) return;
    try { _ehGame.applySnapshot(snap); } catch(e) { _ehCatch('applySnapshot', e); window.ehReportError('manual', 'snapshot_apply_failed', { error: e && e.message }); }
    try { _gtSnapCacheSet(tableId, snap); } catch(_) {}
    // ★v82 无房主: 当前手牌结束(showdown/over)后, 由【在座真人】延迟 4s 触发 start_hand 开下一手。
    //   服务端 start_hand 幂等(已有进行中手牌→hand_in_progress), 多端同时触发只有首个生效, 不重发。
    if ((snap.phase === 'over' || snap.phase === 'showdown') && !_gtNextHandPending) {
      _gtNextHandPending = true;
      var _nhHand = snap.handNo;
      setTimeout(function() {
        _gtNextHandPending = false;
        var _fr2 = _gtTables.get(tableId);
        if (!_fr2 || _fr2.status !== 'playing') return;

        //   筹码随身份迁移保持不变; 目标已被占 → 清除预约 + toast 提示。换位链自行触发 start_hand, 否则照常开下一手。
        try {
          var _rsv = (_ehGame && typeof _ehGame.seatReserve === 'function') ? _ehGame.seatReserve() : null;
          if (_rsv && typeof _rsv.target === 'number') {
            var _A = gtSeatArrays(_fr2);
            if (_A.mySeat >= 0 && _rsv.target !== _A.mySeat) {
              var _tgt = (_fr2.seats || []).find(function(x){ return x && x.seat === _rsv.target; });
              if (_tgt && (_tgt.kind === 'empty' || !_tgt.kind)) {
                gtLeave(tableId).then(function(){ return gtJoin(tableId, _rsv.target); })
                  .then(function(){
                    try { if (_ehGame && _ehGame.clearSeatReserve) _ehGame.clearSeatReserve(); } catch(_){}
                    sb.functions.invoke('eh-poker-action', { body: { table_id: tableId, action: 'start_hand' } }).catch(function(){});
                  })
                  .catch(function(e){
                    try { if (_ehGame && _ehGame.clearSeatReserve) _ehGame.clearSeatReserve(); } catch(_){}
                    try { toast('换位失败，下局再试'); } catch(_){}
                    sb.functions.invoke('eh-poker-action', { body: { table_id: tableId, action: 'start_hand' } }).catch(function(){});
                  });
                return;   // 换位链异步自行触发 start_hand, 不走下面
              } else {
                try { toast('该座位已被占用', 2200); } catch(_){}
                try { if (_ehGame && _ehGame.clearSeatReserve) _ehGame.clearSeatReserve(); } catch(_){}
              }
            }
          }
        } catch(_) {}
        sb.functions.invoke('eh-poker-action', { body: { table_id: tableId, action: 'start_hand' } }).catch(function(){});
      }, 4000);
    }
    if (snap.handNo !== lastPulled) {
      lastPulled = snap.handNo;
      if (_gtWaitNextHand.has(myUid)) { _gtWaitNextHand.delete(myUid); _gtRemoveAwayBar(); }
      pull();
    } else if (lastPulled >= 0 && _ehGame && typeof _ehGame.needsHand === 'function' && _ehGame.needsHand()) {
      pull();
    }
  });

  chan.on('broadcast', {event:'dissolve'}, function() {
    try { if (_ehGame && typeof _ehGame.close === 'function') _ehGame.close(); } catch(_) {}
    try { _ehGame = null; } catch(_) {}
    _gtCleanupPlay(); try { toast('牌桌已解散'); } catch(_) {}
    try { _gtHideTableCard(tableId); } catch(_) {}
  });

  chan.on('broadcast', {event:'seat_taken'}, function() {
    try { if (_ehGame && _ehGame.renderAll) _ehGame.renderAll(); } catch(_) {}
  });

  chan.on('broadcast', {event:'seat_open'}, function(p) {
    if (p && p.payload && p.payload.tableId === tableId) {
      try { _gtGrabSeat(_gtTables.get(tableId) || row); } catch(_) {}
    }
  });

  gtBindConnStatus(chan, { onReconnected: function() { try { chan.send({type:'broadcast', event:'hello', payload:{uid: myUid}}); } catch(_) {} } });

  _gtMyBeatTimer = setInterval(function() {
    try { if (_gtPlayChan) { _gtPlayChan.send({type:'broadcast', event:'player_beat', payload:{uid: myUid, seat: A.mySeat, ts: Date.now()}}); } } catch(_) {}
  }, 8000);

  chan.on('broadcast', {event:'player_offline'}, function(p) {
    if (p && p.payload && p.payload.uid) {
      _gtOfflineSeats.add(p.payload.uid);
      try { if (_ehGame && _ehGame.setOfflineUids) { _ehGame.setOfflineUids(Array.from(_gtOfflineSeats)); } } catch(_) {}
    }
  });

  chan.on('broadcast', {event:'waiting_seat'}, function(p) {
    if (p && p.payload && p.payload.tableId === tableId) {
      var uid = p.payload.uid;
      if (uid && !_gtWaitingHumans.includes(uid)) { _gtWaitingHumans.push(uid); }
    }
  });

  _gtActiveTable = {id: tableId, host: false};
  _setPokerState('guest', tableId);

  // ★v103 乐观进入: 牌桌 UI 先挂起(不等筹码 RPC), 后台读 eh_chips 更新 _gtMyFinalStack;
  //   真实 stack 由首帧快照覆盖(见 rebuildFromSnap), 招募态短暂显示初始授权额(PK_WALLET_GRANT)无实质影响。
  var _pkMyStack = PK_WALLET_GRANT;
  _gtMyFinalStack = _pkMyStack;

  _ehGame = window.EHPokerGame.open({
    scoreKey: 'gtsc:' + row.id,
    mode: 'guest',
    names: A.names, avatars: A.avatars, isAI: A.isAI, souls: A.souls, ids: A.ids,
    mySeat: A.mySeat, remoteSeats: A.remoteSeats,
    lobby: inLobby, isHost: false, lobbySeats: row.seats, lobbyCtx: gtCtx(row),
    sb: 50, bb: 100, startStack: _pkMyStack,
    myStack: _pkMyStack,
    onWallet: function(v) { _gtMyFinalStack = Math.max(0, Math.round(Number(v) || 0)); },
    chat: ehGameChatBridge(),
    onDissolve: function() { try { if (row && row.id) gtClose(row.id); } catch(_) {} try { _gtCleanupPlay(); } catch(_) {} },
    onAction: function(move) { gtPokerAction(tableId, move.action, move.amount); },
    onSeatResume: function(seat) { var sd = (typeof seat === 'number') ? seat : A.mySeat; try { chan.send({type:'broadcast', event:'resume', payload:{seat: sd, uid: myUid}}); } catch(_) {} },
    onSeatIdle: function(seat, info) {
      if (info && info.vacate && info.mine) {
        try { gtSettleChipsToGlobal(_gtMyFinalStack); } catch(_) {}
        try { gtLeave(tableId); } catch(_) {}
        try { gtCheckNoHumansThenClose(row); } catch(_) {}
        _gtBroadcastPlayerAway(tableId);
        _gtCleanupPlay();
        _setPokerState('spectator', tableId);
        setTimeout(function() {
          var fresh = _gtTables.get(tableId);
          if (fresh && fresh.status !== 'closed') {
            try { gtSpectatePoker(fresh); } catch(e) { _ehCatch('onBust_spectate', e); }
            _gtShowAwayBar(tableId);
          }
        }, 300);
      }
    },
    onGrabSeat: function() { _gtGrabSeat(row); },
    onBust: function() {
      try { gtSettleChipsToGlobal(_gtMyFinalStack); } catch(_) {}
      try { gtRpc('eh_gt_set_away', {p_table: row.id, p_away: true}); } catch(_) {}
      try { gtCheckNoHumansThenClose(row); } catch(_) {}
      _gtBroadcastPlayerAway(row.id);
      _gtCleanupPlay();
      _setPokerState('spectator', row.id);
      setTimeout(function() {
        var fresh = _gtTables.get(row.id);
        if (fresh && fresh.status !== 'closed') {
          try { gtSpectatePoker(fresh); } catch(e) { _ehCatch('onBust_spectate', e); }
          _gtShowAwayBar(row.id);
        }
      }, 300);
    },
    onBustCount: function() { try { ehRecordBust('nlhe'); } catch(_) {} },
    onExit: function() {
      if(_gtReleasingHolder) return;   // ★让位非离场: 跳过 away 标记
      try { gtSettleChipsToGlobal(_gtMyFinalStack); } catch(_) {}
      _setPokerState('away', tableId);
      _gtBroadcastPlayerAway(tableId);
      try { gtRpc('eh_gt_set_away', {p_table: tableId, p_away: true}); } catch(_) {}
      try { gtCheckNoHumansThenClose(row); } catch(_) {}
      _gtCleanupPlay();
    },
  });
  // ★v103 后台读真实筹码(不阻塞 UI 挂起); 到账后更新 _gtMyFinalStack 供离桌结算, 真实 stack 由首帧快照覆盖。
  gtReadChipsReadOnly().then(function(_gchips){ _gtMyFinalStack = _gchips; }).catch(function(e){ _ehCatch('gtBuyInFlow', e); });
  _gtStartTurnAlert();
  _gtPokerBindUnload(tableId);
  // ★v82 无房主服务端模式: 进桌后触发 start_hand(Edge Function 发牌+广播脱敏快照)。
  //   服务端 start_hand 幂等: 已有进行中手牌→hand_in_progress(不重复发牌); 当前手牌结束→开新一手。
  //   need_2_seated(灵魂尚未入座完成)时短延时重试, 其余错误静默(不打扰)。
  if (row && row.status === 'playing') {

    sb.functions.invoke('eh-poker-action', { body: { table_id: tableId, action: 'get_state' } })
      .then(function(res){
        var d = res && res.data;
        if (d && d.ok && d.snap && _ehGame && _ehGame.applySnapshot) {
          try { _ehGame.applySnapshot(d.snap); } catch(e) { _ehCatch('applySnapshot_getstate', e); }
          try { _gtSnapCacheSet(tableId, d.snap); } catch(_) {}
          if (d.snap.handNo !== lastPulled) { lastPulled = d.snap.handNo; pull(); }
        }
      }).catch(function(){ /* silent */ });

    //   need_2_seated(灵魂未入座)时短延时重试; 重试耗尽→提示用户
    (function _tryStartHand(tries){
      tries = tries || 0;
      sb.functions.invoke('eh-poker-action', { body: { table_id: tableId, action: 'start_hand' } })
        .then(function(res){
          var d = res && res.data, err = (d && d.ok===false) ? d.error : ((res && res.error) ? res.error.message : '');
          if (err === 'need_2_seated' && tries < 12) { setTimeout(function(){ _tryStartHand(tries+1); }, 400); }
          else if (err === 'need_2_seated') { try{ toast('灵魂入座超时，请稍后重试或手动召唤灵魂'); }catch(_){} }
          else if (err && err !== 'hand_in_progress') { try{ toast('开局失败: ' + err); }catch(_){} }
        }).catch(function(){ try{ toast('开局请求失败，请检查网络'); }catch(_){} });
    })();
  }
  setTimeout(pull, 800);
  setTimeout(function() { try { if (_gtPlayChan) _gtPlayChan.send({type:'broadcast', event:'hello', payload:{uid: myUid}}); } catch(_) {} }, 500);
}
  // 导出到全局, 供 app.js 在 EH_SERVER_HOST=true 时调用
  root._gtEnterPokerServer = _gtEnterPokerServer;
  root.gtPokerAction = gtPokerAction;
})(window);
