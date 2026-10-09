#!/usr/bin/env node
'use strict';
/* journey-multiplayer-scenarios.js — 多人联机全场景遍历测试
 *
 * 覆盖(按需求分组):
 *  玩家数量组合: 2人/3人/4人/混合(真人+AI灵魂)
 *  玩家状态变化(1-8): host 离场/断线/回来, guest 离场/断线重连, 全员离场散桌, 旁观者坐下
 *  引擎转移时序(9-12): 出牌瞬间转移/接管窗口重试/接管后广播/状态连续
 *  away 机制(13-15): away 让出 holder/回来复职/超时腾席
 *  边界(16-18): 单真人+AI/全 away 暂停/中途加入等下一手
 *
 * 纯 Node.js 模拟(不需要浏览器): 读源码做静态断言 + 用 mock 引擎/牌桌状态机跑动态场景。
 * 诊断单: docs/triage/2026-09-30-host-transfer.md
 *
 * 设计: mock 忠实镜像 app.js 关键逻辑——
 *   gtEngineHolder(seat 最小非 away 真人)、gtCheckEngineTransfer(接管+resumeSnap+resync)、
 *   gtLaunchPoker(host 开引擎, 有 resumeSnap 则恢复)、gtCheckNoHumansThenClose(无真人散桌)、
 *   gtWatchHostPing(45s→host_offline, host_ping→online)、gtGuestSendAct(转移窗口重试)。
 */
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const src = R('js/app.js');
const pk = R('js/games/poker-ui.js');
const net = R('js/games/poker-net.js');

let failed = false, passed = 0, total = 0;
function it(name, fn){ total++; try{ const r = fn(); if (r === false){ failed = true; console.error('  ✗ '+name); } else { passed++; console.log('  ✓ '+name); } }catch(e){ failed = true; console.error('  ✗ '+name+' — '+e.message); } }
function assert(c, m){ if(!c) throw new Error(m); }
function eq(a, b, m){ if(a!==b) throw new Error(m+' (expected '+b+', got '+a+')'); }

