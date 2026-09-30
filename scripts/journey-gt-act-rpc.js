#!/usr/bin/env node
'use strict';
/* journey-gt-act-rpc.js — 联机出牌走 eh_gt_act RPC(已部署) + 降级 broadcast */
const fs=require('fs'), path=require('path');
const app=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
const sql=fs.readFileSync(path.join(__dirname,'..','sql/eh_gt_act.sql'),'utf8');
const ign=fs.readFileSync(path.join(__dirname,'..','.gitignore'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/function gtGuestSendAct/.test(app), 'guest 出牌入口 gtGuestSendAct');
assert(/eh_gt_act/.test(app), '前端调用 RPC eh_gt_act');
assert(/payload.uid/.test(app), '降级路径仍带 uid 供 host 校验');
assert(/auth\.uid\(\)/.test(sql) && /seat_mismatch/.test(sql), 'SQL RPC 含 uid↔seat 绑定');
assert(/\.secrets/.test(ign), '.secrets 已在 .gitignore(令牌不进仓库)');
// 反回退: 旧版 insert (kind, payload) 引用 eh_logs 不存在的 kind 列 → RPC 必炸 →
//   客人退回 via=bc → 被 requireViaRpc 拒 → 整局出不了牌(2026-09-29 实案)
assert(!/insert into public\.eh_logs \(kind/i.test(sql), 'eh_gt_act 不再用 eh_logs 不存在的 kind 列');
assert(/insert into public\.eh_logs \(scope, tag, actor_id/i.test(sql), '日志写 scope/tag/actor_id 真实列');
assert(/exception when others/i.test(sql), '日志失败不阻断出牌(异常块兜底)');
const gt = fs.readFileSync(path.join(__dirname,'..','js/modules/gt-net.js'),'utf8');
assert(/uidVerified/.test(gt), 'acceptMove: uid 已验证的 bc 降级放行(防 RPC 挂掉后死锁)');
const pk = fs.readFileSync(path.join(__dirname,'..','js/games/poker-ui.js'),'utf8');
assert(/awaitingHostT/.test(pk) && /出牌没成功/.test(pk), 'guest 超时复位 awaitingHost(防锁死不能出牌)');
assert(/log: \[\]/.test(fs.readFileSync(path.join(__dirname,'..','js/games/poker-net.js'),'utf8')), 'pseudoState 带 log 数组(否则客人 applyAction 直接炸)');
assert(/_deck: \{ cards:/.test(fs.readFileSync(path.join(__dirname,'..','js/games/poker-net.js'),'utf8')), 'pseudoState 带占位牌堆(advanceStreet 发牌不炸)');

console.log('\n'+(failed?'❌ 有失败':'✅ eh_gt_act RPC 接线契约通过'));
process.exit(failed?1:0);
