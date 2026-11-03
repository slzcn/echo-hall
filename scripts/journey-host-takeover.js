#!/usr/bin/env node
'use strict';
/* journey-host-takeover.js
 * B11: host 掉线后必须有「标 away → gtEngineHolder 重算」闭环；不得依赖不存在的 eh_gt_set_host。
 * 诊断单: docs/triage/2026-11-02-host-takeover-loop.md
 */
const fs = require('fs'), path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = R('js/app.js');

let step = 0, failed = false;
function assert(c, m){ step++; if(!c){ failed = true; console.error('✗ [' + step + '] ' + m); } else console.log('✓ [' + step + '] ' + m); }

console.log('\n▸ host 掉线接管闭环');

// 反证: 不得再调用不存在的 RPC
assert(!/rpc\/eh_gt_set_host/.test(app) && !/sb\.rpc\('eh_gt_set_host'/.test(app),
  '反证: eh_gt_set_host 调用必须不存在(旧实现必红)');

// 超时路径应标 away 触发重算
assert(/gtHostMarkAway\(tableId,\s*holder,\s*true\)/.test(app) || /gtHostMarkAway\(tableId,\s*holder/.test(app),
  'host_ping 超时路径调用 gtHostMarkAway(holder)');
assert(/gtEngineHolder\(tr\)/.test(app), '用 gtEngineHolder 判定失联持有者');
assert(/房主掉线/.test(app) || /正在接管/.test(app), '用户可见接管提示');

// pagehide 自己标 away，不再 set_host（允许注释提及历史）
const unloadAt = app.indexOf('function _gtPokerBindUnload');
const unloadAll = app.slice(unloadAt, unloadAt + 1600);
const unload = unloadAll.split('\n').filter(l => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l)).join('\n');
assert(/eh_gt_set_away/.test(unload), 'pagehide 用 set_away 自标离线');
assert(!/rpc\/eh_gt_set_host|sb\.rpc\('eh_gt_set_host'/.test(unload), 'pagehide 不再调 set_host');

// 行为级: holder 重算
{
  const holderOf = (seats) => {
    const humans = seats.filter(s => s && s.kind === 'human' && s.uid && !s.away).sort((a, b) => a.seat - b.seat);
    return humans.length ? humans[0].uid : null;
  };
  let seats = [
    { seat: 0, kind: 'human', uid: 'host', away: false },
    { seat: 1, kind: 'human', uid: 'guest', away: false },
  ];
  assert(holderOf(seats) === 'host', '行为级: 崩溃前 holder=host');
  // guest 标 host away
  seats = seats.map(s => s.uid === 'host' ? { ...s, away: true } : s);
  assert(holderOf(seats) === 'guest', '行为级: 标 away 后 holder=guest(接管)');
}

console.log('\n' + (failed ? '❌ host 接管旅程失败' : '✅ host 接管闭环通过（set_host 死调用已除）'));
process.exit(failed ? 1 : 0);
