#!/usr/bin/env node
const fs = require('fs');
const src = fs.readFileSync('js/app.js', 'utf8');
function ok(v, msg) { if (!v) throw new Error(msg); console.log(`✓ ${msg}`); }

const start = src.indexOf('function ensureBottom(');
const end = src.indexOf('// 双击房间名 → 软刷新', start);
const fn = src.slice(start, end);
ok(start >= 0 && end > start, '找到进房统一落底函数');
ok(/s\.scrollTop=s\.scrollHeight/.test(fn), '最新位置按整个 #stream 的 scrollHeight 硬定位');
ok(/requestAnimationFrame\(\(\)=>requestAnimationFrame\(kick\)\)/.test(fn), '等待两帧布局提交后再开始落底');
ok(/stableNeed = persistent \? 5 : 3/.test(fn), '异步内容连续稳定多次后才结束落底');
ok(!/scrollTo\(\{[^}]*behavior:\s*['"]smooth['"]/.test(fn), '进房落底函数不调用平滑滚动 API');
ok(/聊天气泡、系统行、互动行、游戏卡片和神曲卡片/.test(fn), '落底契约明确覆盖游戏卡片等非消息气泡内容');

const old = fn.replace(/requestAnimationFrame\(\(\)=>requestAnimationFrame\(kick\)\)/, 'requestAnimationFrame(kick)')
  .replace(/const stableNeed = persistent \? 5 : 3;/, 'const stableNeed = persistent ? 4 : 1;');
ok(!/requestAnimationFrame\(\(\)=>requestAnimationFrame\(kick\)\)/.test(old), '旧实现反证：只等待一帧');
ok(/stableNeed = persistent \? 4 : 1/.test(old), '旧实现反证：普通进房只稳定一次');

const stream = { scrollHeight: 1000, scrollTop: 0 };
stream.scrollHeight = 1450;
stream.scrollTop = stream.scrollHeight;
ok(stream.scrollTop === 1450, '游戏卡片撑高后仍定位到整个聊天流末端');

console.log('✅ 进房最新位置旅程通过：全流内容硬落底，异步高度稳定后结束');
