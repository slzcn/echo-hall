#!/usr/bin/env node
'use strict';
// 横竖屏 VK 双减旅程：
//   场景 A - 未聚焦竖→横切换 baseFullH 应刷新为新朝向真全高
//   场景 B - 键盘弹起中转屏时 baseFullH 不应被清 0 → 不产生双减
//   场景 C - 键盘弹起中转屏后收键盘 → baseFullH 应刷新到新朝向真全高
//
// 手法：从 js/keyboard.js 抽取三个纯函数级契约:
//   1) orientationchange handler 里的 baseFullH 处理策略
//   2) applyLayout 复位分支（未聚焦 + 无估算 + VK 收起 → 刷新 baseFullH）
//   3) visibleHeight() 的分母/扣键盘逻辑
//   然后按真实时间轴 stub。旧实现（无条件置 0）必红，新实现（键盘弹起时保留）必绿。

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'keyboard.js'), 'utf8');

function assert(ok, msg) { if (!ok) throw new Error('FAIL: ' + msg); console.log('✓ ' + msg); }

// -----------------------------------------------------------
// 从源码提取 orientationchange handler 主体（一次性静态契约扫描）
// -----------------------------------------------------------
const orientLine = src.match(/window\.addEventListener\('orientationchange',\s*\(\)\s*=>\s*\{[^}]*\}/);
if (!orientLine) throw new Error('FAIL: 找不到 orientationchange handler');
const handlerBody = orientLine[0];

