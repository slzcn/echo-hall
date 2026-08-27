#!/usr/bin/env node
'use strict';
/**
 * verify-poker-preaction.js — 德州"预选(pre-action)"自动执行验证(手动跑, 非门禁)。
 *  单机 AI 桌, 座位0=我。策略: 只要"不是我的回合"就勾上「跟任意注」预选,
 *  然后【绝不】点 #pkCall/#pkFold。若预选逻辑正确, 每次轮到我都会自动 call/check,
 *  牌局应能在我从不手点行动键的情况下推进到摊牌/结束。
 *  校验: (1) 全程点击只含 data-pre; (2) 至少触发过 N 次自动行动; (3) 抵达 over。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const SFX = fs.readFileSync(path.join(ROOT, 'js/sfx-engine.js'), 'utf8');
let chromium;
try{ ({chromium}=require('playwright')); }catch(_){ try{({chromium}=require('playwright-core'));}catch(__){} }
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';
const FILES=['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'];

(async()=>{
  const browser = await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  await page.evaluate(()=>{ const S=window.EhSfx||{}; S.say=()=>{}; S.play=()=>{}; window.EhSfx=S;
    window.EhGameBgm={enter:()=>{},exit:()=>{}}; });
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.evaluate(()=>{ window.__g=EHPokerGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0}); });

  const res = await page.evaluate(async ()=>{
    const g=window.__g; const t0=performance.now();
    let preClicks=0, manualActClicks=0, overSeen=false, autoFires=0;
    let prevToAct=-1, armedForMyTurn=false;
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    // 监视: 一旦有人点了真正的行动键(#pkCall/#pkFold/#pkRaise)就记一笔(本脚本不该点)
    document.addEventListener('click',(e)=>{
      const btn=e.target && e.target.closest && e.target.closest('button');
      const id=btn&&btn.id;
      if(id==='pkCall'||id==='pkFold'||id==='pkRaise') manualActClicks++;
    }, true);
    // 多跑几手: over 后自动"再来一局"由 UI 倒计时触发, 这里只持续勾预选并统计
    const start=performance.now();
    while(performance.now()-start < 55000){
      let st; try{ st=g.state(); }catch(_){ st=null; }
      if(st){
        if(st.phase==='over') overSeen=true;
        const betting=['preflop','flop','turn','river'].includes(st.phase);
        if(betting && st.toAct>=0 && st.toAct!==0){
          // 别家回合: 勾「跟任意注」(若按钮在且未选中), 并记"已为我的下一次回合备好预选"
          const b=document.querySelector('[data-pre="callany"]');
          if(b && !b.classList.contains('on')){ b.click(); preClicks++; armedForMyTurn=true; }
        }
        // 检测自动执行: 上一拍轮到我(0)且已备预选 → 这一拍已离开0, 且全程没手点行动键 = 预选自动落子
        if(betting && prevToAct===0 && st.toAct!==0 && armedForMyTurn){ autoFires++; armedForMyTurn=false; }
        if(betting) prevToAct=st.toAct;
      }
      await sleep(90);
    }
    return { manualActClicks, overSeen, preClicks, autoFires };
  });

  await browser.close();
  const ok = res.overSeen && res.manualActClicks===0 && res.autoFires>=1;
  console.log('德州预选验证:');
  console.log('  预选勾选次数   :', res.preClicks);
  console.log('  自动落子次数   :', res.autoFires, '(应 ≥1)');
  console.log('  手点行动键次数 :', res.manualActClicks, '(应为 0)');
  console.log('  抵达摊牌/结束  :', res.overSeen);
  console.log('  pageerror      :', errs.length, errs.slice(0,3));
  console.log(ok && errs.length===0 ? '\n✅ 预选自动执行链路通过' : '\n❌ 未通过');
  process.exit(ok && errs.length===0 ? 0 : 1);
})().catch(e=>{ console.error(e); process.exit(1); });
