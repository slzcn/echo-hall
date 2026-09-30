#!/usr/bin/env node
'use strict';
// journey-souls-cache-eviction.js — 灵魂预取缓存(soulsCache)生命周期旅程
//
// 2026-08 重构: soulsCache 的 TTL/数量淘汰逻辑已从 app.js 内联块迁到
//   js/modules/lobby.js 的 createSoulsCacheStore(deps) 工厂(app.js 只注入依赖并解构 cache/prune/put)。
//   本旅程随之改为直接加载真实工厂来跑, 而非在 app.js 里正则抠代码块(旧写法已随迁移失效)。
//
// 断言(反 anti-pattern「预取缓存无上限 → 长会话内存泄漏 / 误删当前房 pending」):
//   · 过期且非保护项被主动清除(TTL)
//   · 当前房 / pending Promise 即使过期也不误删(正在用的不能拆)
//   · 大量历史房收敛到数量上限(有界, 不无限增长)
//   · 超限优先淘汰最旧, 保护项占位后保留较新的若干条
//   · put 生命周期: 写入即 pending, 兑现后落 pending=false; 返回冻结句柄
//   · 接线契约: app.js 经 createSoulsCacheStore 装配, 写入统一走 putSoulsCache
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const root = path.resolve(__dirname, '..');

// ── 加载真实工厂(与 test-module-contracts 同法: 在含 window 的沙箱里执行 lobby.js IIFE)──
const context = { window: {}, Promise, Date, console };
context.window.window = context.window;
vm.createContext(context);
const lobbyFile = path.join(root, 'js/modules/lobby.js');
vm.runInContext(fs.readFileSync(lobbyFile, 'utf8'), context, { filename: lobbyFile });
const M = context.window.EH_LOBBY_MODULE;
assert(M && typeof M.createSoulsCacheStore === 'function', 'lobby 导出 createSoulsCacheStore 工厂');

(async () => {
  // 可翻转的"当前房"引用 + 固定 TTL=100 + 上限 24(复刻线上默认)
  let curRoom = { id: 'current' };
  const store = M.createSoulsCacheStore({
    getCurrentRoom: () => curRoom,
    getTtl: () => 100,
    maxEntries: 24,
  });
  assert(Object.isFrozen(store), 'store 句柄冻结(cache/prune/put 不可被替换)');

  // ── TTL + 保护: 过期普通项删, 当前房 / pending 不删 ──
  const now = 1000;
  store.cache.expired = { at: 800, p: Promise.resolve([]), pending: false };   // 200ms 前, 过期
  store.cache.current = { at: 800, p: Promise.resolve([]), pending: false };   // 过期但=当前房
  store.cache.pending = { at: 800, p: new Promise(() => {}), pending: true };  // 过期但仍在飞
  store.prune(now);
  assert(!store.cache.expired, '过期且非保护项被主动清除(TTL)');
  assert(store.cache.current, '当前房即使过期也不误删(正在看的房不能拆)');
  assert(store.cache.pending, 'pending Promise 即使过期也不误删(在飞的请求不能拆)');

  // ── 数量上限: 30 个历史房收敛到 24(pending 占一席后保留较新的 23) ──
  curRoom = null;                                             // 离开房间, current 不再受保护
  for (let i = 0; i < 30; i++) store.cache['room-' + i] = { at: 950 + i, p: Promise.resolve([]), pending: false };
  store.prune(now);
  assert.equal(Object.keys(store.cache).length, 24, '大量历史房收敛到数量上限(有界)');
  assert(!store.cache['room-0'] && !store.cache['room-6'], '超限优先淘汰最旧条目(room-0..6)');
  assert(store.cache['room-7'] && store.cache['room-29'], '受保护 pending 占一席后保留较新的 23 条');

  // ── put 生命周期: 写入即 pending, 兑现后 pending=false ──
  const p = store.put('live', Promise.resolve(['soul']));
  assert(store.cache.live && store.cache.live.pending === true, 'put 写入即标 pending(在飞, 期间不被淘汰)');
  await p;
  await Promise.resolve();                                    // 让 .finally 回调落地
  assert(store.cache.live && store.cache.live.pending === false, 'Promise 兑现后落 pending=false');

  // ── 反证: 不回收的朴素对象随会话无限增长(旧内联/无上限实现的病根) ──
  const legacy = {};
  for (let i = 0; i < 30; i++) legacy['room-' + i] = { at: 950 + i };
  assert.equal(Object.keys(legacy).length, 30, '反证: 无淘汰的实现持续增长且不回收(30 条不收敛)');

  // ── 接线契约(静态): app.js 经工厂装配 soulsCache, 写入统一走 putSoulsCache ──
  const appSrc = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  assert(/createSoulsCacheStore\(\{/.test(appSrc), 'app.js 经 EH_LOBBY_MODULE.createSoulsCacheStore 装配缓存(不再内联实现)');
  assert(/const putSoulsCache\s*=\s*_soulsCacheStore\.put/.test(appSrc), 'putSoulsCache 绑定到工厂 store.put(统一写入口)');
  assert((appSrc.match(/putSoulsCache\(/g) || []).length >= 2, '预取/进房校正等写入均走 putSoulsCache(不各自裸写 soulsCache)');

  console.log('✓ soulsCache 主动 TTL/数量淘汰并保护 pending/current；put 生命周期正确；接线契约在位；旧实现反证通过');
})().catch(e => { console.error(e); process.exit(1); });
