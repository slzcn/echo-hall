#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('sw.js','utf8'),listeners={},stores=new Map();
const failed='https://echo.test/js/fail.js?v=1';
const html='<script defer src="./js/config.js?v=1"></script><script src="./js/fail.js?v=1"></script><link rel="stylesheet" href="./js/main.css?v=1"><script src="https://cdn.example/x.js"></script>';
const absolute=x=>new URL(typeof x==='string'?x:(x.url||x.href),'https://echo.test/').href;
let online=true;
async function fetchMock(input){if(!online)throw Error('offline');const u=absolute(input);if(u===failed)throw Error('failed asset');return new Response(u==='https://echo.test/'||u==='https://echo.test/index.html'?html:'asset',{status:200});}
function makeCache(name){const stored=new Map();stores.set(name,stored);return{async add(x){const u=absolute(x),r=await fetchMock(new Request(u));if(!r.ok)throw Error('bad');stored.set(u,r.clone());},async addAll(xs){await Promise.all(xs.map(x=>this.add(x)));},async put(x,r){stored.set(absolute(x),r);},async match(x){return stored.get(absolute(x));},async keys(){return[];},async delete(){return true;}};} const cachesByName=new Map(); const open=async name=>{if(!cachesByName.has(name))cachesByName.set(name,makeCache(name));return cachesByName.get(name);};
const self={location:new URL('https://echo.test/sw.js'),clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(t,f)=>listeners[t]=f};
vm.runInNewContext(source,{self,caches:{open,keys:async()=>[],delete:async()=>true,match:async()=>null},fetch:fetchMock,Request,Response,Headers,URL,Promise,setTimeout,clearTimeout,console});
(async()=>{let work;listeners.install({waitUntil:p=>work=p});await work;online=false;
const jsStore=stores.get('eh-js-v1'),shellStore=[...stores.entries()].find(([name])=>name.startsWith('eh-shell-'))[1];
assert(jsStore.has('https://echo.test/js/config.js?v=1'),'caches versioned same-origin script in JS cache');
assert(shellStore.has('https://echo.test/js/main.css?v=1'),'caches same-origin stylesheet in shell cache');
assert(![...stores.values()].some(store=>store.has('https://cdn.example/x.js')),'excludes cross-origin resource');
assert(shellStore.has('https://echo.test/index.html'),'one failed asset does not roll back shell');
const legacyShellOnly=new Set(['https://echo.test/','https://echo.test/index.html']);
assert(!legacyShellOnly.has('https://echo.test/js/config.js?v=1'),'legacy shell-only install counterexample misses required JS');
console.log('✓ install extracts same-origin scripts/styles and isolates per-resource failures');
console.log('✓ legacy shell-only install counterexample stays red');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
