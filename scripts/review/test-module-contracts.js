#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../../');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const copyInviteInitAt = appSource.indexOf('const copyInvite = window.EH_LOBBY_MODULE.createCopyInvite');
const myRoomsInitAt = appSource.indexOf('const renderMyRooms = window.EH_LOBBY_MODULE.createRenderMyRooms');
if (copyInviteInitAt < 0 || myRoomsInitAt < 0 || copyInviteInitAt > myRoomsInitAt) {
  throw new Error('lobby: copyInvite must initialize before renderMyRooms dependency injection');
}
console.log('PASS lobby: app wiring initializes copyInvite before renderMyRooms');

const modules = [
  ['lobby', 'EH_LOBBY_MODULE', 'createLobbyController', ['render', 'renderOfficial', 'renderPublic', 'renderMyRooms', 'showRetry', 'fillRoomStats', 'prefetchRoom', 'prefetchAll']],
  ['auth', 'EH_AUTH_MODULE', 'createAuthController', ['api', 'awaitReady', 'resolveSession', 'ensure', 'saveIdentity', 'loadOrRollIdentity', 'logout']],
  ['bgm', 'EH_BGM_MODULE', 'createBgmController', ['on', 'set', 'init', 'buildMenu', 'startLobby', 'startRoom', 'playAI', 'playLegacy', 'generate']],
  ['room', 'EH_ROOM_MODULE', 'createRoomController', ['enter', 'back', 'leave', 'clearLast']],
  ['messages', 'EH_MESSAGES_MODULE', 'createMessagesController', ['subscribe', 'loadHistory', 'refreshSnapshotTail', 'buildMessage', 'persistSnapshot']],
];

const context = { window: {} };
context.window.window = context.window;
vm.createContext(context);

const lobbyFile = path.join(root, 'js/modules', 'lobby.js');
vm.runInContext(fs.readFileSync(lobbyFile, 'utf8'), context, { filename: lobbyFile });
if (typeof context.window.EH_LOBBY_MODULE.fmtAgo !== 'function') throw new Error('lobby: fmtAgo missing');
const agoNow = context.window.EH_LOBBY_MODULE.fmtAgo(new Date().toISOString());
if (agoNow !== '刚刚') throw new Error(`lobby: fmtAgo immediate value mismatch: ${agoNow}`);
console.log('PASS lobby: fmtAgo pure helper is exported');

// 回归：复制能力与提示函数可能晚于模块初始化，调用时必须读取最新依赖。
(async function testLateRuntimeForCopyInvite() {
  const lobby = context.window.EH_LOBBY_MODULE;
  let nav = null, toastText = '', copied = 0;
  const el = { classList: { add: () => { copied += 1; }, remove: () => {} } };
  const copy = lobby.createCopyInvite({
    getNavigator: () => nav,
    getDocument: () => ({ createElement: () => ({ style: {}, select: () => {} }), body: { appendChild: () => {}, removeChild: () => {} }, execCommand: () => true }),
    getToast: () => text => { toastText = text; },
    getConfig: () => ({ text: { ok_codeCopied: '复制成功' } }),
    getSchedule: () => setTimeout,
  });
  nav = { clipboard: { writeText: async code => { if (code !== 'late-code') throw new Error('code mismatch'); } } };
  await copy('late-code', el);
  await Promise.resolve();
  if (copied !== 1 || toastText !== '复制成功') throw new Error('lobby: copyInvite did not resolve late clipboard dependency');
  console.log('PASS lobby: copyInvite resolves late clipboard dependency');
})().catch(err => { console.error(err); process.exitCode = 1; });

for (const [name, globalName, factoryName, keys] of modules) {
  const file = path.join(root, 'js/modules', `${name}.js`);
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const api = context.window[globalName];
  if (!api || typeof api[factoryName] !== 'function') throw new Error(`${name}: factory missing`);
  const deps = Object.fromEntries(keys.map(k => [k, typeof k === 'string' ? (() => k) : null]));
  const controller = api[factoryName](deps);
  for (const key of keys) {
    if (typeof controller[key] !== 'function') throw new Error(`${name}: ${key} not callable`);
  }
  if (!Object.isFrozen(controller)) throw new Error(`${name}: controller not frozen`);
  let rejected = false;
  try { api[factoryName]({}); } catch (err) { rejected = /missing dependency/.test(String(err)); }
  if (!rejected) throw new Error(`${name}: missing dependency was not rejected`);
  console.log(`PASS ${name}: ${keys.length} dependencies, frozen, missing-dependency guard`);
}

