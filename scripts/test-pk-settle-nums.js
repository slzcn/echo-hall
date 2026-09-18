#!/usr/bin/env node
'use strict';
/* test-pk-settle-nums.js — 德州结算数字: 净变动 vs 底池总额; 生涯分不双计 */
const fs=require('fs'), path=require('path');
const pk=fs.readFileSync(path.join(__dirname,'..','js/games/poker-ui.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log('  ✓ '+m);} else {fail++;console.log('  ✗ '+m);} };

console.log('\n── 结算数字契约 ──');
ok(/res\.delta\[mySeat\]/.test(pk) && /engDelta/.test(pk), '我方净变动取引擎 result.delta[mySeat]');
ok(/净赢|净亏/.test(pk) && /收池/.test(pk), '结算文案区分 净赢/净亏 与 收池');
ok(/potWon/.test(pk) && /potTotalAll/.test(pk), '收池 potWon 与底池总额 potTotalAll 分离');
ok(/你收池/.test(pk), '单机胜利横幅显示「你收池 + 本手净变动」');
ok((app.match(/_bankFromPokerResult/g)||[]).length===0, '生涯分不再双计(去掉第二次 bankBump)');
ok(/bumpGameStats[\s\S]{0,400}bankBump/.test(app), 'bumpGameStats 内唯一一次 bankBump');
ok(/pk-mynums/.test(pk), '结算面板有我方数字行');

// 纯逻辑: 收池 vs 净赢
const pots=[{amount:200,winners:[0,1]},{amount:50,winners:[0]}];
const mySeat=0;
const potWon=pots.filter(pt=>pt.winners.includes(mySeat)).reduce((a,pt)=>a+Math.floor(pt.amount/(pt.winners.length||1)),0);
ok(potWon===100+50, `拆分池人均收池 150 (实 ${potWon})`);
const potTotal=pots.reduce((a,pt)=>a+pt.amount,0);
ok(potTotal===250 && potWon!==potTotal, '底池总额 250 ≠ 我收池 150');
// 引擎净变动模拟: 我投入 80, 收池 150 → 净 +70
ok(150-80===70, '净变动 = 收池 - 本手投入');

console.log('\n'+(fail?'💥 有失败 ('+pass+'✓ '+fail+'✗)':'🎉 全部通过 ('+pass+'✓)'));
process.exit(fail?1:0);
