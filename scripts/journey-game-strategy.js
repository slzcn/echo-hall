#!/usr/bin/env node
'use strict';
// 状态旅程：本地同步 → pending → coach/回退 → 离桌/新局/新手。
// 不变量：JWT固定端点且禁redirect；过期generation不写缓存；配额跨席位/游戏/离桌共享。
// 反证可加载修复前文件：node scripts/journey-game-strategy.js --against /tmp/eh-strategy-before.js
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(process.argv.includes('--against')?process.argv[process.argv.indexOf('--against')+1]:path.join(__dirname,'../js/games/strategy-core.js'),'utf8');
const endpoint='https://cddkniwbhvcbfgkgomtl.supabase.co/functions/v1/eh-game-strategy';
const good={risk_level:'high',priority:'finish_self',pressure:'take_control',target_seat:null,confidence:.9,expires_after:'next_turn',ttl_ms:60000};
const input=(extra={})=>Object.assign({matchId:'桌A',handId:1,seat:0,landlord:1,lastSeat:2,hand:[{id:'s3',rank:3,suit:'S',joker:false}],handsLeft:[9,8,7],publicCounts:{3:2}},extra);
const options={endpoint,timeout:1800,token:'测试JWT'};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function harness(code=source){
  let now=100000,n=0;const timers=new Map(),calls=[],maps=[];
  class TrackedMap extends Map{constructor(...args){super(...args);maps.push(this);}}
  const box={Map:TrackedMap,AbortController,Date:{now:()=>now},setTimeout(fn,ms){const id=++n;timers.set(id,{at:now+ms,fn});return id;},clearTimeout(id){timers.delete(id);},fetch(url,opts){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});calls.push({url,opts,resolve:(policy=good)=>resolve({ok:true,json:async()=>({policy,source:'coach'})}),raw:resolve,reject});return promise;}};
  vm.runInNewContext(code,box);return {s:box.EHStrategy,calls,maps,async tick(ms){now+=ms;for(const [id,t]of timers)if(t.at<=now){timers.delete(id);t.fn();}await flush();}};
}
let passed=0,failed=0;
async function test(name,fn){let timer;try{await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('旅程未完成（异步挂起）')),1000);})]);passed++;console.log('通过 '+name);}catch(e){failed++;console.error('失败 '+name+'：'+e.message);}finally{clearTimeout(timer);}}
(async()=>{
await test('公开计数对象与严格字段白名单',()=>{
 const {s}=harness(),x=input({publicCounts:{played:{3:2},known:1,unseen:51,total:54},deck:['隐私'],seed:'隐私',log:['隐私'],hands:[['隐私']]});
 const p=s.publicInput('ddz',x);assert.equal(p.public_counts.played[3],2);assert.equal(p.public_counts.known,1);assert.equal(p.public_counts.unseen,51);assert.equal(p.landlord,1);assert.equal(p.last_seat,2);assert(!JSON.stringify(p).includes('隐私'));assert(!('id'in p.hand[0]));
 const q=s.publicInput('poker',input({board:[{rank:5,suit:'H'}]}));assert.equal(q.public_counts.known,2);
});
await test('advise同步且教练成功后有效缓存不重发',async()=>{
 const h=harness(),p=h.s.advise('ddz',input(),options);assert.equal(p.source,'local');assert.equal(typeof p.then,'undefined');await flush();assert.equal(h.calls.length,1);h.calls[0].resolve();await flush();assert.equal(h.s.get('ddz',input()).source,'coach');await h.tick(11000);await h.s.request('ddz',input({hand:[{rank:4}]}),options);assert.equal(h.calls.length,1);
});
await test('变化牌面同coach key的pending去重',async()=>{
 const h=harness(),a=h.s.request('ddz',input(),options),b=h.s.request('ddz',input({hand:[{rank:5}]}),options);assert.strictEqual(a,b);await flush();assert.equal(h.calls.length,1);h.calls[0].resolve();await a;
});
await test('超时即回退，迟到成功不得污染',async()=>{
 const h=harness(),p=h.s.request('ddz',input(),options);await flush();await h.tick(2500);assert.equal((await p).source,'local');assert(h.calls[0].opts.signal.aborted);h.calls[0].resolve();await flush();assert.equal(h.s.get('ddz',input()).source,'local');
});
await test('非法枚举/动作金额/字段/低置信度严格回退',async()=>{
 const variants=[{priority:'invented'},{risk_level:'extreme'},{pressure:'raise'},{confidence:.54},{confidence:'0.9'},{target_seat:9},{action:'allin'},{amount:100},{expires_after:'forever'},{ttl_ms:90000},{constructor:'bad'}];
 for(const patch of variants){const h=harness(),p=h.s.request('ddz',input(),options);await flush();h.calls[0].resolve({...good,...patch});assert.equal((await p).source,'local',JSON.stringify(patch));}
});
await test('根级白名单与服务端本地回退不可冒充教练',async()=>{
 for(const extra of [{source:'local'},{source:'unknown'},{source:undefined},{action:'raise'},{amount:200},{error:'timeout'}]){const h=harness(),p=h.s.request('ddz',input(),options);await flush();h.calls[0].raw({ok:true,json:async()=>({policy:good,source:'coach',...extra})});assert.equal((await p).source,'local');}
});
await test('默认十秒异步预算容纳八秒教练且不阻塞本地',async()=>{
 const h=harness(),p=h.s.request('ddz',input(),{endpoint,token:'测试JWT'});await flush();await h.tick(8000);assert(!h.calls[0].opts.signal.aborted);assert.equal(h.s.get('ddz',input()).source,'local');h.calls[0].resolve();assert.equal((await p).source,'coach');
});
await test('失败退避翻倍，恢复可成功',async()=>{
 const h=harness();for(let i=0;i<2;i++){const p=h.s.request('ddz',input(),options);await flush();h.calls[i].reject(Error('离线'));assert.equal((await p).source,'local');await h.tick(11000);}
 await h.s.request('ddz',input(),options);assert.equal(h.calls.length,2);await h.tick(11000);const p=h.s.request('ddz',input(),options);await flush();h.calls[2].resolve();assert.equal((await p).source,'coach');
});
await test('离桌清所有缓存，abort catch不能复活',async()=>{
 const h=harness();h.s.get('ddz',input({seat:1}));const p=h.s.request('ddz',input(),options);await flush();h.s.clear('桌A');h.calls[0].reject(Error('abort'));await p;assert(h.calls[0].opts.signal.aborted);assert(h.maps.every(m=>m.size===0));
});
await test('无pending的本地缓存也完整清理且不误清同名子串桌',()=>{
 const h=harness(),a=h.s.get('ddz',input()),b=h.s.get('ddz',input({matchId:'prefix:桌A:suffix'}));h.s.clear('桌A');assert.notStrictEqual(h.s.get('ddz',input()),a);assert.strictEqual(h.s.get('ddz',input({matchId:'prefix:桌A:suffix'})),b);
});
await test('跨局、同名重新开局generation阻止旧响应',async()=>{
 const h=harness(),p=h.s.request('ddz',input(),options);await flush();h.s.clear('桌A');h.s.get('ddz',input({matchId:'桌B'}));h.s.get('ddz',input());h.calls[0].resolve();assert.equal((await p).source,'local');assert.equal(h.s.get('ddz',input()).source,'local');assert.equal(h.s.get('ddz',input({matchId:'桌B'})).source,'local');
});
await test('跨手隔离缓存与旧pending响应',async()=>{
 const h=harness(),p=h.s.request('ddz',input(),options);await flush();h.s.get('ddz',input({handId:2}));h.calls[0].resolve();assert.equal((await p).source,'local');assert.equal(h.s.get('ddz',input({handId:2})).source,'local');
 await h.tick(11000);const q=h.s.request('ddz',input({handId:2}),options);await flush();h.calls[1].resolve();await q;assert.equal(h.s.get('ddz',input({handId:2})).source,'coach');assert.equal(h.s.get('ddz',input({handId:3})).source,'local');
});
await test('全局每分钟最多六次，跨游戏席位与clear不重置',async()=>{
 const h=harness();for(let i=0;i<6;i++){const p=h.s.request(['ddz','guandan','poker'][i%3],input({matchId:'桌'+i,seat:i%3}),options);await flush();assert.equal(h.calls.length,i+1);h.calls[i].resolve();await p;h.s.clear();if(i<5)await h.tick(11000);}
 await h.s.request('poker',input({matchId:'新桌'}),options);assert.equal(h.calls.length,6);await h.tick(11000);const p=h.s.request('poker',input({matchId:'新桌'}),options);await flush();assert.equal(h.calls.length,7);h.calls[6].resolve();await p;
});
await test('恶意端点/缺JWT不发送，合法端点拒绝重定向',async()=>{
 const h=harness();for(const url of ['https://evil.example',endpoint+'/',endpoint+'?x=1',endpoint+'#x',endpoint.replace('https:','http:'),endpoint.replace('supabase.co','supabase.co.evil.example')])await h.s.request('ddz',input(),{...options,endpoint:url});await h.s.request('ddz',input(),{endpoint});await h.s.request('ddz',input(),{token:'测试JWT'});assert.equal(h.calls.length,0);
 const p=h.s.request('ddz',input(),options);await flush();assert.equal(h.calls[0].opts.redirect,'error');assert.equal(h.calls[0].opts.headers.Authorization,'Bearer 测试JWT');h.calls[0].raw({ok:true,redirected:true,json:async()=>({policy:good,source:'coach'})});assert.equal((await p).source,'local');
});
await test('有界cache和generation，批量旧局自动释放',()=>{const h=harness();for(let i=0;i<1000;i++)h.s.get('ddz',input({matchId:'桌'+i}));assert(h.maps.every(m=>m.size<=256));h.s.clear();assert(h.maps.every(m=>m.size===0));});
await test('非空策略真实候选score正负影响',()=>{const {s}=harness(),c={cards:[{rank:3},{rank:3}],parse:{key:3},isBomb:true};assert(s.score('ddz',c,null,{priority:'finish_self',pressure:'take_control'})>0);assert(s.score('guandan',c,null,{priority:'calculate',pressure:'let_partner_lead'})<0);assert.equal(s.score('ddz',null,null,good),0);});
await test('内置旧错误实现反证：仅清pending遗漏本地缓存必被识别',()=>{
 const broken=source.replace('  function clear(matchId){','  function clear(matchId){ return;');
 const h=harness(broken),a=h.s.get('ddz',input());h.s.clear('桌A');
 // 真执行旧错误行为，不靠源码断言；此断言证明上面的清缓存旅程能抓回归。
 assert.throws(()=>assert.notStrictEqual(h.s.get('ddz',input()),a));
});
await test('三游戏真实AI：非空策略改变决策且保持合法',()=>{
 const Deck=require('../js/games/deck.js');
 for(const kind of ['ddz','guandan']){
  const AI=require('../js/games/'+kind+'-ai.js'),Rules=require('../js/games/'+kind+'-rules.js');let changed=0;
  for(let seed=1;seed<=80;seed++){
   const cards=Deck.shuffle(kind==='ddz'?Deck.standardDeck():Deck.doubleDeck(),seed).cards.slice(0,kind==='ddz'?12:16);
   const ctx={seat:0,landlord:0,hand:cards,handsLeft:kind==='ddz'?[cards.length,12,12]:[cards.length,16,16,16],level:2};
   const a=AI.decide({...ctx,strategy:{...good,priority:'calculate',pressure:'preserve_bombs'}}),b=AI.decide({...ctx,strategy:good});
   for(const move of [a,b]){assert.equal(move.action,'play');assert(move.cards.length);assert(move.cards.every(c=>cards.some(h=>h.id===c.id)));assert(Rules.parse(move.cards,2));}
   if(a.cards.map(c=>c.id).sort().join()!==b.cards.map(c=>c.id).sort().join())changed++;
  }
  assert(changed>0,kind+'策略没有改变任何决策');console.log('  '+kind+'：80个种子中'+changed+'个改变合法决策');
 }
 const AI=require('../js/games/poker-ai.js'),G=require('../js/games/poker-engine.js');let changed=0;
 for(let seed=1;seed<=80;seed++){
  const st=G.createGame({seed,names:['甲','乙','丙'],sb:5,bb:10,button:0,startStack:1000}),seat=st.toAct,la=G.legalActions(st,seat);
  const a=AI.decide(st,seat,{seed:seed+100, samples:30,strategy:{...good,risk_level:'low',pressure:'preserve_bombs'}}),b=AI.decide(st,seat,{seed:seed+100,samples:30,strategy:good});
  for(const d of [a,b])assert((d.action==='fold'&&la.canFold)||(d.action==='check'&&la.canCheck)||(d.action==='call'&&la.canCall)||(d.action==='bet'&&la.canBet)||(d.action==='raise'&&la.canRaise)||(d.action==='allin'&&(la.canRaise||la.canBet||la.canCall)),'德州策略动作非法');
  if(a.action!==b.action||a.amount!==b.amount)changed++;
 }
 assert(changed>0,'德州策略没有改变决策');console.log('  poker：80个种子中'+changed+'个改变合法决策');
});
console.log(`策略旅程：${passed}通过，${failed}失败`);if(failed)process.exitCode=1;
})();
