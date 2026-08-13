#!/usr/bin/env node
'use strict';
/** 正式用户改名旅程（前后一致性）：
 *  一个还【在场】的正式用户改名/换头像后, 其已渲染的历史消息旧名/旧头像必须跟着变成新身份;
 *  匿名/虚空消息、以及【已离场】用户的历史消息必须定格在发送时快照; 灵魂走另一条链不被本函数动。
 *  运行真实 liveIdentityByUid + refreshRenderedUserIdentity(从 js/app.js 抽取, 不复刻)。 */
const fs=require('fs'),vm=require('vm'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','js','app.js'),'utf8');
const start=source.indexOf('function liveIdentityByUid(uid){');
const end=source.indexOf('async function loadRoomSouls(rid){');
if(start<0||end<0) throw new Error('无法定位真实 liveIdentityByUid/refreshRenderedUserIdentity');
const production=source.slice(start,end);
function assert(ok,msg){if(!ok)throw new Error('FAIL: '+msg);console.log('✓ '+msg);}

// ---- 极简假 DOM：只实现被生产代码触达的接口 ----
function mkEl(tag){
  const el={
    tagName:tag, dataset:{}, style:{ _m:{}, setProperty(k,v){this._m[k]=v;}, get color(){return this._c;}, set color(v){this._c=v;} },
    children:[], _text:'', _attrs:{},
    get textContent(){ return this._text; }, set textContent(v){ this._text=v; this.children=[]; },
    get innerHTML(){ return this._html!==undefined?this._html:this._text; },
    set innerHTML(v){ this._html=v; this._text=String(v).replace(/<[^>]*>/g,''); },
    getAttribute(k){ return this._attrs[k]; },
    setAttribute(k,v){ this._attrs[k]=v; if(k==='style'){/* 记录但不解析 */} },
    querySelector(sel){ return (this._q&&this._q[sel])||null; },
    querySelectorAll(){ return []; },
  };
  return el;
}
// 一条消息 DOM：.msg[data-uid] 里含 .meta .nm 和 .av
function mkMsg({uid,name,color,emoji,isVoid}){
  const nm=mkEl('span'); nm.textContent=name; nm.style.color=color;
  const av=mkEl('div'); av.textContent=emoji; av.dataset.atname=name;
  av.setAttribute('style',`background:${color}22;color:${color};box-shadow:inset 0 0 0 1.5px ${color}`);
  const msg=mkEl('div');
  msg.dataset.uid=uid; msg.dataset.name=name; if(isVoid) msg.dataset.void='1';
  msg._q={ '.meta .nm':nm, '.av':av };
  msg._nm=nm; msg._av=av;
  return msg;
}

function harness(msgs, snapshot, souls){
  const stream={ _msgs:msgs };
  const ctx={
    console,
    lastUsersSnapshot: snapshot,
    roomUserIdentity: new Map(),
    soulUidSet: new Set(souls||[]),
    safeColor:(c)=> c || '#888',
    safeEmoji:(e)=> e || '',
    avEmoji:(e)=> `<span class="ee">${e}</span>`,
    document:{
      querySelectorAll(sel){
        if(sel==='#stream .msg[data-uid]') return msgs;
        return [];
      },
    },
  };
  vm.runInNewContext(production, ctx, {filename:'js/app.js#rename-follow'});
  return ctx;
}

// 场景：4 条历史消息
const UID_A='uid-alice', UID_B='uid-bob', UID_C='uid-carol', UID_S='uid-soul';
const msgs=[
  mkMsg({uid:UID_A,name:'旧名A',color:'#111',emoji:'🐱'}),                 // 在场且改名 → 应跟随
  mkMsg({uid:UID_B,name:'匿名旧名',color:'#222',emoji:'👻',isVoid:true}),  // 匿名/虚空 → 定格
  mkMsg({uid:UID_C,name:'离场者',color:'#333',emoji:'🦊'}),                // 不在快照 → 定格
  mkMsg({uid:UID_S,name:'灵魂旧名',color:'#444',emoji:'🤖'}),              // 灵魂 → 本函数不碰
];
// 当前在场快照：Alice 已改成"月见/🌙"、灵魂也在场但改了名(应被 soulUidSet 挡住不动)
const snapshot=[
  {user_id:UID_A, name:'月见', color:'#0af', emoji:'🌙'},
  {user_id:UID_S, name:'灵魂新名', color:'#f0a', emoji:'🌟'},
];

// ---- 直接单元验证 liveIdentityByUid ----
{
  const ctx=harness(msgs.map(m=>m), snapshot, [UID_S]);
  const liveA=ctx.liveIdentityByUid(UID_A);
  assert(liveA && liveA.name==='月见' && liveA.emoji==='🌙', '步骤 0a: liveIdentityByUid 命中在场用户返回其当前身份');
  assert(ctx.liveIdentityByUid(UID_C)===null, '步骤 0b: 已离场用户不在快照 → 返回 null(历史将维持快照)');
  assert(ctx.liveIdentityByUid('')===null, '步骤 0c: 空 uid 安全返回 null');
}

// ---- 旅程验证 refreshRenderedUserIdentity 就地回补 ----
{
  const local=[
    mkMsg({uid:UID_A,name:'旧名A',color:'#111',emoji:'🐱'}),
    mkMsg({uid:UID_B,name:'匿名旧名',color:'#222',emoji:'👻',isVoid:true}),
    mkMsg({uid:UID_C,name:'离场者',color:'#333',emoji:'🦊'}),
    mkMsg({uid:UID_S,name:'灵魂旧名',color:'#444',emoji:'🤖'}),
  ];
  const ctx=harness(local, snapshot, [UID_S]);
  ctx.refreshRenderedUserIdentity();

  assert(local[0]._nm.textContent==='月见', '步骤 1: 在场用户改名 → 历史消息名字跟随为"月见"');
  assert(local[0].dataset.name==='月见', '步骤 2: data-name 跟随更新(点击/@ 用新名)');
  assert(local[0]._av.dataset.atname==='月见', '步骤 3: 头像 atname 跟随(@ 出正确新名)');
  assert(local[0]._nm.style.color==='#0af', '步骤 4: 名字颜色跟随新身份');

  assert(local[1]._nm.textContent==='匿名旧名', '步骤 5: 匿名/虚空消息定格, 不跟改名(无持久身份、@会泄露)');
  assert(local[2]._nm.textContent==='离场者', '步骤 6: 已离场用户历史定格(不在在场快照)');
  assert(local[3]._nm.textContent==='灵魂旧名', '步骤 7: 灵魂消息不被真人链改动(走 refreshRenderedSoulIdentity)');
}

// ---- 反证：把在场判定短路(视所有人为已离场)后, 改名不再跟随, 前后一致性被旅程抓红 ----
{
  const mutant=production.replace('const u=byUid.get(uid); if(!u || !u.name) return;',
                                  'const u=null; if(!u || !u.name) return;');
  if(mutant===production) throw new Error('FAIL: 未能构造反证变异体(定位锚点失效)');
  const local=[ mkMsg({uid:UID_A,name:'旧名A',color:'#111',emoji:'🐱'}) ];
  const ctx={ console, lastUsersSnapshot:snapshot, roomUserIdentity:new Map(), soulUidSet:new Set(),
    safeColor:c=>c||'#888', safeEmoji:e=>e||'', avEmoji:e=>e,
    document:{ querySelectorAll:sel=> sel==='#stream .msg[data-uid]'?local:[] } };
  vm.runInNewContext(mutant, ctx, {filename:'js/app.js#rename-follow.mutant'});
  ctx.refreshRenderedUserIdentity();
  assert(local[0]._nm.textContent==='旧名A', '反证通过：断掉在场回补后, 改名不再跟随(旧实现必红)');
}

console.log('\n✅ 正式用户改名旅程通过：在场→历史跟随新身份；匿名/离场→定格；灵魂链不受影响。');
