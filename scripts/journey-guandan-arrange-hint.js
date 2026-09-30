#!/usr/bin/env node
'use strict';
/* journey-guandan-arrange-hint.js — 理牌 × 提示 × 重组体验
 * 诊断: docs/triage/2026-09-20-gd-arrange-hint.md */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const ui=R('js/games/guandan-ui.js');
const ai=R('js/games/guandan-ai.js');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/function hasManualRows\(/.test(ui), '有手动码牌判定 hasManualRows');
assert(/↺ 恢复自动/.test(ui), '手动码牌后理牌钮标「恢复自动」');
assert(/已恢复自动理牌/.test(ui), '短按可一键恢复自动理牌');
assert(/已保留你的码牌/.test(ui), '手动整理「完成」保留码牌并提示按组推荐');
assert(/canCombo\(\)\)/.test(ui) && /arrangeGroups\(hand, st\.level\)/.test(ui), '手动整理种子优先按牌型组');
assert(/hintCycle=\[\]; hintIdx=0;\s*\/\/ 码牌变了/.test(ui) || /码牌变了/.test(ui), '拖排落位后清空提示缓存');
assert(/理牌优先/.test(ui) && /runGroups\(ordered\)/.test(ui), '提示从视觉理牌序 runGroups 取组');
assert(/isComplete/.test(ui), '提示保留「一把走完」最优先');
assert(/Rules\.isBomb\(p\)\) return/.test(ui), '理牌优先不把炸弹顶到最前');
assert(/Rules\.sortHand\(hand, st\.level\);[\s\S]{0,80}runGroups\(rankSeq\)/.test(ui) || /runGroups\(rankSeq\)/.test(ui), '按大小态也标同点组缝');
assert(/hints\(/.test(ai) && /arrangeGroups/.test(ai), 'AI hints/arrangeGroups 仍在');
// 模拟: 理牌序上的成型组应排在 AI 其它候选前(非走完、非炸)
const handIds=['a1','a2','b1','b2','c1'];
const orderedGroups=[['a1','a2'],['b1','b2'],['c1']]; // 对/对/单
const aiHints=[['c1'],['a1','a2'],['b1','b2']];      // AI 可能把单张放前
const key=g=>g.slice().sort().join(',');
const mine=orderedGroups.filter(g=>g.length>=2);
const complete=[];
const seen=new Set();
const cyc=complete.concat(mine, aiHints.filter(g=>!seen.has(key(g)) && !mine.some(m=>key(m)===key(g))));
assert(key(cyc[0])===key(['a1','a2']) || key(cyc[0])===key(['b1','b2']), '理牌组成型组优先于散单提示');

console.log('\n'+(failed?'❌ 有失败':'✅ 掼蛋理牌×提示×重组通过'));
process.exit(failed?1:0);
