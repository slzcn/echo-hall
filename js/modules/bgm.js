/*
 * bgm.js — BGM 纯逻辑(第 4 阶段实现)
 * journey-exempt: journey-auth-bgm-features.js
 */
(function (root) {
  'use strict';
  function required(name, value) {
    if (typeof value !== 'function' && value == null) {
      throw new TypeError('[EH_BGM] missing dependency: ' + name);
    }
    return value;
  }
  function lsBool(key) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? true : v === '1';
    } catch (e) { return true; }
  }
  function bgmOnFrom(key) { return lsBool(key); }
  function pickRoomTrack(library, roomName, randomFn) {
    var rnd = typeof randomFn === 'function' ? randomFn : Math.random;
    var all = (library || []).filter(function (x) { return x && x.url; });
    if (!all.length) return null;
    var pool = roomName ? all.filter(function (x) { return x.room_name === roomName; }) : all;
    if (!pool.length) pool = all;
    return pool[Math.floor(rnd() * pool.length) % pool.length];
  }
  function shouldSkipGen(pending, generating) {
    return !!(pending || generating);
  }
  function createBgmController(deps) {
    deps = deps || {};
    return Object.freeze({
      on: required('on', deps.on),
      set: required('set', deps.set),
      init: required('init', deps.init),
      buildMenu: required('buildMenu', deps.buildMenu),
      startLobby: required('startLobby', deps.startLobby),
      startRoom: required('startRoom', deps.startRoom),
      playAI: required('playAI', deps.playAI),
      playLegacy: required('playLegacy', deps.playLegacy),
      generate: required('generate', deps.generate),
      bgmOnFrom: bgmOnFrom,
      pickRoomTrack: pickRoomTrack,
      shouldSkipGen: shouldSkipGen,
    });
  }
  var api = Object.freeze({
    createBgmController: createBgmController,
    bgmOnFrom: bgmOnFrom,
    pickRoomTrack: pickRoomTrack,
    shouldSkipGen: shouldSkipGen,
    lsBool: lsBool,
  });
  if (root) root.EH_BGM_MODULE = api;
  return api;
})((typeof window !== 'undefined') ? window : ((typeof globalThis !== 'undefined') ? globalThis : this));
if (typeof module !== 'undefined' && module.exports) module.exports = (typeof window !== 'undefined' ? window.EH_BGM_MODULE : null) || (typeof globalThis !== 'undefined' ? globalThis.EH_BGM_MODULE : null);