// 回归：Supabase 客户端在 app.js 解析时有意为 null，bootSupabase() 稍后才赋值。
// createPrefetch 必须延迟读取最新客户端，不能在工厂创建时捕获 null 并中断整份 app.js。
(async function testLateSupabaseInit() {
  const lobby = context.window.EH_LOBBY_MODULE;
  let lateSb = null;
  let soulsCalls = 0;
  let rpcCalls = 0;
  const prefetch = lobby.createPrefetch({
    getSb: () => lateSb,
    prefetchCache: {},
    prefetchSouls: () => { soulsCalls += 1; },
    readN: () => 12,
    readTtl: () => 60000,
  });
  const beforeBoot = await prefetch.prefetchRoom('late-room', 'official');
  if (!Array.isArray(beforeBoot) || beforeBoot.length !== 0 || soulsCalls !== 0) {
    throw new Error('lobby: prefetch before Supabase boot must safely return []');
  }
  lateSb = {
    rpc: async (name, args) => {
      rpcCalls += 1;
      if (name !== 'eh_public_recent' || args.rid !== 'late-room' || args.lim !== 12) throw new Error('lobby: late Supabase arguments mismatch');
      return { data: [{ id: 7 }] };
    },
  };
  const afterBoot = await prefetch.prefetchRoom('late-room', 'official');
  if (afterBoot.length !== 1 || afterBoot[0].id !== 7 || soulsCalls !== 1 || rpcCalls !== 1) {
    throw new Error('lobby: late Supabase client was not read at call time');
  }
  console.log('PASS lobby: late Supabase init is resolved at prefetch call time');
})().catch(err => { console.error(err); process.exitCode = 1; });

// 回归：fillRoomStats 创建时 sb 尚未 boot，调用时才读取最新客户端。
(async function testLateSupabaseForFillStats() {
  const lobby = context.window.EH_LOBBY_MODULE;
  let lateSb = null;
  let prefetchCalls = 0;
  const card = {
    dataset: { kind: 'official', nm: '大厅' },
    querySelector: (selector) => {
      if (selector === '.cnt') return { textContent: '' };
      if (selector === '[data-prev]') return { classList: { add() {}, remove() {} }, textContent: '', innerHTML: '' };
      if (selector === '.tm') return { textContent: '' };
      return null;
    },
  };
  const box = { querySelector: () => card };
  const fill = lobby.createFillRoomStats({
    getSb: () => lateSb,
    prefetchRoom: async () => { prefetchCalls += 1; return []; },
    msgPreview: () => '',
    roomAccentC: () => '#000',
    esc: (x) => String(x),
    fmtAgo: () => '刚刚',
  });
  await fill(box, 'late-room');
  if (prefetchCalls !== 0) throw new Error('lobby: fillRoomStats touched prefetch before Supabase boot');
  lateSb = { from: () => ({ select: () => ({ eq: () => ({ gte: async () => ({ count: 2 }) }) }) }) };
  await fill(box, 'late-room');
  if (prefetchCalls !== 1) throw new Error('lobby: fillRoomStats did not use late Supabase client');
  console.log('PASS lobby: fillRoomStats resolves late Supabase at call time');
})().catch(err => { console.error(err); process.exitCode = 1; });

// 回归：重试入口创建时认证与 renderLobby 尚未就绪，点击时必须读取最新运行时依赖。
(async function testLateRuntimeForLobbyRetry() {
  const lobby = context.window.EH_LOBBY_MODULE;
  let lateUid = null, lateRender = null, authCalls = 0, readyCalls = 0;
  const retryEl = {};
  const box = { innerHTML: '', querySelector: selector => selector === '.lobby-retry' && box.innerHTML.includes('lobby-retry') ? retryEl : null };
  const showRetry = lobby.createLobbyShowRetry({
    getBox: () => box, chSkel: n => `<skeleton count="${n}">`,
    awaitReady: async ms => { if (ms !== 8000) throw new Error('lobby: retry timeout mismatch'); readyCalls += 1; },
    getMyUid: () => lateUid,
    ensureAuth: async () => { authCalls += 1; lateUid = 'late-user'; },
    getRenderLobby: () => lateRender,
  });
  showRetry();
  if (typeof retryEl.onclick !== 'function') throw new Error('lobby: retry handler was not installed');
  const renderCalls = [];
  lateRender = soft => { renderCalls.push(soft); };
  lateRender.resetRetry = () => { renderCalls.push('reset'); };
  await retryEl.onclick(); await Promise.resolve();
  if (readyCalls !== 1 || authCalls !== 1 || renderCalls[0] !== 'reset' || !renderCalls.includes(false) || !renderCalls.includes(true)) {
    throw new Error('lobby: retry did not resolve late auth/render dependencies at click time');
  }
  console.log('PASS lobby: retry resolves late auth/render dependencies at click time');
})().catch(err => { console.error(err); process.exitCode = 1; });

