#!/usr/bin/env node
'use strict';
const fs=require('fs');
const vm=require('vm');
const src=fs.readFileSync('js/app.js','utf8');
const begin=src.indexOf('async function bgmAccessToken');
const end=src.indexOf('async function showMyBgmLibrary',begin);
if(begin<0||end<0) throw new Error('找不到 BGM 鉴权函数边界');
const code=src.slice(begin,end);

function assert(ok,msg){ if(!ok) throw new Error(msg); console.log('✓ '+msg); }
async function run({sessions=[],responses=[]}){
  const calls=[]; const toasts=[]; let refreshes=0; let si=0; let ri=0;
  const ctx={
    console,
    sb:{auth:{
      refreshSession:async()=>{ refreshes++; return {data:{session:sessions[si++]||null}}; }
    }},
    resolveSession:async()=>sessions[si++]||null,
    ensureAuth:async()=>null,
    withTimeout:async(p)=>await p,
    curRoom:{id:'room-1',name:'闲聊广场',kind:'public'}, myUid:'user-1',
    _ehBgmGenerating:false,
    toast:(s)=>toasts.push(s),
    bgmBroadcastPhrase:()=>false,
    bgmRoomKind:()=> 'public',
    bgmGeneratedTitle:()=> '测试曲',
    fetch:async(url,opts)=>{
      calls.push({url,opts});
      const x=responses[ri++]||{status:200,ok:true,body:{ok:true,id:'bgm-1',url:'https://x/a.mp3',title:'测试曲'}};
      return {status:x.status,ok:x.ok,json:async()=>x.body};
    },
    EH_BGM_FN:'https://example.test/eh-bgm-gen',
    bgmSaveLocal:()=>{}, bgmPlayLocal:()=>{}, msgChan:null,
    ehLog:()=>{}, window:{dispatchEvent:()=>{}}, CustomEvent:function(){},
    setTimeout, clearTimeout, Date, JSON, String,
  };
  vm.createContext(ctx); vm.runInContext(code,ctx);
  await ctx.sendBgmGen('雨夜');
  return {calls,toasts,refreshes};
}

(async()=>{
  let r=await run({sessions:[null,null,null]});
  assert(r.calls.length===0,'无有效令牌时不发送作曲请求');
  assert(r.toasts.some(x=>x.includes('登录状态已过期')),'无令牌时给出明确登录提示');

  r=await run({sessions:[{access_token:'token-a'}]});
  assert(r.calls.length===1,'有效令牌只发送一次请求');
  assert(r.calls[0].opts.headers.Authorization==='Bearer token-a','请求强制携带 Authorization');
  assert(JSON.parse(r.calls[0].opts.body).roomId==='room-1','请求强制携带 roomId');

  r=await run({
    sessions:[{access_token:'expired-token'},{access_token:'fresh-token'}],
    responses:[
      {status:401,ok:false,body:{error:'invalid_token'}},
      {status:200,ok:true,body:{ok:true,id:'bgm-2',url:'https://x/b.mp3',title:'测试曲'}}
    ]
  });
  assert(r.calls.length===2,'首次 401 后只重试一次');
  assert(r.refreshes===1,'首次 401 仅刷新一次 session');
  assert(r.calls[1].opts.headers.Authorization==='Bearer fresh-token','重试使用刷新后的令牌');
  console.log('\n全部 7 项 BGM 鉴权行为回归通过');
})().catch(e=>{ console.error('✗ '+e.message); process.exit(1); });
