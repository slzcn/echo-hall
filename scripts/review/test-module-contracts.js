#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../../');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const bindRoomCardsInitAt = appSource.indexOf('const bindRoomCards = window.EH_LOBBY_MODULE.createBindRoomCards');
const officialRoomsInitAt = appSource.indexOf('const renderOfficial = window.EH_LOBBY_MODULE.createRenderOfficial');
const publicRoomsInitAt = appSource.indexOf('const renderPublic = window.EH_LOBBY_MODULE.createRenderPublic');
if (bindRoomCardsInitAt < 0 || officialRoomsInitAt < 0 || publicRoomsInitAt < 0 || bindRoomCardsInitAt > officialRoomsInitAt || bindRoomCardsInitAt > publicRoomsInitAt) {
  throw new Error('lobby: bindRoomCards must initialize before room renderer dependency injection');
}
const oldBindOrderFixture = `
  const renderOfficial = createRenderOfficial({ bindRoomCards });
  const bindRoomCards = createBindRoomCards({});
`;
if (!(oldBindOrderFixture.indexOf('const renderOfficial') < oldBindOrderFixture.indexOf('const bindRoomCards'))) {
  throw new Error('lobby: bindRoomCards old-order counterexample is invalid');
}
console.log('PASS lobby: app wiring initializes bindRoomCards before room renderers (old order rejected)');
const copyInviteInitAt = appSource.indexOf('const copyInvite = window.EH_LOBBY_MODULE.createCopyInvite');
const myRoomsInitAt = appSource.indexOf('const renderMyRooms = window.EH_LOBBY_MODULE.createRenderMyRooms');
if (copyInviteInitAt < 0 || myRoomsInitAt < 0 || copyInviteInitAt > myRoomsInitAt) {
  throw new Error('lobby: copyInvite must initialize before renderMyRooms dependency injection');
}
console.log('PASS lobby: app wiring initializes copyInvite before renderMyRooms');

const bindCardsInitAt = appSource.indexOf('const bindRoomCards = window.EH_LOBBY_MODULE.createBindRoomCards');
const officialInitAt = appSource.indexOf('const renderOfficial = window.EH_LOBBY_MODULE.createRenderOfficial');
if (bindCardsInitAt < 0 || officialInitAt < 0 || bindCardsInitAt > officialInitAt) {
  throw new Error('lobby: bindRoomCards must initialize before renderOfficial dependency injection');
}
console.log('PASS lobby: app wiring initializes bindRoomCards before room renderers');

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

const knownOnline = context.window.EH_LOBBY_MODULE.readKnownOnline({ querySelector: () => ({ textContent: '12 人在线' }) });
if (knownOnline !== 12 || context.window.EH_LOBBY_MODULE.readKnownOnline({ querySelector: () => null }) !== null) {
  throw new Error('lobby: readKnownOnline parsing mismatch');
}
console.log('PASS lobby: readKnownOnline pure helper is exported');

if (typeof context.window.EH_LOBBY_MODULE.optimisticCnt !== 'function') throw new Error('lobby: optimisticCnt missing');
const cntWithKnown = context.window.EH_LOBBY_MODULE.optimisticCnt({ knownOnline: 4 });
if (!/~ <b>5<\/b> 人在线/.test(cntWithKnown)) throw new Error('lobby: optimisticCnt known value mismatch: ' + cntWithKnown);
const cntUnknown = context.window.EH_LOBBY_MODULE.optimisticCnt({});
if (!/连接中…/.test(cntUnknown)) throw new Error('lobby: optimisticCnt fallback mismatch: ' + cntUnknown);
const cntNull = context.window.EH_LOBBY_MODULE.optimisticCnt(null);
if (!/连接中…/.test(cntNull)) throw new Error('lobby: optimisticCnt null-room fallback mismatch: ' + cntNull);
console.log('PASS lobby: optimisticCnt pure helper is exported');

