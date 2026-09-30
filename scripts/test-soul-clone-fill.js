#!/usr/bin/env node
'use strict';
// 灵魂分身补位 planner 单测: 锁住 gtSeatSoulsIntoEmpties 的两段补位算法 ——
//   pass1 真灵魂一席一位; pass2 灵魂不够时借在场灵魂克隆"分身"填满(轮流复用, 每原灵魂序号自增, 首个不带号)。
// 同时对 app.js 源码断言该机制真的接上 eh_gt_seat_clone(p_seq)、且 seats 有序空位从小到大。
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');

// —— 与 app.js gtSeatSoulsIntoEmpties 同构的纯算法(只产出 RPC 调用序列, 不落网络) ——
function planSeatFill(seats, roomSouls, myUid){
  const seated=new Set((seats||[]).filter(s=>s&&s.kind==='soul'&&s.uid).map(s=>s.uid));
  const empties=(seats||[]).filter(s=>s&&s.kind==='empty'&&typeof s.seat==='number').map(s=>s.seat).sort((a,b)=>a-b);
  const souls=(roomSouls||[]).filter(s=>s&&s.auth_uid&&s.auth_uid!==myUid&&!seated.has(s.auth_uid));
  const calls=[]; let ei=0; const origins=[];
  for(;ei<empties.length&&ei<souls.length;ei++){
    calls.push({rpc:'eh_gt_seat_soul',seat:empties[ei],uid:souls[ei].auth_uid});
    origins.push(souls[ei].auth_uid);
  }
  if(ei<empties.length){
    let pool=origins.slice();
    if(!pool.length) pool=(roomSouls||[]).filter(s=>s&&s.auth_uid&&s.auth_uid!==myUid).map(s=>s.auth_uid);
    if(pool.length){
      const seq={};
      for(let k=0; ei<empties.length; ei++, k++){
        const origin=pool[k%pool.length];
        seq[origin]=(seq[origin]||0)+1;
        calls.push({rpc:'eh_gt_seat_clone',seat:empties[ei],origin,seq:seq[origin]});
      }
    }
  }
  return calls;
}
// 分身展示名(与 SQL 一致: 首个"·分身", ≥2 带序号)
const disp=(name,seq)=> name+'·分身'+(seq>1?String(seq):'');

let pass=0,fail=0;
function eq(a,b,msg){ const ok=JSON.stringify(a)===JSON.stringify(b); if(ok)pass++;else{fail++;console.log('❌',msg,'\n   得到',JSON.stringify(a),'\n   期望',JSON.stringify(b));} }
function ok(c,msg){ if(c)pass++;else{fail++;console.log('❌',msg);} }

const HOST='host-uid';
const S=(seat,kind,uid)=>({seat,kind,uid});
const empty=seat=>({seat,kind:'empty'});
const host=seat=>({seat,kind:'human',uid:HOST});

// 场景1: 4席掼蛋, host@0, 空1/2/3, 3真灵魂 → 全真灵魂, 无分身
eq(planSeatFill([host(0),empty(1),empty(2),empty(3)],
   [{auth_uid:'a'},{auth_uid:'b'},{auth_uid:'c'}],HOST),
   [{rpc:'eh_gt_seat_soul',seat:1,uid:'a'},{rpc:'eh_gt_seat_soul',seat:2,uid:'b'},{rpc:'eh_gt_seat_soul',seat:3,uid:'c'}],
   '场景1 三灵魂全真身入座');

// 场景2: 4席, host@0, 空1/2/3, 仅1真灵魂 → seat1真身, seat2/3=该灵魂分身 seq1,2
eq(planSeatFill([host(0),empty(1),empty(2),empty(3)],[{auth_uid:'a'}],HOST),
   [{rpc:'eh_gt_seat_soul',seat:1,uid:'a'},
    {rpc:'eh_gt_seat_clone',seat:2,origin:'a',seq:1},
    {rpc:'eh_gt_seat_clone',seat:3,origin:'a',seq:2}],
   '场景2 单灵魂→真身+两分身(seq1,2)');
eq(disp('狼姐',1),'狼姐·分身','分身首个不带序号');
eq(disp('狼姐',2),'狼姐·分身2','分身第二个带序号2');

// 场景3: 4席, host@0, 空1/2/3, 2真灵魂 → seat1/2真身, seat3=灵魂a的分身(轮流从a起)
eq(planSeatFill([host(0),empty(1),empty(2),empty(3)],[{auth_uid:'a'},{auth_uid:'b'}],HOST),
   [{rpc:'eh_gt_seat_soul',seat:1,uid:'a'},{rpc:'eh_gt_seat_soul',seat:2,uid:'b'},
    {rpc:'eh_gt_seat_clone',seat:3,origin:'a',seq:1}],
   '场景3 两灵魂→两真身+1分身(轮到a)');

// 场景4: 房里0灵魂 → 无任何调用(空位留给 eh_gt_start 机器人兜底)
eq(planSeatFill([host(0),empty(1),empty(2),empty(3)],[],HOST),[],'场景4 无灵魂→零调用(交机器人兜底)');

// 场景5: 3席斗地主, host@0, 灵魂'x'已坐 seat1(不该重复坐), 仅 seat2 空 + 1个新灵魂'a' → seat2 坐真身a, 无分身
eq(planSeatFill([host(0),S(1,'soul','x'),empty(2)],[{auth_uid:'x'},{auth_uid:'a'}],HOST),
   [{rpc:'eh_gt_seat_soul',seat:2,uid:'a'}],
   '场景5 已坐灵魂不重坐+唯一空位坐新真身(真身够则不克隆)');

// 场景5b: host@0, 灵魂'x'已坐 seat1, 空2/3, 无其它真灵魂 → 克隆池退回房里全部灵魂[x]→seat2/3=x分身1,2
eq(planSeatFill([host(0),S(1,'soul','x'),empty(2),empty(3)],[{auth_uid:'x'}],HOST),
   [{rpc:'eh_gt_seat_clone',seat:2,origin:'x',seq:1},{rpc:'eh_gt_seat_clone',seat:3,origin:'x',seq:2}],
   '场景5b 真身全已坐→余位克隆退回全名册(x分身1,2)');

// 场景6: 排除自己(myUid 在 roomSouls 里不应被坐)
eq(planSeatFill([host(0),empty(1)],[{auth_uid:HOST},{auth_uid:'a'}],HOST),
   [{rpc:'eh_gt_seat_soul',seat:1,uid:'a'}],'场景6 自己不入座');

// —— app.js 源码结构断言 ——
const src=fs.readFileSync(path.join(ROOT,'js/app.js'),'utf8');
ok(/eh_gt_seat_clone/.test(src) && /p_seq:seq\[origin\]/.test(src),'app.js 调 eh_gt_seat_clone 且传 p_seq');
ok(/pass1/.test(src) && /pass2/.test(src),'app.js 保留两段补位注释锚点');
ok(/origins\.push\(souls\[ei\]\.auth_uid\)/.test(src),'app.js pass1 记录克隆源 origins');
ok(/seq\[origin\]=\(seq\[origin\]\|\|0\)\+1/.test(src),'app.js 每原灵魂分身序号自增');
ok(/empty'&&typeof s\.seat==='number'\)\.map\(s=>s\.seat\)\.sort/.test(src),'app.js 空位从小到大有序补');

console.log(`\n通过 ${pass} · 失败 ${fail}`);
process.exit(fail?1:0);
