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
 *   ② 三款牌桌顶栏都有「✕ 返回」房间入口(aria-label=返回房间)。
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
  if (new RegExp(`class="${xcls}"[^>]*aria-label="返回房间"`).test(src) || (new RegExp(`class="${xcls}"`).test(src) && /返回房间|返回聊天/.test(src)))
    ok(`[${tag}] 顶栏有「✕ 返回」聊天入口(.${xcls})`);
  else bad(`[${tag}] ${file} 顶栏缺「✕ 返回」聊天入口(.${xcls} / aria-label=返回聊天)`);
}

// ④ 进出一条路: 退出=X「返回房间」; 顶栏/折叠片不再有「离桌」双按钮(免与返回语义打架)
const APP = fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
for (const [tag, file] of [['斗地主','js/games/game-ui.js'],['掼蛋','js/games/guandan-ui.js'],['德州','js/games/poker-ui.js']]){
  const src = fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  if (/eh-leave|ck-leave/.test(src)) bad(`[${tag}] ${file} 仍带「离桌」按钮(退出应只走 X 返回房间)`);
  else ok(`[${tag}] 顶栏/折叠片无「离桌」双按钮`);
}
if (!/已入座 · 跟上这局|已入座 · 人齐自动开局/.test(APP)) bad('加入缺「已入座」确认反馈');
else ok('点牌桌卡加入有「已入座」确认');
const _uf = (APP+fs.readFileSync(path.join(__dirname,'..','js/games/poker-ui.js'),'utf8'))
  .split('\n').filter(l=>/toast\(|textContent=|innerHTML=|callLbl=/.test(l)).join('\n');
if (/等待裁决/.test(_uf)) bad('用户可见文案仍有「等待裁决」黑话');
else ok('提示词已去掉「等待裁决」黑话');

if (fails.length) { console.log(`\n❌ 牌桌聊天下线守卫 ${fails.length} 项未过`); process.exit(1); }
console.log('\n✅ 牌桌进出一条路 + 聊天下线守卫全通过: 返回房间 / 无离桌双钮 / 已入座反馈 / 提示词对齐');
