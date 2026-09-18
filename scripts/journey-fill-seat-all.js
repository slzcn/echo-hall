#!/usr/bin/env node
'use strict';
/* journey-fill-seat-all.js — 三游戏补位同型 + 联机 uid 反冒名 + score 模块 */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const ddz=R('js/games/game-ui.js');
const gd=R('js/games/guandan-ui.js');
const pk=R('js/games/poker-ui.js');
const app=R('js/app.js');
const score=R('js/modules/score.js');
const idx=R('index.html');
const sql=R('sql/eh_gt_act.sql');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

console.log('\n── 补位同型(灵魂优先) ──');
assert(/function fillSeat\(/.test(ddz) && /function freeSoulsForSeat\(/.test(ddz), '斗地主 fillSeat + 灵魂优先');
assert(/function fillSeat\(/.test(gd) && /function freeSoulsForSeat\(/.test(gd), '掼蛋 fillSeat + 灵魂优先');
assert(/function fillSeat\(/.test(pk), '德州 fillSeat');
assert(/data-fill/.test(ddz) && /data-fill/.test(gd) && /data-fill/.test(pk), '三桌菜单单一补位入口');

console.log('\n── 联机反冒名 ──');
assert(/payload\.uid/.test(app) && /payloadUid/.test(app), 'host 校验 act.uid 与 DB 座位一致');
assert(/uid:myUid/.test(app), 'guest 发送 act 附带 uid');
assert(/eh_gt_act/.test(sql) && /auth\.uid\(\)/.test(sql), 'phase-2 RPC 脚本已落地(sql/eh_gt_act.sql)');

console.log('\n── score 模块迁移 ──');
assert(/EH_SCORE_MODULE/.test(score) && /createScoreBank/.test(score), 'js/modules/score.js 账本模块');
assert(/modules\/score\.js/.test(idx), 'index.html 已挂载 score.js');
assert(/_EH_SCORE/.test(app) && /function bankGet\(/.test(app), 'app.js 兼容别名委托模块');
assert(/EH_BANK_GET/.test(app), 'EH_BANK_* 仍导出给 game-ui');

console.log('\n── 生涯可见 ──');
assert(/生涯/.test(pk) && /EH_BANK_GET/.test(pk), '德州结算行含生涯 net');
assert(/showCareerChip\('doudizhu'/.test(app) && /showCareerChip\('guandan'/.test(app), '斗地主/掼蛋结算后 toast 生涯');

console.log('\n'+(failed?'❌ 有失败':'✅ 全量改进契约通过'));
process.exit(failed?1:0);
