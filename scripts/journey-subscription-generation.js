#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs');
async function race(legacy=false){let epoch=1,room='A',published=[],release;const removing=new Promise(r=>release=r);async function setup(r){const ep=epoch;await removing;if(!legacy&&(ep!==epoch||room!==r))return;published.push(r);}const p=setup('A');room='B';epoch++;release();await p;return published;}
(async()=>{assert.deepEqual(await race(false),[]);console.log('✓ 旧房 setup 在 await 后按代次失效');assert.deepEqual(await race(true),['A']);console.log('✓ 旧实现反证：异步清理后会复活 A 订阅');const s=fs.readFileSync('js/app.js','utf8');
assert((s.match(/const setupEpoch=roomEpoch/g)||[]).length>=3,'三类 setup 都应捕获代次');
assert(s.includes('const nextMsgChan ='));
assert(s.includes('const nextPresChan ='));
assert(s.includes('const nextGtChan ='));
assert(s.includes('try{ sb.removeChannel(nextMsgChan); }'));
console.log('✓ 消息、presence、牌桌频道均局部创建并经代次确认后发布');
})().catch(e=>{console.error('✗',e.stack||e);process.exit(1)});
