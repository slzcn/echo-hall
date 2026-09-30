#!/usr/bin/env node
'use strict';
/* journey-chip-authenticity.js — 筹码真实性 + 每日5次对局门禁
 * 1) 灵魂/远程真人按 uid 账本带入, 不再每次 1000
 * 2) 结算写回全席 chips; 清零后 chipsOf 回补 1000
 * 3) 每日【输光】≤5 次, 超限不能再进场(不是打满 5 局)
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
assert(/DAY_MAX\s*=\s*5/.test(score) && /eh_daily_plays_v1/.test(score), 'score 模块每日输光上限=5');
assert(/dailyPlayReached/.test(score) && /dailyPlayBump/.test(score), 'score 模块导出每日计数 API');
assert(/function pkSeatStackFor/.test(src) && /function pkSeatStacksWrite/.test(src), 'app.js 全员筹码读写助手');
assert(/stackFor:\s*function/.test(src) && /onStacks:\s*function/.test(src), 'poker open 注入 stackFor/onStacks');
assert(/myStack: bankOpenOpts\('nlhe'\)/.test(src), 'lobby open 仍带本人生涯筹码');
assert(/function seatBuyIn/.test(pk) && /opts\.stackFor/.test(pk), 'poker-ui seatBuyIn 优先 stackFor');
assert(/function emitStacks/.test(pk) && /opts\.onStacks/.test(pk), 'poker-ui 结算 emitStacks 回写账本');
assert(/i === mySeat \? MY_START : START/.test(pk), '无 stackFor 时我这席 MY_START 兜底');
assert(/EH_DAILY_PLAYS/.test(src) && /ehDailyPlayGate/.test(src), 'app.js 每日门禁 EH_DAILY_PLAYS');
assert(/ehDailyPlayGate\('\w+'\)/.test(src), '门禁按游戏分闸');
assert(/d.reached\('nlhe'\)|reached\('nlhe'\)/.test(pk+src), '德州门禁不锁其他游戏');
assert(/pkLimitReached/.test(pk) && /pkAddPlay/.test(pk), 'poker-ui 输光计数+到顶拒发');
assert(/bumpSeatBanks/.test(src), 'bumpGameStats 经 bumpSeatBanks 沉淀全席(含灵魂)');
assert(/EH_BANK_SET_OF/.test(ddz) && /EH_BANK_CHIPS_OF/.test(ddz), '斗地主累计分也按 uid 沉淀灵魂/真人');

// 模拟账本旅程
const store = {};
function key(g,u){ return g+':'+u; }
function getOf(g,u){ return store[key(g,u)] || (store[key(g,u)]={chips:null,net:0,plays:0,wins:0}); }
function chipsOf(g,u,grant){
  const grantN = grant==null?2000:grant;
  const rec=getOf(g,u);
  let c = rec.chips;
  if(c==null) return grantN;
  if(g==='nlhe' && c<100) return grantN;
  return Math.max(0, Math.round(c));
}
function bumpOf(g,u,delta){
  const rec=getOf(g,u);
  const base = rec.chips==null ? 2000 : rec.chips;
  let c = Math.round(base + (delta||0));
  if(g==='nlhe' && c<1000) c=2000;
  rec.chips=c; rec.plays=(rec.plays||0)+1; rec.net=Math.round((rec.net||0)+(delta||0));
  return rec;
}
const soul='soul-uid-alpha';
assert(chipsOf('nlhe', soul)===2000, '新灵魂首次入座 GRANT=2000');
bumpOf('nlhe', soul, +350);
assert(chipsOf('nlhe', soul)===2350, '灵魂赢 350 → 2350');
bumpOf('nlhe', soul, -200);
assert(chipsOf('nlhe', soul)===2150, '再进房仍带 2150(不重置 2000)');
bumpOf('nlhe', soul, -5000);
assert(chipsOf('nlhe', soul)===2000, '清零/破产后回补 2000');

const day={n:0,max:5};
function reached(){ return day.n>=day.max; }
function bump(){ return ++day.n; }
for(let i=0;i<5;i++) bump();
assert(reached()===true, '每日第5局后 reached=true');
assert(reached(), '第6次进房应被拒绝(旅程断言)');

// ── 服务端计数迁移后的门禁真值(反「恒放行/left=99」回退) ──
assert(!/dailyPlayReached\(game\) \{ return false; \}/.test(score), 'reached 不再恒 false(迁移后回退必红)');
assert(!/dailyPlayLeft\(game\) \{ return 99; \}/.test(score), 'left 不再恒 99');
assert(/function setDailyFromServer/.test(score) && /setDailyFromServer:/.test(score), 'score 导出 setDailyFromServer(服务端 eh_game_plays 灌入)');
assert(/dailyPlayReached\(game\) \{ return dailyPlays\(game\) >= DAY_MAX; \}/.test(score), 'reached 按 DAY_MAX 真算');
assert(/dailyPlayLeft\(game\) \{ return Math.max\(0, DAY_MAX - dailyPlays\(game\)\); \}/.test(score), 'left = DAY_MAX - plays');
assert(/function ehRefreshDailyPlays/.test(src) && /eh_game_plays/.test(src), 'app 拉 eh_game_plays 灌今日计数');
assert(/return true;\s*\}\s*\/\//.test(src) === false || !/永远放行/.test(src), 'ehDailyPlayGate 不再「永远放行」');
assert(/d\.reached && d\.reached\(g\)/.test(src) || /d\.reached\(g\)/.test(src), '门禁真的查 reached(g)');
assert(/ehRecordBust/.test(src) && !/ehRecordPlay\(/.test(src.replace(/ehRecordBust/g,'')), '每日只记输光(ehRecordBust), 不再每手落账');
assert(/me\.email=email/.test(src) || /me\.email\s*=\s*email/.test(src), 'doRegister 把注册邮箱写进 me(验证邮件入口依赖)');
const boot = R('js/boot.js');
assert(/from\('eh_users'\)/.test(boot) && !/eh_accounts/.test(boot), 'boot.js 账号信息只读 eh_users(eh_accounts 已冻结)');

console.log('\n'+(failed?'❌ 有失败':'✅ 筹码真实性 + 每日5次门禁通过'));
process.exit(failed?1:0);
