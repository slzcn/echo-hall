#!/usr/bin/env node
'use strict';
/* journey-version-guard.js
 * C5/C6/C7: 发版脚本可命中 SW；运行时 __EH_APP_VER 漂移可检；hardRecover 不清 audio/lib。
 * 诊断单: 审查报告 C5/C6/C7（发版安全）
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let step = 0, failed = false;
function assert(c, m){ step++; if(!c){ failed = true; console.error('✗ [' + step + '] ' + m); } else console.log('✓ [' + step + '] ' + m); }

console.log('\n▸ 发版安全 / 版本漂移');

const bump = R('bump-version.sh');
const sw = R('sw.js');
const app = R('js/app.js');
const html = R('index.html');

// C6: bump 不得在可执行 sed 里写死 eh-sw-v550-，必须正则任意序号
const bumpCode = bump.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
assert(!/eh-sw-v550-/.test(bumpCode), '反证: bump 可执行段不得写死 eh-sw-v550-');
assert(/eh-sw-v\[0-9\]/.test(bump), 'bump: SW 模式用正则 eh-sw-v[0-9]+');
assert(/未找到 SW_VERSION|fail_if_unchanged|exit 1/.test(bump), 'bump: 未命中即失败退出');
assert(/__EH_APP_VER/.test(bump), 'bump: 同步 __EH_APP_VER');

// C5: app.js 交叉核对
assert(/__EH_APP_VER/.test(app) && /__EH_BUILD_VER/.test(app), 'app.js 含 __EH_APP_VER ↔ __EH_BUILD_VER 核对');
assert(/字节漂移|drift/i.test(app), '漂移时有告警/恢复路径');

// C7: hardRecover / drift 恢复保留 audio/lib
assert(/if\(\/audio\|lib\/i\.test\(k\)\) return null/.test(html),
  'hardRecover 跳过 audio/lib 缓存');
assert(/if\(\/audio\|lib\/i\.test\(k\)\) return null/.test(app) || /audio\|lib/.test(app),
  'app.js 漂移恢复跳过 audio/lib');

// 行为级: bump 的 sed 模式能命中当前 sw.js
{
  const m = sw.match(/const SW_VERSION = 'eh-sw-v([0-9]+)-/);
  assert(!!m, '当前 sw.js 匹配 eh-sw-vN- 模式');
  const re = /const SW_VERSION = 'eh-sw-v[0-9]+-[^']*'/;
  assert(re.test(sw), 'bump 的替换正则可命中当前 SW_VERSION 行');
}

console.log('\n' + (failed ? '❌ 发版安全旅程失败' : '✅ 发版脚本/漂移核对/缓存保护通过'));
process.exit(failed ? 1 : 0);
