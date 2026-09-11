#!/usr/bin/env node
'use strict';
/* 引擎单测: 全下短路(其余人全 all-in 后不再逐街让唯一活人空过) + 正常下注轮不受影响。
 * 用法: node scripts/test-poker-allin.js */
const E = require('../js/games/poker-engine.js');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;} else {fail++; console.log('  ✗ '+m);} };

// ── 场景1: 甲乙全下, 我跟平 → 应直接跑完到摊牌, 翻/转/河都不再问我过牌 ──
{
  const st = E.createGame({ names:['我','甲','乙'], isAI:[false,false,false],
    stacks:[1000,50,50], sb:5, bb:10, button:0, seed:'allin-1', actionBias:0 });
  ok(st.toAct===0, '开局轮到我(button 后首行动)');
  E.applyAction(st,0,'call');           // 我跟 10
  E.applyAction(st,1,'allin');          // 甲全下到 50
  ok(st.toAct===2, '甲全下后轮到乙');
  E.applyAction(st,2,'allin');          // 乙全下到 50
  ok(st.toAct===0, '乙全下后轮回我(我还欠注 → 保留 跟/弃 决策)');
  const la = E.legalActions(st,0);
  ok(la.toCall===40 && la.canFold===true, '我面对 all-in: 需跟40 且可弃牌');

  // 我跟平后: 除我外都 all-in, 我已无需跟注 → 不该再逐街让我过牌, 直接摊牌
  let myPromptsAfter=0;
  const before=st.street;
  E.applyAction(st,0,'call');           // 我跟到 50
  // 跑完过程中若还把 toAct 交回我(且非结束), 就是 bug
  ok(st.result!=null, '我跟平后本手立即判定(全下跑完), 不再逐街空过');
  ok(st.board.length===5, '公共牌已发满 5 张(runout 到河牌)');
  ok(st.phase==='over'||st.phase==='showdown', '进入摊牌/结束态 (实际:'+st.phase+')');
}

// ── 场景2(回归): 都还有筹码时, 翻牌圈过牌-过牌应正常推进, 不被短路误伤 ──
{
  const st = E.createGame({ names:['我','甲'], isAI:[false,false],
    stacks:[1000,1000], sb:5, bb:10, button:0, seed:'normal-1', actionBias:0 });
  // heads-up: button=SB=我(seat0), 甲=BB. 翻牌前我先行动。
  E.applyAction(st,0,'call');           // 我补齐到 10
  const bb=E.legalActions(st,1);
  ok(bb.canCheck===true && bb.canFold===true, 'BB 可过牌时【弃牌仍合法】(引擎不拦, UI 该放开)');
  E.applyAction(st,1,'check');          // 甲过牌 → 进翻牌
  ok(st.street==='flop', '双方到齐 → 进翻牌');
  ok(st.toAct>=0 && st.result==null, '翻牌圈仍需正常行动(未被全下短路误伤)');
  // 翻牌圈双过牌 → 进转牌
  const first=st.toAct;
  E.applyAction(st,first,'check');
  E.applyAction(st,(first+1)%2,'check');
  ok(st.street==='turn', '翻牌双过 → 进转牌');
}

console.log((fail? '❌':'✅')+` poker-allin: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