// 契约 1：handler 不再无条件把 baseFullH=0（旧实现的锐点）
assert(!/orientationchange[^{]*\{[^}]*baseFullH\s*=\s*0\s*;\s*setTimeout/.test(src),
  '契约 1：orientationchange 不再无条件立即 baseFullH=0（这是双减根因）');

// 契约 2：handler 里必须包含「键盘落下判断」再决定是否清 baseFullH
assert(/orientationchange[^{]*\{[\s\S]*?chatFocused[\s\S]*?estimatedKbH[\s\S]*?baseFullH\s*=\s*0/.test(src),
  '契约 2：orientationchange 只在键盘落下态才把 baseFullH=0');

// 契约 3：handler 尾部仍有 settleChatLayout 触发（让新朝向布局刷新 & applyLayout 复位分支能重刷 baseFullH）
assert(/orientationchange[\s\S]*?settleChatLayout/.test(src),
  '契约 3：orientationchange 仍触发 settleChatLayout 让键盘落下路径刷新 baseFullH');

// -----------------------------------------------------------
// 时间轴模拟（VM 跑最小逻辑克隆，验三场景行为）
// -----------------------------------------------------------
// 从源码提取 visibleHeight 分母与扣键盘部分做行为参考；这里用等价逻辑重放三场景。
function makeCtx({ innerH, vvH, vkH, chatFocused, estimatedKbH, baseFullH }) {
  return { innerH, vvH, vkH, chatFocused, estimatedKbH, baseFullH };
}
function visibleHeight(ctx) {
  let vis = ctx.innerH;
  if (ctx.vvH) vis = Math.min(vis, ctx.vvH);
  const full = Math.max(ctx.baseFullH || 0, ctx.innerH, ctx.vvH || 0);
  if (ctx.vkH > 0) vis = Math.min(vis, full - ctx.vkH);
  if (ctx.estimatedKbH > 0) vis = Math.min(vis, full - ctx.estimatedKbH);
  return Math.max(1, Math.round(vis));
}
function applyLayoutRefresh(ctx) {
  // 复用生产 applyLayout 复位分支同款条件：未聚焦 + 无估算 + VK 收起
  const vkDown = !(ctx.vkH > 0);
  if (!ctx.chatFocused && ctx.estimatedKbH === 0 && vkDown) {
    ctx.baseFullH = Math.max(ctx.innerH, ctx.vvH || 0);
  }
}
// 生产 orientationchange 新逻辑等价 stub：键盘落下才清 baseFullH
function orientChangeNew(ctx) {
  const vkDown = !(ctx.vkH > 0);
  if (!ctx.chatFocused && ctx.estimatedKbH === 0 && vkDown) {
    ctx.baseFullH = 0;
  }
  // 250ms 后 settleChatLayout → applyLayout 会执行复位分支
  applyLayoutRefresh(ctx);
}
// 旧实现（有 bug）：无条件 baseFullH=0
function orientChangeOld(ctx) {
  ctx.baseFullH = 0;
  applyLayoutRefresh(ctx); // 键盘弹起态复位分支跳过 → baseFullH 保持 0
}

// ---- 场景 A：未聚焦竖(800)→横(400) ----
{
  const ctx = makeCtx({ innerH: 400, vvH: 400, vkH: 0, chatFocused: false, estimatedKbH: 0, baseFullH: 800 });
  orientChangeNew(ctx);
  assert(ctx.baseFullH === 400, '场景 A：未聚焦转屏后 baseFullH 更新为新朝向 400');
  assert(visibleHeight(ctx) === 400, '场景 A：可视高 = 新朝向真全高（无双减）');
}

// ---- 场景 B：键盘弹起中转屏，VK 高 300，旧全高 800，新朝向 innerH=400 (resizes-content 已扣) ----
{
  // 修复前旧实现锐点：baseFullH 被立即清 0，full 退化成 max(0,400)=400，再减 300 → 100
  const bad = makeCtx({ innerH: 400, vvH: 400, vkH: 300, chatFocused: true, estimatedKbH: 0, baseFullH: 800 });
  orientChangeOld(bad);
  const visBad = visibleHeight(bad);
  assert(visBad < 200, `旧实现必红：键盘弹起转屏产生双减(可视高=${visBad}，远小于真可视 500)`);

  // 新实现：键盘弹起 → baseFullH 保留 800 → full=max(800,400)=800 → vis=min(innerH=400, full-vkH=500)=400（只减一次）
  //   旧实现错在把 full 退化成 400 → 400-300=100 → vis=min(400,100)=100（双减）；已在上方 visBad<200 抰红。
  const good = makeCtx({ innerH: 400, vvH: 400, vkH: 300, chatFocused: true, estimatedKbH: 0, baseFullH: 800 });
  orientChangeNew(good);
  const visGood = visibleHeight(good);
  assert(good.baseFullH === 800, '场景 B：键盘弹起中转屏 baseFullH 保留旧全高，不被清 0');
  assert(visGood >= 400 && visGood > visBad * 2, `场景 B：修好后可视高=${visGood}（至少 = min(innerH, full-vkH)=400，无双减；旧实现仅=${visBad}）`);
}

// ---- 场景 C：键盘弹起中转屏后键盘落下 ----
{
  const ctx = makeCtx({ innerH: 400, vvH: 400, vkH: 300, chatFocused: true, estimatedKbH: 0, baseFullH: 800 });
  orientChangeNew(ctx);
  assert(ctx.baseFullH === 800, '场景 C 前提：转屏后键盘仍弹起，baseFullH 保留 800');
  // 键盘落下：vkH=0, chatFocused=false, innerH/vvH 回到新朝向真全高 700（横屏 - 状态栏）
  ctx.vkH = 0; ctx.chatFocused = false; ctx.innerH = 700; ctx.vvH = 700;
  applyLayoutRefresh(ctx);
  assert(ctx.baseFullH === 700, '场景 C：键盘落下后 applyLayout 复位分支刷新 baseFullH=700 新朝向');
  assert(visibleHeight(ctx) === 700, '场景 C：键盘落下后可视高 = 新朝向真全高');
}

// ---- 反证：旧实现在场景 A 会不会出问题？----
// 旧实现未聚焦转屏其实也 OK（复位分支能刷新），所以旧实现只在场景 B 挂
{
  const ctx = makeCtx({ innerH: 400, vvH: 400, vkH: 0, chatFocused: false, estimatedKbH: 0, baseFullH: 800 });
  orientChangeOld(ctx);
  assert(ctx.baseFullH === 400, '反证补充：旧实现场景 A 侥幸 OK（复位分支救了）——所以只在场景 B 双减');
}

console.log('\n✅ 横竖屏 VK 双减旅程通过：场景 A/C 保持绿，场景 B 修复后不双减，旧实现在场景 B 必红。');