// 回归：大厅协调器创建时身份尚未恢复，渲染时必须读取最新身份，不能捕获空值。
(async function testLateIdentityForLobbyRender() {
  const lobby = context.window.EH_LOBBY_MODULE;
  let lateMe = null, themeCalls = 0;
  const nameEl = { textContent: '', style: {} };
  const render = lobby.createRenderLobby({
    initThemeUI: () => { themeCalls += 1; },
    getMe: () => lateMe,
    getNameEl: () => nameEl,
    renderOfficial: async () => {}, renderPublic: async () => {}, renderMyRooms: async () => {},
    isLobbyActive: () => true, showRetry: () => {}, schedule: () => 1,
  });
  await render(false);
  if (nameEl.textContent !== '' || themeCalls !== 1) throw new Error('lobby: render before identity restore must stay safe');
  lateMe = { name: '迟到身份', color: '#123456' };
  await render(true);
  if (nameEl.textContent !== '迟到身份' || nameEl.style.color !== '#123456' || themeCalls !== 1) {
    throw new Error('lobby: render did not resolve late identity at call time');
  }
  console.log('PASS lobby: renderLobby resolves late identity at call time');
})().catch(err => { console.error(err); process.exitCode = 1; });


// 回归：renderPublic 创建时 sb 尚未 boot，调用时才读取最新客户端，并按公开房间查询。
(async function testLateSupabaseForPublicRender() {
  const lobby = context.window.EH_LOBBY_MODULE;
  let lateSb = null;
  let queryArgs = null;
  let fillCalls = 0;
  const box = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  Object.defineProperty(box, 'children', { get: () => box.innerHTML ? [{}] : [] });
  const empty = { style: {} };
  const render = lobby.createRenderPublic({
    getSb: () => lateSb,
    roomsQuery: async q => q,
    getBox: () => box,
    getEmpty: () => empty,
    chSkel: () => '<skeleton>',
    fillRoomStats: () => { fillCalls += 1; },
    prefetchAll: () => {},
    getConfig: () => ({}),
    roomAccentC: () => '#000',
    esc: value => String(value),
    safeEmoji: value => value || '○',
    autoTopic: () => '默认话题',
    bindRoomCards: () => {},
  });
  const beforeBoot = await render(false);
  if (!beforeBoot || !beforeBoot.failed) throw new Error('lobby: public render before Supabase boot must fail safely');
  lateSb = {
    from: table => ({
      select: fields => ({
        eq: (field, value) => ({
          eq: (field2, value2) => ({
            order: (field3, options) => {
              queryArgs = { table, fields, field, value, field2, value2, field3, options };
              return Promise.resolve({ data: [] });
            },
          }),
        }),
      }),
    }),
  };
  await render(false);
  if (!queryArgs || queryArgs.table !== 'eh_rooms' || queryArgs.value !== 'public' || queryArgs.value2 !== false || queryArgs.options.ascending !== false || fillCalls !== 0) {
    throw new Error('lobby: public render did not use late Supabase client or public query');
  }
  console.log('PASS lobby: renderPublic resolves late Supabase at call time');
})().catch(err => { console.error(err); process.exitCode = 1; });


// 回归：私密房列表创建时 sb 尚未 boot，调用时才读取最新客户端。
(async function testLateSupabaseForMyRooms() {
  const lobby = context.window.EH_LOBBY_MODULE;
  let lateSb = null, queryCalled = 0;
  const box = { innerHTML: '', children: [], querySelector: () => null, querySelectorAll: () => [] };
  const empty = { style: {} };
  const render = lobby.createRenderMyRooms({
    getSb: () => lateSb, roomsQuery: async q => { queryCalled += 1; return q; }, getMyUid: () => 'user-1',
    getBox: () => box, getEmpty: () => empty, rmSkel: () => '<skeleton>', prefetchAll: () => {}, getConfig: () => {},
    esc: value => String(value), safeEmoji: value => value || '○', readKnownOnline: () => null,
    enterRoom: () => {}, copyInvite: () => {},
  });
  const beforeBoot = await render(false);
  if (!beforeBoot || !beforeBoot.failed || queryCalled !== 0) throw new Error('lobby: my rooms before Supabase boot must fail safely');
  lateSb = { from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ id: 'r1', name: '私密房', emoji: '◇', owner: 'user-1' }] }) }) }) }) };
  await render(false);
  if (queryCalled !== 1 || !box.innerHTML.includes('私密房')) throw new Error('lobby: my rooms did not use late Supabase client');
  console.log('PASS lobby: renderMyRooms resolves late Supabase at call time');
})().catch(err => { console.error(err); process.exitCode = 1; });
