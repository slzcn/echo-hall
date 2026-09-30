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

// ── 治本层: 重复气泡"清道夫"(移除已材料化的重复, 而非只 prevent-add) ──────────────
// prevent-add 的盲区: 各路径只在 append 前判重, 但没有任何一处能【移除】已落进 DOM 的重复。
// 快照(keep-alive roomSnap / localStorage eh_room_snap)是"原样 innerHTML 回填", 一旦某次竞态
// 双渲染, 重复被烘焙进快照并每轮 persistRoomSnap 自我复制→prevent-add 永远清不掉。dedupStreamByMid
// 在【还原后】和【序列化前】各清扫一次: 既修当前屏可见双份, 又自愈已污染的 localStorage 快照。
ok(/function dedupStreamByMid\(root\)\{/.test(src), '存在集中式重复气泡清道夫 dedupStreamByMid(移除已材料化的重复, 补 prevent-add 盲区)');
ok(/:scope > \[data-mid\]/.test(src), 'dedupStreamByMid 只扫 stream 直接子节点(:scope>)——避免误删 .echo-bar 等嵌套同 mid 元素');
ok(/mid\.startsWith\('local_'\)/.test(src), 'dedupStreamByMid 跳过乐观上屏的 local_ 临时 id(尚未回填真 id, 非重复)');
// 序列化前清扫 = 停止把重复烘焙进快照 + 自愈已污染的 localStorage
const psStart = src.indexOf('function persistRoomSnap');
const ps = src.slice(psStart, psStart + 900);
ok(/dedupStreamByMid\(st\)[\s\S]*?st\.querySelectorAll\('\.msg'\)/.test(ps),
  'persistRoomSnap 序列化前先 dedupStreamByMid(不再把重复气泡写进快照, 自愈 localStorage)');
// keep-alive 快照还原后立刻清扫
ok(/innerHTML=_snapHtml;[\s\S]{0,160}dedupStreamByMid\(\$\('#stream'\)\)/.test(src),
  'snapHit 还原快照后立刻 dedupStreamByMid(keep-alive 回房烘焙的重复即时清掉)');

// ── 实时触发层: persist 3s 节流 + idle 延后 → 若房间随后安静, 重复在活动会话里一直挂着不消 ──
//   (实测: 闲聊广场"小绵羊"同一句冒三遍且不消)。故挂 MutationObserver 到 #stream, 任一路径新增/删除
//   直接子节点即用 rAF 去抖跑一次 dedup, 一帧内清掉, 不再依赖 persist 节流窗口。
ok(/function ensureStreamDedupObserver\(\)/.test(src), '存在 ensureStreamDedupObserver(实时清道夫, 补 persist 节流盲区)');
ok(/new MutationObserver\(scheduleStreamDedup\)/.test(src), '观察器回调走 scheduleStreamDedup(rAF 去抖, 合并一帧内多次 append)');
ok(/_streamDedupObs\.observe\(st,\s*\{\s*childList:true\s*\}\)/.test(src) && !/_streamDedupObs\.observe\([^)]*subtree/.test(src),
  '观察器只挂 childList(不含 subtree): 打字机改后代 .txt 不触发, 密集聊天零额外开销');
ok(/function scheduleStreamDedup\(\)\{[\s\S]*?if\(_streamDedupRAF\) return;/.test(src),
  'scheduleStreamDedup 用 _streamDedupRAF flag 去抖(dedup 自身 remove 再触发观察时不递归空转)');
ok(/try\{ ensureStreamDedupObserver\(\); \}catch/.test(src),
  'enterRoom 里挂载实时清道夫观察器(只挂一次, 由内部 flag 保证)');
// 挂载即扫: MutationObserver 不回溯已在 DOM 的节点, 而页首防闪脚本先于 app.js 把快照 innerHTML 进 #stream,
// 那份快照若是旧版烘焙的重复(如真人 yiran"年年有余"冒三遍), 观察器永远看不到 → 必须挂载时立刻扫一遍。
ok(/_streamDedupObs\.observe\([^)]*\);\s*(?:\/\/[^\n]*\n\s*)*try\{\s*dedupStreamByMid\(st\)/.test(src),
  'ensureStreamDedupObserver 挂载后立刻 dedupStreamByMid 扫现有子节点(清首帧防闪脚本铺入的历史重复)');
// 观察器要在 snapHit 分支【之前】挂 —— 否则 keep-alive 秒回房(该分支提前 return)永远挂不上观察器
{
  const er = src.slice(src.indexOf('async function enterRoom'), src.indexOf('async function enterRoom')+3000);
  const iObs = er.indexOf('ensureStreamDedupObserver()');
  const iSnap = er.indexOf('const snapHit');
  ok(iObs>=0 && iSnap>=0 && iObs < iSnap, '观察器在 snapHit 分支之前挂载(keep-alive 秒回房路径也覆盖)');
}

// 算法自证: 同 mid 只留内容最完整(文字最长)的一个; local_ 与嵌套元素不动
function simDedup(nodes){                 // nodes: [{mid, len, top}] top=是否 stream 直接子
  const seen=new Map(); const kept=[];
  for(const n of nodes){
    if(!n.top) { kept.push(n); continue; }              // 嵌套(:scope> 不命中)不参与
    if(!n.mid || String(n.mid).startsWith('local_')){ kept.push(n); continue; }
    const prev=seen.get(n.mid);
    if(!prev){ seen.set(n.mid,n); kept.push(n); continue; }
    if(n.len>prev.len){ kept.splice(kept.indexOf(prev),1); seen.set(n.mid,n); kept.push(n); }
    // 否则丢弃 n(不 push)
  }
  return kept;
}
const after = simDedup([
  {mid:'1418', len:42, top:true},   // 灵魂那条
  {mid:'1418', len:42, top:true},   // 竞态双渲染的重复 → 应被移除
  {mid:'1418', len:0,  top:false},  // .echo-bar 嵌套同 mid → 保留(非顶层)
  {mid:'local_x', len:5, top:true}, // 乐观上屏临时 → 保留
  {mid:'local_x', len:5, top:true}, // 临时 id 不判重 → 保留
  {mid:'1500', len:10, top:true},
]);
ok(after.filter(n=>n.mid==='1418'&&n.top).length===1, '算法: 顶层同 mid 双份塌缩为一(留一条)');
ok(after.filter(n=>n.mid==='1418'&&!n.top).length===1, '算法: 嵌套同 mid(.echo-bar)不受影响');
ok(after.filter(n=>n.mid==='local_x').length===2, '算法: local_ 临时 id 不参与去重(两条都在)');
ok(after.length===5, '算法: 6 节点仅移除 1 个真重复');

console.log('✅ 聊天消息重复显示旅程通过：prevent-add(快照补拉 + loadHistoryCore 两路 mid 判重) + 治本清道夫(还原后/序列化前移除已材料化重复), 旧竞态实现必红');
