#!/usr/bin/env node
'use strict';
/* #1 提示队友协作体检: 跟牌时若桌面是【队友/对家】领出, 提示不再教你压自己人。
 *   ① 对家领出 + 非残局 + 不能一把走完 → hints 返回空(建议让队友走)
 *   ② 对手领出 → hints 照常返回能压的牌(非空)
 *   ③ 对家领出但能一把走完 → hints 仍返回该一把走完的牌(终结本方胜)
 * 用法: node scripts/probe-hint-teammate.js */
const path=require('path');
const DDZ=require(path.join(__dirname,'..','js/games/ddz-ai.js'));
const DR =require(path.join(__dirname,'..','js/games/ddz-rules.js'));
const GD =require(path.join(__dirname,'..','js/games/guandan-ai.js'));
const GR =require(path.join(__dirname,'..','js/games/guandan-rules.js'));
let pass=0, fail=0; const ok=(c,m)=>{ if(c)pass++; else{fail++; console.log('  ✗ '+m);} };

// ── 斗地主 ──────────────────────────────────────────────
// 牌: {rank,id}. 我=seat0(农民), 地主=seat1, 队友=seat2.
const dcard=(rank,s)=>({rank,id:(s||'h')+rank});
(function ddz(){
  const hand=[6,7,8,9,10,11,12,13].map(r=>dcard(r));          // 8 张单, 非残局
  const target=DR.parse([dcard(5)]);                          // 桌面单张 5, 我能压
  const base={ seat:0, landlord:1, handsLeft:[8,10,9], log:[] };

  // ① 队友(seat2)领出 → 建议让牌, hints 空
  const hMate=DDZ.hints(hand, target, {...base, lastSeat:2});
  ok(hMate.length===0, 'ddz 队友领出→提示空(让队友走), 实得 '+hMate.length+' 手');

  // ①' 同一手牌【物理可压】(lastSeat=null, renderActBar 据此判 noBeat): 队友领出时协作提示虽空,
  //     但我客观压得过 → UI 必须显示"不出"而非谎报"要不起"(状态忠实红线)。
  const hCan=DDZ.hints(hand, target, {...base, lastSeat:null});
  ok(hCan.length>0, 'ddz 队友领出但物理可压→canBeat 非空(UI 显"不出"非"要不起"), 实得 '+hCan.length+' 手');

  // ② 地主(seat1)领出 → 照常给能压的牌
  const hOpp=DDZ.hints(hand, target, {...base, lastSeat:1});
  ok(hOpp.length>0, 'ddz 对手领出→提示非空(能压), 实得 '+hOpp.length+' 手');

  // ③ 队友领出但我能一把走完 → 仍推荐走完
  const hand3=[dcard(9),dcard(9,'s'),dcard(9,'d')];           // 仅剩一个三条=一把走完(跟单张? 需同型)
  //   桌面是三条 8 → 我三条 9 能压且是全部手牌
  const t3=DR.parse([dcard(8),dcard(8,'s'),dcard(8,'d')]);
  const hGo=DDZ.hints(hand3, t3, { seat:0, landlord:1, handsLeft:[3,10,9], log:[], lastSeat:2 });
  ok(hGo.length>0 && hGo[0].length===3, 'ddz 队友领出但能一把走完→仍推荐走完, 实得首手 '+(hGo[0]?hGo[0].length:0)+' 张');
})();

// ── 掼蛋 ────────────────────────────────────────────────
// 牌: {rank,suit,id}. 座位 %2 同组: 我=0, 对家=2(队友); 对手=1,3. level=3, 避开♥3百搭.
let gid=0; const gc=(rank,suit)=>({rank,suit,id:'g'+(gid++)+'_'+suit+rank});
(function guandan(){
  const level=3;
  // 我手牌(非残局, 8 张): 含一对 9(♠♦) 能压桌面一对 7
  const hand=[gc(9,'♠'),gc(9,'♦'),gc(6,'♠'),gc(8,'♣'),gc(10,'♠'),gc(11,'♦'),gc(12,'♣'),gc(13,'♠')];
  const target=GR.parse([gc(7,'♠'),gc(7,'♦')], level);       // 桌面一对 7
  ok(!!target && target.type==='pair', '掼蛋 target 构造成一对 7 ('+(target&&target.type)+')');
  const base={ seat:0, level, handsLeft:[8,12,11,13] };

  // ① 对家(seat2)领出 → 空
  const hMate=GD.hints({ hand, tableParse:target, ...base, lastSeat:2 });
  ok(hMate.length===0, '掼蛋 对家领出→提示空(让对家走), 实得 '+hMate.length+' 手');

  // ①' 同一手牌【物理可压】(renderCtrl 的 plays 不带 lastSeat, 据此亮"提示"钮/判 mateLead 下不谎报):
  const hCan=GD.hints({ hand, tableParse:target, ...base });
  ok(hCan.length>0, '掼蛋 对家领出但物理可压→plays 非空(提示钮可点/不谎报压不过), 实得 '+hCan.length+' 手');

  // ② 对手(seat1)领出 → 非空
  const hOpp=GD.hints({ hand, tableParse:target, ...base, lastSeat:1 });
  ok(hOpp.length>0, '掼蛋 对手领出→提示非空(能压), 实得 '+hOpp.length+' 手');

  // ③ 缺 lastSeat(旧调用) → 退化为旧行为(非空), 不受影响
  const hLegacy=GD.hints({ hand, tableParse:target, ...base });
  ok(hLegacy.length>0, '掼蛋 缺 lastSeat→退化旧行为(非空), 实得 '+hLegacy.length+' 手');
})();

console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
