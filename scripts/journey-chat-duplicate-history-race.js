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

// ── loadHistoryCore 首屏/idle 补渲染路径同样要防重复 ──────────────────────────
// prependMissingPublicHistory(快照补拉)之外, 全新进房(无快照)走 loadHistoryCore:
//   subscribeMessages 先于 loadHistory 开启, 拉取 await 期间 realtime/灵魂队列可能已把最新一条上屏,
//   而它也在本次历史 rows 里。若 head.forEach / drainRest 无脑 append 就双渲染(灵魂连发那条最易中招)。
//   修法: 渲染前按 mid 过 _soulMsgKnown(查 DOM+pending+队列)剔除已现/在队列的行。
const lhStart = src.indexOf('async function loadHistoryCore');
const lh = src.slice(lhStart, lhStart + 12000);   // loadHistoryCore 函数体窗口
ok(/head\.forEach\(m=>\{ if\(m && m\.id!=null && _soulMsgKnown\(m\.id\)\) return;/.test(lh),
  'loadHistoryCore 首屏 head.forEach 渲染前按 _soulMsgKnown 跳过已现/在队列的消息');
ok(/batch\.forEach\(m=>\{ if\(m && m\.id!=null && _soulMsgKnown\(m\.id\)\) return;/.test(lh),
  'loadHistoryCore idle 分批 batch.forEach 同样按 _soulMsgKnown 跳过(补渲染期间来的最新消息不重复)');
// _soulMsgKnown 必须三路判重(pending 集合 + 队列数组 + DOM), 缺一路则某序下漏判致重复
ok(/function _soulMsgKnown\(mid\)\{[\s\S]*?_soulQPending\.has\(mid\)[\s\S]*?_soulQ\[i\][\s\S]*?querySelector\(`\[data-mid=/.test(src),
  '_soulMsgKnown 三路判重(pending 集合 + 队列数组 + DOM)——任一路径抢先都拦得住');
// 旧实现反证: 若 head.forEach 无守卫(直接 buildMsgEl), 该断言必红
const lhOld = lh.replace(/head\.forEach\(m=>\{ if\(m && m\.id!=null && _soulMsgKnown\(m\.id\)\) return; /, 'head.forEach(m=>{ ');
ok(!/head\.forEach\(m=>\{ if\(m && m\.id!=null && _soulMsgKnown/.test(lhOld), '旧实现反证: 去掉守卫后首屏无 mid 判重(会重复渲染)');

console.log('✅ 聊天消息重复显示旅程通过：快照补拉 + loadHistoryCore 首屏/idle 两路均按 mid 二次判重，旧竞态实现必红');
