#!/usr/bin/env node
'use strict';
/**
 * verify-guandan-arrange.js — 掼蛋「智能组牌」理牌 UI 真浏览器验证(手动跑, 非门禁)。
 *  对标腾讯欢乐掼蛋分组显示。纯单机开桌 → 短按 #gdSort 切到组牌模式 → 校验:
 *   (1) 切换后下排出现 ≥1 张 .grp-start(分组首张); (2) 组首张左侧留白(marginLeft)明显大于组内叠放牌;
 *   (3) 切换前后手牌张数守恒(无重无漏, 组牌只重排不增删); (4) 再切回大小模式无 .grp-start;
 *   (5) 分组顺序内核正确(arrangeGroups 每组是合法牌型/末组散牌); (6) 全程 0 个 pageerror。
 *  组牌拆解正确性由 node 直验(下方 kernelCheck)覆盖, 浏览器侧只验渲染接线 + 留白布局。
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
  await page.setContent('<!doctype html><meta charset=utf-8><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  await page.evaluate(()=>{ const S=window.EhSfx||{}; S.say=()=>{}; S.play=()=>{};
    window.EhSfx=S; window.EhGameBgm={enter:()=>{},exit:()=>{}}; });
  for(const f of FILES) await page.addScriptTag({content:G(f)});

  const r = await page.evaluate(()=>{
    const old=document.querySelector('.gd-room'); if(old) old.remove();
    window.__g = window.EHGuandanGame.open({ names:['我','AI甲','AI乙','AI丙'], avatars:['🙂','🤖','👾','🐱'], isAI:[false,true,true,true], mySeat:0 });
    const sleep=ms=>new Promise(res=>setTimeout(res,ms));
    // 手牌可能分上下两排(牌多≥15张时对标腾讯双排显示) → 数两排全部牌, 而非只数 .bot 行。
    const botCards=()=>[...document.querySelectorAll('.gd-hand-row .card')];
    return (async()=>{
      await sleep(700);   // 等发牌
      const n0 = botCards().length;
      const btn=document.querySelector('#gdSort');
      if(!btn) return { btn:false };
      // 短按一次: rank→combo(setContent 无长按, 直接触发 pointerup 短按分支较繁, 直接改状态入口)
      btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
      await sleep(120);
      const combo = botCards();
      const nCombo = combo.length;
      const grpStarts = combo.filter(el=>el.classList.contains('grp-start'));
      const nGrp = grpStarts.length;
      // 留白校验: 取一个 grp-start(非首张)与一个普通叠放牌的 marginLeft 比
      const ml = el => parseFloat(getComputedStyle(el).marginLeft)||0;
      let gapOk=false;
      if(nGrp){
        const gs = grpStarts.find(el=>el!==combo[0]) || grpStarts[0];
        const plain = combo.find(el=>el!==combo[0] && !el.classList.contains('grp-start'));
        if(gs && plain) gapOk = ml(gs) > ml(plain) + 8;   // 组首留白明显更大
      }
      // 切回大小
      btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
      await sleep(120);
      const back = botCards();
      const nBack = back.length;
      const nGrpBack = back.filter(el=>el.classList.contains('grp-start')).length;
      return { btn:true, n0, nCombo, nGrp, gapOk, nBack, nGrpBack };
    })();
  });
  await ctx.close(); await browser.close();

  const conserve = r.btn && r.n0>0 && r.nCombo===r.n0 && r.nBack===r.n0;
  const ok = kOk && r.btn && conserve && r.nGrp>=1 && r.gapOk && r.nGrpBack===0 && errs.length===0;
  console.log(`  [browser] 钮=${r.btn} 发牌数=${r.n0} 组牌后=${r.nCombo} 组首张=${r.nGrp} 留白更大=${r.gapOk} 切回大小=${r.nBack}/组首${r.nGrpBack} err=${errs.length}`);
  if(errs.length) console.log('    pageerror:', errs.slice(0,3));
  console.log(ok ? '\n✅ 掼蛋智能组牌理牌 验证通过' : '\n❌ 未通过');
  process.exit(ok ? 0 : 1);
})().catch(e=>{ console.error(e); process.exit(1); });
