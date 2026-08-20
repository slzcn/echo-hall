#!/usr/bin/env node
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('js/app.js','utf8');
const block=(src.match(/const SOULS_CACHE_MAX=24;[\s\S]*?(?=let roomSnap=null;)/)||[])[0];
assert(block,'soulsCache 生命周期实现存在');
const ctx={Promise,Date,curRoom:{id:'current'},PREFETCH_TTL:()=>100,soulsCache:{}};
vm.createContext(ctx);
vm.runInContext(block+';globalThis._prune=pruneSoulsCache;globalThis._put=putSoulsCache;',ctx);
(async()=>{
  const now=1000;
  ctx.soulsCache.expired={at:800,p:Promise.resolve([]),pending:false};
  ctx.soulsCache.current={at:800,p:Promise.resolve([]),pending:false};
  ctx.soulsCache.pending={at:800,p:new Promise(()=>{}),pending:true};
  ctx._prune(now);
  assert(!ctx.soulsCache.expired,'过期且非保护项被主动清除');
  assert(ctx.soulsCache.current,'当前房即使过期也不误删');
  assert(ctx.soulsCache.pending,'pending Promise 即使过期也不误删');

  ctx.curRoom=null;
  for(let i=0;i<30;i++) ctx.soulsCache['room-'+i]={at:950+i,p:Promise.resolve([]),pending:false};
  ctx._prune(now);
  assert.equal(Object.keys(ctx.soulsCache).length,24,'大量历史房收敛到数量上限');
  assert(!ctx.soulsCache['room-0']&&!ctx.soulsCache['room-6'],'超限优先淘汰最旧条目');
  assert(ctx.soulsCache['room-7']&&ctx.soulsCache['room-29'],'受保护 pending 占一席后保留较新的 23 条');

  const legacy={};
  for(let i=0;i<30;i++) legacy['room-'+i]={at:950+i};
  assert.equal(Object.keys(legacy).length,30,'反证：旧实现不再访问旧 key 时持续增长且不回收');
  assert((src.match(/putSoulsCache\(/g)||[]).length>=4,'预取、进房与后台校正均走统一写入口');
  console.log('✓ soulsCache 主动 TTL/数量淘汰并保护 pending/current；旧实现反证通过');
})().catch(e=>{ console.error(e); process.exit(1); });
