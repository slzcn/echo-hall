/*
 * messages.js — 消息/历史纯逻辑(从 app.js 迁出, 第 5 阶段实现)
 * journey-exempt: journey-chat-core.js + journey-finish-all.js
 */
(function (root) {
  'use strict';
  function required(name, value) {
    if (typeof value !== 'function') throw new TypeError('[EH_MESSAGES] missing ' + name);
    return value;
  }
  function midKey(user_id, text) {
    return (user_id || '') + '\x01' + String(text || '').trim().slice(0, 200);
  }
  function dedupProjInHistory(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return rows || [];
    var msgKeys = {};
    rows.forEach(function (m) {
      if (!m || m.kind === 'proj' || !m.user_id || !m.text) return;
      msgKeys[midKey(m.user_id, m.text)] = 1;
    });
    rows.forEach(function (m) {
      if (!m || m.kind !== 'proj' || !m.user_id || !m.text) return;
      if (msgKeys[midKey(m.user_id, m.text)]) m._skipHist = true;
    });
    return rows;
  }
  function dedupPlan(candidates) {
    var seen = {}, removeIdx = [];
    (candidates || []).forEach(function (c, i) {
      if (!c || !c.mid || c.isLocal) return;
      if (!Object.prototype.hasOwnProperty.call(seen, c.mid)) { seen[c.mid] = i; return; }
      var pi = seen[c.mid];
      if (c.len > ((candidates[pi] && candidates[pi].len) || 0)) { removeIdx.push(pi); seen[c.mid] = i; }
      else removeIdx.push(i);
    });
    return removeIdx;
  }
  function shouldPersistSnap(now, lastAt, gapMs) {
    gapMs = gapMs || 3000;
    if (!now) return false;
    return !lastAt || (now - lastAt) >= gapMs;
  }
  function snapPayload(rid, html, at) {
    if (!rid || !html) return null;
    return { rid: rid, html: html, at: at || Date.now() };
  }
  function canRestoreSnap(snap, rid) {
    return !!(snap && snap.rid && rid && snap.rid === rid && snap.html);
  }
  function stillInRoom(curRid, enterRid) {
    return !!curRid && curRid === enterRid;
  }

  function isTrustedVoiceSrc(src, prefixes) {
    src = String(src || '');
    if (!src) return false;
    if (src.indexOf('blob:') === 0) return true;
    var list = prefixes || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && src.indexOf(list[i]) === 0) return true;
    }
    return false;
  }
  function messageKindLabel(kind, text) {
    kind = kind || 'msg';
    if (kind === 'voice') return '🎙️ 语音消息';
    if (kind === 'song') return '🎵 神曲';
    if (kind === 'proj') return '📽️ 投影';
    if (kind === 'game') return '🎴 牌局';
    return '消息';
  }
  function echoStateBump(state, mid, emoji, mine) {
    if (!state || !mid || !emoji) return state || {};
    var rec = state[mid] || (state[mid] = {});
    if (!rec[emoji]) rec[emoji] = { count: 0, mine: false };
    if (mine) rec[emoji].mine = true;
    rec[emoji].count = (rec[emoji].count || 0) + (mine ? 0 : 1);
    return state;
  }
  function shouldStreamKind(kind) {
    return kind === 'song' || kind === 'act';
  }
  function createMessagesController(deps) {
    deps = deps || {};
    return Object.freeze({
      subscribe: required('subscribe', deps.subscribe),
      loadHistory: required('loadHistory', deps.loadHistory),
      refreshSnapshotTail: required('refreshSnapshotTail', deps.refreshSnapshotTail),
      buildMessage: required('buildMessage', deps.buildMessage),
      persistSnapshot: required('persistSnapshot', deps.persistSnapshot),
      dedupProjInHistory: dedupProjInHistory,
      dedupPlan: dedupPlan,
      midKey: midKey,
      shouldPersistSnap: shouldPersistSnap,
      snapPayload: snapPayload,
      canRestoreSnap: canRestoreSnap,
      stillInRoom: stillInRoom,
      isTrustedVoiceSrc: isTrustedVoiceSrc,
      messageKindLabel: messageKindLabel,
      echoStateBump: echoStateBump,
      shouldStreamKind: shouldStreamKind,
    });
  }
  var api = Object.freeze({
    createMessagesController: createMessagesController,
    dedupProjInHistory: dedupProjInHistory,
    dedupPlan: dedupPlan,
    midKey: midKey,
    shouldPersistSnap: shouldPersistSnap,
    snapPayload: snapPayload,
    canRestoreSnap: canRestoreSnap,
    stillInRoom: stillInRoom,
    isTrustedVoiceSrc: isTrustedVoiceSrc,
    messageKindLabel: messageKindLabel,
    echoStateBump: echoStateBump,
    shouldStreamKind: shouldStreamKind,
  });
  if (root) root.EH_MESSAGES_MODULE = api;
  return api;
})((typeof window !== 'undefined') ? window : ((typeof globalThis !== 'undefined') ? globalThis : this));
if (typeof module !== 'undefined' && module.exports) module.exports = (typeof window !== 'undefined' ? window.EH_MESSAGES_MODULE : null) || (typeof globalThis !== 'undefined' ? globalThis.EH_MESSAGES_MODULE : null);
