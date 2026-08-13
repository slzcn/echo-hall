#!/usr/bin/env node
'use strict';
/** 正式用户改名旅程（前后一致性）：
 *  真人改名/换头像后, 其已渲染的历史消息旧名/旧头像必须跟着变成新身份——身份来源两层, 与灵魂 roomSouls 对等:
 *    1) 在场者: lastUsersSnapshot(presence 心跳, 最新鲜, 优先)
 *    2) 离场者: roomUserIdentity(进房按历史 uid 批量拉 eh_users 的权威身份表, 兜住不在 presence 里的人, 如"61女王")
 *  匿名/虚空消息(无持久身份)必须定格在发送时快照; 查不到身份(纯陌生 uid)也定格; 灵魂走另一条链不被本函数动。
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

function harness(msgs, snapshot, souls, identity){
  const ctx={
    console,
    lastUsersSnapshot: snapshot,
    roomUserIdentity: identity || new Map(),   // 离场者权威身份表(进房批量拉 eh_users 的产物)
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

// 场景：5 条历史消息
const UID_A='uid-alice', UID_B='uid-bob', UID_C='uid-carol', UID_D='uid-diva', UID_S='uid-soul';
function scene(){
  return [
    mkMsg({uid:UID_A,name:'旧名A',color:'#111',emoji:'🐱'}),                 // 在场且改名 → 跟随(快照)
    mkMsg({uid:UID_B,name:'匿名旧名',color:'#222',emoji:'👻',isVoid:true}),  // 匿名/虚空 → 定格
    mkMsg({uid:UID_C,name:'陌生离场者',color:'#333',emoji:'🦊'}),            // 不在快照也不在身份表 → 定格
    mkMsg({uid:UID_D,name:'61女王',color:'#5a5',emoji:'👑'}),               // 离场但在权威身份表 → 跟随(反查 eh_users)
    mkMsg({uid:UID_S,name:'灵魂旧名',color:'#444',emoji:'🤖'}),              // 灵魂 → 本函数不碰
  ];
}
// 当前在场快照：Alice 已改成"月见/🌙"、灵魂也在场但改了名(应被 soulUidSet 挡住不动)
const snapshot=[
  {user_id:UID_A, name:'月见', color:'#0af', emoji:'🌙'},
  {user_id:UID_S, name:'灵魂新名', color:'#f0a', emoji:'🌟'},
];
// 权威身份表：61女王(离场)已在 eh_users 改名"热血狼/🐺"; Alice 也在表里但用旧名(应被更新鲜的在场快照覆盖)
function identity(){
  return new Map([
    [UID_D, {name:'热血狼', emoji:'🐺', color:'#e33'}],
    [UID_A, {name:'表里旧名A', emoji:'🐱', color:'#111'}],
  ]);
}

// ---- 直接单元验证 liveIdentityByUid 的两层数据源 ----
{
  const ctx=harness(scene(), snapshot, [UID_S], identity());
  const liveA=ctx.liveIdentityByUid(UID_A);
  assert(liveA && liveA.name==='月见' && liveA.emoji==='🌙', '步骤 0a: 在场者优先取 presence 快照(月见), 压过身份表旧名');
  const liveD=ctx.liveIdentityByUid(UID_D);
  assert(liveD && liveD.name==='热血狼' && liveD.emoji==='🐺', '步骤 0b: 离场者从权威身份表反查到新名(热血狼)——61女王案');
  assert(ctx.liveIdentityByUid(UID_C)===null, '步骤 0c: 既不在场也不在身份表 → 返回 null(历史维持快照)');
  assert(ctx.liveIdentityByUid('')===null, '步骤 0d: 空 uid 安全返回 null');
}

// ---- 旅程验证 refreshRenderedUserIdentity 就地回补 ----
{
  const local=scene();
  const ctx=harness(local, snapshot, [UID_S], identity());
  ctx.refreshRenderedUserIdentity();

  assert(local[0]._nm.textContent==='月见', '步骤 1: 在场用户改名 → 历史消息名字跟随为"月见"');
  assert(local[0].dataset.name==='月见', '步骤 2: data-name 跟随更新(点击/@ 用新名)');
  assert(local[0]._av.dataset.atname==='月见', '步骤 3: 头像 atname 跟随(@ 出正确新名)');
  assert(local[0]._nm.style.color==='#0af', '步骤 4: 名字颜色跟随在场新身份(非身份表旧色)');

  assert(local[1]._nm.textContent==='匿名旧名', '步骤 5: 匿名/虚空消息定格, 不跟改名(无持久身份、@会泄露)');
  assert(local[2]._nm.textContent==='陌生离场者', '步骤 6: 既不在场也不在身份表 → 定格(反查不到)');

  assert(local[3]._nm.textContent==='热血狼', '步骤 7: 【离场者】改名跟随——61女王历史里的旧名回补成 eh_users 现名"热血狼"');
  assert(local[3].dataset.name==='热血狼', '步骤 8: 离场者 data-name 也跟随(@ 出其现名)');
  assert(local[3]._nm.style.color==='#e33', '步骤 9: 离场者名字颜色跟随身份表新色');

  assert(local[4]._nm.textContent==='灵魂旧名', '步骤 10: 灵魂消息不被真人链改动(走 refreshRenderedSoulIdentity)');
}

// ---- 反证 1：把在场判定短路(所有人视作查不到)后, 改名不再跟随, 前后一致性被旅程抓红 ----
{
  const mutant=production.replace('const u=byUid.get(uid); if(!u || !u.name) return;',
                                  'const u=null; if(!u || !u.name) return;');
  if(mutant===production) throw new Error('FAIL: 未能构造反证变异体(定位锚点失效)');
  const local=[ mkMsg({uid:UID_A,name:'旧名A',color:'#111',emoji:'🐱'}) ];
  const ctx={ console, lastUsersSnapshot:snapshot, roomUserIdentity:identity(), soulUidSet:new Set(),
    safeColor:c=>c||'#888', safeEmoji:e=>e||'', avEmoji:e=>e,
    document:{ querySelectorAll:sel=> sel==='#stream .msg[data-uid]'?local:[] } };
  vm.runInNewContext(mutant, ctx, {filename:'js/app.js#rename-follow.mutant'});
  ctx.refreshRenderedUserIdentity();
  assert(local[0]._nm.textContent==='旧名A', '反证 1：断掉回补后, 改名不再跟随(旧实现必红)');
}

// ---- 反证 2：只认在场快照、砍掉身份表兜底(旧实现)→ 离场者 61女王 永远显示旧名, 被旅程抓红 ----
{
  const oldImpl=production
    .replace(/const r=\(roomUserIdentity && roomUserIdentity\.get\) \? roomUserIdentity\.get\(uid\) : null;\n  return r \? \{ name:r\.name, emoji:r\.emoji, color:r\.color \} : null;/,
             'return null;')
    .replace('if(roomUserIdentity && roomUserIdentity.forEach) roomUserIdentity.forEach((v,uid)=>{ if(uid && v && v.name) byUid.set(uid, {user_id:uid, name:v.name, emoji:v.emoji, color:v.color}); });',
             '/* 旧实现: 无身份表兜底 */');
  if(oldImpl===production) throw new Error('FAIL: 未能构造"无身份表兜底"反证(锚点失效)');
  const local=[ mkMsg({uid:UID_D,name:'61女王',color:'#5a5',emoji:'👑'}) ];
  const ctx=harness(local, snapshot, [], identity());
  const src2=oldImpl;
  const ctx2={ console, lastUsersSnapshot:snapshot, roomUserIdentity:identity(), soulUidSet:new Set(),
    safeColor:c=>c||'#888', safeEmoji:e=>e||'', avEmoji:e=>e,
    document:{ querySelectorAll:sel=> sel==='#stream .msg[data-uid]'?local:[] } };
  vm.runInNewContext(src2, ctx2, {filename:'js/app.js#rename-follow.noidentity'});
  assert(ctx2.liveIdentityByUid(UID_D)===null, '反证 2a: 无身份表兜底 → 离场者反查返回 null');
  ctx2.refreshRenderedUserIdentity();
  assert(local[0]._nm.textContent==='61女王', '反证 2b: 无身份表兜底 → 61女王历史永远定格旧名(正是修复前的 bug)');
}

