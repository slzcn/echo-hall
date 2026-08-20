#!/usr/bin/env node
'use strict';
const assert=require('assert');

function singleFlight(fn){ let busy=false; return async()=>{ if(busy) return false; busy=true; try{ await fn(); return true; }finally{ busy=false; } }; }
async function run(){
  let release, calls=0; const gate=new Promise(r=>release=r);
  const action=singleFlight(async()=>{ calls++; await gate; });
  const a=action(), b=action();
  assert.equal(await b,false,'执行中重复调用必须立即拒绝');
  assert.equal(calls,1,'并发操作只能发出一个请求');
  release(); assert.equal(await a,true);
  assert.equal(await action(),true,'完成后必须可再次执行');
  assert.equal(calls,2);
  console.log('✓ 登录／建房／邀请码操作 single-flight 契约');

  let legacyCalls=0; let releaseOld; const oldGate=new Promise(r=>releaseOld=r);
  const legacy=async()=>{ legacyCalls++; await oldGate; };
  const x=legacy(), y=legacy(); assert.equal(legacyCalls,2,'旧实现反证必须并发两次'); releaseOld(); await Promise.all([x,y]);
  console.log('✓ 旧实现反证：await 前无锁会重复提交');

  const fs=require('fs'), src=fs.readFileSync('js/app.js','utf8');
  for(const name of ['_createRoomInFlight','_joinCodeInFlight','_loginInFlight']) assert(src.includes(name),`缺少 ${name}`);
  assert(/async function createRoom\(\)\{\s*if\(_createRoomInFlight\) return;\s*_createRoomInFlight=true;\s*try\{/.test(src));
  assert(/finally\{ _loginInFlight=false; \}/.test(src));
  console.log('✓ 生产入口同步加锁且 finally 释放');
}
run().catch(e=>{console.error('✗',e.stack||e);process.exit(1)});
