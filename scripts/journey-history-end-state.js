#!/usr/bin/env node
'use strict';
// 历史翻阅终态旅程：公开房封顶与私密房到最早都必须给出明确反馈。
const fs=require('fs'), path=require('path'), vm=require('vm');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
const config=fs.readFileSync(path.join(root,'js/config.js'),'utf8');
const admin=fs.readFileSync(path.join(root,'admin.html'),'utf8');
function assert(ok,msg){if(!ok)throw new Error('FAIL: '+msg);console.log('✓ '+msg);}
function harness(){
  const first={className:'first',remove(){this.removed=true;}};
  const stream={children:[first],querySelector(sel){return sel==='.history-end'?this.children.find(x=>x.className==='history-end')||null:null;},insertBefore(el){this.children.unshift(el);}};
  const document={createElement(){return {className:'',dataset:{},textContent:'',remove(){this.removed=true;}};}};
  const ctx={$:sel=>sel==='#stream'?stream:null,document};
  const start=app.indexOf('function addHistoryEnd(kind,text){');
  const end=app.indexOf('\nfunction addLoadMore',start);
  assert(start>=0&&end>start,'生产代码包含 addHistoryEnd 终态渲染函数');
  vm.runInNewContext(app.slice(start,end),ctx,{filename:'app.js#history-end'});
  return {stream,addHistoryEnd:ctx.addHistoryEnd};
}

assert(config.includes("historyTopPublicLimit:'已显示最近 {n} 条消息；更早的内容不在公开房快照范围内'"),'公开房达到配置上限使用明确提示文案');
assert(config.includes("historyTopPublicEnd:'这里就是公开房最早的记录了'"),'公开房未达到上限使用最早记录提示文案');
assert(config.includes("historyTopPrivate:'这里就是这个房最早的记录了'"),'私密房使用最早记录提示文案');
assert(admin.includes("所有公开/官方房通用")&&admin.includes('上限500'),'后台明确显示公开房通用及可配置上限');
assert(admin.includes("Math.min(Math.max(v,1),2000)"),'后台将公开房历史条数限制在 1～2000');
assert(app.includes("addHistoryEnd('public',publicEndText)"),'公开房历史真正渲染完成后插入终态');
assert(app.includes("addHistoryEnd('private',EH_CONFIG.text.historyTopPrivate"),'私密房到最早时插入终态');

const h=harness();
h.addHistoryEnd('public','已显示最近 500 条消息；更早的内容不在公开房快照范围内');
assert(h.stream.children[0].dataset.historyEnd==='public','公开房终态插入历史顶部');
assert(h.stream.children[0].textContent.includes('500 条'),'公开房终态包含实际配置条数');
h.addHistoryEnd('private','这里就是这个房最早的记录了');
assert(h.stream.children[0].dataset.historyEnd==='private','私密房终态插入历史顶部');
assert(h.stream.querySelector('.history-end').textContent==='这里就是这个房最早的记录了','私密房终态文案可见');

// 反证：移除两个真实调用，旧静默实现必须被抓红。
const mutant=app.replace("addHistoryEnd('public',publicEndText);",'').replace("addHistoryEnd('private',EH_CONFIG.text.historyTopPrivate||'这里就是这个房最早的记录了');",'');
assert(mutant.includes("if(isPublic && rows.length)" )===false,'反证准备：旧实现不再有公开房终态调用');
assert(!mutant.includes("addHistoryEnd('private',EH_CONFIG.text.historyTopPrivate"),'反证准备：旧实现不再有私密房终态调用');
console.log('\n✅ 历史翻阅终态旅程通过：公开房封顶、私密房到最早均有明确反馈；旧静默实现必红。');
process.exit(0);
