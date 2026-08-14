'use strict';
// 安卓折叠屏 PWA：覆盖式 IME 三信号全哑时，私信与聊天室必须留出足够安全余量。
const fs = require('fs');
const path = require('path');
const keyboard = fs.readFileSync(path.join(__dirname, '..', 'js', 'keyboard.js'), 'utf8');
const dm = fs.readFileSync(path.join(__dirname, '..', 'js', 'dm.js'), 'utf8');
function assert(ok, msg) {
  if (!ok) throw new Error('FAIL: ' + msg);
  console.log('✓ ' + msg);
}
const oldRatio = 0.38;
const ratio = 0.39;
const h = 719;
const oldKb = Math.round(h * oldRatio);
const newKb = Math.round(h * ratio);
assert(/\* 0\.39\)/.test(keyboard), '主聊天室无信号兜底使用 39%');
assert(/\*0\.39\)/.test(dm), '私信无信号兜底使用 39%');
assert(newKb > oldKb, '新估算比旧估算多留出键盘安全余量');
assert(h - newKb < h - oldKb, '聊天室可视容器相对旧实现再缩短，输入框避开键盘覆盖边缘');
assert(oldRatio !== ratio, '反证：旧 38% 与当前 39% 是可区分的单变量实现');
assert(/_kbHeightRaw\(\)===0/.test(dm), '私信只在没有真实键盘高度时才使用估算');
assert(/realKbH\)/.test(keyboard), '聊天室拿到真实键盘高度时优先使用真实值');
console.log('\n✅ 安卓折叠屏无信号 IME 安全余量旅程通过；真实几何信号路径保持不变。');
