#!/usr/bin/env node
'use strict';
/* journey-eh-polish.js — 次日剩余提示 + 神曲叠播时长 + 全员筹码 */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const app=R('js/app.js'), sh=R('js/games/table-shared.css');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }
assert(/还可输光/.test(app), '每日剩余输光次数提示');
// 开桌页常驻(主人点名: 不只在剩≤2时 toast): 斜杠菜单 + 三桌招募态 + 战绩卡都要有
assert(/ehDailyLeftBadge/.test(app) && /ehDailyLeftInline/.test(app), '每日剩余徽章助手');
// 斜杠菜单不再挂每日徽章/分组(主人: 太丑); 每日限制只留在三款开局门禁
assert(!/slash-grp/.test(app.split('function renderSlashMenu')[1]?.split('function pickSlash')[0]||''), '斜杠菜单无分组标题');
assert(/_slashList=SLASH_CMDS\.filter/.test(app) && !/ehDailyLeftBadge\(EH_GAME_KEY_BY_CMD/.test(app), '斜杠菜单不挂每日徽章');
assert(/ehDailyLeftInline\('doudizhu'\)/.test(app) && /ehDailyLeftInline\('guandan'\)/.test(app) && /ehDailyLeftInline\('nlhe'\)/.test(app), '三款战绩卡带每日剩余');
const gddz=R('js/games/game-ui.js'), gpk=R('js/games/poker-ui.js'), ggd=R('js/games/guandan-ui.js');
assert(/ehDailyLeftInline\('doudizhu'\)/.test(gddz), '斗地主招募态常驻每日剩余');
assert(/ehDailyLeftInline\('nlhe'\)/.test(gpk), '德州招募态常驻每日剩余');
assert(/ehDailyLeftInline\('guandan'\)/.test(ggd), '掼蛋招募态常驻每日剩余');
assert(/playSingingHybrid/.test(app), '神曲伴奏+人声');
// 神曲卡片更早标明形态, 减少"以为坏了"(主人点名)
assert(/song-kind/.test(app) && /AI 谱曲中/.test(app) && /伴奏\+人声 · 本地试听|清唱 · 本地试听/.test(app), '神曲卡片标明 AI 谱曲/伴奏+人声/本地试听');
assert(/AI 谱曲 · 本地试听/.test(app), '神曲曲风条标明 AI 谱曲·本地试听');
assert(/hybrid-on/.test(app) && /hybrid-on/.test(sh), '叠播卡片标识');
assert(/mDur/.test(app) && /Math\.max\(vEst, mDur\)/.test(app), '叠播时长跟母版');
assert(/bankChipsOf\('nlhe', id, GRANT\)/.test(app), '远程真人/灵魂按 uid 带入筹码');
// 关键路径空 catch 已接 ring buffer(ehDumpLog 可查)
assert(/_ehCatch\('gameLoad'/.test(app) && /_ehCatch\('gameRelaunch'/.test(app), '游戏加载失败进日志');
assert(/_ehCatch\('songToken'/.test(app) && /_ehCatch\('sendSong'/.test(app), '神曲发送/取 token 失败进日志');
assert(/_ehCatch\('resolveToken'/.test(app) && /_ehCatch\('saveIdentity'/.test(app), '会话/身份失败进日志');
assert(/_ehCatch\('ehDailyPlayGate'/.test(app) && /_ehCatch\('ehDailyLeftBadge'/.test(app), '每日局数路径进日志');
assert(/_ehCatch\('gtReap'/.test(app) && /_ehCatch\('gtSeatClone'/.test(app), '牌桌 RPC 失败进日志');
console.log('\n'+(failed?'❌ 有失败':'✅ EH 优化批次通过'));
process.exit(failed?1:0);
