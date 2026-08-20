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
  // 失败也必须收尾：调用方拿到友好反馈、按钮恢复，下一次可重试。
  let busy=false, button={disabled:false,textContent:'提交'}, feedback=[];
  const submit=async function(work){
    if(busy) return false; busy=true; button.disabled=true; button.textContent='处理中…';
    try{ await work(); return true; }
    catch(e){ feedback.push('操作失败，请重试'); return false; }
    finally{ busy=false; button.disabled=false; button.textContent='提交'; }
  };
  assert.equal(await submit(async()=>{ throw new Error('injected reject'); }),false,'Promise reject 应转为可重试失败');
  assert.equal(busy,false,'Promise reject 后必须释放锁');
  assert.equal(button.disabled,false,'Promise reject 后按钮必须恢复');
  assert.equal(feedback.length,1,'Promise reject 后必须给出友好反馈');
  assert.equal(await submit(async()=>{}),true,'失败后第二次必须可重试');
  console.log('✓ reject 收尾：按钮恢复、锁释放、反馈与重试');

  let legacyCalls=0; let releaseOld; const oldGate=new Promise(r=>releaseOld=r);
  const legacy=async()=>{ legacyCalls++; await oldGate; };
  const x=legacy(), y=legacy(); assert.equal(legacyCalls,2,'旧实现反证必须并发两次'); releaseOld(); await Promise.all([x,y]);
  console.log('✓ 旧实现反证：await 前无锁会重复提交');

  const fs=require('fs'), src=fs.readFileSync('js/app.js','utf8');
  for(const name of ['_createRoomInFlight','_joinCodeInFlight','_loginInFlight']) assert(src.includes(name),`缺少 ${name}`);
  assert(src.includes("async function createRoom(){\n  if(_createRoomInFlight) return;\n  _createRoomInFlight=true;\n  const btn=$('#doCreateBtn');\n  try{"));

  assert(src.includes('_loginInFlight=false;\n    if(btn){ btn.disabled=false; btn.textContent=\'登 录\'; }'));
  for(const name of ['createRoom','joinByCode','doLogin']){
    const start=src.indexOf('async function '+name+'()');
    const end=src.indexOf('\n}\n',start)+3;
    const fn=src.slice(start,end);
    assert(/catch\s*\(/.test(fn),`${name} 必须捕获 reject 并反馈`);
    assert(/finally\s*\{/.test(fn),`${name} 必须 finally 收尾`);
  }
  console.log('✓ 生产入口同步加锁且 finally 释放');
}
run().catch(e=>{console.error('✗',e.stack||e);process.exit(1)});
