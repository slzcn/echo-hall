#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs');
const app=fs.readFileSync('js/app.js','utf8');
const leave=app.slice(app.indexOf('async function leaveRoom()'),app.indexOf('// ============ 房主设置抽屉'));
assert(!/roomSnap=\{[^\n]*html:_st\.innerHTML/.test(leave),'离房快照不能复制全量 innerHTML');
assert(/slice\(-30\)/.test(leave),'内存快照应裁到最近轻量消息');
assert(/oldestId/.test(leave)&&/echoState/.test(leave),'必须保留分页游标和未完成文本状态');
console.log('✓ 离房内存快照轻量裁剪并保留 oldestId/echoState；旧全量实现反证通过');
