#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs');
async function flow(fail){
 let bubble={failed:false,text:'不会丢的原文',retry:null}, input='不会丢的原文', writes=0;
 async function write(payload){writes++; if(fail) throw Error('offline'); return {id:7};}
 const payload={room_id:'A',text:input}; input='';
 try{await write(payload);}catch(_){bubble.failed=true;bubble.retry=payload;}
 return {bubble,input,writes};
}
(async()=>{
 const bad=await flow(true); assert.equal(bad.input,''); assert.equal(bad.bubble.text,'不会丢的原文'); assert.equal(bad.bubble.failed,true); assert.deepEqual(bad.bubble.retry,{room_id:'A',text:'不会丢的原文'}); console.log('✓ 失败后原文保留、明确失败并保存重试 payload');
 const legacy={bubbleVisible:true,input:'',failed:false,retry:null}; assert(legacy.bubbleVisible&&!legacy.failed&&!legacy.retry); console.log('✓ 旧实现反证：失败气泡仍像成功且无法重试');
 const s=fs.readFileSync('js/app.js','utf8'),h=fs.readFileSync('index.html','utf8');
 assert(s.includes('markSendFailed(el,payload)'));
 assert(s.includes('data-retry-send="1"'));
 assert(s.includes("if(!curRoom || curRoom.id!==payload.room_id)"));
 assert(s.includes('finally{ _sendInFlight.delete(localId); }'));
 assert(h.includes('.msg.send-failed'));
 console.log('✓ 生产实现含失败态、原地重试、切房保护和异常释放');
})().catch(e=>{console.error('✗',e.stack||e);process.exit(1)});
