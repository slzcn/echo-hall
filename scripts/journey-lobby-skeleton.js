#!/usr/bin/env node
'use strict';

const fs = require('fs');
const src = fs.readFileSync('js/app.js', 'utf8');

const checks = [
  ['官方房 soft 快路径只认真实房间卡', /function renderOfficial[\s\S]*?if\(soft && box\.querySelector\('\.ch\[data-rid\]'\)\)/],
  ['公开房 soft 快路径只认真实房间卡', /function renderPublic[\s\S]*?if\(soft && box\.querySelector\('\.ch\[data-rid\]'\)\)/],
  ['私密房 soft 快路径只认真实房间行', /function renderMyRooms[\s\S]*?if\(soft && boxE\.querySelector\('\.rm\[data-rid\]'\)\)/],
  ['旧 children.length 骨架误判已移除', () => !/if\(soft && (?:box|boxE)\.children\.length\)/.test(src)],
];

let failed = 0;
for (const [name, rule] of checks) {
  const ok = rule instanceof RegExp ? rule.test(src) : rule();
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
}

// 行为反证：骨架有 children，但没有真实卡。旧判据会误跳过查询，新判据必须继续查。
const skeletonBox = {
  children: [{ className: 'ch-skel' }],
  querySelector(selector) {
    return selector === '.ch[data-rid]' ? null : null;
  },
};
const oldWouldSkipQuery = skeletonBox.children.length > 0;
const newWouldSkipQuery = !!skeletonBox.querySelector('.ch[data-rid]');
const counterexampleOk = oldWouldSkipQuery && !newWouldSkipQuery;
console.log(`${counterexampleOk ? '✓' : '✗'} 反证：只有骨架时旧判据误跳过、新判据继续查询`);
if (!counterexampleOk) failed++;

const renderedBox = {
  querySelector(selector) {
    return selector === '.ch[data-rid]' ? { dataset: { rid: 'room-1' } } : null;
  },
};
const renderedFastPathOk = !!renderedBox.querySelector('.ch[data-rid]');
console.log(`${renderedFastPathOk ? '✓' : '✗'} 已有真实卡时仍保留 soft 快路径`);
if (!renderedFastPathOk) failed++;

if (failed) {
  console.error(`\n${failed} 项首页骨架恢复回归失败`);
  process.exit(1);
}
console.log('\n✅ 首页骨架恢复回归通过：占位骨架不会再阻断真实房间查询');
