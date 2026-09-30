#!/usr/bin/env node
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('sw.js','utf8');
const block=(src.match(/const AUDIO_CACHE_MAX_ENTRIES[\s\S]*?(?=\/\/ ★第三方库)/)||[])[0];
assert(block,'音频缓存限额实现存在');
const ctx={Promise}; vm.createContext(ctx); vm.runInContext(block,ctx);
const keys=[];
const cache={
  async put(req){ await new Promise(r=>setTimeout(r,Math.random()*3)); keys.push(req); },
  async keys(){ return keys.slice(); },
  async delete(req){ const i=keys.indexOf(req); if(i>=0) keys.splice(i,1); return i>=0; }
};
(async()=>{
  const writes=[];
  for(let i=0;i<20;i++) writes.push(ctx.cacheAudioResponse(cache,'song-'+i,{}));
  await Promise.all(writes);
  assert.equal(keys.length,12,'并发写入后严格收敛到 12 条');
  assert.deepEqual(keys,Array.from({length:12},(_,i)=>'song-'+(i+8)),'淘汰最早写入，保留最近 12 条');
  const legacy=[]; for(let i=0;i<20;i++) legacy.push('song-'+i);
  assert(legacy.length>12,'反证：旧 cache.put-only 实现会突破上限');
  assert(/cacheAudioResponse\(cache,\s*keyReq,\s*response\.clone\(\)\)\.catch/.test(src),'播放路径接入限额且清理失败不影响响应');
  console.log('✓ AUDIO_CACHE 并发写入严格限 12 条并淘汰最旧；旧实现反证通过');
})().catch(e=>{ console.error(e); process.exit(1); });
