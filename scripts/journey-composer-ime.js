#!/usr/bin/env node
'use strict';
/**
 * journey-composer-ime.js — 主聊天输入框与输入法协同完整旅程
 *
 * 运行真实生产输入处理器，覆盖：idle → composition → compositionend 尾随 Enter
 * → 明确第二次 Enter → 菜单协同 → 输入框增高 → 发送后恢复。
 */
const fs=require('fs');
const vm=require('vm');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','js','app.js'),'utf8');
const startMarker="const cin=$('#cin');";
const endMarker='} // if(cin) — #cin 缺失(弱网旧壳)时跳过绑定, 不中断后续';
const start=source.lastIndexOf(startMarker);
const end=source.indexOf(endMarker,start);
if(start<0||end<0) throw new Error('无法定位真实主聊天输入处理器');
const productionHandler=source.slice(start,end+1);

function assert(ok,msg){if(!ok)throw new Error('FAIL: '+msg);console.log('✓ '+msg);}
function createHarness({atActive=false,slashActive=false}={}){
  const handlers={}; const calls={send:0,pickAt:0,pickSlash:0,sync:0};
  const cin={
    value:'',scrollHeight:42,style:{height:'42px'},_lastLen:0,
    addEventListener(type,fn){handlers[type]=fn;},
    dispatchEvent(){}, getBoundingClientRect(){return {right:100,top:100,height:42};},
  };
  let raf=[];
  const ctx={
    console,Date,
    requestAnimationFrame(fn){raf.push(fn);return raf.length;},
    curRoom:null,beat(){},markSelfTyping(){},checkAtTrigger(){},
    renderSlashMenu(){},hideSlash(){},renderAtMenu(){},hideAt(){},
    pickAt(){calls.pickAt++;},pickSlash(){calls.pickSlash++;},
    syncSendBtn(){calls.sync++;},send(){calls.send++;},
    _coarsePointer:true,_atActive:atActive,_atSel:0,_atList:[{}],
    _slashActive:slashActive,_slashSel:0,_slashList:[{}],
    $:sel=>sel==='#cin'?cin:null,window:{},
  };
  vm.runInNewContext(productionHandler,ctx,{filename:'js/app.js#composer-input'});
  return {handlers,calls,cin,flushRaf(){const q=raf;raf=[];q.forEach(fn=>fn());}};
}
function key(timeStamp,overrides={}){
  let prevented=false;
  return {key:'Enter',code:'Enter',shiftKey:false,isComposing:false,keyCode:13,timeStamp,
    preventDefault(){prevented=true;},get prevented(){return prevented;},...overrides};
}

