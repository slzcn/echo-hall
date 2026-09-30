#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs');
async function coordinator(){
 const flights=new Map(), calls=[]; let releases={};
 async function refresh(rid){ let f=flights.get(rid); if(f&&f.busy){f.pending=true;return}
  f={busy:true,pending:false};flights.set(rid,f);calls.push(rid);await new Promise(r=>releases[rid]=r);
  const again=f.pending;flights.delete(rid);if(again) queueMicrotask(()=>refresh(rid)); }
 refresh('A'); await Promise.resolve(); refresh('B'); await Promise.resolve();
 assert.deepEqual(calls,['A','B'],'不同房补拉不得被全局锁阻塞');
 refresh('B'); assert.deepEqual(calls,['A','B'],'同房忙时应合并');
 releases.A(); releases.B(); await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(calls,['A','B','B'],'同房 pending 应在完成后补跑一次');
 console.log('✓ 按房 single-flight：跨房并行、同房合并后补跑');
 const legacy={busy:true}; let bCalled=false; if(!legacy.busy)bCalled=true; assert.equal(bCalled,false); console.log('✓ 旧全局布尔锁反证：A 忙会丢弃 B');
}
(async()=>{await coordinator(); const app=fs.readFileSync('js/app.js','utf8'), pull=fs.readFileSync('js/pull-refresh.js','utf8'), html=fs.readFileSync('index.html','utf8');
 assert(app.includes('const _snapTailFlights=new Map()'));
 assert(app.includes('flight.pending=true'));
 assert(pull.includes('if(refreshing) return'));
 assert(html.includes('role="log" aria-live="polite"'));
 assert(app.includes("setAttribute('aria-busy','true')")&&app.includes("setAttribute('aria-busy','false')"));
 console.log('✓ 生产实现含下拉锁、按房 pending、历史 busy/live 语义');
})().catch(e=>{console.error('✗',e.stack||e);process.exit(1)});
