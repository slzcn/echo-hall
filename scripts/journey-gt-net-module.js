#!/usr/bin/env node
'use strict';
/* journey-gt-net-module.js — 联机纯逻辑迁出 app.js → modules/gt-net.js */
const fs=require('fs'), path=require('path');
const pathMod=path.join(__dirname,'..','js/modules/gt-net.js');
const src=fs.readFileSync(pathMod,'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
const idx=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const gdAi=fs.readFileSync(path.join(__dirname,'..','js/games/guandan-ai.js'),'utf8');
const ddzAi=fs.readFileSync(path.join(__dirname,'..','js/games/ddz-ai.js'),'utf8');

let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/EH_GT_NET_MODULE/.test(src) && /createGtNet/.test(src), 'modules/gt-net.js 导出 createGtNet');
assert(/acceptMove/.test(src) && /stamp/.test(src) && /sendAct/.test(src), 'gt-net 提供 stamp/acceptMove/sendAct');
assert(/EH_GT_NET_MODULE/.test(app), 'app.js 使用 _EH_GT_NET 模块');
assert(/modules\/gt-net\.js/.test(idx), 'index.html 挂载 gt-net.js');
assert(/uid_mismatch|String\(payloadUid\)/.test(src), 'acceptMove 含 uid 反冒名');
assert(/b\.cards\.length - a\.cards\.length/.test(gdAi), '掼蛋提示: 同分多清散牌');
assert(/b\.cards\.length - a\.cards\.length/.test(ddzAi), '斗地主提示: 同分多清散牌');

console.log('\n'+(failed?'❌ 有失败':'✅ gt-net 迁移 + 提示增强契约通过'));
process.exit(failed?1:0);
