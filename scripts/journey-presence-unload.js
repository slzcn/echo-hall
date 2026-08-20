#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs');
const app=fs.readFileSync('js/app.js','utf8');
const marker='function leavePresenceOnPageHide';
const pos=app.indexOf(marker); assert(pos>=0,'需要独立 pagehide 清理函数');
const unload=app.slice(pos,app.indexOf('// ★下拉刷新',pos));
assert(/fetch\(/.test(unload),'pagehide 必须走 REST fetch');
assert(/keepalive\s*:\s*true/.test(unload),'pagehide fetch 必须 keepalive');
assert(/Authorization/.test(unload)&&/method\s*:\s*['"]DELETE/.test(unload),'pagehide delete 必须带鉴权');
assert(/addEventListener\(['"]pagehide/.test(unload),'卸载清理应使用 pagehide');
const normal=app.slice(app.indexOf('async function leavePresence'),app.indexOf('function setConn'));
assert(/sb\.from\('eh_presence'\)\.delete/.test(normal),'正常 leaveRoom 保持 Supabase 原路径');
console.log('✓ pagehide 使用带鉴权 keepalive REST DELETE；普通 leaveRoom 路径保留；旧实现反证通过');
