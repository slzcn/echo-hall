#!/usr/bin/env node
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','js','app.js'),'utf8');
function assert(ok,msg){if(!ok)throw new Error('FAIL: '+msg);console.log('✓ '+msg);}
const start=source.indexOf('async function prependMissingPublicHistory(');
if(start<0) throw new Error('FAIL: 修前红灯：生产代码缺少公开房预取历史补齐状态转换');
const end=source.indexOf('\n}\n',start);
if(end<0) throw new Error('无法定位 prependMissingPublicHistory 结尾');
const production=source.slice(start,end+3);
function makeHarness(){
  const room={id:'r1',kind:'public'};
  const nodes=[];
  for(let id=453;id<=500;id++) nodes.push(node(id));
  function node(id){return {dataset:{mid:String(id)},getBoundingClientRect(){return {top:nodes.indexOf(this)*20-stream.scrollTop};}};}
  const stream={scrollTop:120,clientHeight:600,
    get scrollHeight(){return nodes.length*20;},
    querySelectorAll(sel){return sel==='[data-mid]'?[...nodes]:[];},
    querySelector(sel){return sel==='[data-mid]'?nodes[0]||null:null;},
    insertBefore(frag){nodes.unshift(...frag.children);}
  };
  const ctx={console,curRoom:room,$:s=>s==='#stream'?stream:null,
    document:{createDocumentFragment(){return {children:[],appendChild(n){this.children.push(n);}};}},
    buildMsgEl:m=>node(m.id),fetchEchoes(){},resyncMsgOwnership(){},
    requestIdleCallback:fn=>fn(),requestAnimationFrame:fn=>fn(),setTimeout:fn=>fn(),
    window:{requestIdleCallback:fn=>fn()},TUNE:(k,d)=>d
  };
  vm.runInNewContext(production,ctx,{filename:'js/app.js#prependMissingPublicHistory'});
  return {ctx,room,stream,nodes};
}
(async()=>{
  const rows=Array.from({length:500},(_,i)=>({id:i+1,text:'m'+(i+1)}));
  const h=makeHarness(), anchor=h.nodes[0], before=anchor.getBoundingClientRect().top;
  await h.ctx.prependMissingPublicHistory(h.room,rows);
  assert(h.nodes.length===500,'步骤 1: 预取 48 条后自动补齐到最近 500 条');
  assert(new Set(h.nodes.map(n=>n.dataset.mid)).size===500,'步骤 2: 补齐过程不产生重复消息');
  assert(anchor.getBoundingClientRect().top===before,'步骤 3: 向顶部插入 452 条后阅读锚点不跳');
  await h.ctx.prependMissingPublicHistory(h.room,rows);
  assert(h.nodes.length===500,'步骤 4: 重复补齐保持幂等');
  const h2=makeHarness();h2.ctx.curRoom={id:'r2'};
  await h2.ctx.prependMissingPublicHistory(h2.room,rows);
  assert(h2.nodes.length===48,'步骤 5: 切房后停止插入，防止历史串房');
  assert(source.includes('refreshSnapshotTail(_r, true)'), '步骤 6: 只有预取命中首屏会请求补齐旧历史');
  const mutant=source.replace('refreshSnapshotTail(_r, true)','refreshSnapshotTail(_r)');
  assert(!mutant.includes('refreshSnapshotTail(_r, true)'),'反证通过：旧 tail-only 路径不会进入补旧状态');
  console.log('\n✅ 公开房最近 500 条自动补齐旅程通过；预取 48 条旧实现必红');
})().catch(e=>{console.error(e.stack||e);process.exit(1);});
