#!/usr/bin/env node
'use strict';
/**
 * journey-bgm-compose.js — BGM 作曲完整用户旅程回归
 *
 * 旅程：idle → 点击 → generating → 重复点击被拦 → success/error → idle 恢复。
 * 测试读取真实生产源并运行 sendBgmGen；不是复制生产实现。
 */
const fs=require('fs');
const vm=require('vm');
const path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','js','app.js'),'utf8');
function assert(ok,msg){ if(!ok) throw new Error('FAIL: '+msg); console.log('✓ '+msg); }
function extractFunction(name,nextName){
  const start=src.indexOf(`async function ${name}(`);
  const end=src.indexOf(`\nasync function ${nextName}(`,start);
  if(start<0||end<0) throw new Error(`无法抽取 ${name}`);
  return src.slice(start,end);
}
const sendSrc=extractFunction('sendBgmGen','showMyBgmLibrary');

function makeContext(fetchImpl){
  const events=[]; const toasts=[]; const saved=[]; const played=[];
  const quietConsole={...console,warn(){}};
  const ctx={
    console:quietConsole,
    EH_BGM_FN:'https://example.test/functions/v1/eh-bgm-gen',
    curRoom:{id:'room-1',name:'午夜电台',kind:'public'},
    myUid:'anon-user-1',
    _ehBgmGenerating:false,
    Date,
    CustomEvent:function(type,opt){ this.type=type; this.detail=opt&&opt.detail; },
    window:{
      _ehBgmGenerating:false,
      dispatchEvent(e){ events.push({type:e.type,detail:e.detail}); },
    },
    toast(x){ toasts.push(String(x)); },
    ensureAuth:async()=>{},
    bgmRoomKind:()=> 'public',
    bgmBroadcastPhrase:()=> false,
    bgmGeneratedTitle:()=> '午夜回声',
    bgmAccessToken:async()=> 'valid-token',
    fetch:fetchImpl,
    bgmSaveLocal:r=>saved.push(r),
    bgmPlayLocal:r=>played.push(r),
    msgChan:null,
    ehLog:()=>{},
    setTimeout,clearTimeout,Promise,JSON,String,
  };
  vm.createContext(ctx);
  vm.runInContext(sendSrc,ctx);
  return {ctx,events,toasts,saved,played};
}

(async()=>{
  // 成功旅程：用手动 deferred response 观察“请求进行中”的真实中间态。
  let release;
  const pending=new Promise(resolve=>{ release=resolve; });
  let requests=0;
  const env=makeContext(async()=>{
    requests++;
    await pending;
    return {status:200,ok:true,json:async()=>({ok:true,id:'bgm-1',title:'午夜回声',url:'https://example.test/a.mp3'})};
  });

  assert(env.ctx._ehBgmGenerating===false && env.ctx.window._ehBgmGenerating===false,
    '步骤 1: 点击前 idle，可发起作曲');

  const first=env.ctx.sendBgmGen('雨夜');
  await Promise.resolve(); await Promise.resolve();
  assert(env.ctx._ehBgmGenerating===true && env.ctx.window._ehBgmGenerating===true,
    '步骤 2: 点击后进入 generating，中间态真实存在');
  assert(env.events.some(e=>e.type==='eh:bgm-changed'&&e.detail?.reason==='generating'&&e.detail?.on===true),
    '步骤 2: generating 状态通知 UI 显示“灵魂正在作曲…”');

  await env.ctx.sendBgmGen('重复点击');
  assert(requests===1,'步骤 3: 生成中重复点击不产生第二个请求');
  assert(env.toasts.some(t=>t.includes('先别催')),'步骤 3: 重复点击获得明确反馈');

  release(); await first;
  assert(env.saved.length===1&&env.played.length===1,'步骤 4: 成功后只保存并播放一首');
  assert(env.ctx._ehBgmGenerating===false&&env.ctx.window._ehBgmGenerating===false,
    '步骤 4: 成功后恢复 idle，可再次作曲');
  assert(env.events.some(e=>e.detail?.reason==='generating'&&e.detail?.on===false),
    '步骤 4: 完成状态通知 UI 恢复入口');

  // 失败旅程：finally 也必须恢复入口。
  const failed=makeContext(async()=>{ throw new Error('network down'); });
  await failed.ctx.sendBgmGen('失败路径');
  assert(failed.ctx._ehBgmGenerating===false&&failed.ctx.window._ehBgmGenerating===false,
    '步骤 5: 网络失败后仍恢复 idle，不会永久禁用');
  assert(failed.toasts.some(t=>t.includes('稍后再试')),'步骤 5: 失败时用户获得明确反馈');

  // 反证：移除生产代码的 generating=true UI 通知，旅程契约必须能判红。
  const mutant=sendSrc.replace(
    "window._ehBgmGenerating=true; window.dispatchEvent(new CustomEvent('eh:bgm-changed',{detail:{reason:'generating',on:true}}));",
    "window._ehBgmGenerating=true;"
  );
  assert(mutant!==sendSrc,'反证准备：已构造“生成中不通知 UI”的旧错误实现');
  const mutantEvents=[];
  const mutantCtx={...makeContext(async()=>({status:200,ok:true,json:async()=>({ok:true,id:'x',title:'x',url:'https://example.test/x.mp3'})})).ctx};
  mutantCtx.window={_ehBgmGenerating:false,dispatchEvent:e=>mutantEvents.push(e)};
  vm.createContext(mutantCtx); vm.runInContext(mutant,mutantCtx);
  await mutantCtx.sendBgmGen('旧实现');
  assert(!mutantEvents.some(e=>e.detail?.reason==='generating'&&e.detail?.on===true),
    '反证通过：旧版无进度通知会违反旅程断言并被抓红');

  console.log('\n✅ BGM 作曲完整旅程通过；覆盖中间态、禁重入、成功恢复、失败恢复与旧实现反证');
})().catch(e=>{ console.error(e); process.exit(1); });
