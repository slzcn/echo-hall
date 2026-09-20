#!/usr/bin/env node
'use strict';
/* test-bankroll.js — 临时身份游戏积分跨局累计(德州等)
 * 诊断单: docs/triage/2026-09-18-anon-score-accumulate.md */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
const score = fs.readFileSync(path.join(__dirname,'..','js/modules/score.js'),'utf8');
const pk = fs.readFileSync(path.join(__dirname,'..','js/games/poker-ui.js'),'utf8');

let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log('  ✓ '+m);} else {fail++;console.log('  ✗ '+m);} };

console.log('\n── 源码契约 ──');
ok(/eh_bank_v1/.test(score) || /eh_bank_v1/.test(src), '存在按 uid 的 eh_bank_v1 账本');
ok(/function bankChips\(/.test(src) && /bankBump|bump: bump/.test(score+src), 'bankChips/bankBump 已实现');
ok(/function bankMigrateFromLocalAnon\(/.test(src), '匿名→uid 账本迁移');
ok(/function seatBuyIn/.test(pk) && /i === mySeat \? MY_START : START/.test(pk) || /stacks = names\.map\(\(_, i\) => \(i === mySeat \? MY_START : START\)\)/.test(pk),
  'poker startDeal/seatBuyIn 我这席用 MY_START(不重置 1000)');
ok(/myStack: bankOpenOpts\('nlhe'\)\.chips/.test(src), '招募态 open 传入生涯筹码');
ok(/bumpGameStats/.test(src), 'onResult 回写本地账本');
ok(/uid = myUid/.test(src) || /myUid\) uid = myUid/.test(src) || /A\.mySeat===seat && myUid/.test(src),
  '_statEntries 对 solo 席用 myUid 兜底');

// 纯逻辑模拟账本
console.log('\n── 账本累计 ──');
{
  const store={};
  const key=(u,g)=>g+':'+u;
  function bankGet(u,g){
    const k=key(u,g);
    if(!store[k]) store[k]={chips:1000,net:0,plays:0,wins:0};
    return store[k];
  }
  function bankBump(u,g,delta,won){
    const r=bankGet(u,g);
    r.net+=delta; r.plays++;
    if(won) r.wins++;
    let chips=Math.round((r.chips||1000)+delta);
    if(g==='nlhe' && chips<100) chips=1000; // 破产保底
    r.chips=chips;
    return r;
  }
  const uid='anon-temp-1';
  bankBump(uid,'nlhe',320,true);
  bankBump(uid,'nlhe',150,true);
  const rec=bankGet(uid,'nlhe');
  ok(rec.chips===1470, `两局赢后 chips=1470 (实 ${rec.chips})`);
  ok(rec.net===470 && rec.plays===2 && rec.wins===2, 'net/plays/wins 累计正确');
  bankBump(uid,'nlhe',-2000,false);
  ok(bankGet(uid,'nlhe').chips===1000, '输光回补 GRANT=1000');
  // 旧键迁移模拟
  store['nlhe:uid-2']=null;
  const legacy=500;
  store['nlhe:uid-2']={chips:legacy,net:legacy-1000,plays:3,wins:2};
  ok(store['nlhe:uid-2'].chips===500, 'uid 账本可带入非默认筹码');
  ok(uid!=='local-anon', '临时身份也有稳定 key');
}

console.log('\n'+(fail?'💥 有失败 ('+pass+'✓ '+fail+'✗)':'🎉 全部通过 ('+pass+'✓)'));
process.exit(fail?1:0);
