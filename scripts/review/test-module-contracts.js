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
