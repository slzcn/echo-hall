/*
 * room.js — 房间生命周期纯逻辑(第 5 阶段实现)
 * journey-exempt: journey-chat-core.js
 */
(function (root) {
  'use strict';
  function required(name, value) {
    if (typeof value !== 'function') throw new TypeError('[EH_ROOM] missing ' + name);
    return value;
  }
  function clearedStateKeys() {
    return ['roomSnap', 'oldestId', 'echoState', '_songReadyQueue', '_songGenQueue', 'lastUsersSnapshot'];
  }
  function canEnter(room) {
    return !!(room && room.id && room.kind);
  }
  function stillValid(room, enterRid) {
    return !!(room && room.id && enterRid && room.id === enterRid);
  }
  function shouldKeepSnap(leaveMode) {
    return leaveMode !== 'hard';
  }
  function createRoomController(deps) {
    deps = deps || {};
    return Object.freeze({
      enter: required('enter', deps.enter),
      back: required('back', deps.back),
      leave: required('leave', deps.leave),
      clearLast: required('clearLast', deps.clearLast),
      canEnter: canEnter,
      stillValid: stillValid,
      shouldKeepSnap: shouldKeepSnap,
      clearedStateKeys: clearedStateKeys,
    });
  }
  var api = Object.freeze({
    createRoomController: createRoomController,
    canEnter: canEnter,
    stillValid: stillValid,
    shouldKeepSnap: shouldKeepSnap,
    clearedStateKeys: clearedStateKeys,
  });
  if (root) root.EH_ROOM_MODULE = api;
  return api;
})((typeof window !== 'undefined') ? window : ((typeof globalThis !== 'undefined') ? globalThis : this));
if (typeof module !== 'undefined' && module.exports) module.exports = (typeof window !== 'undefined' ? window.EH_ROOM_MODULE : null) || (typeof globalThis !== 'undefined' ? globalThis.EH_ROOM_MODULE : null);
