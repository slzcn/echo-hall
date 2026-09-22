#!/usr/bin/env node
'use strict';
/* journey-eh-polish.js — 次日剩余提示 + 神曲叠播时长 + 全员筹码 */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const app=R('js/app.js'), sh=R('js/games/table-shared.css');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }
assert(/还可玩/.test(app), '每日剩余次数提示');
assert(/playSingingHybrid/.test(app), '神曲伴奏+人声');
assert(/hybrid-on/.test(app) && /hybrid-on/.test(sh), '叠播卡片标识');
assert(/mDur/.test(app) && /Math\.max\(vEst, mDur\)/.test(app), '叠播时长跟母版');
assert(/bankChipsOf\('nlhe', id, GRANT\)/.test(app), '远程真人/灵魂按 uid 带入筹码');
console.log('\n'+(failed?'❌ 有失败':'✅ EH 优化批次通过'));
process.exit(failed?1:0);
