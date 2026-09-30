#!/usr/bin/env node
'use strict';
/**
 * test-guandan-spoken.js — 掼蛋「读牌口语」验证(主人要求: 出牌语音直接读出具体牌)。
 *  两段: (1) rules.parse 是否导出正确的点数字段(single.deckRank / pair·trio·bomb.nat /
 *  fullhouse.trioRank·pairRank / 顺子连对钢板.topRank·botRank); (2) 口语拼接是否得到
 *  "一张6 / 一对5 / 三个7带一对3 / 3到7顺子" 这类具体读法。
 *  注: 下方 spokenLabel 与 js/games/guandan-ui.js 内的同名函数【同源】, 改一处须同步另一处。
 */
const path = require('path');
const Rules = require(path.join(__dirname, '..', 'js/games/guandan-rules.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };

// ── 与 guandan-ui.js 同源的口语生成器 ──
const NAT_LABEL = {1:'A',2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A'};
const CN_NUM = {4:'四',5:'五',6:'六',7:'七',8:'八',9:'九',10:'十'};
const natName = (r)=> (r==null ? '' : (NAT_LABEL[r] || String(r)));
function spokenLabel(p){
  if(!p) return '';
  switch(p.type){
    case 'single': {
      const dr = p.deckRank;
      if(dr===17) return '一张大王';
      if(dr===16) return '一张小王';
      if(dr==null) return '单张';
      return '一张'+natName(dr===15?2:dr);
    }
    case 'pair':  return '一对'+natName(p.nat);
    case 'trio':  return '三个'+natName(p.nat);
    case 'fullhouse': return '三个'+natName(p.trioRank)+'带一对'+natName(p.pairRank);
    case 'straight':      return natName(p.botRank)+'到'+natName(p.topRank)+'顺子';
    case 'straightflush': return natName(p.botRank)+'到'+natName(p.topRank)+'同花顺';
    case 'pairline':      return natName(p.botRank)+'到'+natName(p.topRank)+'连对';
    case 'trioline':      return natName(p.botRank)+natName(p.topRank)+'钢板';
    case 'bomb':  return (CN_NUM[p.size]||p.size)+'个'+natName(p.nat)+'炸';
    case 'jokerbomb': return '四大天王';
    default: return '';
  }
}

// 造牌: 普通 C(id,花色,rank); 王 J(id,'big'|'small')
const C = (id, suit, rank) => ({ id, suit, rank, joker:null });
const J = (id, big) => ({ id, rank: big?17:16, suit:null, joker: big?'big':'small' });
const L = 2; // 级牌=2(♥2 为百搭)
const spoke = (cards) => spokenLabel(Rules.parse(cards, L));

// 1) 单张(主人例子: 一张六)
ok(spoke([C('s6','♠',6)]) === '一张6', '单张 → 一张6');
ok(spoke([C('sA','♠',14)]) === '一张A', '单张A → 一张A');
ok(spoke([J('jb',true)]) === '一张大王', '单张大王');
ok(spoke([J('js',false)]) === '一张小王', '单张小王');

// 2) 对子(主人例子: 一对五)
ok(spoke([C('s5','♠',5),C('c5','♣',5)]) === '一对5', '对子 → 一对5');
ok(spoke([C('sK','♠',13),C('cK','♣',13)]) === '一对K', '对K → 一对K');

// 3) 三张
ok(spoke([C('s7','♠',7),C('c7','♣',7),C('d7','♦',7)]) === '三个7', '三张 → 三个7');
// 百搭凑三个七(♥2=百搭): 应仍报"三个7"(按牌型点数, 不暴露物理配牌)
ok(spoke([C('s7','♠',7),C('c7','♣',7),C('h2','♥',2)]) === '三个7', '百搭凑三张 → 仍读三个7');

// 4) 三带二(主人例子: 三个七带对三)
ok(spoke([C('s7','♠',7),C('c7','♣',7),C('d7','♦',7),C('s3','♠',3),C('c3','♣',3)]) === '三个7带一对3',
  '三带二 → 三个7带一对3');

// 5) 顺子 / 同花顺(带首尾点)
ok(spoke([C('s3','♠',3),C('h4','♥',4),C('s5','♠',5),C('c6','♣',6),C('s7','♠',7)]) === '3到7顺子',
  '顺子 → 3到7顺子');
ok(spoke([C('s3','♠',3),C('s4','♠',4),C('s5','♠',5),C('s6','♠',6),C('s7','♠',7)]) === '3到7同花顺',
  '同花顺 → 3到7同花顺');

// 6) 连对(3连对) / 钢板(2连三)
ok(spoke([C('s5','♠',5),C('h5','♥',5),C('s6','♠',6),C('c6','♣',6),C('s7','♠',7),C('d7','♦',7)]) === '5到7连对',
  '连对 → 5到7连对');
ok(spoke([C('s7','♠',7),C('c7','♣',7),C('d7','♦',7),C('s8','♠',8),C('c8','♣',8),C('d8','♦',8)]) === '78钢板',
  '钢板 → 78钢板');

// 7) 炸弹 / 天王炸
ok(spoke([C('s8','♠',8),C('h8b','♥',8),C('c8','♣',8),C('d8','♦',8)]) === '四个8炸', '四张炸 → 四个8炸');
ok(spoke([C('s9','♠',9),C('h9b','♥',9),C('c9','♣',9),C('d9','♦',9),C('s9b','♠',9)]) === '五个9炸', '五张炸 → 五个9炸');
ok(spoke([J('jb1',true),J('jb2',true),J('js1',false),J('js2',false)]) === '四大天王', '四大天王');

// 8) parse 点数字段本体(数据地基)
const fh = Rules.parse([C('s7','♠',7),C('c7','♣',7),C('d7','♦',7),C('s3','♠',3),C('c3','♣',3)], L);
ok(fh.trioRank===7 && fh.pairRank===3, 'fullhouse 导出 trioRank=7 pairRank=3');
const st = Rules.parse([C('s3','♠',3),C('h4','♥',4),C('s5','♠',5),C('c6','♣',6),C('s7','♠',7)], L);
ok(st.topRank===7 && st.botRank===3, 'straight 导出 topRank=7 botRank=3');

console.log(`\n掼蛋读牌口语: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
