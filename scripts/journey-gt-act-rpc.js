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

console.log('\n'+(failed?'❌ 有失败':'✅ eh_gt_act RPC 接线契约通过'));
process.exit(failed?1:0);