// 回归：房间强调色工厂创建时配置与主题解析器尚未就绪，调用时必须读取最新依赖。
(function testLateRuntimeForRoomAccent() {
  const lobby = context.window.EH_LOBBY_MODULE;
  let lateConfig = null, lateRoomThemeFor = null;
  const roomAccentC = lobby.createRoomAccentC({
    getConfig: () => lateConfig,
    getRoomThemeFor: () => lateRoomThemeFor,
  });
  if (roomAccentC(null) !== '#0ABAB5' || roomAccentC({ name: '迟到房', kind: 'public' }) !== '#1DE9B6') {
    throw new Error('lobby: room accent before config ready must use safe defaults');
  }
  lateConfig = {
    roomKindC: { official: '#111111', public: '#222222', private: '#333333' },
    roomNameC: { 专属房: '#444444' },
    roomTheme: { 官方房: 'official-theme' },
    themePalettes: { 'official-theme': { '--accent': '#555555' }, 'public-theme': { '--accent': '#666666' } },
  };
  lateRoomThemeFor = room => room.name === '迟到房' ? 'public-theme' : null;
  if (roomAccentC({ name: '专属房', kind: 'public' }) !== '#444444' || roomAccentC({ name: '官方房', kind: 'official' }) !== '#555555' || roomAccentC({ name: '迟到房', kind: 'public' }) !== '#666666') {
    throw new Error('lobby: room accent did not resolve late config or theme dependency');
  }
  console.log('PASS lobby: room accent resolves late config and theme dependency');
})();

// 回归：灵魂取色工厂创建时配置与当前房间尚未就绪，调用时必须读取最新依赖。
(function testLateRuntimeForSoulThemeColor() {
  const lobby = context.window.EH_LOBBY_MODULE;
  let lateConfig = null, lateRoom = null;
  const soulThemeColor = lobby.createSoulThemeColor({
    getConfig: () => lateConfig,
    getRoom: () => lateRoom,
    roomAccentC: room => room && room.kind === 'public' ? '#667788' : '#112233',
  });
  if (soulThemeColor('', undefined, '迟到灵魂') !== '#0ABAB5') {
    throw new Error('lobby: soul theme before config and room ready must use safe default');
  }
  lateConfig = { soulColors: { 迟到灵魂: '#445566' }, roomKindC: { official: '#102030' } };
  if (soulThemeColor('', undefined, { name: '迟到灵魂' }) !== '#445566') {
    throw new Error('lobby: soul theme did not resolve late soul color config');
  }
  lateConfig = { roomKindC: { official: '#102030' } };
  lateRoom = { id: 'late-room', kind: 'public' };
  if (soulThemeColor('', undefined, '无专属色') !== '#667788') {
    throw new Error('lobby: soul theme did not resolve late current room');
  }
  if (soulThemeColor('#ABCDEF', '#010101', '无专属色') !== '#ABCDEF') {
    throw new Error('lobby: soul theme custom color priority mismatch');
  }
  lateRoom = null;
  if (soulThemeColor('', '#010101', '无专属色') !== '#010101') {
    throw new Error('lobby: soul theme explicit fallback mismatch');
  }
  console.log('PASS lobby: soul theme resolves late config and current room dependencies');
})();

// 回归：查询超时实现可能晚于大厅模块装配；未就绪时安全失败，就绪后读取最新函数并保留超时兜底。
(async function testLateRuntimeForRoomsQuery() {
  const lobby = context.window.EH_LOBBY_MODULE;
  let lateWithTimeout = null;
  const roomsQuery = lobby.createRoomsQuery({
    getWithTimeout: () => lateWithTimeout,
    defaultTimeout: 8000,
  });
  const beforeReady = await roomsQuery(Promise.resolve({ data: ['ignored'] }));
  if (!beforeReady || !beforeReady.__timeout) throw new Error('lobby: roomsQuery before timeout dependency ready must fail safely');
  let receivedMs = 0;
  lateWithTimeout = async (query, ms) => { receivedMs = ms; return query; };
  const afterReady = await roomsQuery(Promise.resolve({ data: [{ id: 1 }] }), 3210);
  if (receivedMs !== 3210 || !afterReady.data || afterReady.data[0].id !== 1) {
    throw new Error('lobby: roomsQuery did not resolve late timeout dependency');
  }
  lateWithTimeout = async () => { throw new Error('slow network'); };
  const timedOut = await roomsQuery(Promise.resolve({ data: [] }));
  if (!timedOut || !timedOut.__timeout) throw new Error('lobby: roomsQuery timeout fallback mismatch');
  console.log('PASS lobby: roomsQuery resolves late timeout dependency and fails safely');
})().catch(err => { console.error(err); process.exitCode = 1; });

