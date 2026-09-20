#!/usr/bin/env node
'use strict';
/* journey-chat-core.js — A: messages/room 纯逻辑迁出 + B: act via=rpc + 聊天核心守卫 */
const fs=require('fs'), path=require('path');
const msg=fs.readFileSync(path.join(__dirname,'..','js/modules/messages.js'),'utf8');
const room=fs.readFileSync(path.join(__dirname,'..','js/modules/room.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
const gt=fs.readFileSync(path.join(__dirname,'..','js/modules/gt-net.js'),'utf8');
const idx=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

console.log('\n── A 架构: messages/room ──');
assert(/EH_MESSAGES_MODULE/.test(msg) && /dedupProjInHistory/.test(msg) && /dedupPlan/.test(msg), 'messages 模块含真实纯逻辑');
assert(/stillInRoom/.test(msg) && /shouldPersistSnap/.test(msg), 'messages 含切房/快照节流守卫');
assert(/EH_ROOM_MODULE/.test(room) && /canEnter/.test(room) && /clearedStateKeys/.test(room), 'room 模块含生命周期纯逻辑');
assert(/EH_MESSAGES/.test(app) && /EH_ROOM/.test(app), 'app.js 接线 EH_MESSAGES / EH_ROOM');
assert(/modules\/messages\.js/.test(idx) && /modules\/room\.js/.test(idx), 'index 挂载 messages/room');
assert(/window\.EH_MESSAGES_MODULE/.test(app) && /dedupProjInHistory/.test(app), '历史投影去重走模块');
assert(/shouldPersistSnap/.test(app), '快照节流走模块');

console.log('\n── B 联机: via=rpc ──');
assert(/via:\s*via \|\| 'bc'|via \|\| .bc./.test(gt) || /via: via \|\| 'bc'/.test(gt) || /via: via \|\| .bc./.test(gt) || /via: via/.test(gt), 'guest act 带 via 标记');
assert(/sendBc\('rpc'\)/.test(gt), 'RPC 成功后 via=rpc');
assert(/requireViaRpc/.test(gt), 'host 支持 requireViaRpc');
assert(/payload\.via/.test(app), 'app host 读 payload.via');

console.log('\n── C 聊天核心不变量 ──');
assert(/function dedupStreamByMid/.test(app) && /MutationObserver/.test(app), '消息流 mid 去重 + 实时清道夫');
assert(/_enterRid/.test(app) && /curRoom\.id!==_enterRid/.test(app), 'loadHistory 切房守卫');
assert(/function subscribeMessages/.test(app) && /setupEpoch!==roomEpoch/.test(app), '订阅代次守卫');
assert(/function send\(/.test(app) && /aria-busy/.test(app), 'loadHistory busy 语义在源码中');

// 纯逻辑: dedupPlan
const M = require(path.join(__dirname,'..','js/modules/messages.js'));
const plan = M.dedupPlan([
  { mid:'a', len:10, isLocal:false },
  { mid:'a', len:30, isLocal:false },
  { mid:'b', len:5, isLocal:false },
  { mid:'local_x', len:9, isLocal:true },
]);
assert(Array.isArray(plan) && plan.length===1 && plan[0]===0, 'dedupPlan 保留更长一条(移除 idx0)');
assert(M.stillInRoom('r1','r1')===true && M.stillInRoom('r2','r1')===false, 'stillInRoom 切房判断');
assert(M.shouldPersistSnap(10000, 8000, 3000)===false && M.shouldPersistSnap(12000, 8000, 3000)===true, '快照 3s 节流');
const R = require(path.join(__dirname,'..','js/modules/room.js'));
assert(R.canEnter({id:'x',kind:'official'}) && !R.canEnter(null), 'room.canEnter');
assert(R.stillValid({id:'x'},'x') && !R.stillValid({id:'y'},'x'), 'room.stillValid 切房');

console.log('\n'+(failed?'❌ 有失败':'✅ A架构 + B联机via + C聊天核心 通过'));
process.exit(failed?1:0);
