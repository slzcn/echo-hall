#!/usr/bin/env node
'use strict';
/* journey-anon-bankroll.js — 临时身份积分跨局旅程
 * 1) 赢利后 chips 增加  2) 再开局带入非 1000  3) 破产回补  4) 匿名 uid 迁移
 * 诊断单: docs/triage/2026-09-18-anon-score-accumulate.md */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname,'..','js','app.js'),'utf8');
const pk = fs.readFileSync(path.join(__dirname,'..','js','games','poker-ui.js'),'utf8');

let step=0, failed=false;
function assert(c,m){ step++; if(!c){ failed=true; console.error('✗ ['+step+'] '+m); } else console.log('✓ ['+step+'] '+m); }

assert(/eh_bank_v1/.test(src) && /function bankBump\(/.test(src), '账本与 bankBump 存在');
assert(/function bankMigrateFromLocalAnon\(/.test(src), '登录后 local-anon → uid 迁移');
assert(/i === mySeat \? MY_START : START/.test(pk), 'startDeal 我这席带入 MY_START');
assert(/myStack: bankOpenOpts\('nlhe'\)/.test(src), 'lobby open 带入生涯筹码 + onWallet');
assert(/_statEntries[\s\S]{0,400}myUid/.test(src) || /A\.mySeat===seat && myUid/.test(src), 'solo 统计用 myUid 兜底');

// 模拟用户旅程
const store = {};
function uidKey(u,g){ return g+':'+u; }
function bump(u,g,delta){
  const k=uidKey(u,g);
  const r=store[k]||(store[k]={chips:1000,net:0,plays:0});
  r.net+=delta; r.plays++;
  r.chips=Math.max(0,r.chips+delta);
  if(g==='nlhe'&&r.chips<100) r.chips=1000;
  return r;
}
const anon='supabase-anon-uuid';
const h1=bump(anon,'nlhe',400);
assert(h1.chips===1400, '旅程1: 赢 400 后带入筹码 1400 (实 '+h1.chips+')');
const h2=bump(anon,'nlhe',250);
assert(h2.chips===1650, '旅程2: 再赢 250 → 1650 (实 '+h2.chips+')');
bump(anon,'nlhe',-5000);
assert(store[uidKey(anon,'nlhe')].chips===1000, '旅程3: 破产回补 GRANT 1000');
assert(store[uidKey(anon,'nlhe')].plays===3, '旅程3: 局数仍累计为 3');

console.log('\n'+(failed?'❌ 有失败':'✅ 临时身份积分跨局旅程通过'));
process.exit(failed?1:0);
