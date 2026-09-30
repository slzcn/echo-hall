#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('sw.js','utf8'),listeners={},url='https://x.supabase.co/storage/v1/object/public/eh-song/a.mp3';
const bytes=Uint8Array.from({length:10},(_,i)=>i);let cached=null,online=true,requests=[];
const cache={async match(){return cached&&cached.clone();},async put(_k,r){cached=r.clone();},async keys(){return[];},async delete(){return true;}};
async function fetchMock(req){requests.push(req);if(!online)throw Error('offline');const range=req.headers.get('range');if(range)return new Response(bytes.slice(2,5),{status:206,headers:{'Content-Range':'bytes 2-4/10','Content-Length':'3','Content-Type':'audio/mpeg','Accept-Ranges':'bytes'}});return new Response(bytes,{status:200,headers:{'Content-Length':'10','Content-Type':'audio/mpeg','Accept-Ranges':'bytes'}});}
const self={location:new URL('https://echo.test/sw.js'),clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(t,f)=>listeners[t]=f};
vm.runInNewContext(source,{self,caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true,match:async()=>null},fetch:fetchMock,Request,Response,Headers,Blob,URL,Promise,Uint8Array,setTimeout,clearTimeout,console});
async function dispatch(range){let p;const request=new Request(url,{headers:range?{Range:range}:{}});listeners.fetch({request,respondWith:x=>p=x});return p;}
async function body(r){return [...new Uint8Array(await r.arrayBuffer())];}
(async()=>{cached=null;online=true;requests=[];let r=await dispatch();assert.equal(r.status,200,'non-Range network response stays complete');assert.deepEqual(await body(r),[0,1,2,3,4,5,6,7,8,9]);assert(cached,'non-Range 200 response populates the complete cache');
cached=null;requests=[];r=await dispatch('bytes=2-4');assert.equal(r.status,206);assert.deepEqual(await body(r),[2,3,4]);assert.equal(requests.length,1);assert.equal(requests[0].headers.get('range'),'bytes=2-4');
cached=new Response(bytes,{status:200,headers:{'Content-Length':'10','Content-Type':'audio/mpeg','Accept-Ranges':'bytes'}});online=false;
for(const [range,cr,want] of [['bytes=2-4','bytes 2-4/10',[2,3,4]],['bytes=7-','bytes 7-9/10',[7,8,9]],['bytes=-3','bytes 7-9/10',[7,8,9]]]){r=await dispatch(range);assert.equal(r.status,206,range);assert.equal(r.headers.get('content-range'),cr,range);assert.deepEqual(await body(r),want,range);}
for(const range of ['bytes=10-','bytes=7-3','bytes=abc','items=0-1','bytes=0-1,4-5']){r=await dispatch(range);assert.equal(r.status,416,range);assert.equal(r.headers.get('content-range'),'bytes */10',range);}
cached=null;r=await dispatch('bytes=0-1');assert.equal(r.status,504,'offline Range without a complete cache degrades safely');
const legacySuffix=/bytes=(\d*)-(\d*)/.exec('bytes=-3');
assert.equal(legacySuffix[1]||'0','0','legacy parser counterexample treats suffix Range as starting at zero');
const fn=source.match(/async function serveAudio[\s\S]*?\n\}/);assert(fn&&!/\.arrayBuffer\(\)/.test(fn[0]),'serveAudio avoids full MP3 arrayBuffer');
console.log('✓ online Range passthrough; cached bounded/open/suffix/invalid semantics');
console.log('✓ legacy suffix parser counterexample stays red');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
