#!/usr/bin/env node
'use strict';
/* journey-host-transfer.js — host 离场引擎转移旅程
 * 验证无房主架构下引擎转移时牌局状态连续、接管后立刻广播快照、接管期间 guest action 重试。
 *
 * 旅程:
 * 1) host(seat 0) + guest(seat 1) 打了几手(handNo/pot/stacks 推进)
 * 2) host 离场 → gtEngineHolder 返回 guest uid
 * 3) guest 接管成为新 host(gtCheckEngineTransfer → gtLaunchPoker(row, resumeSnap))
 * 4) 验证: 接管后引擎状态连续(handNo 不重置、pot 不重置、筹码不重置)
 * 5) 验证: 接管后新 host 立刻 resync() 广播快照给 guest
 * 6) 验证: 接管期间 guest 发出的 action 不报错(重试机制, connState=host_offline 时等2s重发)
 *
 * 纯 Node.js 模拟, 不需要浏览器。读源码做静态断言 + 用 mock 引擎跑动态旅程。
 * 诊断单: docs/triage/2026-09-30-host-transfer.md */
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const src = R('js/app.js');
const pk = R('js/games/poker-ui.js');
const net = R('js/games/poker-net.js');

let step = 0, failed = false;
function assert(c, m){ step++; if(!c){ failed=true; console.error('✗ ['+step+'] '+m); } else console.log('✓ ['+step+'] '+m); }
function eq(a, b, m){ step++; if(a!==b){ failed=true; console.error('✗ ['+step+'] '+m+' (expected '+b+', got '+a+')'); } else console.log('✓ ['+step+'] '+m); }

console.log('\n▸ 静态断言: 源码修复点到位');
// 问题1: resumeSnap 支持
assert(/resumeSnap:\s*resumeSnap\s*\|\|\s*null/.test(src), 'gtLaunchPoker 向 EHPokerGame.open 传入 resumeSnap');
assert(/function gtLaunchPoker\(row,\s*resumeSnap\)/.test(src), 'gtLaunchPoker 签名收 resumeSnap 参数');
assert(/opts\.resumeSnap\s*&&\s*PokerNet/.test(pk), 'poker-ui open() 识别 opts.resumeSnap');
assert(/PokerNet\.pseudoState\(_rs,\s*mySeat,\s*myHole\)/.test(pk), 'poker-ui 用 pseudoState 从快照重建 st');
assert(/if\s*\(st\s*&&\s*_rs\.handNo\s*!=\s*null\)\s*handNo\s*=\s*_rs\.handNo/.test(pk), 'poker-ui 从快照恢复 handNo');
assert(/stacks\s*=\s*_rs\.players\.map/.test(pk), 'poker-ui 从快照恢复各席 stacks');
assert(/if\s*\(st\s*&&\s*st\._guest\)\s*delete\s*st\._guest/.test(pk), 'poker-ui 接管者清除 _guest 标记(成为新权威)');
assert(/lastSnap:\(\)=>lastSnap/.test(pk), 'poker-ui 返回值暴露 lastSnap() 供接管取快照');
// 问题1: gtCheckEngineTransfer 取快照 + 传参
assert(/typeof _ehGame\.lastSnap==='function'\)\s*_resumeSnap\s*=\s*_ehGame\.lastSnap\(\)/.test(src), 'gtCheckEngineTransfer 接管前从 guest 实例取最后一帧快照');
assert(/gtLaunchPoker\(row,\s*_resumeSnap\)/.test(src), 'gtCheckEngineTransfer 把快照传给 gtLaunchPoker');
// 问题3: 接管后立刻 resync
assert(/gtLaunchPoker\(row,\s*_resumeSnap\);[\s\S]*?_ehGame\.resync\(\)/.test(src), 'gtCheckEngineTransfer 接管完成后立刻调 resync() 广播快照');
// 问题2: gtGuestSendAct 重试
assert(/_transferInProgress\s*=\s*function\(\)/.test(src), 'gtGuestSendAct 定义引擎转移检测 helper');
assert(/connState\(\)==='host_offline'/.test(src), 'gtGuestSendAct 检测 connState===host_offline');
assert(/setTimeout\(function\(\)\{\s*_doRpc\(retries-1\);\s*\},\s*2000\)/.test(src), 'gtGuestSendAct 转移窗口内等2s重发一次');
assert(/_doRpc\(1\)/.test(src), 'gtGuestSendAct 首次发起带1次重试额度');
// poker-net snapshot 形状(供 resume 读取的字段)
assert(/handNo:/.test(net) && /players:/.test(net) && /stack:/.test(net) && /button:/.test(net), 'poker-net snapshot 含 handNo/players[].stack/button');

