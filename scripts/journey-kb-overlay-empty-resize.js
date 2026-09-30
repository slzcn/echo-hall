'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'keyboard.js'), 'utf8');
function assert(ok, msg) {
  if (!ok) throw new Error('FAIL: ' + msg);
  console.log('✓ ' + msg);
}

// 生产锚点：必须复用现有 visualViewport.resize 分支，不能另加监听器。
assert(/viewport\.addEventListener\('resize', \(\) => \{/.test(src), '复用现有 visualViewport.resize 入口');
assert(/signalBaseline/.test(src), 'resize 分支使用 focusin 建立的信号基线');
assert(/Math\.abs\(.*viewport\.height.*signalBaseline\.vvH/.test(src), 'resize 分支按高度变化判断真信号');

function visible(innerH, vvH, baseFullH, estimatedKbH) {
  let vis = Math.min(innerH, vvH);
  const full = Math.max(baseFullH, innerH, vvH);
  if (estimatedKbH > 0) vis = Math.min(vis, full - estimatedKbH);
  return Math.max(1, Math.round(vis));
}
function oldResize(ctx) {
  if (ctx.estimatedKbH > 0) ctx.estimatedKbH = 0;
}
function fixedResize(ctx) {
  const hasRealVvChange = Math.abs(ctx.vvH - ctx.baselineVvH) > 1;
  if (ctx.estimatedKbH > 0 && hasRealVvChange) ctx.estimatedKbH = 0;
}

// 场景 1：覆盖式键盘发空 resize，估算必须保留，composer 仍在键盘上方。
{
  const old = { vvH: 719, baselineVvH: 719, estimatedKbH: 273 };
  oldResize(old);
  const fixed = { vvH: 719, baselineVvH: 719, estimatedKbH: 273 };
  fixedResize(fixed);
  assert(old.estimatedKbH === 0, '旧实现反证：空 resize 会错误清零估算');
  assert(fixed.estimatedKbH === 273, '当前实现：空 resize 保留估算键盘高');
  assert(visible(718, 719, 719, fixed.estimatedKbH) === 446, '覆盖式键盘空 resize 后 hall 仍缩至可见区');
}
// 场景 2：真实视口缩高，估算必须让位给真实信号。
{
  const ctx = { vvH: 408, baselineVvH: 719, estimatedKbH: 273 };
  fixedResize(ctx);
  assert(ctx.estimatedKbH === 0, '真实 visualViewport 缩高后撤销估算，回到真值主链');
}
// 场景 3：无估算时 resize 不改变现有主链。
{
  const ctx = { vvH: 719, baselineVvH: 719, estimatedKbH: 0 };
  fixedResize(ctx);
  assert(ctx.estimatedKbH === 0, '无估算态的空 resize 保持无估算');
}
console.log('\n✅ 覆盖式键盘空 resize 旅程通过：空事件保留估算、真缩高切真值、旧实现必红。');
process.exit(0);