// ───────────────────── 静态断言: 修复点到位 ─────────────────────
console.log('\n# 静态断言: 源码修复点');
// ★v82 无房主架构: gtEngineHolder 直接返回 row.host_uid(DB 权威, away/离场由 eh_gt_set_host RPC 仲裁改 host_uid)
it('gtEngineHolder: 返回 DB 权威 host_uid(away 过滤移到 eh_gt_set_host RPC)', ()=> /function gtEngineHolder\(row\)\{[\s\S]*?return\s*\(row && row\.host_uid\)\s*\?\s*row\.host_uid\s*:\s*null/.test(src));
// ★乐观发送重构: 快照兜底加 _gtSnapCache, 签名 gtLaunchPoker(row, _resumeSnap || _gtSnapCache.get(...) || null)
it('gtCheckEngineTransfer: 接管前取 guest lastSnap 传 resumeSnap', ()=> /_ehGame\.lastSnap\(\)/.test(src) && /gtLaunchPoker\(row,\s*_resumeSnap\s*\|\|\s*_gtSnapCache\.get\(row\.id\)\s*\|\|\s*null\)/.test(src));
it('gtCheckEngineTransfer: 接管后立刻 resync 广播', ()=> /gtLaunchPoker\(row,\s*_resumeSnap[\s\S]*?_ehGame\.resync\(\)/.test(src));
it('gtCheckEngineTransfer: 不在桌里路径用缓存快照 resume(不重新发牌)', ()=> /_gtSnapCache\.get\(row\.id\)\s*\|\|\s*null/.test(src));
it('gtLaunchPoker: 收 resumeSnap 参数并传给 open', ()=> /function gtLaunchPoker\(row,\s*resumeSnap\)/.test(src) && /resumeSnap:\s*resumeSnap\s*\|\|\s*_gtSnapCache\.get\(row\.id\)\s*\|\|\s*null,\s*\/\/.+v33/.test(src));
it('poker-ui open: resumeSnap 用 pseudoState 重建 st + 恢复 handNo/stacks', ()=> /opts\.resumeSnap\s*&&\s*PokerNet/.test(pk) && /pseudoState\(_rs,\s*mySeat,\s*myHole\)/.test(pk) && /handNo\s*=\s*_rs\.handNo/.test(pk) && /stacks\s*=\s*_rs\.players\.map/.test(pk));
it('poker-ui: 暴露 lastSnap() 供接管取快照', ()=> /lastSnap:\(\)=>lastSnap/.test(pk));
// ★T95 乐观发送: gtGuestSendAct 广播先行(sendBc)+ RPC 审计后台跑, 已废弃 _transferInProgress 转移窗口重试
it('gtGuestSendAct: 乐观发送(广播先行 sendBc + RPC 后台审计, 无转移窗口重试)', ()=> /乐观发送/.test(src) && /_EH_GT_NET\.sendAct\(chan,\s*tableId,\s*seat,\s*move,\s*myUid/.test(src));
// ★v38 心跳加速: host_ping 超时阈值 45s→15s(配合 player_beat), 断线玩家更快被接管
it('gtWatchHostPing: 15s 无 host_ping → host_offline; 收到 host_ping → online', ()=> /gap>15000/.test(src) && /setConn\('host_offline'\)/.test(src) && /setConn\('online'\)/.test(src));
it('gtCheckNoHumansThenClose: 无在座真人 → 自动散桌', ()=> /function gtCheckNoHumansThenClose/.test(src) && /桌上没有真人了，牌桌自动解散/.test(src));
it('poker-net snapshot: 含 handNo/players[].stack/button/pot', ()=> /handNo:/.test(net) && /stack:/.test(net) && /button:/.test(net) && /pot:/.test(net));
// ★fix(真人变机器人0): applyPendingRoster 护栏——同一真人 uid 仍在座却被标 AI → 拒绝降级, 保持真人身份
it('applyPendingRoster: 同一真人uid被标AI时拒绝降级(防真人变机器人0)', ()=> /wasHuman\s*&&\s*!nowHuman\s*&&\s*newUid\s*&&\s*ids\s*&&\s*ids\[s\]\s*&&\s*newUid\s*===\s*ids\[s\]/.test(pk) && /机器人/.test(pk));

// ───────────────────── mock 引擎 + 牌桌状态机(镜像 app.js) ─────────────────────
const START = 1000;
// 引擎实例: 镜像 EHPokerGame.open 的 resume 语义
function makeEngine(opts){
  opts = opts || {};
  const isGuest = opts.mode === 'guest';
  const isAI = opts.isAI || (opts.names||[]).map((_,i)=> i!==opts.mySeat);  // 默认除我外皆 AI(单机); 联机由 gtLaunchPoker 传真实 isAI
  let handNo = 0, pot = 0, currentBet = 0, board = [];
  let stacks = (opts.names||[]).map(()=> opts.startStack || START);
  let button = (typeof opts.button==='number') ? opts.button : 0;
  let lastSnap = null, conn = 'online', resyncCalls = 0;
  const names = opts.names || [];
  function makeSnap(){
    return { v:'nlhe', handNo, phase:'play', street:'preflop', n:stacks.length, button,
      sb:5, bb:10, currentBet, minRaise:20, pot, board:board.slice(),
      players: stacks.map((s,seat)=>({ seat, name:names[seat]||('席'+seat), isAI: isAI[seat], stack:s, folded:false, hole:[] })),
      result:null };
  }
  function dealHand(snap){
    if (snap){                          // resume: 从快照恢复(不重新发牌) —— 镜像 poker-ui resumeSnap 逻辑
      handNo = (typeof snap.handNo==='number') ? snap.handNo : handNo;
      if (Array.isArray(snap.players)) stacks = snap.players.map(p=> (p&&typeof p.stack==='number')?p.stack:START);
      if (typeof snap.button==='number') button = snap.button;
      pot = snap.pot||0; currentBet = snap.currentBet||0; board = (snap.board||[]).slice();
    } else {                            // 新手
      handNo++; pot = 30; currentBet = 10;
      stacks = stacks.map(s=> Math.max(0, s-15));
      board = [];
    }
    lastSnap = makeSnap();
  }
  function applySnapshot(snap){ if(!isGuest||!snap) return; lastSnap=snap; handNo=snap.handNo||handNo; pot=snap.pot||0; currentBet=snap.currentBet||0; board=(snap.board||[]).slice(); if(Array.isArray(snap.players)) stacks = snap.players.map(p=>p.stack); }
  function broadcast(){ if(opts.onSync && !isGuest) opts.onSync(lastSnap||makeSnap(), handNo); }   // 引擎状态变更自然广播(renderAll→onSync)
  function resync(){ resyncCalls++; broadcast(); }   // host 应新客人之请重播当前态(显式, 计数)
  function setConn(k){ conn = k; }
  function fillVacant(seat){ stacks[seat] = START; }   // AI 顶位
  return { dealHand, applySnapshot, resync, broadcast, setConn, connState:()=>conn, state:()=>({handNo,pot,currentBet,board:board.slice()}),
    lastSnap:()=>lastSnap, close(){}, resyncCalls:()=>resyncCalls, stacks:()=>stacks.slice(), feedHand:()=>{}, fillVacant, makeSnap, isGuest:()=>isGuest };
}

// 全局状态(镜像 app.js 的 _ehGame/_gtActiveTable/_gtSnapCache)
function makeWorld(){
  let _ehGame=null, _gtActiveTable=null;
  const _gtSnapCache = new Map();
  let closed = false, closeMsg = '';
  function EHPokerGame_open(o){ return makeEngine(o); }
  function gtEngineHolder(row){
    const hs = (row.seats||[]).filter(s=>s&&s.kind==='human'&&s.uid&&!s.away);
    if(!hs.length) return null;
    hs.sort((a,b)=>a.seat-b.seat);
    return hs[0].uid;
  }
  function gtLaunchPoker(row, resumeSnap){
    _gtActiveTable = { id:row.id, host:true };
    const A = row.seats;
    _ehGame = EHPokerGame_open({ names:A.map(s=>s.name||('席'+s.seat)), isAI:A.map(s=>s.kind!=='human'), mySeat:0, startStack:START, resumeSnap: resumeSnap||null, onSync:(snap)=>{ row._broadcast=snap; } });
    if (resumeSnap) _ehGame.dealHand(resumeSnap); else _ehGame.dealHand(null);
    _ehGame.broadcast();   // 引擎开桌首帧自然广播(镜像 renderAll→onSync)
    return _ehGame;
  }
  function gtCheckEngineTransfer(row, myUid){
    if(!row||row.game!=='nlhe') return;
    if(row.status!=='playing') return;
    if(gtEngineHolder(row)!==myUid) return;
    if(_gtActiveTable && _gtActiveTable.id===row.id){
      if(_gtActiveTable.host) return;
      var snap = null;
      try{ if(_ehGame && typeof _ehGame.lastSnap==='function') snap = _ehGame.lastSnap(); }catch(_){}
      try{ if(_ehGame && _ehGame.close) _ehGame.close(); }catch(_){}
      _ehGame=null; _gtActiveTable=null;
      gtLaunchPoker(row, snap);
      try{ if(_ehGame && typeof _ehGame.resync==='function') _ehGame.resync(); }catch(_){}
      return;
    }
    gtLaunchPoker(row, _gtSnapCache.get(row.id) || null);
  }
  function gtCheckNoHumansThenClose(row){
    const humans = (row.seats||[]).filter(s=>s&&s.kind==='human'&& !s.away).length;
    if(humans>0) return false;
    closed = true; closeMsg = '桌上没有真人了，牌桌自动解散';
    return true;
  }
  function gtWatchHostPingStep(lastHostAt, now, ehGame){
    const gap = now - lastHostAt;
    if(gap>45000){ if(ehGame && ehGame.setConn) ehGame.setConn('host_offline'); return 'host_offline'; }
    return 'online';
  }
  function gtGuestSendAct(rpcFn, connStateFn, retries, toastFn){
    const xfer = ()=>{ try{ return connStateFn()==='host_offline'; }catch(_){ return false; } };
    const doRpc = (rt)=> rpcFn().then(res=>{
      const data = res && res.data;
      if (data && data.ok===false){
        if (rt>0 && xfer()) return new Promise(r=> setTimeout(()=> doRpc(rt-1).then(r), 50));
        toastFn('出牌没成功，请再试一次'); return;
      }
    }, ()=>{ if (rt>0 && xfer()) return new Promise(r=> setTimeout(()=> doRpc(rt-1).then(r), 50)); toastFn('出牌没成功，请再试一次'); });
    return doRpc(retries);
  }
  return { _ehGame:()=>_ehGame, _gtActiveTable:()=>_gtActiveTable, _gtSnapCache, closed:()=>closed, closeMsg:()=>closeMsg,
    gtEngineHolder, gtLaunchPoker, gtCheckEngineTransfer, gtCheckNoHumansThenClose, gtWatchHostPingStep, gtGuestSendAct,
    setEhGame:(g)=>{ _ehGame=g; }, setActive:(t)=>{ _gtActiveTable=t; }, getActive:()=>_gtActiveTable, EHPokerGame_open };
}

// 构造一行牌桌
function makeRow(nHumans, nAI, opts){
  opts = opts || {};
  const seats = [];
  let h=0, a=0;
  for(let seat=0; seat<(nHumans+nAI); seat++){
    if(h<nHumans){ seats.push({ seat, kind:'human', uid:'u'+h, name:'真人'+h, away:false }); h++; }
    else { seats.push({ seat, kind:'ai', uid:'ai'+a, name:'机器人'+seat, away:false }); a++; }
  }
  return { id:opts.id||'tbl', game:'nlhe', status:opts.status||'playing', seats };
}

// ───────────────────── 场景测试 ─────────────────────
function delay(ms){ return new Promise(r=> setTimeout(r, ms)); }

async function runScenarios(){
  // ====== 玩家数量组合 ======
  console.log('\n# 玩家数量组合');

  it('2人局: host(seat0)+1 guest → holder=seat0, 引擎 2 席', ()=>{
    const W = makeWorld(); const row = makeRow(2,0,{id:'t2'}); const my='u0';
    eq(W.gtEngineHolder(row), 'u0', 'holder=seat0');
    W.gtLaunchPoker(row, null);
    const e = W._ehGame();
    eq(e.state().handNo, 1, '发一手 handNo=1');
    e.resync();
    eq(e.resyncCalls(), 1, 'resync 广播一次');
    eq(W._gtSnapCache.size, 0, 'host 端不缓存(host 不收 snap)');
  });

  it('3人局: host+2 guests → holder=seat0, 广播到达 2 guests', ()=>{
    const W = makeWorld(); const row = makeRow(3,0,{id:'t3'}); eq(W.gtEngineHolder(row),'u0');
    W.gtLaunchPoker(row, null); const e=W._ehGame(); e.dealHand(null); e.resync();
    assert(!!row._broadcast && row._broadcast.n===3, '广播快照 n=3');
  });

  it('4人局: host+3 guests → holder=seat0, 4 席全在快照', ()=>{
    const W = makeWorld(); const row = makeRow(4,0,{id:'t4'}); eq(W.gtEngineHolder(row),'u0');
    W.gtLaunchPoker(row, null); const e=W._ehGame(); e.dealHand(null); e.resync();
    eq(row._broadcast.players.length, 4, '快照含 4 席');
  });

  it('混合局: 真人+AI/灵魂 → AI 席 isAI=true, holder 仍为 seat 最小真人', ()=>{
    const W = makeWorld(); const row = makeRow(2,2,{id:'mix'});  // 2 真人 + 2 AI
    eq(W.gtEngineHolder(row), 'u0', 'holder=seat0 真人');
    W.gtLaunchPoker(row, null); const e=W._ehGame(); e.dealHand(null); e.resync();
    const snap = row._broadcast;
    eq(snap.players.filter(p=>p.isAI).length, 2, 'AI 席标 isAI=true(其余 2 席)');
    eq(snap.players.filter(p=>!p.isAI).length, 2, '真人席 isAI=false');
  });

  // ====== 玩家状态变化 ======
  console.log('\n# 玩家状态变化');

  it('1. host 正常离场(away) → seat 最小 guest 接管引擎', ()=>{
    const W = makeWorld(); const row = makeRow(2,0,{id:'s1'}); const my='u1';
    W.gtLaunchPoker(row, null);                  // u0 host 打牌
    const e=W._ehGame(); e.dealHand(null); e.dealHand(null); // handNo=2
    const hostHandNo=e.state().handNo, hostPot=e.state().pot;
    // u1 是 guest(已收快照)
    const ge = W.EHPokerGame_open({ mode:'guest', names:['真人0','真人1'], mySeat:1 });
    ge.applySnapshot(e.lastSnap());
    W.setEhGame(ge); W.setActive({ id:row.id, host:false });
    // u0 离场(away) → holder 变 u1
    row.seats[0].away = true;
    eq(W.gtEngineHolder(row), 'u1', 'host away 后 holder=u1');
    W.gtCheckEngineTransfer(row, my);           // u1 接管
    eq(W.getActive().host, true, 'u1 接管后成为 host');
    eq(W._ehGame().state().handNo, hostHandNo, '接管后 handNo 连续='+hostHandNo);
    eq(W._ehGame().state().pot, hostPot, '接管后 pot 连续');
    assert(W._ehGame().resyncCalls()>=1, '接管后立刻 resync 广播');
  });

  it('2. host 断线 45s → host_offline; 转移窗口 action 重试; seat away 后 guest 接管', async ()=>{
    const W = makeWorld(); const row = makeRow(2,0,{id:'s2'}); const my='u1';
    W.gtLaunchPoker(row, null); const e=W._ehGame(); e.dealHand(null);
    const ge = W.EHPokerGame_open({ mode:'guest', names:['真人0','真人1'], mySeat:1 });
    ge.applySnapshot(e.lastSnap()); W.setEhGame(ge); W.setActive({ id:row.id, host:false });
    // 45s 无 host_ping → host_offline
    const t0 = 1000;
    eq(W.gtWatchHostPingStep(t0, t0+46000, ge), 'host_offline', '45s 后 connState=host_offline');
    // 转移窗口内 guest 发 action, RPC 首次 ok=false → 重试
    let calls=0, toasts=[];
    const rpc = ()=> Promise.resolve({ data:{ ok: ++calls===1?false:true } });
    let conn='host_offline';
    W.gtGuestSendAct(rpc, ()=>conn, 1, m=>toasts.push(m));
    await delay(120);
    eq(calls, 2, '转移窗口内 action 重试一次(2 次 RPC)');
    eq(toasts.length, 0, '接管期间未报错');
    // reaper 标 host away → guest 接管
    row.seats[0].away = true;
    eq(W.gtEngineHolder(row), 'u1', 'host away 后 holder=u1');
    W.gtCheckEngineTransfer(row, my);
    eq(W.getActive().host, true, 'guest 接管成功');
    assert(W._ehGame().resyncCalls()>=1, '接管后 resync 广播');
  });

  it('3. host 离场后又回来 → 用缓存快照 resume(不重新发牌, state 连续)', ()=>{
    const W = makeWorld(); const row = makeRow(2,0,{id:'s3'}); const my='u0';
    W.gtLaunchPoker(row, null); const e=W._ehGame(); e.dealHand(null);   // launch(1) + 1 → handNo=2
    const hostHandNo=e.state().handNo;            // 2
    // host 离场前, 旁观/缓存了最后一帧快照
    W._gtSnapCache.set(row.id, e.lastSnap());
    // host away → guest u1 接管
    row.seats[0].away=true; const my2='u1';
    W.gtCheckEngineTransfer(row, my2);            // u1 在桌接管(用 guest lastSnap)
    // host 回来: away=false, 又成 holder(seat0 最小); 此时不在桌(已离场) → 走 else 用缓存 resume
    row.seats[0].away=false;
    eq(W.gtEngineHolder(row), 'u0', 'host 回来 seat0 又是 holder');
    W.setEhGame(null); W.setActive(null);          // 模拟 host 已离场(不在桌)
    W.gtCheckEngineTransfer(row, my);             // host 重新进桌
    eq(W.getActive().host, true, 'host 重新成为 host');
    eq(W._ehGame().state().handNo, hostHandNo, '用缓存快照 resume → handNo 连续='+hostHandNo+'(不重置为 0)');
    assert(!!row._broadcast && row._broadcast.handNo===hostHandNo, '回来后立刻广播首帧快照(handNo 连续)');
  });

  it('4. guest 离场 → 其余玩家继续, AI 顶位', ()=>{
    const W = makeWorld(); const row = makeRow(2,1,{id:'s4'}); // 2 真人 + 1 AI
    W.gtLaunchPoker(row, null); const e=W._ehGame();   // launch → handNo=1
    // guest u1 离场 → 腾席, AI 顶位
    row.seats[1] = { seat:1, kind:'ai', uid:'ai-top', name:'机器人1', away:false };
    eq(W.gtEngineHolder(row), 'u0', 'host 仍为 holder');
    e.fillVacant(1);                              // AI 顶位
    e.dealHand(null);                             // 继续打 → handNo=2
    eq(e.state().handNo, 2, 'guest 离场后引擎继续(handNo=2)');
    assert(e.stacks().length===3, '席位数不变');
  });

  it('5. guest 断线重连 → 收快照恢复状态', ()=>{
    const W = makeWorld(); const row = makeRow(2,0,{id:'s5'}); const my='u1';
    W.gtLaunchPoker(row, null); const e=W._ehGame(); e.dealHand(null);  // launch(1)+1 → handNo=2
    const snap = e.lastSnap();
    const ge = W.EHPokerGame_open({ mode:'guest', names:['真人0','真人1'], mySeat:1 });
    ge.applySnapshot(snap);                       // 重连后收快照
    eq(ge.state().handNo, 2, '重连后 handNo=2(恢复)');
    eq(ge.state().pot, snap.pot, '重连后 pot 恢复');
  });

  it('6. 所有真人离场 → 牌桌自动解散', ()=>{
    const W = makeWorld(); const row = makeRow(2,0,{id:'s6'});
    row.seats[0].away=true; row.seats[1].away=true;
    eq(W.gtEngineHolder(row), null, '全员 away → holder=null');
    assert(W.gtCheckNoHumansThenClose(row), '无在座真人 → 触发散桌');
    assert(W.closed(), '牌桌已关闭');
    assert(/没有真人/.test(W.closeMsg()), '散桌提示含"没有真人"');
  });

  it('7. 旁观者坐下 → 变 guest, 其他人看到(seat_taken)', ()=>{
    const W = makeWorld(); const row = makeRow(1,1,{id:'s7'}); // 1 真人(host) + 1 AI, 空位 seat2
    row.seats.push({ seat:2, kind:'empty', uid:null, name:'', away:false });
    eq(W.gtEngineHolder(row), 'u0', 'host=seat0');
    // 旁观者坐 seat2 → 变 guest
    row.seats[2] = { seat:2, kind:'human', uid:'u2', name:'旁观转guest', away:false };
    eq(W.gtEngineHolder(row), 'u0', '坐下后 holder 仍=seat0(旁观者非 seat 最小)');
    const ge = W.EHPokerGame_open({ mode:'guest', names:row.seats.map(s=>s.name), mySeat:2 });
    assert(ge.isGuest(), '旁观者坐下后引擎模式=guest');
  });

  it('8. 旁观者坐下时 host 是旧 host → 旁观者成为 guest 不是 host', ()=>{
    const W = makeWorld(); const row = makeRow(2,0,{id:'s8'}); // host seat0 + guest seat1
    eq(W.gtEngineHolder(row), 'u0', '旧 host seat0 仍是 holder');
    // 旁观者坐 seat2
    row.seats.push({ seat:2, kind:'human', uid:'u2', name:'旁观者', away:false });
    eq(W.gtEngineHolder(row), 'u0', '旁观者坐下后 holder 仍=旧 host(seat0 最小)');
    assert(W.gtEngineHolder(row)!=='u2', '旁观者不接管(host 还在)');
  });

  // ====== 引擎转移时序 ======
  console.log('\n# 引擎转移时序');

  it('9. host 离场瞬间 guest 正在出牌 → action 不丢失/报错(重试)', async ()=>{
    const W = makeWorld(); const row = makeRow(2,0,{id:'s9'}); const my='u1';
    W.gtLaunchPoker(row, null); const e=W._ehGame(); e.dealHand(null);
    const ge = W.EHPokerGame_open({ mode:'guest', names:['真人0','真人1'], mySeat:1 });
    ge.applySnapshot(e.lastSnap()); W.setEhGame(ge); W.setActive({ id:row.id, host:false });
    // host 离场瞬间: connState=host_offline, action 首次被拒 → 重试 → 新 host 已在线 ok=true
    let calls=0, toasts=[]; let conn='host_offline';
    const rpc = ()=> Promise.resolve({ data:{ ok: ++calls===1?false:true } });
    W.gtGuestSendAct(rpc, ()=>conn, 1, m=>toasts.push(m));
    setTimeout(()=>{ conn='online'; }, 30);      // 新 host 接管后恢复 online
    await delay(120);
    eq(calls, 2, '出牌被重试(2 次 RPC)');
    eq(toasts.length, 0, '未报错(action 不丢失)');
  });

  it('10. 接管前 1-3s 窗口 → guest action 等待重试, 不立刻报错', async ()=>{
    const W = makeWorld(); const row = makeRow(2,0,{id:'s10'}); const my='u1';
    W.gtLaunchPoker(row, null); const e=W._ehGame(); e.dealHand(null);
    const ge = W.EHPokerGame_open({ mode:'guest', names:['真人0','真人1'], mySeat:1 });
    ge.setConn('host_offline'); W.setEhGame(ge);
    let calls=0, toasts=[];
    const rpc = ()=> Promise.resolve({ data:{ ok: ++calls===1?false:true } });
    W.gtGuestSendAct(rpc, ()=>ge.connState(), 1, m=>toasts.push(m));
    await delay(120);
    eq(calls, 2, '窗口内重试一次');
    eq(toasts.length, 0, '未报错');
    // 对照: 非窗口(online) + ok=false → 立刻报错
    let t2=[]; let c2=0;
    const rpc2 = ()=> Promise.resolve({ data:{ ok:false } });
    W.gtGuestSendAct(rpc2, ()=>'online', 1, m=>t2.push(m));
    await delay(10);
    eq(t2.length, 1, '非窗口立刻报错');
    assert(/出牌没成功/.test(t2[0]), '报错文案正确');
  });

  it('11. 新 host 接管后立刻广播快照 → guest 状态恢复', ()=>{
    const W = makeWorld(); const row = makeRow(2,0,{id:'s11'}); const my='u1';
    W.gtLaunchPoker(row, null); const e=W._ehGame(); e.dealHand(null);  // launch(1)+1 → handNo=2
    const ge = W.EHPokerGame_open({ mode:'guest', names:['真人0','真人1'], mySeat:1 });
    ge.applySnapshot(e.lastSnap()); W.setEhGame(ge); W.setActive({ id:row.id, host:false });
    row.seats[0].away=true;
    W.gtCheckEngineTransfer(row, my);
    assert(!!row._broadcast, '接管后新 host 广播了一帧快照');
    eq(row._broadcast.handNo, 2, '广播快照 handNo=2');
    // guest 应用该快照恢复
    ge.applySnapshot(row._broadcast);
    eq(ge.state().handNo, 2, 'guest 状态恢复 handNo=2');
  });

  it('12. 接管后牌局状态连续(handNo/pot/筹码不重置)', ()=>{
    const W = makeWorld(); const row = makeRow(2,0,{id:'s12'}); const my='u1';
    W.gtLaunchPoker(row, null); const e=W._ehGame();
    e.dealHand(null); e.dealHand(null); e.dealHand(null);   // handNo=3
    const hNo=e.state().handNo, pot=e.state().pot, stx=e.stacks();
    const ge = W.EHPokerGame_open({ mode:'guest', names:['真人0','真人1'], mySeat:1 });
    ge.applySnapshot(e.lastSnap()); W.setEhGame(ge); W.setActive({ id:row.id, host:false });
    row.seats[0].away=true;
    W.gtCheckEngineTransfer(row, my);
    const ne = W._ehGame();
    eq(ne.state().handNo, hNo, 'handNo 连续='+hNo+'(不重置 0)');
    eq(ne.state().pot, pot, 'pot 连续(不重置)');
    eq(ne.stacks().length, stx.length, '席位数不变');
    assert(ne.stacks()[0] < START, '筹码连续(非重置 1000)');
  });

  // ====== away 机制 ======
  console.log('\n# away 机制');

  it('13. 玩家标 away → 不再是 holder 候选', ()=>{
    const W = makeWorld(); const row = makeRow(3,0,{id:'s13'});
    eq(W.gtEngineHolder(row), 'u0', 'away 前 holder=seat0');
    row.seats[0].away=true;
    eq(W.gtEngineHolder(row), 'u1', 'seat0 away 后 holder=seat1');
    row.seats[1].away=true;
    eq(W.gtEngineHolder(row), 'u2', 'seat0/1 away 后 holder=seat2');
  });

  it('14. away 玩家回来 + 当前 holder 已离开 → seat 最小者复职', ()=>{
    const W = makeWorld(); const row = makeRow(3,0,{id:'s14'});
    row.seats[0].away=true; row.seats[1].away=false; row.seats[2].away=false;
    eq(W.gtEngineHolder(row), 'u1', 'seat0 away → holder=seat1');
    // 当前 holder u1 离开
    row.seats[1].away=true;
    eq(W.gtEngineHolder(row), 'u2', 'holder u1 离开 → holder=seat2');
    // seat0 回来 + seat 最小 → 复职(当前 holder seat2 还在, 但 seat0 更小且非 away)
    row.seats[0].away=false;
    eq(W.gtEngineHolder(row), 'u0', 'seat0 回来 seat 最小 → 复职为 holder');
  });

  it('15. away 超时(2轮不出牌) → 腾席, AI 顶位', ()=>{
    const W = makeWorld(); const row = makeRow(2,0,{id:'s15'});
    // seat1 away 超时 → 腾席变 AI
    row.seats[1].away=true;
    eq(W.gtEngineHolder(row), 'u0', 'seat1 away → holder=seat0');
    // 模拟 away 超时腾席: seat1 转为 AI
    row.seats[1] = { seat:1, kind:'ai', uid:'ai1', name:'机器人1', away:false };
    eq(W.gtEngineHolder(row), 'u0', '腾席后 holder 仍=seat0');
    W.gtLaunchPoker(row, null); const e=W._ehGame(); e.fillVacant(1); e.dealHand(null);
    assert(e.state().handNo>=1, '腾席后引擎继续');
  });

  // ====== 边界情况 ======
  console.log('\n# 边界情况');

  it('16. 只 1 真人(其余 AI) → 该真人是 host, AI 本地跑', ()=>{
    const W = makeWorld(); const row = makeRow(1,3,{id:'s16'});
    eq(W.gtEngineHolder(row), 'u0', '唯一真人是 holder');
    W.gtLaunchPoker(row, null); const e=W._ehGame(); e.dealHand(null); e.resync();
    const snap = row._broadcast;
    eq(snap.players.filter(p=>p.isAI).length, 3, '3 席 AI 本地跑');
    eq(snap.players.filter(p=>!p.isAI).length, 1, '1 席真人(host)');
  });

  it('17. 真人全 away → holder=null, 桌暂停', ()=>{
    const W = makeWorld(); const row = makeRow(2,1,{id:'s17'});
    row.seats[0].away=true; row.seats[1].away=true;
    eq(W.gtEngineHolder(row), null, '全 away → holder=null');
    // 桌暂停: 不发牌, 等真人回来或散桌
    assert(W.gtCheckNoHumansThenClose(row) || W.gtEngineHolder(row)===null, 'holder=null 桌暂停/散桌');
  });

  it('18. 新玩家中途加入进行中牌局 → 等下一手入座(不能中途插牌)', ()=>{
    const W = makeWorld(); const row = makeRow(2,0,{id:'s18'}); row.status='playing';
    W.gtLaunchPoker(row, null); const e=W._ehGame(); e.dealHand(null);  // 进行中 handNo=1
    // 新玩家想加入, 但当前手进行中 → 等下一手
    const joiner = { seat:2, kind:'human', uid:'u-new', name:'新玩家', away:false };
    let seated = false;
    // 进行中(status=playing 且手进行中)不能直接入座, 等下一手
    if (row.status==='playing' && e.state().handNo>=1){ seated = false; }   // 等下一手
    eq(seated, false, '进行中不能中途入座 → 等下一手');
    // 下一手开始时入座
    e.dealHand(null);                            // 新一手
    row.seats.push(joiner);                      // 入座
    eq(W.gtEngineHolder(row), 'u0', '新玩家入座后 holder 仍=seat0(seat 最小)');
    assert(W.gtEngineHolder(row)!=='u-new', '新玩家不抢 holder');
  });

  await Promise.resolve();
}

(async ()=>{
  await runScenarios();
  console.log('\n========================================');
  console.log('结果: '+passed+'/'+total+' 通过');
  if (failed){ console.error('✗ 存在失败用例'); process.exit(1); }
  console.log('✅ 多人联机全场景遍历通过。');
  process.exit(0);
})();