// ---- keep-alive 秒回房路径：loadRoomUserIdentity 无 rows 时从 DOM 扫 uid 补身份表 ----
// (秒回房直接贴旧 DOM 快照、跳过 loadHistory→无 rows; 若不从 DOM 扫描, 离场者旧名永留快照 = 主人看到的"还有")
{
  const s2=source.indexOf('async function loadRoomUserIdentity(rows){');
  const e2=source.indexOf('// 消息流灵魂头像"在场才呼吸"', s2);
  if(s2<0||e2<0) throw new Error('FAIL: 无法定位 loadRoomUserIdentity');
  const prod2=source.slice(s2,e2);

  // 场景: DOM 里有离场者 61女王(UID_D)+匿名(UID_B, data-void=1)+灵魂(UID_S)。无 rows 入参。
  const dom=[
    mkMsg({uid:UID_D,name:'61女王',color:'#5a5',emoji:'👑'}),
    mkMsg({uid:UID_B,name:'匿名旧名',color:'#222',emoji:'👻',isVoid:true}),
    mkMsg({uid:UID_S,name:'灵魂旧名',color:'#444',emoji:'🤖'}),
  ];
  let queried=null;
  const map=new Map();
  const ctx={
    console, sb:{
      from(t){ return { select(){ return { in(col, ids){ queried={t,col,ids};
        return Promise.resolve({ data:[{id:UID_D,name:'热血狼',emoji:'🐺',color:'#e33'}], error:null }); } }; } }; }
    },
    soulUidSet:new Set([UID_S]),
    roomUserIdentity:map,
    refreshRenderedUserIdentity(){ ctx._refreshed=(ctx._refreshed||0)+1; },
    document:{ querySelectorAll:sel=> sel==='#stream .msg[data-uid]'?dom:[] },
  };
  vm.runInNewContext(prod2, ctx, {filename:'js/app.js#loadRoomUserIdentity'});
  (async()=>{
    await ctx.loadRoomUserIdentity();   // 不传 rows → 走 DOM 扫描分支
    assert(queried && queried.t==='eh_users', '步骤 11: 无 rows 时从 DOM 扫 uid, 批量查 eh_users');
    assert(queried.ids.includes(UID_D), '步骤 12: 扫到离场者 61女王 uid 入批');
    assert(!queried.ids.includes(UID_B), '步骤 13: 匿名(data-void)不入批');
    assert(!queried.ids.includes(UID_S), '步骤 14: 灵魂 uid 不入批(走 roomSouls)');
    assert(map.get(UID_D) && map.get(UID_D).name==='热血狼', '步骤 15: 身份表填入离场者现名(热血狼)');
    assert(ctx._refreshed===1, '步骤 16: 拉到后就地回补一次 DOM(keep-alive 秒回房也跟随改名)');
    console.log('\n✅ 正式用户改名旅程通过：进房/秒回房两路径都跟随；离场→权威身份表反查(61女王案)；匿名/陌生→定格；灵魂链不受影响。');
  })().catch(e=>{ console.error(e.message||e); process.exit(1); });
}
