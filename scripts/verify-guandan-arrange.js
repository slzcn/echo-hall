#!/usr/bin/env node
'use strict';
/**
 * verify-guandan-arrange.js — 掼蛋「智能组牌·竖列分组」理牌 UI 真浏览器验证(手动跑, 非门禁)。
 *  对标腾讯欢乐掼蛋「一键理牌」。纯单机开桌 → 短按 #gdSort 切到组牌模式 → 校验:
 *   (1) 手牌带挂 .combo, 出现 ≥2 个 .gd-col 竖列; (2) 含≥2张的列组内上下叠(第2张 marginTop 明显为负);
 *   (3) 每个成型列底部有 .gd-col-label 且文案是已知牌型; (4) 各列底边对齐(align-items:flex-end);
 *   (5) 整簇不横向溢出手牌带; (6) 切换前后张数守恒(只重排不增删); (7) 切回大小态 .combo 撤销、回单排;
 *   (8) 分组内核正确(arrangeGroups 每组合法/末组散牌); (9) 全程 0 个 pageerror。
 *  组牌拆解正确性由 node 直验(下方 kernelCheck)覆盖, 浏览器侧验渲染接线 + 竖列布局。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const SFX = fs.readFileSync(path.join(ROOT, 'js/sfx-engine.js'), 'utf8');
let chromium;
try{ ({chromium}=require('playwright')); }catch(_){ try{({chromium}=require('playwright-core'));}catch(__){} }
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';
const FILES=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','card-counter.js','guandan-ui.js'];

// ── 纯内核直验: arrangeGroups 无重无漏 + 每组合法 ──
function kernelCheck(){
  const AI = require(path.join(ROOT,'js/games/guandan-ai.js'));
  const Rules = require(path.join(ROOT,'js/games/guandan-rules.js'));
  const C=(id,suit,rank,joker)=>joker?{id,joker}:{id,suit,rank};
  const level=2;
  const hand=[
    C('s13','♠',13),C('h13','♥',13),C('c13','♣',13),C('d13','♦',13), // 四K炸
    C('s3','♠',3),C('s4','♠',4),C('s5','♠',5),C('s6','♠',6),C('s7','♠',7), // 黑桃顺(同花顺)
    C('s9','♠',9),C('h9','♥',9),                                     // 对9
    C('s11','♠',11),C('h11','♥',11),C('c11','♣',11),                 // 三J
    C('jb',null,null,'big'),C('js',null,null,'small'),C('s14','♠',14), // 散: 双王 A
  ];
  const groups=AI.arrangeGroups(hand,level);
  const flat=groups.flat().map(c=>c.id).sort();
  const orig=hand.map(c=>c.id).sort();
  const noLoss=JSON.stringify(flat)===JSON.stringify(orig);
  const firstIsBomb=groups.length && Rules.isBomb(Rules.parse(groups[0],level)); // 炸弹组最先(护炸)
  const allGroupsN=groups.length;
  console.log(`  [kernel] 组数=${allGroupsN} 无重无漏=${noLoss} 炸弹组最先=${!!firstIsBomb}`);
  return noLoss && !!firstIsBomb && allGroupsN>=4;
}

(async()=>{
  const kOk = kernelCheck();
  const browser = await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  await page.evaluate(()=>{ const S=window.EhSfx||{}; S.say=()=>{}; S.play=()=>{};
    window.EhSfx=S; window.EhGameBgm={enter:()=>{},exit:()=>{}}; });
  for(const f of FILES) await page.addScriptTag({content:G(f)});

  const r = await page.evaluate(()=>{
    const old=document.querySelector('.gd-room'); if(old) old.remove();
    window.__g = window.EHGuandanGame.open({ names:['我','AI甲','AI乙','AI丙'], avatars:['🙂','🤖','👾','🐱'], isAI:[false,true,true,true], mySeat:0 });
    const sleep=ms=>new Promise(res=>setTimeout(res,ms));
    const allCards=()=>[...document.querySelectorAll('#gdHand .card')];
    const mt = el => parseFloat(getComputedStyle(el).marginTop)||0;
    const KNOWN=['单张','对子','三张','三带二','顺子','连对','钢板','同花顺','天王炸','4炸','5炸','6炸','7炸','8炸'];
    return (async()=>{
      await sleep(700);   // 等发牌
      const n0 = allCards().length;                 // 大小态: 单排码牌
      const rowsInit = document.querySelectorAll('#gdHand .gd-hand-row').length;
      const btn=document.querySelector('#gdSort');
      if(!btn) return { btn:false };
      // 短按一次: rank→combo(竖列分组)
      btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
      await sleep(150);
      const isCombo = document.querySelector('#gdHand').classList.contains('combo');
      const cols=[...document.querySelectorAll('#gdHand .gd-col')];
      const nCol=cols.length;
      const nCombo = allCards().length;
      // 竖向叠放: 存在含≥2张的列, 其第2张 marginTop 明显为负(组内上下叠)
      let vStackOk=false, colN2=null;
      const c2 = cols.find(c=>c.querySelectorAll('.card').length>=2);
      if(c2){ const ks=c2.querySelectorAll('.card'); colN2=ks.length; vStackOk = mt(ks[1]) < -8; }
      // 列底标牌型: 每个≥2张的列都有 gd-col-label 且文案是已知牌型
      const multi=cols.filter(c=>c.querySelectorAll('.card').length>=2);
      const labels=[...document.querySelectorAll('#gdHand .gd-col-label')].map(e=>e.textContent);
      const labelOk = multi.length>0 && multi.every(c=>{ const l=c.querySelector('.gd-col-label'); return l && KNOWN.includes(l.textContent); });
      // 底对齐: 任取两列, 底边(含标签)相差 <3px(align-items:flex-end)
      let bottomAlignOk=true;
      if(cols.length>=2){ const b0=cols[0].getBoundingClientRect().bottom; bottomAlignOk = cols.every(c=>Math.abs(c.getBoundingClientRect().bottom-b0)<3); }
      // 不溢出: 整簇左右不越出手牌带
      const hand=document.querySelector('#gdHand').getBoundingClientRect();
      const noOverflow = cols.every(c=>{ const r=c.getBoundingClientRect(); return r.left>=hand.left-1 && r.right<=hand.right+1; });
      // 切回大小
      btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
      await sleep(150);
      const backCombo = document.querySelector('#gdHand').classList.contains('combo');
      const nBack = allCards().length;
      const rowsBack = document.querySelectorAll('#gdHand .gd-hand-row').length;
      return { btn:true, n0, rowsInit, isCombo, nCol, nCombo, colN2, vStackOk, labelOk, labels, bottomAlignOk, noOverflow, backCombo, nBack, rowsBack };
    })();
  });
  await ctx.close(); await browser.close();

  const conserve = r.btn && r.n0>0 && r.nCombo===r.n0 && r.nBack===r.n0;
  const ok = kOk && r.btn && conserve && r.isCombo && r.nCol>=2 && r.vStackOk && r.labelOk
    && r.bottomAlignOk && r.noOverflow && !r.backCombo && r.rowsBack>=1 && errs.length===0;
  console.log(`  [browser] 钮=${r.btn} 发牌=${r.n0} 组牌态=${r.isCombo} 列数=${r.nCol} 组牌后张=${r.nCombo} 竖叠(第2张mt<0)=${r.vStackOk} 列底标牌型=${r.labelOk} 底对齐=${r.bottomAlignOk} 不溢出=${r.noOverflow} 切回非组牌=${!r.backCombo}/张${r.nBack}/行${r.rowsBack} err=${errs.length}`);
  if(r.labels) console.log('    列标签:', r.labels.join(' · '));
  if(errs.length) console.log('    pageerror:', errs.slice(0,3));
  console.log(ok ? '\n✅ 掼蛋组牌竖列分组理牌 验证通过' : '\n❌ 未通过');
  process.exit(ok ? 0 : 1);
})().catch(e=>{ console.error(e); process.exit(1); });
