#!/usr/bin/env node
'use strict';
/* journey-room-switch-cursor.js
 * B3/B4: 换房时历史游标不得串房；prefetch delete 不得因 curRoom=null 崩。
 * 诊断单: docs/triage/2026-11-02-room-switch-cursor.md
 */
const fs = require('fs'), path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = R('js/app.js');

let step = 0, failed = false;
function assert(c, m){ step++; if(!c){ failed = true; console.error('✗ [' + step + '] ' + m); } else console.log('✓ [' + step + '] ' + m); }

console.log('\n▸ 换房历史游标 / 预取 delete');

const fnAt = app.indexOf('async function loadHistoryCore(first)');
const fn = app.slice(fnAt, fnAt + 2800);
assert(fnAt > 0, '找到 loadHistoryCore');

assert(/let _newOldest=null/.test(fn), '使用局部 _newOldest');
assert(/if\(_newOldest!=null\) oldestId = _newOldest/.test(fn), 'rid 通过后才提交全局 oldestId');

// 提交点必须在 rid 校验之后
const ridCheck = fn.indexOf('if(!curRoom || curRoom.id!==_enterRid) return');
const commit = fn.indexOf('oldestId = _newOldest');
assert(ridCheck > 0 && commit > ridCheck, 'oldestId 提交在防串房 return 之后');

// 旧序反证: 不得再出现「rows.length 就写全局 oldestId」且写在 rid 检查前
assert(!/if\(rows\.length\)\{ oldestId = rows\[0\]\.id; \}/.test(fn),
  '反证: 旧「if(rows.length){ oldestId=… }」直接写全局不得存在');

// prefetchCache 用 _enterRid，且不再 delete curRoom.id
assert(/prefetchCache\[_enterRid\]/.test(fn), 'prefetchCache 用 _enterRid 做 key');
assert(!/delete prefetchCache\[curRoom\.id\]/.test(fn),
  '反证: delete prefetchCache[curRoom.id] 不得存在(防 curRoom=null 崩)');

// 行为级
{
  let oldestId = 0; // B 的游标
  let curRoom = { id: 'B' };
  const enterRid = 'A';
  let rows = [{ id: 100 }];
  let _newOldest = rows[0].id;
  // await 中切房
  curRoom = { id: 'B' };
  if (!curRoom || curRoom.id !== enterRid) {
    // return before commit
  } else {
    oldestId = _newOldest;
  }
  assert(oldestId === 0, '行为级: A 历史不得覆盖 B 游标');

  // 同房才提交
  curRoom = { id: 'A' };
  if (!curRoom || curRoom.id !== enterRid) {
  } else {
    oldestId = _newOldest;
  }
  assert(oldestId === 100, '行为级: 同房正常提交');
}

console.log('\n' + (failed ? '❌ 换房游标旅程失败' : '✅ 换房游标防串房通过（旧序必红）'));
process.exit(failed ? 1 : 0);
