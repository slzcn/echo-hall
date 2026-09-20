#!/usr/bin/env node
'use strict';
/* journey-ui-consistency.js — 文案/结构/性能严谨一致性 */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const ddz=R('js/games/game-ui.js'), gd=R('js/games/guandan-ui.js'), pk=R('js/games/poker-ui.js');
const app=R('js/app.js'), sh=R('js/games/table-shared.css'), net=R('js/games/table-net.js');
const ver=R('ver.txt').trim(), html=R('index.html'), sw=R('sw.js');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

console.log('\n── 文案一致 ──');
assert(/邀请补位/.test(ddz) && /邀请补位/.test(gd) && /邀请补位/.test(pk), '空位文案统一「邀请补位」');
assert(/一键补满/.test(ddz) && /一键补满/.test(gd) && /一键补满/.test(pk), '补满按钮统一「一键补满」');
assert(/一键补满/.test(net) && /邀请补位/.test(net), '聊天牌桌卡文案与桌内对齐');
assert(/点空位邀请补位/.test(net), '牌桌卡提示「点空位邀请补位」');
assert(/点「开始」发牌/.test(ddz) && /点「开始」发牌/.test(gd) && /点「开始」发牌/.test(pk), '招募提示统一「点开始发牌」');
assert(/补位 · 等开局/.test(ddz) && /补位 · 等开局/.test(gd), '补位 toast 统一「等开局」');
assert(/暂无灵魂 · 可一键补满或邀请真人/.test(ddz) && /暂无灵魂/.test(gd), '无灵魂提示统一');
assert(/出牌未通过校验，请刷新后重试/.test(app), 'RPC 校验失败文案统一');
assert(/我回来了 · 接管座位/.test(ddz) && /我回来了 · 接管座位/.test(gd) && /我回来了 · 接管座位/.test(pk), '接管座位文案一致');
assert(/收工/.test(ddz) && /收工/.test(gd) && /收工/.test(pk), '结算「收工」一致');
assert(/今日对局已达/.test(pk) && /今日对局已达/.test(app), '每日局数文案统一');

console.log('\n── 结构一致 ──');
assert(/ddz-lobacts|ddz-acts/.test(ddz) && /gd-lobacts|gd-acts/.test(gd) && /pk-lobacts|pk-acts/.test(pk), '操作区容器命名各就各位');
assert(/pk-prehint/.test(pk) && /还差 \$\{empties\} 席 · 点空位邀请补位/.test(pk), '德州招募提示与另两桌同构');
assert(/min-height:\s*0/.test(sh) && /is-lobby/.test(sh), '招募/短屏骨架降级仍在');
assert(/var\(--accent/.test(sh), '台面/按钮跟主题变量');

console.log('\n── 性能收口 ──');
assert(/_ddzSeatSigs/.test(ddz) && /oppDirty/.test(ddz), '斗地主座位增量');
assert(/_seatSigs/.test(gd), '掼蛋座位增量');
assert(/structSig/.test(pk) && /positionSeats\._key/.test(pk), '德州签名+几何缓存');
assert(/EH_MESSAGES/.test(app) && /shouldPersistSnap/.test(app), '快照节流走模块');
assert(/_ehCatch\('rmMsgChan'/.test(app), '通道清理可观测');

console.log('\n── 严谨 ──');
const build=(html.match(/BUILD_VER='([^']+)'/)||[])[1];
const appVer=(app.match(/__EH_APP_VER = '([^']+)'/)||[])[1];
const swVer=(sw.match(/SW_VERSION = '([^']+)'/)||[])[1];
assert(!!ver && build===ver && appVer===ver && (swVer||'').includes(ver),
  `版本三元组一致 BUILD=app=ver.txt=${ver} · SW=${swVer}`);
assert(/isTrustedVoiceSrc/.test(R('js/modules/messages.js')), '语音白名单在模块');

console.log('\n'+(failed?'❌ 有失败':'✅ 文案/结构/性能一致性通过'));
process.exit(failed?1:0);
