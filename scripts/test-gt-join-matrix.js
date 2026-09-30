#!/usr/bin/env node
'use strict';
/* test-gt-join-matrix.js — 多人入座矩阵与满座分流
 * 覆盖: 空位优先 / 德州可顶替 AI / 斗地主掼蛋只坐空位 / 满座分流(德州旁观, 其余诚实提示) /
 *       away 席回归 / 一人两座防护 / 引擎持有者=最小非 away 真人
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const SQL = fs.readFileSync(path.join(ROOT, 'sql/eh_game_tables.sql'), 'utf8');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ✓ '+m);} else {fail++; console.log('  ✗ '+m);} };

function mkRow(game, seats){ return { id:'t1', game, status:'playing', seats }; }
function empty(seat){ return { seat, kind:'empty' }; }
function human(seat, uid, extra){ return Object.assign({ seat, kind:'human', uid, name:uid, emoji:'🙂' }, extra||{}); }
function bot(seat){ return { seat, kind:'ai', uid:'bot'+seat, name:'机器人'+seat, emoji:'🤖' }; }
function soul(seat){ return { seat, kind:'soul', uid:'soul'+seat, name:'灵魂'+seat, emoji:'👤' }; }

const fnSrc=[
  APP.slice(APP.indexOf('async function gtEnsureSeated'), APP.indexOf('function gtEnter(')),
  APP.slice(APP.indexOf('function gtEngineHolder'), APP.indexOf('// 无房主: 自动开桌')),
  APP.slice(APP.indexOf('function gtSeatArrays'), APP.indexOf('// host: 只把【远程真人席】')),
].join('\n');
const calls=[];
const sb={ myUid:'uid-me', roomSouls:[], gtJoin:async(id,seat)=>{ calls.push(seat); return sb.__ret; },
  _gtTables:new Map(), gtRenderCard(){}, _ehCatch(){}, toast(){}, console };
vm.createContext(sb);
vm.runInContext(fnSrc + '\nthis.api={gtEnsureSeated,gtEngineHolder,gtSeatArrays};', sb);
const api=sb.api;

console.log('\n── 引擎持有者 ──');
ok(api.gtEngineHolder(mkRow('nlhe',[human(1,'b'),human(0,'a')]))==='a', '最小座号真人当持有者');
ok(api.gtEngineHolder(mkRow('nlhe',[human(1,'b',{away:true}),human(0,'a',{away:true}),human(2,'c')]))==='c', 'away 者不计持有者');
ok(api.gtEngineHolder(mkRow('nlhe',[empty(0),bot(1)]))===null, '无真人返回 null');

(async()=>{
  console.log('\n── 入座矩阵(gtEnsureSeated) ──');
  // 空位优先
  calls.length=0; sb.__ret=mkRow('nlhe',[human(1,'uid-me'),empty(0)]);
  await api.gtEnsureSeated(mkRow('nlhe',[empty(0),empty(1)]));
  ok(calls[0]===0, '空位优先坐最小空位');

  // 已在座不重复 join
  calls.length=0; sb.__ret=null;
  await api.gtEnsureSeated(mkRow('nlhe',[human(1,'uid-me'),empty(0)]));
  ok(calls.length===0, '已在座不再 join');

  // 德州可顶替 AI/灵魂
  calls.length=0; sb.__ret=mkRow('nlhe',[human(0,'uid-me'),bot(1)]);
  await api.gtEnsureSeated(mkRow('nlhe',[soul(0),bot(1),human(2,'x')]));
  ok(calls.length===1 && (calls[0]===0||calls[0]===1), '德州无空位时顶替 AI/灵魂席');

  // 斗地主/掼蛋只坐空位
  calls.length=0; sb.__ret=null;
  await api.gtEnsureSeated(mkRow('ddz',[soul(0),bot(1),human(2,'x')]));
  ok(calls.length===0, '斗地主无空位不顶替 AI');
  await api.gtEnsureSeated(mkRow('guandan',[soul(0),bot(1),human(2,'x')]));
  ok(calls.length===0, '掼蛋无空位不顶替 AI');

  // join 失败仍返回原 row, 不抛
  calls.length=0;
  sb.gtJoin=async()=>{ calls.push(1); throw new Error('seat taken'); };
  const r=await api.gtEnsureSeated(mkRow('nlhe',[empty(0),empty(1)]));
  ok(r && r.id==='t1', 'join 失败不抛, 返回原桌');
  sb.gtJoin=async(id,seat)=>{ calls.push(seat); return sb.__ret; };

  console.log('\n── 满座分流(源码契约) ──');
  ok(/gtSpectatePoker/.test(APP) && /座位已满 · 等有人离开再入座/.test(APP), '满座: 德州旁观 / 其余诚实提示');
  ok(/row\.game==='nlhe'\)\{\s*gtSpectatePoker/.test(APP.replace(/\s+/g,' ')), '仅德州满座走旁观');

  console.log('\n── SQL 一人两座 / 顶替约束 ──');
  ok(/清我当前占的座清空|防一人两座/.test(SQL), 'SQL join 先清旧座');
  ok(/seat taken/.test(SQL), '真人席不许顶替另一个真人');
  ok(/nlhe keep seats open/.test(SQL), '德州灵魂补位保底留 2 空位');

  console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
  process.exit(fail?1:0);
})();
