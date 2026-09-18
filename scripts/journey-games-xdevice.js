#!/usr/bin/env node
'use strict';
/* journey-games-xdevice.js — 三游戏跨端一致 + 性能契约 */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const sh=R('js/games/table-shared.css');
const ddz=R('js/games/game-ui.js');
const gd=R('js/games/guandan-ui.js');
const pk=R('js/games/poker-ui.js');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

console.log('\n── 设计令牌 / 触控 / 无障碍 ──');
assert(/--eh-touch:\s*44px/.test(sh), '触控目标令牌 44px');
assert(/--eh-r-btn/.test(sh) && /--eh-ease/.test(sh), '圆角/缓动令牌');
assert(/:focus-visible/.test(sh), '三桌统一焦点可见环');
assert(/prefers-reduced-motion/.test(sh), '减少动态分支');
assert(/contain:\s*layout style/.test(sh), '桌体 contain 限布局范围');

console.log('\n── 交互一致 ──');
assert(/selectSameRankGroup/.test(ddz), '斗地主双触选同点一组');
assert(/selectGroupOfCard|runGroups/.test(gd), '掼蛋双触选组');
assert(/acceptSeq/.test(ddz) && /acceptSeq/.test(gd) && /acceptSeq/.test(pk), '三桌 guest 快照 seq 一致');
assert(/resumeRemote/.test(ddz) && /resumeRemote/.test(gd) && /resumeRemote/.test(pk), '三桌 resumeRemote 一致');
assert(/SFX_KEEP_WHEN_SPEAKING|setSfxSoft/.test(R('js/sfx-engine.js')), '音频互斥策略统一');

console.log('\n── 性能 ──');
assert(/_ddzSeatSigs/.test(ddz) && /oppDirty/.test(ddz), '斗地主座位增量签名');
assert(/_seatSigs/.test(gd), '掼蛋座位增量签名');
assert(/structSig/.test(pk) && /stateSig/.test(pk), '德州两层签名(结构/状态)');
assert(/positionSeats\._key/.test(pk), '德州座位几何缓存');
assert(/contain:\s*layout style paint/.test(sh), 'felt/paint contain');

console.log('\n── 日/夜与安全区 ──');
assert(/html\[data-mode="day"\]/.test(sh) && /safe-area-inset-bottom/.test(sh), '日间样式 + 底部安全区');

console.log('\n'+(failed?'❌ 有失败':'✅ 三游戏跨端统一契约通过'));
process.exit(failed?1:0);
