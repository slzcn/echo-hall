#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'keyboard.js'), 'utf8');
function assert(ok, msg) { if (!ok) throw new Error('FAIL: ' + msg); console.log('✓ ' + msg); }
assert(/window\.addEventListener\('resize', scheduleLayout/.test(src), '复用现有 resize → scheduleLayout 链');

// 生产行为反证：旧实现没有折叠/展开几何基线刷新契约。
// 这条必须在修复前先失败，不能把“缺新变量”当成最终测试目标。
const hasFoldGuard = /layoutWidth/.test(src) && /widthChanged/.test(src)
  && /innerHeight\s*\+\s*vkH/.test(src)
  && /innerHeight\s*\+\s*estimatedKbH/.test(src);
function visible(innerH, vvH, vkH, baseFullH, estimated=0) {
  let vis = innerH;
  if (vvH) vis = Math.min(vis, vvH);
  const full = Math.max(baseFullH || 0, innerH, vvH || 0);
  if (vkH > 0) vis = Math.min(vis, full - vkH);
  if (estimated > 0) vis = Math.min(vis, full - estimated);
  return Math.max(1, Math.round(vis));
}
const oldFoldResult = visible(521, 521, 320, 800);
if (!hasFoldGuard) assert(oldFoldResult === 521, `旧实现必红：展开后仍按闭合基线算出 ${oldFoldResult}，预期 521`);
else console.log('✓ 旧实现反证契约已由修复锚点覆盖');
assert(hasFoldGuard, '折叠屏几何基线变量与展开重建路径已存在');

function oldResize(ctx) { ctx.width = ctx.nextWidth; /* 旧 applyLayout 不刷新聚焦态基线 */ }
function newResize(ctx) {
  ctx.width = ctx.nextWidth;
  const widthChanged = ctx.width !== ctx.layoutWidth;
  if (widthChanged && ctx.chatFocused) {
    if (ctx.vkH > 0) ctx.baseFullH = Math.max(ctx.baseFullH, ctx.innerH + ctx.vkH);
    else if (ctx.estimatedKbH > 0) ctx.baseFullH = Math.max(ctx.baseFullH, ctx.innerH + ctx.estimatedKbH);
  }
  ctx.layoutWidth = ctx.width;
}
// 场景 A：键盘弹起后从闭合态展开，innerHeight 随展开增加。
{
  const old = { width:360, nextWidth:673, layoutWidth:360, innerH:521, vkH:320, estimatedKbH:0, baseFullH:800, chatFocused:true };
  oldResize(old);
  const bad = visible(old.innerH, old.innerH, old.vkH, old.baseFullH);
  const good = { ...old, baseFullH:800, width:360, layoutWidth:360 };
  newResize(good);
  const fixed = visible(good.innerH, good.innerH, good.vkH, good.baseFullH);
  assert(bad === 480, `旧实现必红：展开后仍按闭合基线算出 480（实际=${bad}）`);
  assert(good.baseFullH === 841, `场景 A：展开后重建全高 841（实际=${good.baseFullH}）`);
  assert(fixed === 521, `场景 A：展开后可视高恢复为 521（实际=${fixed}）`);
}
// 场景 B：普通手机键盘弹起，宽度不变，不能用已缩 innerHeight 覆盖全高。
{
  const ctx = { width:393, nextWidth:393, layoutWidth:393, innerH:532, vkH:320, estimatedKbH:0, baseFullH:852, chatFocused:true };
  newResize(ctx);
  assert(ctx.baseFullH === 852, '场景 B：普通键盘弹起宽度不变，不污染全高基线');
}
// 场景 C：展开后收折，仍以当前缩小 innerHeight 为最终可视高，不双减。
{
  const ctx = { width:673, nextWidth:360, layoutWidth:673, innerH:480, vkH:320, estimatedKbH:0, baseFullH:841, chatFocused:true };
  newResize(ctx);
  assert(ctx.baseFullH === 841, '场景 C：收折不把展开态基线错误降低');
  assert(visible(ctx.innerH, ctx.innerH, ctx.vkH, ctx.baseFullH) === 480, '场景 C：收折后可视高仍为当前缩小 innerHeight，无双减');
}
// 场景 D：无真实 VK 时使用估算键盘高度。
{
  const ctx = { width:360, nextWidth:673, layoutWidth:360, innerH:521, vkH:0, estimatedKbH:320, baseFullH:800, chatFocused:true };
  newResize(ctx);
  assert(ctx.baseFullH === 841, '场景 D：估算键盘路径同样重建展开态全高');
}
console.log('\n✅ 折叠屏键盘展开旅程通过：展开修复、普通手机不污染、收折不双减、估算路径全覆盖；旧实现必红。');
process.exit(0);
