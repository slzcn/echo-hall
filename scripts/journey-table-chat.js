#!/usr/bin/env node
'use strict';
/**
 * journey-table-chat.js — 牌桌"游戏内聊天已下线"回归守卫【静态】
 *
 * 历史: F2 曾给牌桌镶一条可收起聊天坞(.tchat)+弹幕层(.tchat-dm), 走 realtime 边打边聊。
 * 决策(155216c「游戏内聊天下线」): 撤掉牌桌内聊天坞/弹幕, 减少牌桌干扰、专注对局;
 *   看消息/聊天一律点顶栏「✕ 返回」回聊天室(牌桌折叠成活牌桌片, 牌局后台继续)。
 *
 * 本测退化为"别把聊天坞加回来"的反回退守卫(静态即可, 无需起浏览器):
 *   ① 三款牌桌 UI 里聊天坞恒关(const dock = null), 且不再构建 .tchat/.tchat-dm 相关 DOM。
 *   ② 三款牌桌顶栏都有「✕ 返回」聊天入口(aria-label=返回聊天)。
 * 若哪天要恢复牌桌内聊天, 请连同本测一起改回行为版(见 git 887a6ae 旧实现)。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');

const fails = [];
const ok = m => console.log('  ✓ ' + m);
const bad = m => { console.log('  ✗ ' + m); fails.push(m); };

const UIS = [
  ['斗地主', 'game-ui.js', 'ddz-x'],
  ['掼蛋', 'guandan-ui.js', 'gd-x'],
  ['德州', 'poker-ui.js', 'pk-x'],
];

console.log('── 牌桌"游戏内聊天已下线"回归守卫 ──');
for (const [tag, file, xcls] of UIS) {
  const src = G(file);

  // ① 聊天坞恒关: const dock = null (下线标记)
  if (/const\s+dock\s*=\s*null/.test(src)) ok(`[${tag}] 聊天坞已下线(const dock = null)`);
  else bad(`[${tag}] ${file} 缺"聊天坞下线"标记(const dock = null) —— 聊天坞被加回来了?`);

  // ② 不再挂载牌桌内聊天坞/弹幕 DOM(class 名以字面量出现即视为在建 DOM)
  if (/class="[^"]*\btchat\b/.test(src) || /class="[^"]*\btchat-dm\b/.test(src))
    bad(`[${tag}] ${file} 又出现 .tchat/.tchat-dm 聊天坞 DOM(牌桌内聊天不该复活)`);
  else ok(`[${tag}] 未重建聊天坞/弹幕 DOM(.tchat/.tchat-dm)`);

  // ③ 顶栏保留「✕ 返回」聊天入口(牌桌折叠回聊天室看消息的唯一路径)
  if (new RegExp(`class="${xcls}"[^>]*aria-label="返回聊天"`).test(src) || (new RegExp(`class="${xcls}"`).test(src) && /返回聊天/.test(src)))
    ok(`[${tag}] 顶栏有「✕ 返回」聊天入口(.${xcls})`);
  else bad(`[${tag}] ${file} 顶栏缺「✕ 返回」聊天入口(.${xcls} / aria-label=返回聊天)`);
}

if (fails.length) { console.log(`\n❌ 牌桌聊天下线守卫 ${fails.length} 项未过`); process.exit(1); }
console.log('\n✅ 牌桌"游戏内聊天已下线"守卫全通过: 三款坞恒关 + 无 .tchat DOM + 顶栏「✕ 返回」在(点它回聊天室看消息)');
