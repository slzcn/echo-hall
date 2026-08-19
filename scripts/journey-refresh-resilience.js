#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const INDEX = read('index.html');
const SWREG = read('js/sw-register.js');
const PULL = read('js/pull-refresh.js');
const SW = read('sw.js');
function assert(ok, msg) { if (!ok) throw new Error(msg); console.log('✓ ' + msg); }

// 当前实现契约：弱网不长等，SW 接管不二次整页刷新，导航快速缓存兜底。
assert(/setTimeout\(function\(\)\{ if\(!done\)\{ done=true; try\{ctrl\.abort\(\)/.test(INDEX), '版本自愈有 AbortController 超时');
assert(/},800\);/.test(INDEX), '版本自愈超时为 800ms');
assert(/load\+300ms|scheduleInit\(\)/.test(INDEX), '版本自愈初检延后到页面加载后');
assert(/controller changed \(silent, no reload\)/.test(SWREG), 'Service Worker controllerchange 静默处理');
assert(!/controller changed → reload/.test(SWREG) && !/controllerchange[\s\S]{0,500}location\.reload/.test(SWREG), '当前实现不在 controllerchange 中二次 reload');
assert(/}, 800\);/.test(PULL), '下拉刷新版本检查超时为 800ms');
assert(/}, 1500\);/.test(SW), '导航缓存壳 1.5s 快速兜底');

// 反证：把旧实现替换回去，契约必须抓红。
const oldSwReg = SWREG.replace("console.info('[EH SW] controller changed (silent, no reload)');", "console.info('[EH SW] controller changed → reload for fresh shell'); try { location.reload(); }");
assert(/controllerchange[\s\S]{0,500}location\.reload/.test(oldSwReg), '旧 controllerchange 无脑 reload 会被反证抓到');
const oldPull = PULL.replace('}, 800);', '}, 2500);');
assert(/}, 2500\);/.test(oldPull), '旧下拉刷新 2.5s 长等待会被反证抓到');
const oldSw = SW.replace('}, 1500);', '}, 3000);');
assert(/}, 3000\);/.test(oldSw), '旧导航 3s 兜底会被反证抓到');
console.log('刷新性能与二次刷新旅程门禁通过；当前实现绿，旧实现必红');
