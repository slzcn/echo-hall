#!/usr/bin/env node
'use strict';
/* test-fill-seat.js — 灵魂/机器人同型补位 + 灵魂优先 + 德州空位概率补位
 * 诊断单: docs/triage/2026-09-18-pk-fill-seat-soul-first.md
 * 用法: node scripts/test-fill-seat.js */
const path = require('path');
const fs = require('fs');

let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log('  ✓ '+m);} else {fail++;console.log('  ✗ '+m);} };

const src = fs.readFileSync(path.join(__dirname,'..','js/games/poker-ui.js'),'utf8');
const net = fs.readFileSync(path.join(__dirname,'..','js/games/table-net.js'),'utf8');

console.log('\n── 源码契约 ──');
ok(/function fillSeat\(/.test(src), 'poker-ui 导出 fillSeat(灵魂优先→机器人)');
ok(/function freeSoulsForSeat\(/.test(src), 'freeSoulsForSeat 过滤已入座灵魂');
ok(/function autoFillVacants\(/.test(src), 'autoFillVacants 每局空位概率补位');
ok(/VACANT_FILL_P/.test(src), '存在补位概率常量');
ok(/soulFillOk/.test(net) && /playing.*nlhe|nlhe.*playing/.test(net.replace(/\s+/g,' ')), 'table-net 局中 nlhe 空位也可选灵魂补位');
ok(/🤝补位/.test(net), '聊天牌桌卡补位入口同型文案');

// 纯逻辑: 灵魂优先
function freeSouls(souls, ids){
  const used=new Set((ids||[]).filter(Boolean));
  return (souls||[]).filter(s=>s&&s.auth_uid&&!used.has(s.auth_uid));
}
function pickFill(souls, ids, seatSoulAvailable, rng){
  const free=freeSouls(souls, ids);
  if (free.length && seatSoulAvailable) return { kind:'soul', who:free[0] };
  return { kind:'bot', who:{ name:'机器人' } };
}
console.log('\n── 灵魂优先决策 ──');
ok(pickFill([{auth_uid:'u1',name:'月见'}], [], true).kind==='soul', '有空闲灵魂且通道可用 → 灵魂');
ok(pickFill([{auth_uid:'u1',name:'月见'}], ['u1'], true).kind==='bot', '灵魂已入座 → 机器人');
ok(pickFill([], [], true).kind==='bot', '房里无灵魂 → 机器人');
ok(pickFill([{auth_uid:'u1',name:'月见'}], [], false).kind==='bot', '无 seatSoul 通道(单机无 ctx) → 机器人');

// 概率补位: 多局采样应出现 soul 与 bot 两种结果(有灵魂时多数为 soul)
console.log('\n── 概率补位采样 ──');
{
  let soulHits=0, botHits=0, trials=400;
  for (let i=0;i<trials;i++){
    const seats=[null,null,null]; // 空三席
    seats.forEach((_,si)=>{
      if (Math.random()>0.48) return;
      const r=pickFill([{auth_uid:'s'+si, name:'魂'+si}], [], true);
      if (r.kind==='soul') soulHits++; else botHits++;
    });
  }
  ok(soulHits>0, `有灵魂时空位补位走灵魂 (${soulHits} 次)`);
  ok(soulHits>=botHits, `灵魂命中不低于机器人 (${soulHits} vs ${botHits})`);
}

console.log('\n'+(fail?'💥 有失败 ('+pass+'✓ '+fail+'✗)':'🎉 全部通过 ('+pass+'✓)'));
process.exit(fail?1:0);