if (failed){ console.error('\n✗ 静态断言失败, 中止'); process.exit(1); }

console.log('\n▸ 动态旅程: host 离场 → guest 接管 → 状态连续 + 快照广播 + action 重试');

// ── mock 引擎: 模拟 EHPokerGame.open 的 resume 语义(手写镜像 poker-ui.js 的修复逻辑) ──
// 真实 open() 在浏览器跑; 这里复刻关键状态机: handNo/pot/stacks/button + lastSnap + resync + setConn/connState。
function makeEngine(opts){
  opts = opts || {};
  const isGuest = opts.mode === 'guest';
  let handNo = 0;
  let stacks = (opts.names||[]).map((_,i)=> opts.startStack || 1000);
  let button = (typeof opts.button==='number') ? opts.button : 0;
  let pot = 0, currentBet = 0, board = [];
  let lastSnap = null;
  let conn = 'online';
  let resyncCalls = 0;

  // host 发一手: pot/stacks 推进 + 产快照
  function dealHand(snap){
    if (snap){            // resume: 从快照恢复(不重新发牌)
      handNo = snap.handNo || 0;
      if (Array.isArray(snap.players)) stacks = snap.players.map(p=>p.stack);
      if (typeof snap.button==='number') button = snap.button;
      pot = snap.pot || 0; currentBet = snap.currentBet || 0; board = (snap.board||[]).slice();
    } else {              // 新手
      handNo++; pot = 30; currentBet = 10;
      // 模拟筹码推进: sb5/bb10 + 一轮跟注
      stacks = stacks.map(s=> Math.max(0, s - 15));
      board = [];
    }
    lastSnap = makeSnap();
  }
  function makeSnap(){
    return {
      v:'nlhe', handNo, phase:'play', street:'preflop', n: stacks.length, button,
      sb:5, bb:10, currentBet, minRaise:20, aggressor:null, toAct:0, pot,
      board: board.slice(),
      players: stacks.map((s,seat)=>({ seat, name:(opts.names||[])[seat]||('席'+seat), isAI:seat!==opts.mySeat,
        stack:s, start: opts.startStack||1000, folded:false, allin:false, committed:0, street:0, acted:false, hole:[] })),
      result:null,
    };
  }
  function applySnapshot(snap){ if(!isGuest||!snap) return; lastSnap = snap; handNo = snap.handNo||0; pot = snap.pot||0; currentBet = snap.currentBet||0; board = (snap.board||[]).slice(); stacks = snap.players.map(p=>p.stack); }
  function resync(){ resyncCalls++; if(opts.onSync && !isGuest){ opts.onSync(lastSnap||makeSnap(), handNo); } }
  function setConn(k){ conn = k; }
  return {
    dealHand, applySnapshot, resync,
    setConn, connState:()=>conn,
    state:()=>({ handNo, pot, currentBet, board:board.slice(), players: stacks.map((s,seat)=>({seat,stack:s})) }),
    lastSnap:()=>lastSnap,
    close(){}, resyncCalls:()=>resyncCalls,
    stacks:()=>stacks.slice(),
  };
}

// ── mock app 层全局(镜像 app.js 的 gtCheckEngineTransfer/gtLaunchPoker/gtGuestSendAct 关键路径) ──
let _ehGame = null, _gtActiveTable = null;
function EHPokerGame_open(o){ return makeEngine(o); }

// gtEngineHolder: seats 里 seat 最小的非 away 真人
function gtEngineHolder(row){
  const hs = (row.seats||[]).filter(s=>s && s.kind==='human' && s.uid && !s.away);
  if(!hs.length) return null;
  hs.sort((a,b)=>a.seat-b.seat);
  return hs[0].uid;
}

