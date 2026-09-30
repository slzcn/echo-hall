#!/usr/bin/env node
'use strict';
/* 掼蛋"提示拆炸"核对(纯 node, 无需 Chrome): 手握 5 张同点(5 炸)时,
 *  - genCombos/allBombs 不得给出用其中 4 张的"4 炸"(拆炸留孤儿); 应给整副 5 炸。
 *  - AI.hints 领出建议里不得出现"同点 4 炸子集"。
 * 用法: node scripts/probe-guandan-bomb-whole.js */
const Rules = require('../js/games/guandan-rules.js');
const AI = require('../js/games/guandan-ai.js');
const Deck = require('../js/games/deck.js');
let pass=0, fail=0; const ok=(c,m)=>{ if(c){pass++;console.log('  ✓ '+m);}else{fail++;console.log('  ✗ '+m);} };

const LEVEL = 2;
const deck = Deck.doubleDeck();
const byRank = r => deck.filter(c=>c.rank===r && !c.joker);
// 5 张同点(rank 5, 非级非王非百搭) + 若干散牌凑一手
const bomb5 = byRank(5).slice(0,5);
const filler = [byRank(7)[0], byRank(9)[0], byRank(11)[0], byRank(13)[0], byRank(14)[0]];
const hand = bomb5.concat(filler);
console.log('手牌: 5×[5] +', filler.map(c=>c.label).join(' '), '(共'+hand.length+'张)');

const sameRankBomb = c => Rules.isBomb(c.parse)
  && c.parse.type==='bomb'
  && new Set(c.cards.filter(x=>!x.joker && !Rules.isWild(x,LEVEL)).map(x=>x.rank)).size===1;

// ① genCombos/allBombs
const bombs = AI.allBombs(hand, LEVEL);
const bombLens = bombs.map(b=>b.cards.length).sort((a,b)=>a-b);
console.log('  allBombs 张数:', JSON.stringify(bombLens));
const subset4 = bombs.filter(b=> b.cards.length===4 && sameRankBomb(b));
ok(subset4.length===0, '不产生"5 张同点里取 4 张"的 4 炸子集(实得 '+subset4.length+' 个)');
ok(bombs.some(b=> b.cards.length===5 && sameRankBomb(b)), '产生整副 5 炸(全 5 张同点)');

// ② hints 领出(无 target)
const cyc = AI.hints({ hand, tableParse:null, level:LEVEL, seat:0, lastSeat:null, handsLeft:[hand.length,27,27,27] });
const badHint = cyc.filter(g=>{ const p=Rules.parse(g, LEVEL); return p && Rules.isBomb(p) && p.type==='bomb'
  && g.length===4 && new Set(g.filter(x=>!x.joker && !Rules.isWild(x,LEVEL)).map(x=>x.rank)).size===1; });
ok(badHint.length===0, '领出提示不含"同点 4 炸子集"(实得 '+badHint.length+' 个)');
// 提示循环里应能找到整副 5 炸
const has5 = cyc.some(g=>g.length===5 && (()=>{ const p=Rules.parse(g,LEVEL); return p&&Rules.isBomb(p); })());
ok(has5, '领出提示循环里包含整副 5 炸');

// ③ 4 张同点(真 4 炸)不受影响: 应正常产生 4 炸
const hand4 = byRank(6).slice(0,4).concat(filler);
const bombs4 = AI.allBombs(hand4, LEVEL);
ok(bombs4.some(b=>b.cards.length===4 && sameRankBomb(b)), '手握 4 张同点仍正常产生 4 炸(未误杀)');

console.log('\n'+(fail?('❌ '+fail+' 失败 / '+pass+' 通过'):('🎉 全部通过 ('+pass+'✓)')));
process.exit(fail?1:0);
