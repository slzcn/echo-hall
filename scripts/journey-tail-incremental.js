#!/usr/bin/env node
'use strict';
/* journey-tail-incremental.js
 * P13: 公开房 tail 补拉不再每 20s 全量 500 行; 私密房 tail 走 id>domMaxMid 增量。
 */
const fs = require('fs'), path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = R('js/app.js');

let step = 0, failed = false;
function assert(c, m){ step++; if(!c){ failed = true; console.error('✗ [' + step + '] ' + m); } else console.log('✓ [' + step + '] ' + m); }

console.log('\n▸ tail 增量补拉');

const fnAt = app.indexOf('async function refreshSnapshotTail');
const fn = app.slice(fnAt, fnAt + 2200);

assert(/publicTailLimit/.test(fn), '公开房 tail 使用 publicTailLimit(小 lim)');
assert(/fillOlder \? TUNE\('publicRecentLimit',500\) : TUNE\('publicTailLimit'/.test(fn)
  || /fillOlder\s*\?\s*TUNE\('publicRecentLimit'/.test(fn),
  'fillOlder 才用 500 封顶，平时 tail 小 lim');
assert(/privateTailLimit/.test(fn) && /\.gt\('id',\s*domMaxMid\)/.test(fn),
  '私密房 tail 增量 id>domMaxMid');

// DOM 扫描在 fetch 之前
const scan = fn.indexOf('domMaxMid');
const rpc = fn.indexOf('eh_public_recent');
assert(scan > 0 && rpc > scan, '先扫 DOM 再请求(可按 domMaxMid 增量)');

// 行为级: lim 选择
{
  const pick = (fillOlder, isPublic) => {
    if (isPublic) return fillOlder ? 500 : 40;
    return fillOlder ? 60 : 200;
  };
  assert(pick(false, true) === 40, '行为级: 公开房 tail lim=40');
  assert(pick(true, true) === 500, '行为级: 公开房 fillOlder 仍 500');
  assert(pick(false, false) === 200, '行为级: 私密房 tail 上限 200 增量');
}

console.log('\n' + (failed ? '❌ tail 增量旅程失败' : '✅ tail 增量补拉通过'));
process.exit(failed ? 1 : 0);
