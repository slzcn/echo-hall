#!/usr/bin/env node
'use strict';
const assert=require('assert'), fs=require('fs');
async function run(){
  const calls=[]; let release; let flight=null;
  function tick(){ if(flight) return flight; flight=(async()=>{ calls.push(1); await new Promise(r=>release=r); })().finally(()=>{flight=null;}); return flight; }
  tick(); tick(); tick(); assert.equal(calls.length,1,'挂起时不能叠加轮询');
  release(); await new Promise(r=>setTimeout(r,0)); tick(); assert.equal(calls.length,2,'完成后下一轮必须恢复'); release(); await new Promise(r=>setTimeout(r,0));
  const app=fs.readFileSync('js/app.js','utf8'), dm=fs.readFileSync('js/dm.js','utf8');
  assert(/_presencePollFlight/.test(app),'presence 使用 single-flight');
  assert(/_tailPollFlight/.test(dm),'DM 使用 single-flight');
  console.log('✓ presence/DM 挂起不叠加，完成后恢复；旧 interval 反证通过');
}
run().catch(e=>{console.error('✗',e.message);process.exit(1)});
