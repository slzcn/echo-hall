#!/usr/bin/env node
'use strict';
const fs = require('fs');
const assert = require('assert');
const source = fs.readFileSync('sw.js', 'utf8');
const activate = source.match(/self\.addEventListener\('activate',[\s\S]*?\n\}\);/);
assert(activate, '存在 Service Worker activate 生命周期');
assert(!/k\s*===\s*JS_CACHE/.test(activate[0]), 'activate 不整库删除持久版本脚本缓存');
assert(/k\.startsWith\('eh-shell-'\)/.test(activate[0]), 'activate 仍清理旧 shell 缓存');
assert(/k\.startsWith\('eh-cdn-'\)/.test(activate[0]), 'activate 仍清理旧 CDN 缓存');
assert(/ku\.pathname\s*===\s*url\.pathname/.test(source), '单个脚本下载成功后仍清理同路径旧指纹');
assert(/ku\.search\s*!==\s*url\.search/.test(source), '清理只针对不同版本指纹');
assert(/installOfflineShell/.test(source), '安装阶段会从 HTML 发现离线依赖');
assert(/isVersionedJs\(new URL\(href\)\)\s*\?\s*jsCache\s*:\s*shellCache/.test(source),
  '安装阶段带指纹脚本写入持久 JS_CACHE，与运行时读取路径一致');
assert(/Promise\.allSettled/.test(source), '安装阶段单资源失败不会拖垮整批缓存');
const legacy = activate[0].replace(
  ".filter((k) => (k.startsWith('eh-shell-') || k.startsWith('eh-cdn-')) && k !== SHELL_CACHE && k !== CDN_CACHE)",
  ".filter((k) => ((k.startsWith('eh-shell-') || k.startsWith('eh-cdn-')) && k !== SHELL_CACHE && k !== CDN_CACHE) || k === JS_CACHE)"
);
assert(/k\s*===\s*JS_CACHE/.test(legacy), '反证：旧实现会在激活时删除整套脚本缓存');
console.log('✓ Service Worker 换版保留版本脚本缓存');
console.log('✓ 单路径旧指纹仍会在新脚本落缓存后收敛');
console.log('✓ 旧实现反证通过');
