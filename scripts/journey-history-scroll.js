#!/usr/bin/env node
'use strict';
/** 私密房翻历史：运行真实 bindToLatest 滚动状态机。 */
const fs=require('fs'),vm=require('vm'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','js','app.js'),'utf8');
const start=source.indexOf('function maybeLoadOlderOnScroll(stream){');
const end=source.indexOf('\n})();',start);
if(start<0||end<0) throw new Error('无法定位真实 bindToLatest');
const production=source.slice(start,end+5);
function assert(ok,msg){if(!ok)throw new Error('FAIL: '+msg);console.log('✓ '+msg);}
function harness({top=500,button=true,disabled=false}={}){
  const stream={scrollTop:top,scrollHeight:2000,clientHeight:600,_tlBound:false,
    handlers:{},addEventListener(t,f){this.handlers[t]=f;},scrollTo(){}};
  const more=button?{disabled,classList:{contains(){return disabled;}},addEventListener(){}}:null;
  const latest={classList:{add(){},remove(){}},addEventListener(t,f){this[t]=f;}};
  let loadCalls=0,raf=[];
  const ctx={console,setTimeout(){return 1;},clearTimeout(){},
    requestAnimationFrame(fn){raf.push(fn);return raf.length;},
    MutationObserver:function(){this.observe=()=>{};},
    document:{addEventListener(){}},
    $:sel=>sel==='#stream'?stream:sel==='#toLatestBtn'?latest:sel==='#loadMoreBtn'?more:null,
    updateToLatest(){},recordScrollAnchor(){},hideToLatest(){},
    doLoadMore(btn){loadCalls++; if(btn) btn.disabled=true;},
  };
  vm.runInNewContext(production,ctx,{filename:'js/app.js#bindToLatest'});
  return {stream,more,get loadCalls(){return loadCalls;},scroll(){stream.handlers.scroll();const q=raf;raf=[];q.forEach(fn=>fn());}};
}
{
  const h=harness({top:500});h.scroll();
  assert(h.loadCalls===0,'步骤 1: 离顶部较远时不加载更早消息');
}
{
  const h=harness({top:24});h.scroll();
  assert(h.loadCalls===1,'步骤 2: 接近顶部时自动触发一次加载更早消息');
  h.scroll();
  assert(h.loadCalls===1,'步骤 3: 按钮进入 disabled 后重复滚动不并发加载');
}
{
  const h=harness({top:24,button:false});h.scroll();
  assert(h.loadCalls===0,'步骤 4: 没有更早页入口时不发起请求');
}
{
  const h=harness({top:24,disabled:true});h.scroll();
  assert(h.loadCalls===0,'步骤 5: 已在加载中的入口不会重复触发');
}
// 反证：移除真实滚动状态机中的自动续载调用，触顶必须重新变红。
const call='maybeLoadOlderOnScroll(s);';
if(!production.includes(call)) throw new Error('FAIL: 当前生产滚动状态机尚未接入自动续载（修前预期红灯）');
const mutant=production.replace(call,'');
let mutantCalls=0, raf=[];
const stream={scrollTop:24,scrollHeight:2000,clientHeight:600,_tlBound:false,handlers:{},addEventListener(t,f){this.handlers[t]=f;}};
const more={disabled:false};const latest={classList:{add(){},remove(){}},addEventListener(){}};
vm.runInNewContext(mutant,{console,setTimeout(){},requestAnimationFrame(fn){raf.push(fn);},MutationObserver:function(){this.observe=()=>{};},document:{addEventListener(){}},$:s=>s==='#stream'?stream:s==='#toLatestBtn'?latest:s==='#loadMoreBtn'?more:null,updateToLatest(){},recordScrollAnchor(){},hideToLatest(){},doLoadMore(){mutantCalls++;},maybeLoadOlderOnScroll(){mutantCalls++;}});
stream.handlers.scroll();raf.splice(0).forEach(fn=>fn());
assert(mutantCalls===0,'反证通过：移除滚动自动续载后，触顶不会加载并被旅程抓红');
console.log('\n✅ 历史触顶自动续载旅程通过；当前实现绿，旧点击-only 实现必红');
