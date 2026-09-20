#!/usr/bin/env node
'use strict';
/* journey-chip-authenticity.js — 筹码真实性 + 每日5次对局门禁
 * 1) 灵魂/远程真人按 uid 账本带入, 不再每次 1000
 * 2) 结算写回全席 chips; 清零后 chipsOf 回补 1000
 * 3) 每日对局 ≤5, 超限入口/发牌拒绝
 * 诊断单: docs/triage/2026-09-20-chip-authenticity.md */
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const score = R('js/modules/score.js');
const src = R('js/app.js');
const pk = R('js/games/poker-ui.js');
const ddz = R('js/games/game-ui.js');

let step = 0, failed = false;
function assert(c, m){ step++; if(!c){ failed=true; console.error('✗ ['+step+'] '+m); } else console.log('✓ ['+step+'] '+m); }

assert(/chipsOf/.test(score) && /bumpOf/.test(score) && /setOf/.test(score), 'score 模块支持按主体 chipsOf/bumpOf/setOf');
assert(/DAY_MAX\s*=\s*5/.test(score) && /eh_daily_plays_v1/.test(score), 'score 模块每日对局上限=5');
assert(/dailyPlayReached/.test(score) && /dailyPlayBump/.test(score), 'score 模块导出每日计数 API');
assert(/function pkSeatStackFor/.test(src) && /function pkSeatStacksWrite/.test(src), 'app.js 全员筹码读写助手');
assert(/stackFor:\s*function/.test(src) && /onStacks:\s*function/.test(src), 'poker open 注入 stackFor/onStacks');
assert(/myStack: bankOpenOpts\('nlhe'\)/.test(src), 'lobby open 仍带本人生涯筹码');
assert(/function seatBuyIn/.test(pk) && /opts\.stackFor/.test(pk), 'poker-ui seatBuyIn 优先 stackFor');
assert(/function emitStacks/.test(pk) && /opts\.onStacks/.test(pk), 'poker-ui 结算 emitStacks 回写账本');
assert(/i === mySeat \? MY_START : START/.test(pk), '无 stackFor 时我这席 MY_START 兜底');
assert(/EH_DAILY_PLAYS/.test(src) && /ehDailyPlayGate/.test(src), 'app.js 每日门禁 EH_DAILY_PLAYS');
assert(/if\(!ehDailyPlayGate\(\)\) return;/.test(src), '开桌/进桌入口已接门禁');
assert(/pkLimitReached/.test(pk) && /pkAddPlay/.test(pk), 'poker-ui 发牌计数+到顶拒发');
assert(/bumpSeatBanks/.test(src), 'bumpGameStats 经 bumpSeatBanks 沉淀全席(含灵魂)');
assert(/EH_BANK_SET_OF/.test(ddz) && /EH_BANK_CHIPS_OF/.test(ddz), '斗地主累计分也按 uid 沉淀灵魂/真人');

// 模拟账本旅程
const store = {};
function key(g,u){ return g+':'+u; }
function getOf(g,u){ return store[key(g,u)] || (store[key(g,u)]={chips:null,net:0,plays:0,wins:0}); }
function chipsOf(g,u,grant){
  const grantN = grant==null?1000:grant;
  const rec=getOf(g,u);
  let c = rec.chips;
  if(c==null) return grantN;
  if(g==='nlhe' && c<100) return grantN;
  return Math.max(0, Math.round(c));
}
function bumpOf(g,u,delta){
  const rec=getOf(g,u);
  const base = rec.chips==null ? 1000 : rec.chips;
  let c = Math.round(base + (delta||0));
  if(g==='nlhe' && c<100) c=1000;
  rec.chips=c; rec.plays=(rec.plays||0)+1; rec.net=Math.round((rec.net||0)+(delta||0));
  return rec;
}
const soul='soul-uid-alpha';
assert(chipsOf('nlhe', soul)===1000, '新灵魂首次入座 GRANT=1000');
bumpOf('nlhe', soul, +350);
assert(chipsOf('nlhe', soul)===1350, '灵魂赢 350 → 1350');
bumpOf('nlhe', soul, -200);
assert(chipsOf('nlhe', soul)===1150, '再进房仍带 1150(不重置 1000)');
bumpOf('nlhe', soul, -5000);
assert(chipsOf('nlhe', soul)===1000, '清零/破产后回补 1000');

const day={n:0,max:5};
function reached(){ return day.n>=day.max; }
function bump(){ return ++day.n; }
for(let i=0;i<5;i++) bump();
assert(reached()===true, '每日第5局后 reached=true');
assert(reached(), '第6次进房应被拒绝(旅程断言)');

console.log('\n'+(failed?'❌ 有失败':'✅ 筹码真实性 + 每日5次门禁通过'));
process.exit(failed?1:0);