// 1. idle：普通 Enter 发送。
{
  const h=createHarness(); const e=key(1000); h.handlers.keydown(e);
  assert(h.calls.send===1&&e.prevented,'步骤 1: 空闲态 Enter 发送一次并阻止换行');
}
// 2. composition 中：候选确认键不得发送。
{
  const h=createHarness(); h.handlers.compositionstart({timeStamp:2000});
  h.handlers.keydown(key(2020,{isComposing:true,keyCode:229}));
  assert(h.calls.send===0,'步骤 2: 中文合成中 Enter 只操作输入法，不发送');
}
// 3. Safari/WebView 关键序列：compositionend 先发生，尾随 Enter 已经 isComposing=false/keyCode=13。
{
  const h=createHarness(); h.handlers.compositionstart({timeStamp:3000});
  h.handlers.compositionend({timeStamp:3100});
  const tail=key(3101,{isComposing:false,keyCode:13}); h.handlers.keydown(tail);
  assert(h.calls.send===0,'步骤 3: compositionend 后同一按键的尾随 Enter 不误发送');
  assert(!tail.prevented,'步骤 3: 尾随候选确认键不被页面抢走');
  const explicit=key(3400); h.handlers.keydown(explicit);
  assert(h.calls.send===1&&explicit.prevented,'步骤 4: 保护窗后明确再按 Enter 正常发送');
}
// 4. 保护窗内非 Enter 不受影响；Shift+Enter 始终换行。
{
  const h=createHarness(); h.handlers.compositionend({timeStamp:4000});
  h.handlers.keydown(key(4001,{key:'ArrowDown',code:'ArrowDown',keyCode:40}));
  const shift=key(4002,{shiftKey:true}); h.handlers.keydown(shift);
  assert(h.calls.send===0&&!shift.prevented,'步骤 5: 保护窗不破坏方向键与 Shift+Enter 换行');
}
// 5. 菜单协同：尾随 Enter 不能抢 @／斜杠菜单；稍后明确 Enter 才选菜单。
for(const [kind,opts,field] of [
  ['@菜单',{atActive:true},'pickAt'],['斜杠菜单',{slashActive:true},'pickSlash']
]){
  const h=createHarness(opts); h.handlers.compositionstart({timeStamp:5000});h.handlers.compositionend({timeStamp:5100});
  h.handlers.keydown(key(5101));
  assert(h.calls[field]===0&&h.calls.send===0,`步骤 6: 尾随 Enter 不抢 ${kind}`);
  h.handlers.keydown(key(5400));
  assert(h.calls[field]===1,`步骤 6: 稍后明确 Enter 正常选择 ${kind}`);
}
// 6. 输入增高与发送后恢复契约：真实 input handler 应限制到 100px；resetInput 应归 42px。
{
  const h=createHarness(); h.cin.value='多行\n'.repeat(20); h.cin.scrollHeight=180;
  h.handlers.input({}); h.flushRaf();
  assert(h.cin.style.height==='100px','步骤 7: 多行输入高度上限为 100px，不挤坏消息区');
  const resetStart=source.indexOf("function resetInput(){");
  const resetEnd=source.indexOf('\nfunction syncSendBtn()',resetStart);
  const resetSrc=source.slice(resetStart,resetEnd);
  const resetCtx={$:sel=>sel==='#cin'?h.cin:null,hideSlash(){},hideAt(){},syncSendBtn(){}};
  vm.runInNewContext(resetSrc,resetCtx); resetCtx.resetInput();
  assert(h.cin.value===''&&h.cin.style.height==='42px','步骤 8: 发送后清空内容并恢复单行高度');
}

// 反证：移除 compositionend 后的尾随 Enter 保护，步骤 3 必然抓红。
const guardLine="if(_cinCompositionEndedAt && eventTime>=_cinCompositionEndedAt && eventTime-_cinCompositionEndedAt<80){ return; }";
if(!productionHandler.includes(guardLine)){
  throw new Error('FAIL: 当前生产代码尚未实现 compositionend 尾随 Enter 保护（修前预期红灯）');
}
const mutant=productionHandler.replace(`${guardLine}\n`, '');
const mutantHandlers={};let mutantSend=0;
const mutantCin={value:'中文',scrollHeight:42,style:{},addEventListener(t,f){mutantHandlers[t]=f;}};
vm.runInNewContext(mutant,{
  console,Date,requestAnimationFrame:f=>{f();return 1;},curRoom:null,beat(){},markSelfTyping(){},checkAtTrigger(){},
  renderSlashMenu(){},hideSlash(){},renderAtMenu(){},hideAt(){},pickAt(){},pickSlash(){},syncSendBtn(){},send(){mutantSend++;},
  _coarsePointer:true,_atActive:false,_atSel:0,_atList:[{}],_slashActive:false,_slashSel:0,_slashList:[{}],
  $:s=>s==='#cin'?mutantCin:null,window:{},
});
mutantHandlers.compositionstart({timeStamp:7000});mutantHandlers.compositionend({timeStamp:7100});mutantHandlers.keydown(key(7101));
assert(mutantSend===1,'反证通过：移除尾随保护后，旧实现会误发送并被旅程断言抓红');

console.log('\n✅ 输入法与输入框协同 8 步旅程通过；当前实现绿，旧错误实现必红');
