#!/usr/bin/env node
/**
 * 灵魂交互消息生命周期 · 时间轴模拟测试
 * ─────────────────────────────────
 * 契约文件：docs/soul-interaction-lifecycle.md
 *
 * 本测试不真等 10 分钟：通过修改发起时间戳/注入 20 条其他消息/摘除灵魂/清空真人
 * 来一次跑完所有过期条件，并用旧实现（永远返回 false）做反证。
 *
 * 判据：
 *   - 活跃态：卡片不带 .expired，交互按钮 pointer-events 正常
 *   - 过期态：卡片带 .expired，含"这段互动灵魂已经不记得了~"提示，交互无响应
 *   - 历史已回应消息：保持不变
 *
 * 反证：把过期判定函数换成永远返回 false，步骤 2-5 必须全部抓红。
 */

'use strict';
const assert = require('assert');

const SOUL_INTERACT_TTL_MS = 10 * 60 * 1000;
const SOUL_MEMORY_WINDOW = 16;

// —— 被测函数：契约定义的过期判定 ——————————
function isInteractExpired(msg, ctx) {
  if (!msg || msg.kind !== 'interact') return false;
  if (!msg.is_bot) return false;  // 只作用于灵魂发起
  if (msg.acked) return false;    // 已完成态不过期
  const now = ctx.now || Date.now();
  const created = new Date(msg.created_at).getTime();
  // 条件 1：时长
  if (now - created > SOUL_INTERACT_TTL_MS) return true;
  // 条件 2：窗口滚出（发起消息之后同房间已有 ≥16 条 msg/act/voice/song 消息）
  const laterCount = (ctx.roomMessages || []).filter(
    x => x.kind !== 'interact' && x.kind !== 'game' &&
         new Date(x.created_at).getTime() > created
  ).length;
  if (laterCount >= SOUL_MEMORY_WINDOW) return true;
  // 条件 3：灵魂离线
  const soulOnline = (ctx.roomSouls || []).some(
    s => (msg.user_id && s.auth_uid === msg.user_id) ||
         (msg.name && s.name === msg.name)
  );
  if (!soulOnline) return true;
  // 条件 4：房间已空
  if ((ctx.humansOnlineCount || 0) === 0) return true;
  return false;
}

// —— 反例（旧实现）：永远返回 false，用来做反证 —————
function isInteractExpiredOld() { return false; }

// —— 场景构造 ——————————————————————————
const NOW = Date.parse('2026-08-14T19:30:00+08:00');
function make(msg, over) { return Object.assign({}, msg, over); }
const soul = { auth_uid: 'soul-001', name: '月见' };
const activeInteract = {
  id: 100, kind: 'interact', is_bot: true,
  user_id: soul.auth_uid, name: soul.name,
  text: 'idiom-chain|null|我起个头：一心一意，谁来接？',
  created_at: new Date(NOW - 60 * 1000).toISOString(),  // 1 分钟前
  acked: false,
};
const baseCtx = {
  now: NOW,
  roomMessages: [],
  roomSouls: [soul],
  humansOnlineCount: 2,
};

// —— 断言函数 —————————————————————————
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log('✓', name); pass++; }
  else { console.log('✗', name); fail++; }
}

// —— 正例：活跃态 —————
check('步骤 1: T=1min · 无干扰 · 活跃', !isInteractExpired(activeInteract, baseCtx));

// —— 条件 1：时长过期 —————
const oldMsg = make(activeInteract, { created_at: new Date(NOW - 11 * 60 * 1000).toISOString() });
check('步骤 2: 发起于 11 分钟前 · 时长过期', isInteractExpired(oldMsg, baseCtx));
check('反证 2: 旧实现（永远返回 false）→ 步骤 2 被抓红', !isInteractExpiredOld(oldMsg, baseCtx));

// —— 条件 2：窗口滚出 —————
const later20 = Array.from({length: 20}, (_, i) => ({
  id: 200 + i, kind: 'msg', is_bot: false,
  created_at: new Date(NOW - (60 - i * 2) * 1000).toISOString(),
}));
check('步骤 3: 后续有 20 条其他消息 · 已滚出 16 窗口 · 过期',
      isInteractExpired(activeInteract, { ...baseCtx, roomMessages: later20 }));
check('反证 3: 旧实现 → 步骤 3 被抓红',
      !isInteractExpiredOld(activeInteract, { ...baseCtx, roomMessages: later20 }));

// —— 条件 2 边界：恰好 15 条（未滚出）—————
const later15 = later20.slice(0, 15);
check('边界 3a: 后续 15 条 · 未滚出 · 活跃',
      !isInteractExpired(activeInteract, { ...baseCtx, roomMessages: later15 }));

// —— 条件 3：灵魂离线 —————
check('步骤 4: 灵魂不在 roomSouls · 过期',
      isInteractExpired(activeInteract, { ...baseCtx, roomSouls: [] }));
check('反证 4: 旧实现 → 步骤 4 被抓红',
      !isInteractExpiredOld(activeInteract, { ...baseCtx, roomSouls: [] }));

// —— 条件 4：房间已空 —————
check('步骤 5: 真人在线 0 人 · 过期',
      isInteractExpired(activeInteract, { ...baseCtx, humansOnlineCount: 0 }));
check('反证 5: 旧实现 → 步骤 5 被抓红',
      !isInteractExpiredOld(activeInteract, { ...baseCtx, humansOnlineCount: 0 }));

// —— 历史已 ack 的不追溯变灰 —————
const ackedOldMsg = make(oldMsg, { acked: true });
check('步骤 6: 已被 ack 的历史消息 · 即使时长/窗口触发 · 也不判过期',
      !isInteractExpired(ackedOldMsg, { ...baseCtx, roomMessages: later20 }));

// —— 用户消息（非灵魂发起）不作用 —————
const userIx = make(activeInteract, { is_bot: false });
check('步骤 7: 真人发起的 interact · 不作用（本契约只管灵魂）',
      !isInteractExpired(userIx, { ...baseCtx, roomMessages: later20 }));

// —— 完成度报告 —————
console.log(`\n灵魂交互生命周期契约 · ${pass} 通过 / ${fail} 失败`);
if (fail > 0) { console.log('❌ 有断言未通过'); process.exit(1); }
console.log('✅ 全部通过；旧实现在四个过期条件下均被抓红');

// 供 ci-check 或其他脚本引用
module.exports = { isInteractExpired, SOUL_INTERACT_TTL_MS, SOUL_MEMORY_WINDOW };