// 回归：卡片绑定早于预取／进房实现就绪时不得捕获空值，交互发生时读取最新函数。
(function testLateRuntimeForRoomCardBinding() {
  const lobby = context.window.EH_LOBBY_MODULE;
  let latePrefetch = null, lateEnter = null, prefetched = '', entered = null;
  const listeners = {};
  const card = {
    dataset: { rid: 'late-room', nm: '迟到房间', em: '◇', kind: 'public' },
    querySelector: () => ({ textContent: '2 人在线' }),
    addEventListener: (name, handler, options) => { listeners[name] = { handler, options }; },
  };
  const bind = lobby.createBindRoomCards({
    readKnownOnline: () => 2,
    getPrefetchRoom: () => latePrefetch,
    getEnterRoom: () => lateEnter,
  });
  bind({ querySelectorAll: () => [card] });
  listeners.pointerenter.handler();
  card.onclick();
  latePrefetch = (rid, kind) => { prefetched = `${rid}:${kind}`; };
  lateEnter = room => { entered = room; };
  listeners.touchstart.handler();
  card.onclick();
  if (listeners.touchstart.options.passive !== true || prefetched !== 'late-room:public' || !entered || entered.knownOnline !== 2) {
    throw new Error('lobby: room card binding did not resolve late runtime dependencies');
  }
  console.log('PASS lobby: room card binding resolves late runtime dependencies');
})();

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

// 回归：上次房间存取工厂使用 storage getter，运行时切换 storage 也生效；解析异常返回 null。
(function testLastRoomStoreLateStorage() {
  const lobby = context.window.EH_LOBBY_MODULE;
  let lateStorage = null;
  const store = lobby.createLastRoomStore({ getStorage: () => lateStorage, key: 'eh_last_room' });
  if (store.read() !== null) throw new Error('lobby: last-room read before storage ready must return null');
  store.clear(); // 未就绪时不得抛错
  const backing = {};
  lateStorage = {
    getItem: k => (k in backing) ? backing[k] : null,
    setItem: (k, v) => { backing[k] = v; },
    removeItem: k => { delete backing[k]; },
  };
  backing['eh_last_room'] = JSON.stringify({ id: 'r-late', name: '迟到房', emoji: '◇' });
  const got = store.read();
  if (!got || got.id !== 'r-late' || got.name !== '迟到房') throw new Error('lobby: last-room read did not use late storage');
  backing['eh_last_room'] = '{not-json';
  if (store.read() !== null) throw new Error('lobby: last-room read must swallow parse errors');
  backing['eh_last_room'] = JSON.stringify({ name: '缺 id' });
  if (store.read() !== null) throw new Error('lobby: last-room read must reject rows without id');
  backing['eh_last_room'] = JSON.stringify({ id: 'r-late', name: '迟到房' });
  store.clear();
  if ('eh_last_room' in backing) throw new Error('lobby: last-room clear did not remove key');
  lateStorage = { getItem: () => { throw new Error('storage denied'); }, removeItem: () => { throw new Error('storage denied'); } };
  if (store.read() !== null) throw new Error('lobby: last-room read must swallow storage exceptions');
  store.clear(); // 抛错也不应冒泡
  if (!Object.isFrozen(store)) throw new Error('lobby: last-room store must be frozen');
  console.log('PASS lobby: lastRoomStore resolves late storage and swallows errors');
})();

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

// 回归：灵魂预取创建时 sb 尚未 boot，调用时必须读取最新客户端，并复用缓存。
(async function testLateSupabaseForPrefetchSouls() {
  const lobby = context.window.EH_LOBBY_MODULE;
  let lateSb = null, pruneCalls = 0, putCalls = 0;
  const cache = {};
  const prefetch = lobby.createPrefetchSouls({
    getSb: () => lateSb,
    getCache: () => cache,
    pruneCache: () => { pruneCalls += 1; },
    getTtl: () => 60000,
    putCache: (rid, promise) => {
      putCalls += 1;
      const entry = { at: Date.now(), p: promise };
      cache[rid] = entry;
      return promise;
    },
  });
  const beforeBoot = await prefetch('late-room');
  if (!Array.isArray(beforeBoot) || beforeBoot.length !== 0 || pruneCalls !== 1 || putCalls !== 0) {
    throw new Error('lobby: soul prefetch before Supabase boot must safely return []');
  }
  let rpcCalls = 0;
  lateSb = { rpc: async (name, args) => {
    rpcCalls += 1;
    if (name !== 'eh_room_souls' || args.rid !== 'late-room') throw new Error('lobby: soul prefetch RPC arguments mismatch');
    return { data: [{ name: '迟到灵魂' }] };
  } };
  const afterBoot = await prefetch('late-room');
  const cached = await prefetch('late-room');
  if (afterBoot.length !== 1 || afterBoot[0].name !== '迟到灵魂' || cached !== afterBoot || rpcCalls !== 1 || putCalls !== 1 || pruneCalls !== 3) {
    throw new Error('lobby: soul prefetch did not resolve late Supabase or reuse cache');
  }
  console.log('PASS lobby: prefetchSouls resolves late Supabase and reuses cache');
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
