#!/usr/bin/env node
'use strict';
/**
 * verify-guandan-tribute.js — 掼蛋"手动进贡/还贡"UI 真浏览器验证(手动跑, 非门禁)。
 *  纯单机 AI 桌(座位0=我), 用 match.prevResult 直接落到 tribute 阶段。
 *  策略: 每当轮到我(st.turn===0)且 phase==='tribute' 时, 选一张候选牌(优先已自动选中的),
 *  点「确认进贡/还贡」提交; AI 席自动推进。校验:
 *   (1) 确曾进入 tribute 阶段; (2) 全程手点只落在 #gdTribOk / 候选牌上;
 *   (3) 进/还贡闭环后 phase→play; (4) tribute 摘要 transfers 落地; (5) 0 个 pageerror。
 *  两种名次: A=单下(我做一次进贡) B=双下(我做一次还贡, 多候选选牌)。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const SFX = fs.readFileSync(path.join(ROOT, 'js/sfx-engine.js'), 'utf8');
let chromium;
try{ ({chromium}=require('playwright')); }catch(_){ try{({chromium}=require('playwright-core'));}catch(__){} }
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';
const FILES=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','guandan-ui.js'];

async function runScenario(page, finishOrder, label){
  await page.evaluate((fo)=>{
    const old=document.querySelector('.gd-room'); if(old) old.remove();
    window.__g = EHGuandanGame.open({ names:['我','AI甲','AI乙','AI丙'], avatars:['🙂','🤖','👾','🐱'],
      isAI:[false,true,true,true], mySeat:0,
      match:{ teamLevels:[2,2], dealerTeam:0, prevResult:{ finishOrder: fo } } });
  }, finishOrder);

  return await page.evaluate(async ()=>{
    const g=window.__g;
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    let sawTribute=false, myGives=0, reachedPlay=false, transfers=0, strayClicks=0;
    document.addEventListener('click',(e)=>{
      const b=e.target && e.target.closest && e.target.closest('button');
      if(b && b.id && b.id!=='gdTribOk') strayClicks++;   // 本脚本只应点 #gdTribOk(候选牌走 pointerdown 非 button)
    }, true);
    const start=performance.now();
    while(performance.now()-start < 20000){
      let st; try{ st=g.state(); }catch(_){ st=null; }
      if(st){
        if(st.phase==='tribute'){
          sawTribute=true;
          if(st.turn===0){
            // 我的进/还贡回合: 若未自动选中候选, 在候选牌【可见左沿】处派发 pointerdown(命中 handCardAt 坐标判定); 再点确认
            let sel=document.querySelector('.gd-hand .card.tribute-cand.sel');
            if(!sel){
              const c=document.querySelector('.gd-hand .card.tribute-cand');
              if(c){ const r=c.getBoundingClientRect();
                document.querySelector('.gd-hand').dispatchEvent(new PointerEvent('pointerdown',
                  { clientX:r.left+3, clientY:r.top+r.height/2, bubbles:true }));
                await sleep(60);
              }
            }
            const ok=document.querySelector('#gdTribOk');
            if(ok && !ok.disabled){ ok.click(); myGives++; await sleep(80); }
          }
        } else if(st.phase==='play'){
          reachedPlay=true;
          transfers = (st.tribute && st.tribute.transfers) ? st.tribute.transfers.length : 0;
          break;
        }
      }
      await sleep(80);
    }
    return { sawTribute, myGives, reachedPlay, transfers, strayClicks };
  });
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  await page.evaluate(()=>{ const S=window.EhSfx||{}; S.say=()=>{}; S.play=()=>{};
    window.EhSfx=S; window.EhGameBgm={enter:()=>{},exit:()=>{}}; });
  for(const f of FILES) await page.addScriptTag({content:G(f)});

  // A: 单下 finishOrder=[1,2,3,0] → 我(0)做一次【进贡】(强制最大牌, 自动选好)
  const A = await runScenario(page, [1,2,3,0], '单下·我进贡');
  // B: 双下 finishOrder=[0,2,1,3] → 我(0)做一次【还贡】(多候选, 需自己选牌)
  const B = await runScenario(page, [0,2,1,3], '双下·我还贡');

  await browser.close();
  const okA = A.sawTribute && A.reachedPlay && A.transfers>=1 && A.myGives>=1 && A.strayClicks===0;
  const okB = B.sawTribute && B.reachedPlay && B.transfers>=2 && B.myGives>=1 && B.strayClicks===0;
  const ok = okA && okB && errs.length===0;
  const show=(nm,r)=>{ console.log(`  [${nm}] tribute=${r.sawTribute} 我提交=${r.myGives} →play=${r.reachedPlay} transfers=${r.transfers} 杂点=${r.strayClicks}`); };
  console.log('掼蛋手动进贡/还贡 UI 验证:');
  show('单下·我进贡', A);
  show('双下·我还贡', B);
  console.log('  pageerror :', errs.length, errs.slice(0,3));
  console.log(ok ? '\n✅ 手动进贡/还贡链路通过' : '\n❌ 未通过');
  process.exit(ok ? 0 : 1);
})().catch(e=>{ console.error(e); process.exit(1); });
