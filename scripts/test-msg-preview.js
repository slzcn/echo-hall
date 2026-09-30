#!/usr/bin/env node
'use strict';
/* test-msg-preview.js — 大厅房卡「最后一条消息」预览契约(主人: gt 牌桌卡被误显成海龟汤)
 * 联机牌桌卡 game|gt|<id>|<game> 必须按游戏显名, 不掉海龟汤兜底; 未知 game 事件中性兜底。
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ✓ '+m);} else {fail++; console.log('  ✗ '+m);} };

// 抠出 msgPreview 单跑(桩 parseSong / safeEmoji / _interactions)
const src = APP.slice(APP.indexOf('function msgPreview('), APP.indexOf('\n}', APP.indexOf('function msgPreview('))+2);
const sandbox = {
  parseSong: (t)=>({ lyric: String(t||'').split('|').slice(1).join('|') }),
  safeEmoji: (e)=>e||'', _interactions: [],
};
vm.createContext(sandbox);
vm.runInContext(src + '\nthis.msgPreview=msgPreview;', sandbox);
const P = sandbox.msgPreview;

console.log('\n── 联机牌桌卡 ──');
ok(P({kind:'game',text:'game|gt|abc|nlhe'})==='🎰 德州牌桌', '德州牌桌卡显名');
ok(P({kind:'game',text:'game|gt|abc|guandan'})==='🎴 掼蛋牌桌', '掼蛋牌桌卡显名');
ok(P({kind:'game',text:'game|gt|abc|ddz'})==='🃏 斗地主牌桌', '斗地主牌桌卡显名');
ok(P({kind:'game',text:'game|gt|abc|doudizhu'})==='🃏 斗地主牌桌', 'doudizhu 别名显名');
ok(!/海龟汤/.test(P({kind:'game',text:'game|gt|abc|nlhe'})), '牌桌卡不再掉海龟汤兜底');

console.log('\n── 战绩卡 ──');
ok(/德州扑克/.test(P({kind:'game',text:'game|nlhe|win|500|一对|1000|甲'})), '德州战绩显名');
ok(/斗地主/.test(P({kind:'game',text:'game|ddz|win|lord|20|1|1|0|0|1|甲'})), '斗地主战绩显名');
ok(/掼蛋/.test(P({kind:'game',text:'game|gd|win|1|2|3|0|0|0|0|乙'})), '掼蛋战绩显名');

console.log('\n── 海龟汤(真) ──');
ok(/海龟汤/.test(P({kind:'game',text:'game|soup|谜题|表面|适中'})), '海龟汤开局仍显海龟汤');
ok(/揭晓/.test(P({kind:'game',text:'game|reveal|汤底|5|solved'})), '揭晓汤底显名');

console.log('\n── 未知 game 事件 ──');
ok(P({kind:'game',text:'game|weird|x'})==='🎮 游戏动态', '未知事件中性兜底(非海龟汤)');

console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
