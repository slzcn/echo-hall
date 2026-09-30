#!/usr/bin/env node
'use strict';
/* journey-multiplayer-join.js — 多人进同一桌路径严谨回归
 * 1) gtEnsureSeated: 未在座真人自动坐进空位(不再「你不在这桌」)
 * 2) guest lobby 首帧显示招募态座位, 不空白「等待发牌」
 * 3) 一房一桌错游戏: 明确提示, 不静默塞进错桌
 * 4) 进房无牌桌卡 DOM 时 gtSurfaceTable 补入口
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const PK  = fs.readFileSync(path.join(ROOT, 'js/games/poker-ui.js'), 'utf8');
const GD  = fs.readFileSync(path.join(ROOT, 'js/games/guandan-ui.js'), 'utf8');
const DZ  = fs.readFileSync(path.join(ROOT, 'js/games/game-ui.js'), 'utf8');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ✓ '+m);} else {fail++; console.log('  ✗ '+m);} };

// ── 1) 统一入座助手存在, 三款 guest 都先走它 ──
ok(/async function gtEnsureSeated/.test(APP), 'gtEnsureSeated 统一入座助手存在');
ok(/gtEnterPoker[\s\S]{0,800}gtEnsureSeated/.test(APP), '德州 guest 走 gtEnsureSeated');
ok(/gtEnterGuandan[\s\S]{0,800}gtEnsureSeated/.test(APP), '掼蛋 guest 走 gtEnsureSeated');
ok(/gtEnterDdz[\s\S]{0,800}gtEnsureSeated/.test(APP), '斗地主 guest 走 gtEnsureSeated');
ok(!/function gtEnterGuandan[\s\S]{0,500}你不在这桌/.test(APP), '掼蛋不再抛「你不在这桌」');
ok(!/function gtEnterDdz[\s\S]{0,500}你不在这桌/.test(APP), '斗地主不再抛「你不在这桌」');
ok(/function (?:gtEnterPoker|_gtEnterPokerV2)[\s\S]{0,2500}gtSpectatePoker/.test(APP), '德州满座才旁观');

// ── 2) lobby 客人首帧: isGuest && lobbyMode → lobbyState ──
ok(/isGuest\s*\?\s*\(\s*lobbyMode\s*\?\s*lobbyState/.test(PK), '德州 guest lobby 首帧走 lobbyState');
ok(/isGuest\s*\?\s*\(\s*lobbyMode\s*\?\s*lobbyState/.test(GD), '掼蛋 guest lobby 首帧走 lobbyState');
ok(/isGuest\s*\?\s*\(\s*lobbyMode\s*\?\s*lobbyState/.test(DZ), '斗地主 guest lobby 首帧走 lobbyState');
ok(/lobby:inLobby/.test(APP), 'guest open 传 lobby:inLobby');

// ── 3) gtEnter 引擎持有者 lobby 落招募态 ──
ok(/if\(row\.status==='lobby'\)\{\s*gtLaunchLobbyLocal\(row\)/.test(APP), '引擎持有者 lobby → gtLaunchLobbyLocal(不误开对局)');

// ── 4) 一房一桌错游戏明确提示 ──
ok(/房间里已有一桌/.test(APP), '错游戏有明确提示');
ok(/row\.game!=='nlhe'/.test(APP), '德州开桌守卫错游戏');
ok(/row\.game!=='guandan'/.test(APP), '掼蛋开桌守卫错游戏');

// ── 5) 进房补活桌卡 ──
ok(/function gtSurfaceTable/.test(APP), 'gtSurfaceTable 进房补活桌入口');
ok(/gtSurfaceTable\(row\)/.test(APP), 'setupGameTables/realtime 走 gtSurfaceTable');

// ── 6) 多人进同一桌语义: gtGotoExistingTable 统一入座 ──
ok(/gtGotoExistingTable[\s\S]{0,900}gtEnsureSeated/.test(APP), 'gtGotoExistingTable 走统一入座');

console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
