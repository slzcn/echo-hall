#!/usr/bin/env node
'use strict';
// 规则口径审计: 拿标准掼蛋规则构造"边界牌型", 逐一喂 parse, 检查 接受/拒绝+大小 是否符合预期。
// 目的=抓"该合法却被判非法"(如之前的王对)这类偏差, 非模糊自对弈能覆盖。
const R = require('../js/games/guandan-rules.js');
let pass = 0, fail = 0;
function EXPECT(cards, level, pred, desc){
  const p = R.parse(cards, level);
  const ok = pred(p);
  console.log((ok?'  ✓':'✗ FAIL')+' '+desc+'  → '+(p?`${p.type} key=${p.key} len=${p.len}`:'null'));
  ok ? pass++ : fail++;
  return p;
}
// 造牌: n=自然点(2..14,A=14); '2'在deck里rank15
const c  = (n,s)=>({rank:(n===2?15:n), suit:s, joker:null, id:s+n+Math.random().toString(36).slice(2,6)});
const sj = ()=>({rank:16,suit:null,joker:'small',id:'js'+Math.random()});
const bj = ()=>({rank:17,suit:null,joker:'big',id:'jb'+Math.random()});
const isT=(t)=>(p)=>!!p&&p.type===t;
const nul=(p)=>p===null;

console.log('\n== 单张 / 王 ==');
EXPECT([bj()],2,(p)=>p&&p.type==='single'&&p.key===17,'大王单张 力17');
EXPECT([sj()],2,(p)=>p&&p.type==='single'&&p.key===16,'小王单张 力16');
EXPECT([c(2,'♥')],2,(p)=>p&&p.type==='single'&&p.key===15,'红桃级牌(百搭)单出=级牌 力15');

console.log('\n== 对子(含王对/百搭) ==');
EXPECT([sj(),sj()],2,(p)=>isT('pair')(p)&&p.key===16,'双小王对');
EXPECT([bj(),bj()],2,(p)=>isT('pair')(p)&&p.key===17,'双大王对');
EXPECT([bj(),sj()],2,nul,'一大一小 不成对');
EXPECT([c(9,'♠'),c(9,'♦')],2,isT('pair'),'普通对 99');
EXPECT([c(9,'♠'),c(2,'♥')],2,(p)=>isT('pair')(p)&&p.key===9,'9+红桃2(百搭级=2)=一对9');
EXPECT([c(14,'♠'),c(2,'♥')],2,(p)=>isT('pair')(p)&&p.key===14,'A+百搭=对A');

console.log('\n== 顺子边界(A低位/A高位/含2) ==');
EXPECT([c(14,'♠'),c(2,'♣'),c(3,'♦'),c(4,'♥'),c(5,'♠')],7,(p)=>isT('straight')(p)&&p.key===5,'A2345(A作1) key=5');
EXPECT([c(10,'♠'),c(11,'♣'),c(12,'♦'),c(13,'♥'),c(14,'♠')],7,(p)=>isT('straight')(p)&&p.key===14,'10JQKA key=14');
EXPECT([c(11,'♠'),c(12,'♣'),c(13,'♦'),c(14,'♥'),c(2,'♠')],7,nul,'JQKA2 非法(2不接A后)');
EXPECT([c(2,'♣'),c(3,'♦'),c(4,'♥'),c(5,'♠'),c(6,'♣')],7,(p)=>isT('straight')(p)&&p.key===6,'23456 key=6');
EXPECT([c(3,'♠'),c(4,'♣'),c(5,'♦'),c(6,'♥'),c(2,'♥')],7,isT('straight'),'3456+百搭补7 顺子');

console.log('\n== 顺子里级牌不抬权 ==');
EXPECT([c(3,'♠'),c(4,'♣'),c(5,'♦'),c(6,'♥'),c(7,'♠')],5,(p)=>isT('straight')(p)&&p.key===7,'34567(级=5)按自然点 key=7');

console.log('\n== 连对/钢板 ==');
EXPECT([c(3,'♠'),c(3,'♣'),c(4,'♦'),c(4,'♥'),c(5,'♠'),c(5,'♣')],2,isT('pairline'),'334455 三连对');
EXPECT([c(13,'♠'),c(13,'♣'),c(14,'♦'),c(14,'♥'),c(12,'♠'),c(12,'♣')],2,isT('pairline'),'QQKKAA 三连对(A高位)');
EXPECT([c(3,'♠'),c(3,'♣'),c(3,'♦'),c(4,'♥'),c(4,'♠'),c(4,'♣')],2,isT('trioline'),'333444 钢板');
EXPECT([c(2,'♠'),c(2,'♣'),c(3,'♦'),c(3,'♥'),c(5,'♠'),c(5,'♣')],2,nul,'223355 非连续 非连对');

console.log('\n== 炸弹 / 同花顺 / 天王 大小 ==');
const b4=EXPECT([c(7,'♠'),c(7,'♣'),c(7,'♦'),c(7,'♥')],2,(p)=>isT('bomb')(p)&&p.len===4,'四张炸 7777');
const b5=EXPECT([c(8,'♠'),c(8,'♣'),c(8,'♦'),c(8,'♥'),c(2,'♥')],2,(p)=>isT('bomb')(p)&&p.len===5,'五张炸 8888+百搭');
const sf=EXPECT([c(3,'♠'),c(4,'♠'),c(5,'♠'),c(6,'♠'),c(7,'♠')],2,isT('straightflush'),'同花顺 ♠34567');
const jb=EXPECT([bj(),bj(),sj(),sj()],2,isT('jokerbomb'),'四大天王');
console.log('  炸弹链: 4炸<5炸? '+R.beats(b5,b4,2)+' | 5炸<同花顺? '+R.beats(sf,b5,2)+' | 同花顺<天王? '+R.beats(jb,sf,2));

console.log('\n== 三张 / 三带二 ==');
EXPECT([c(9,'♠'),c(9,'♣'),c(9,'♦')],2,isT('trio'),'三张 999');
EXPECT([bj(),bj(),bj()],2,nul,'三个王 非三张');
EXPECT([c(9,'♠'),c(9,'♣'),c(9,'♦'),c(4,'♠'),c(4,'♣')],2,isT('fullhouse'),'三带二 99944');
EXPECT([c(9,'♠'),c(9,'♣'),c(2,'♥'),c(4,'♠'),c(4,'♣')],2,isT('fullhouse'),'三带二 用百搭凑三(99+W)44');

console.log('\n== 逢人配不替王 ==');
EXPECT([sj(),c(2,'♥')],2,nul,'小王+百搭 不成王对(百搭不替王)');
EXPECT([bj(),bj(),sj(),c(2,'♥')],2,nul,'2大王+小王+百搭 ≠天王炸(百搭不替王)');

console.log(`\naudit: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