// gtLaunchPoker(镜像): 以 host 开引擎; 有 resumeSnap 则传给 open 恢复
function gtLaunchPoker(row, resumeSnap){
  _gtActiveTable = { id: row.id, host: true };
  _ehGame = EHPokerGame_open({
    names: row.seats.map(s=>s.name), mySeat: 0, startStack: 1000, sb:5, bb:10,
    resumeSnap: resumeSnap || null,
    onSync: (snap)=>{ row._lastBroadcast = snap; },   // 广播快照给 guest
  });
  if (resumeSnap){ _ehGame.dealHand(resumeSnap); }    // resume: 用快照恢复(不重新发牌)
  return _ehGame;
}

// gtCheckEngineTransfer(镜像修复后逻辑)
function gtCheckEngineTransfer(row){
  if(!row || row.game!=='nlhe') return;
  if(row.status!=='playing') return;
  if(gtEngineHolder(row)!==row._myUid) return;
  if(_gtActiveTable && _gtActiveTable.id===row.id){
    if(_gtActiveTable.host) return;
    var _resumeSnap = null;
    try{ if(_ehGame && typeof _ehGame.lastSnap==='function') _resumeSnap = _ehGame.lastSnap(); }catch(_){}
    try{ if(_ehGame && _ehGame.close) _ehGame.close(); }catch(_){}
    _ehGame = null; _gtActiveTable = null;
    gtLaunchPoker(row, _resumeSnap);
    try{ if(_ehGame && typeof _ehGame.resync==='function') _ehGame.resync(); }catch(_){}
    return;
  }
  gtLaunchPoker(row);
}

// gtGuestSendAct(镜像修复后逻辑: 转移窗口内 host_offline 时等2s重发)
let _toastLog = [];
function toast(m){ _toastLog.push(m); }
let _rpcCalls = 0;
function gtGuestSendAct(rpc, connStateFn, retries){
  const _transferInProgress = ()=>{ try{ return connStateFn()==='host_offline'; }catch(_){ return false; } };
  const _doRpc = function(rt){
    _rpcCalls++;
    try{
      return rpc().then(function(res){
        var data = res && res.data;
        if (data && data.ok === false){
          if (rt > 0 && _transferInProgress()){           // 转移窗口内被拒 → 等50ms(压缩2s)重发
            return new Promise(function(resolve){ setTimeout(function(){ _doRpc(rt-1).then(resolve); }, 50); });
          }
          toast('出牌没成功，请再试一次');               // 非转移/重试用尽 → 报错
          return;
        }
        // ok: 出牌成功(无报错)
      }, function(){
        if (rt > 0 && _transferInProgress()){
          return new Promise(function(resolve){ setTimeout(function(){ _doRpc(rt-1).then(resolve); }, 50); });
        }
        toast('出牌没成功，请再试一次');
      });
    }catch(e){ toast('出牌没成功，请再试一次'); }
  };
  _doRpc(retries);
}

// ── 旅程 1: host + guest 打几手 ──
const HOST='host-uid', GUEST='guest-uid';
const row = {
  id:'tbl-1', game:'nlhe', status:'playing',
  seats: [
    { seat:0, kind:'human', uid:HOST, name:'host', away:false },
    { seat:1, kind:'human', uid:GUEST, name:'guest', away:false },
  ],
  _myUid: GUEST,
};

// host 开引擎并打 3 手
gtLaunchPoker(row, null);          // 我=host 起 engine(模拟 host 端)
_ehGame.dealHand(null);            // hand 1
const h1 = _ehGame.state().handNo;
_ehGame.dealHand(null);            // hand 2
_ehGame.dealHand(null);            // hand 3
const hostHandNo = _ehGame.state().handNo;
const hostPot = _ehGame.state().pot;
const hostStacks = _ehGame.stacks();
eq(hostHandNo, 3, 'host 打完 3 手后 handNo=3');
assert(hostPot > 0, 'host 打牌后 pot>0');
assert(hostStacks[0] < 1000, 'host 打牌后筹码减少(非重置 1000)');

