'use strict';
// 冷启动认证旅程：防止 GoTrue 卡住时 UI 无限等待。
const fs = require('fs');
const assert = (ok, msg) => { if (!ok) { console.error('✗', msg); process.exit(1); } console.log('✓', msg); };
const app = fs.readFileSync(__dirname + '/../js/app.js', 'utf8');
const boot = fs.readFileSync(__dirname + '/../js/boot.js', 'utf8');

console.log('\n▸ 冷启动认证 / 登录页解锁旅程');
assert(/withTimeout\(sb\.auth\.getSession\(\), 5000, null\)/.test(app),
  '正式账号 session 兜底重读有 5s 超时，不会无限卡死');
assert(!/const rr=await sb\.auth\.getSession\(\)/.test(app),
  '旧版无超时 getSession 兜底已移除');
assert(/const fallbackMs = isColdStart \? 1500 : 3000/.test(boot),
  '冷启动预绘骨架最多等待 1.5s，普通场景最多等待 3s');
assert(/document\.onpointerdown = onUserPoke/.test(boot) && /document\.onkeydown = onUserPoke/.test(boot),
  '用户点击或键盘操作会立即打断卡住的预绘骨架');
assert(/setTimeout\(\(\)=> doFallback\('timeout'\), fallbackMs\)/.test(boot),
  '无操作超时也会回落入场页');
assert(/if\(curRoom\) return/.test(boot) && /if\(!\$\('#hall'\)\.classList\.contains\('on'\)\) return/.test(boot),
  '回落仅作用于预绘 hall，不会误伤已进入房间的用户');
console.log('✅ 冷启动认证旅程通过：超时有界、用户可打断、已进房不误回落。');
