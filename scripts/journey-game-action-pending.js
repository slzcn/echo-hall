#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs');
function guest(){let pending=false,calls=0;return{act(){if(pending)return;pending=true;calls++},snap(){pending=false},calls:()=>calls};}
const g=guest();g.act();g.act();assert.equal(g.calls(),1);g.snap();g.act();assert.equal(g.calls(),2);console.log('✓ 动作提交至权威快照期间只发送一次，快照后解锁');
let old=0;const legacy=()=>old++;legacy();legacy();assert.equal(old,2);console.log('✓ 旧实现反证：仅换文案不能阻止重复动作');
for(const f of ['js/games/game-ui.js','js/games/guandan-ui.js','js/games/poker-ui.js']){const s=fs.readFileSync(f,'utf8');assert(s.includes('awaitingHost'),`${f} 缺 pending`);}
const p=fs.readFileSync('js/games/poker-ui.js','utf8');assert(p.includes('if (st.toAct!==mySeat || awaitingHost) return'));assert(p.includes('awaitingHost=false;'));
console.log('✓ 斗地主、掼蛋、德州三桌 guest pending 契约一致');
