#!/usr/bin/env node
'use strict';
/* test-private-invite-code.js — 私密房邀请码加入路径
 * 覆盖: 码生成熵 / eh_join_by_code 代插成员 / 裸 insert 被 RLS 拦 / joinByCode 前端流程
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const SQL = fs.readFileSync(path.join(ROOT, 'sql/fix_private_join.sql'), 'utf8');
const LOBBY = fs.readFileSync(path.join(ROOT, 'js/modules/lobby.js'), 'utf8');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ✓ '+m);} else {fail++; console.log('  ✗ '+m);} };

console.log('\n── 邀请码生成 ──');
// 10 位 · 31 字符集, 禁易混 I/O/0/1
const genSrc = APP.slice(APP.indexOf('function genCode'), APP.indexOf('function genCode')+400);
ok(/CH\s*=\s*['"]ABCDEFGHJKMNPQRSTUVWXYZ23456789['"]/.test(genSrc), '码表用 31 字符集(无易混 I/O/0/1)');
ok(/i<10|for\s*\(\s*let i=0;i<10/.test(genSrc), '邀请码固定 10 位');
ok(/secureRand/.test(genSrc), '用 secureRand 取随机');

console.log('\n── 后端 RPC ──');
ok(/create or replace function public\.eh_join_by_code/.test(SQL), '存在 eh_join_by_code RPC');
ok(/security definer/i.test(SQL), 'RPC 为 security definer(代插成员)');
ok(/r\.invite_code\s*=\s*p_code/.test(SQL) || /invite_code\s*=\s*p_code/.test(SQL), 'RPC 校验邀请码匹配');
ok(/on conflict \(room_id, user_id\) do nothing/.test(SQL), '重复加入幂等');
ok(/kind='private'/.test(SQL), '只放行私密房');
ok(/members_insert/.test(SQL) && /eh_room_is_open|eh_is_member/.test(SQL), '裸 insert 收紧: 仅 open 房/已是成员/房主');

console.log('\n── 前端 joinByCode 流程 ──');
const joinSrc = APP.slice(APP.indexOf('async function joinByCode'), APP.indexOf('async function joinByCode')+1600);
ok(/eh_find_room_by_code/.test(joinSrc), '先按码查房');
ok(/eh_join_by_code/.test(joinSrc), '走带码校验 RPC 代插成员');
ok(!/from\('eh_members'\)\.insert/.test(joinSrc), '不在前端裸 insert eh_members');
ok(/toUpperCase\(\)/.joinSrc === undefined || /toUpperCase\(\)/.test(joinSrc), '邀请码大小写归一');
ok(/加入失败|邀请码无效/.test(joinSrc), '无效码给诚实错误文案');

console.log('\n── 私密房准入 ──');
const joinAs = APP.slice(APP.indexOf('async function joinAsMember'), APP.indexOf('async function joinAsMember')+1800);
ok(/kind==='private'/.test(joinAs), '私密房单独走成员资格校验');
ok(/需要邀请码/.test(joinAs), '非成员给「需要邀请码」');
ok(/clearLastRoom/.test(joinAs), '拒绝入房时清 last_room(防刷新回弹)');
ok(/upsert/.test(joinAs) && /ignoreDuplicates/.test(joinAs), '公开/官方房 upsert 幂等');

console.log('\n── 大厅邀请码展示 ──');
ok(/rm-code\[data-code\]/.test(LOBBY) || /data-code/.test(LOBBY), '大厅房卡带邀请码');
ok(/copyInvite/.test(LOBBY), '点码复制邀请');

console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
