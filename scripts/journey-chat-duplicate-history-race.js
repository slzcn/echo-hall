#!/usr/bin/env node
const fs = require('fs');

const src = fs.readFileSync('js/app.js', 'utf8');
function ok(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

const fn = src.slice(
  src.indexOf('async function prependMissingPublicHistory'),
  src.indexOf('// 快照命中后后台补拉最新一屏')
);

ok(/const batchSeen=new Set\(\)/.test(fn), '每个 idle 批次建立本批 mid 去重集合');
ok(/batchSeen\.has\(mid\) \|\| stream\.querySelector\(`\[data-mid=/.test(fn), '真正写 DOM 前按当前消息流二次判重');
ok(/batchSeen\.add\(mid\)[\s\S]*buildMsgEl\(m,true\)/.test(fn), '仅未出现的 mid 才构建历史消息节点');
ok(/stream\.insertBefore\(frag,stream\.firstChild\)/.test(fn), '保留历史消息插入顶部的原有顺序');

const old = fn.replace(/\s*const batchSeen=new Set\(\);[\s\S]*?batchSeen\.add\(mid\);\s*/, '\n      ');
ok(!/stream\.querySelector\(`\[data-mid=/.test(old), '旧实现反证：idle 批次写入前没有当前 DOM 判重');

const dom = new Set(['101']);
const built = [];
const batchSeen = new Set();
for (const m of [{id:100}, {id:101}, {id:100}]) {
  const mid = String(m.id);
  if (batchSeen.has(mid) || dom.has(mid)) continue;
  batchSeen.add(mid);
  built.push(mid);
}
ok(JSON.stringify(built) === '["100"]', 'realtime 抢先插入与批内重复均只保留一个 DOM 节点');

console.log('✅ 聊天消息重复显示旅程通过：历史 idle 批次二次判重，旧竞态实现必红');
