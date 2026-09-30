#!/usr/bin/env node
'use strict';
/* journey-ddz-gd-polish.js — 斗地主/掼蛋观感一致性与功能完整度契约
 * 1) 理牌/锁定可发现: 首用引导 + 按钮 title 说清「锁定怎么用」
 * 2) 提示出处可见: 锁定命中「按你的组合」/ 教练命中「教练建议」
 * 3) 大模型介入: EHStrategy.score 重排提示队列(三款同源)
 * 4) 操作键规格统一: 与德州同 min-height:54px
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const DZ = fs.readFileSync(path.join(ROOT, 'js/games/game-ui.js'), 'utf8');
const GD = fs.readFileSync(path.join(ROOT, 'js/games/guandan-ui.js'), 'utf8');
const PK = fs.readFileSync(path.join(ROOT, 'js/games/poker-ui.js'), 'utf8');
const SC = fs.readFileSync(path.join(ROOT, 'js/games/strategy-core.js'), 'utf8');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ✓ '+m);} else {fail++; console.log('  ✗ '+m);} };

console.log('\n── 理牌/锁定可发现(掼蛋) ──');
ok(/_sortGuideShown/.test(GD), '有理牌/锁定首用引导标志');
ok(/选中≥2张牌可「锁定」成组/.test(GD), '首用引导说清锁定用法');
ok(/长按理牌钮手动码牌/.test(GD), '首用引导说清长按码牌');
ok(/短按: 按大小↔按牌型 · 选中≥2张可锁定成组 · 长按进入手动拖排/.test(GD), '理牌钮 title 覆盖四态用法');
ok(/把选中的 '\+selected\.size\+' 张锁成一组/.test(GD) || /张锁成一组/.test(GD), '选中态 title 说明锁定作用');
ok(/已锁 '\+new Set/.test(GD) || /组 · 点此全部解锁/.test(GD), '解锁态 title 说明组数');

console.log('\n── 提示出处可见 ──');
ok(/按你锁定的组合推荐/.test(GD), '掼蛋: 锁定命中提示出处');
ok(/教练建议 · 优先/.test(GD), '掼蛋: 教练命中提示出处');
ok(/教练建议 · 优先/.test(DZ), '斗地主: 教练命中提示出处');

console.log('\n── 大模型/策略介入提示 ──');
ok(/EHStrategy\.score\('guandan'/.test(GD), '掼蛋: 教练策略重排提示队列');
ok(/EHStrategy\.score\('ddz'/.test(DZ), '斗地主: 教练策略重排提示队列');
ok(/strategyFor\(mySeat, target\)/.test(GD) && /strategyFor\(mySeat, target\)/.test(DZ), '提示生成时拉取策略');
ok(/source==='coach'/.test(SC) || /source:'coach'/.test(SC), '策略核标注 coach 来源');
ok(/priority==='finish_self'/.test(SC) || /finish_self/.test(SC), '策略核有 priority 语义');
// 热路径不塞 LLM: 出牌 AI.decide 走本地, 教练只调顺序/异步
ok(/不塞 LLM 到出牌热路径/.test(GD) || /模板化零延迟/.test(GD), '台词/出牌热路径不阻塞 LLM');

console.log('\n── 操作键规格统一(三款 54px) ──');
ok(/\.ddz-btn\{[^}]*min-height:54px/.test(DZ), '斗地主操作键 54px');
ok(/\.gd-btn\{[^}]*min-height:54px/.test(GD), '掼蛋操作键 54px');
ok(/min-height:54px/.test(PK), '德州操作键 54px');
ok(/border-radius:12px/.test(DZ) && /border-radius:12px/.test(GD), '操作键圆角统一 12px');

console.log('\n── 桌体结构骨架 ──');
ok(/class="ddz-bar"/.test(DZ) && /class="ddz-felt"/.test(DZ) && /class="ddz-hand-wrap"/.test(DZ), '斗地主 bar/felt/hand 骨架');
ok(/class="gd-bar"/.test(GD) && /class="gd-felt"/.test(GD) && /class="gd-hand-wrap"/.test(GD), '掼蛋 bar/felt/hand 骨架');
ok(/class="pk-bar"/.test(PK) && /class="pk-felt"/.test(PK), '德州 bar/felt 骨架');
ok(/eh-skin/.test(DZ) && /eh-skin/.test(GD) && /eh-skin/.test(PK), '三款都有换肤钮');

console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
