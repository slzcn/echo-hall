#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs');
const app=fs.readFileSync('js/app.js','utf8');
const block=app.slice(app.indexOf('(function bindToLatest(){'),app.indexOf('// ============ 灵魂居民 Soul'));
assert(!/characterData\s*:\s*true/.test(block),'observer 不应监听 characterData');
assert(/ResizeObserver/.test(block),'需要 ResizeObserver 保住事后撑高判断');
assert(/childList\s*:\s*true/.test(block),'仍需监听新消息结构变化');
assert(!block.includes('mo.observe(s, {childList:true, subtree:true, characterData:true})'),'旧高频 observer 必须被移除');
console.log('✓ observer 忽略 characterData、保留结构变化并以 ResizeObserver 低频复判；旧实现反证通过');
