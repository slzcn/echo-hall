const fs=require('fs'), assert=require('assert');
const src=fs.readFileSync('js/app.js','utf8');
const a=src.indexOf('async function refreshSnapshotTail');
const b=src.indexOf('// 下拉刷新用',a);
assert(a>=0&&b>a,'找到 refreshSnapshotTail');
const fn=src.slice(a,b);
assert(/const\s+domByMid\s*=\s*new Map\(\)/.test(fn),'一次构建 DOM mid Map');
assert(/domByMid\.get\(String\(m\.id\)\)/.test(fn),'循环使用 O(1) Map 判重');
assert(!/rows\.forEach\([\s\S]*?stream\.querySelector\(`\[data-mid="\$\{m\.id\}"\]`\)/.test(fn),'逐行 selector 扫描已移除');
assert(/domByMid\.set\(String\(m\.id\),\s*el\)/.test(fn),'新增消息同步更新 Map');

// ★"同一句冒三遍"真凶回归守卫(2026-08-21 nest-heal):
//   domByMid 用 [data-mid] 扫描时, .echo-bar 也带同一 data-mid 且在 DOM 里排在 .msg 之后 →
//   会把 mid→.msg 的映射覆盖成 echo-bar → 下面"空框修复"见 echo-bar 无 .txt 误判空框 →
//   exist.replaceWith(整条msg) → 一条 .msg 被塞进另一条的 .body(echo-bar 原位)= 消息套消息。
//   修复: 构建 Map 时跳过"有 [data-mid] 祖先"的嵌套元素(echo-bar), 只认消息行本身。
assert(/e\.parentElement\.closest\('\[data-mid\]'\)\)\s*return/.test(fn),
  'domByMid 跳过嵌套 [data-mid](echo-bar), 不覆盖同 mid 的消息行(防"空框修复"把整条 msg 塞进 body)');
//   兜底: dedupStreamByMid 必须能摘掉已烘焙进快照的"消息套消息"(顶层扫描看不见的嵌套 .msg)。
const dsrc=src.slice(src.indexOf('function dedupStreamByMid'), src.indexOf('function dedupStreamByMid')+900);
assert(/querySelectorAll\('\.msg \.msg\[data-mid\]'\)/.test(dsrc),
  'dedupStreamByMid 摘除嵌套在别的 .msg 内部的 .msg(自愈坏快照)');

console.log('✓ 公共房尾刷新一次建 Map、逐行 O(1) 判重、追加同步更新、跳过 echo-bar 防嵌套、dedup 摘嵌套 msg；旧逐行 selector 反证通过');