// host 最后一帧快照广播给 guest; guest 应用快照
const lastSnap = _ehGame.lastSnap();
assert(!!lastSnap && lastSnap.handNo===3, 'host 最后一帧快照 handNo=3');
// 切到 guest 视角: guest 实例应用了这帧
const guestEngine = makeEngine({ mode:'guest', names:['host','guest'], mySeat:1, startStack:1000 });
guestEngine.applySnapshot(lastSnap);
eq(guestEngine.state().handNo, 3, 'guest 应用快照后 handNo=3(连续)');
eq(guestEngine.state().pot, hostPot, 'guest 应用快照后 pot 与 host 一致');

// ── 旅程 2: host 离场 → 引擎持有者转移给 guest ──
// host 离场: seat0 标 away
row.seats[0].away = true;
eq(gtEngineHolder(row), GUEST, 'host 离场后 gtEngineHolder 返回 guest uid');

// guest 此刻持有的 _ehGame 是 guest 实例(模拟): 把 guest engine 设为当前
_ehGame = guestEngine;
_gtActiveTable = { id: row.id, host: false };
row._myUid = GUEST;

// guest 接管
gtCheckEngineTransfer(row);
eq(_gtActiveTable.host, true, '接管后 _gtActiveTable.host=true(新 host)');
assert(_ehGame && _ehGame.connState, '接管后新 _ehGame 已建立');

// ── 旅程 4: 验证接管后状态连续 ──
const newHost = _ehGame;
eq(newHost.state().handNo, 3, '接管后 handNo=3(不重置为 0)');
eq(newHost.state().pot, hostPot, '接管后 pot 连续(不重置)');
eq(newHost.stacks().length, 2, '接管后席位数不变');
assert(newHost.stacks()[0] < 1000, '接管后 host 席筹码连续(非重置 1000)');
eq(newHost.lastSnap() && newHost.lastSnap().handNo, 3, '接管后新 host 快照 handNo=3');

// ── 旅程 5: 验证接管后立刻 resync 广播 ──
eq(newHost.resyncCalls(), 1, '接管完成后 resync() 被调用一次(广播快照给 guest)');
assert(!!row._lastBroadcast, '接管后新 host 广播了一帧快照给 guest');
eq(row._lastBroadcast.handNo, 3, '广播的快照 handNo=3');

// ── 旅程 6: 验证接管期间 guest action 重试不报错 ──
// 模拟: 引擎转移窗口内, guest 发 action, RPC 首次返回 ok===false(host 还没接管完);
//       2s(压缩50ms)后重发, 此时新 host 已在线, RPC 返回 ok===true → 不报错。
_toastLog = []; _rpcCalls = 0;
let rpcAttempt = 0;
const rpc = ()=> Promise.resolve({ data: { ok: ++rpcAttempt===1 ? false : true } });
// 转移窗口: 首次 connState=host_offline; 重发时已恢复 online
let _conn = 'host_offline';
const connStateFn = ()=> _conn;
// 异步: 重试时切回 online
setTimeout(()=>{ _conn = 'online'; }, 30);

gtGuestSendAct(rpc, connStateFn, 1);

// 等重试窗口结束(50ms 重试 + 余量)
setTimeout(()=>{
  eq(_rpcCalls, 2, '转移窗口内 action 被重试一次(共发起2次 RPC)');
  eq(_toastLog.length, 0, '接管期间 action 重试成功, 未弹出"出牌没成功"报错');

  // 对照: 非转移窗口(online) + ok===false → 立刻报错, 不重试
  _toastLog = []; _rpcCalls = 0; rpcAttempt = 0;
  const rpc2 = ()=> Promise.resolve({ data: { ok:false } });
  gtGuestSendAct(rpc2, ()=> 'online', 1);
  setTimeout(()=>{
    eq(_rpcCalls, 1, '非转移窗口 ok===false 不重试(只发1次)');
    eq(_toastLog.length, 1, '非转移窗口 ok===false 立刻报错');
    assert(/出牌没成功/.test(_toastLog[0]), '报错文案含"出牌没成功"');

    if (failed){ console.error('\n✗ 旅程未通过'); process.exit(1); }
    console.log('\n✅ host 离场引擎转移旅程通过: 状态恢复 + 接管后广播 + action 重试均验证。');
  }, 80);
}, 120);
