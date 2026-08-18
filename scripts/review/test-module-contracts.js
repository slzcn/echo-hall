#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../../');
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
