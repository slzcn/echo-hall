#!/usr/bin/env node
'use strict';
/* test-snap-seq.js — guest 快照乱序丢弃(acceptSeq)单元测试
 * 诊断单: docs/triage/2026-09-18-guest-snap-out-of-order.md
 * 用法: node scripts/test-snap-seq.js */
const path = require('path');
const DDZ = require(path.join(__dirname, '..', 'js/games/ddz-net.js'));
const GD  = require(path.join(__dirname, '..', 'js/games/guandan-net.js'));
const PK  = require(path.join(__dirname, '..', 'js/games/poker-net.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

for (const [name, Net] of [['ddz', DDZ], ['guandan', GD], ['poker', PK]]) {
  console.log('\n── ' + name + ' acceptSeq ──');
  ok(typeof Net.acceptSeq === 'function', name + '.acceptSeq 已导出');

  // 旧实现反证: 无 acceptSeq 时任何 snap 都会被 apply —— 这里模拟"有 seq 且更旧则拒"
  let last;
  let r = Net.acceptSeq({ seq: 1 }, last);
  ok(r.ok && r.seq === 1, '首包 seq=1 接受');
  last = r.seq;
  r = Net.acceptSeq({ seq: 3 }, last);
  ok(r.ok && r.seq === 3, 'seq=3 接受');
  last = r.seq;
  r = Net.acceptSeq({ seq: 2 }, last);
  ok(!r.ok && r.seq === 3, 'seq=2 迟到旧包被拒(反证: 不拒则 UI 回退)');
  r = Net.acceptSeq({ seq: 3 }, last);
  ok(r.ok && r.seq === 3, '相同 seq 重播(hello 补帧)可接受');
  r = Net.acceptSeq({ seq: 10 }, last);
  ok(r.ok && r.seq === 10, '更大 seq 接受');
  last = r.seq;
  r = Net.acceptSeq({ noseq: true }, last);
  ok(r.ok && r.seq === 10, '无 seq 字段兼容放行(旧客户端)');
  r = Net.acceptSeq(null, last);
  ok(!r.ok, '空 snap 拒绝');
}

console.log('\n' + (fail ? '💥 有失败 (' + pass + '✓ ' + fail + '✗)' : '🎉 全部通过 (' + pass + '✓)'));
process.exit(fail ? 1 : 0);
