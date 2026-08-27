#!/usr/bin/env node
'use strict';
/**
 * probe-game-flow.js — 全生命周期"丝滑度"探针(非门禁, 手动跑)。
 *  单机 AI 模式, 用真实 DOM 点击驱动"我"的座位走完整局:
 *   叫分 → 出牌/不出循环 → 收局 over → 再来一局自动倒计时 → 第二局开局。
 *  逐帧轮询 state(), 记录每个阶段切换的时间戳与相邻间隔(找卡顿/停顿),
 *  instrument EhSfx.say 统计语音密度与"打断"(cancel 覆盖)频率,
 *  抓 pageerror, 关键帧截图到 /tmp/eh-flow-*.png。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const SFX = fs.readFileSync(path.join(ROOT, 'js/sfx-engine.js'), 'utf8');
const OUT = '/tmp';

function findChrome(){
  const cands=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean);
  return cands.find(p=>{ try{return fs.existsSync(p);}catch(_){return false;} });
}
let chromium;
try{ ({chromium}=require('playwright')); }catch(_){ try{({chromium}=require('playwright-core'));}catch(__){} }
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';

async function newHall(browser, files){
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  // 屏蔽真实音频/TTS(headless 无输出设备), 但记录调用时间线用于密度分析
  await page.evaluate(()=>{
    window.__bgm={enter:[],exit:0}; window.EhGameBgm={ enter:k=>window.__bgm.enter.push(k), exit:()=>window.__bgm.exit++ };
    window.__say=[];
    const S=window.EhSfx||{};
    S.say = (text,who)=>{ window.__say.push({ t: performance.now(), text:String(text||''), who: who&&who.name||'' }); };
    // play 合成音效也桩掉计数
    window.__play=[]; const _p=S.play; S.play=(n)=>{ window.__play.push({t:performance.now(),n}); };
    window.EhSfx=S;
  });
  for(const f of files) await page.addScriptTag({content:G(f)});
  return {ctx,page,errs};
}

// 在页内轮询驱动一局。返回阶段时间线 + 语音统计。
async function runGame(page, ids, maxMs){
  return await page.evaluate(async ({ids, maxMs})=>{
    const g = window.__g;
    const t0 = performance.now();
    const timeline = [];      // {phase, at, gap}
    const stalls = [];        // 相邻同阶段无变化超过阈值时的停顿(轮到我却卡住)
    let lastPhase=null, lastPhaseAt=0;
    let overSeen=false, secondDealSeen=false, firstOverAt=0, secondDealAt=0;
    let dealCount=0, prevPhase=null;
    const clicked=[];
    const click=(sel)=>{ const el=document.querySelector(sel); if(el && !el.disabled){ el.click(); clicked.push({t:performance.now()-t0, sel}); return true; } return false; };
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));

    const startAt = performance.now();
    let myStuckSince=0;
    while(performance.now()-startAt < maxMs){
      let st; try{ st=g.state(); }catch(_){ st=null; }
      if(st){
        const ph = st.phase;
        if(ph!==lastPhase){
          const now=performance.now()-t0;
          timeline.push({phase:ph, at:Math.round(now), gap:Math.round(now-lastPhaseAt)});
          lastPhase=ph; lastPhaseAt=now;
          if(ph==='over' && !overSeen){ overSeen=true; firstOverAt=now; }
        }
        // 探测"再来一局"后的第二次发牌: over 之后重新回到 bid/play
        if(overSeen && !secondDealSeen && (ph==='bid'||ph==='play'||ph==='preflop')){ secondDealSeen=true; secondDealAt=performance.now()-t0; }

        // 驱动我的座位 (德州用 toAct, 斗地主/掼蛋用 turn/bid.turn)
        const pokerTurn = st.toAct===0 && ['preflop','flop','turn','river'].includes(ph);
        const myDouble = ph==='double' && st.dbl && st.dbl.turn===0;   // 斗地主本地加倍轮轮到我
        const mine = (ph==='bid' && st.bid && st.bid.turn===0) || (ph==='play' && st.turn===0) || myDouble || pokerTurn;
        if(mine){
          if(!myStuckSince) myStuckSince=performance.now();
          if(ph==='bid'){
            // 叫最高可用分(抢地主, 快速定庄)
            let did=false;
            for(const v of [3,2,1,0]){ if(click(`[data-bid="${v}"]`)){ did=true; break; } }
          } else if(myDouble){
            // 加倍轮: 快速点"不加倍"推进(探针只验流程不卡在加倍屏)
            if(!click('[data-dbl="1"]')) click('[data-dbl="2"]');
          } else if(pokerTurn){
            // 德州: 一律 check/call 快速推进(#pkCall = check 或 call)
            if(!click(ids.play)) click(ids.pass);
          } else {
            // play: 先试直接出(单一合法手已自动选中) → 提示选牌再出 → 不出
            if(!click(ids.play)){
              if(click(ids.hint)){ await sleep(120); if(!click(ids.play)){ /*提示后仍不能出*/ } }
              else { click(ids.pass); }
            }
          }
          // 若卡在我这超过 4s 记一次停顿
          if(performance.now()-myStuckSince>4000){ stalls.push({phase:ph,at:Math.round(performance.now()-t0)}); myStuckSince=performance.now(); }
        } else {
          myStuckSince=0;
        }
        // 第二局也见到就够了, 提前收
        if(secondDealSeen && performance.now()-t0 - secondDealAt > 2500) break;
      }
      await sleep(160);
    }
    const say=window.__say||[]; const play=window.__play||[];
    // 语音"打断密度": 相邻 say 间隔 < 700ms 视为一次被 cancel 打断的重叠
    let overlaps=0; for(let i=1;i<say.length;i++){ if(say[i].t-say[i-1].t<700) overlaps++; }
    return {
      timeline, stalls, clicks:clicked,
      firstOverAt:Math.round(firstOverAt), secondDealAt:Math.round(secondDealAt),
      say:{ n:say.length, overlaps, list: say.map(s=>({t:Math.round(s.t), text:s.text, who:s.who})).slice(0,60) },
      play:{ n:play.length, list: play.slice(0,40).map(p=>({t:Math.round(p.t),n:p.n})) },
      bgm: window.__bgm,
    };
  }, {ids, maxMs});
}

async function probe(browser, label, files, openExpr, ids){
  const {ctx,page,errs}=await newHall(browser, files);
  await page.evaluate(openExpr);
  await page.waitForTimeout(500);
  await page.screenshot({path:`${OUT}/eh-flow-${label}-1deal.png`});
  const r = await runGame(page, ids, 75000);
  await page.screenshot({path:`${OUT}/eh-flow-${label}-2end.png`});
  r.errs = errs.slice();
  await ctx.close();
  return r;
}

function report(label, r){
  console.log(`\n═══════════ ${label} ═══════════`);
  console.log('阶段时间线 (phase@ms, gap=距上一阶段ms):');
  for(const p of r.timeline) console.log(`   ${p.phase.padEnd(6)} @${String(p.at).padStart(6)}ms   +${p.gap}ms`);
  console.log(`收局(over)出现 @${r.firstOverAt}ms`);
  console.log(`"再来一局"后第二局开局 @${r.secondDealAt}ms  → 倒计时+发牌耗时 ≈ ${r.secondDealAt-r.firstOverAt}ms`);
  console.log(`语音 say: ${r.say.n} 次, 其中相邻<700ms(被打断重叠) ${r.say.overlaps} 次`);
  console.log(`音效 play: ${r.play.n} 次`);
  console.log(`我的点击: ${r.clicks.length} 次`);
  if(r.stalls.length) console.log(`⚠ 轮到我卡顿(>4s无进展): ${JSON.stringify(r.stalls)}`); else console.log('无"轮到我"卡顿');
  console.log(`BGM: enter=${JSON.stringify(r.bgm.enter)} exit=${r.bgm.exit}`);
  console.log(`pageerror: ${r.errs.length}` + (r.errs.length?(' → '+r.errs.join(' | ')):''));
  // 语音时间线抽样(前 24 条), 观察密度
  console.log('语音时间线抽样: ' + r.say.list.slice(0,24).map(s=>`${s.t}:${s.text}`).join('  '));
}

(async()=>{
  if(!chromium){ console.error('playwright 不可用'); process.exit(2); }
  const exe=findChrome();
  const browser=await chromium.launch({ headless:true, ...(exe?{executablePath:exe}:{}) });
  try{
    const ddz = await probe(browser,'ddz',
      ['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js'],
      ()=>{ window.__g=EHDdzGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0}); },
      {play:'#ddzPlay', hint:'#ddzHint', pass:'#ddzPass'});
    report('斗地主', ddz);

    const gd = await probe(browser,'guandan',
      ['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','guandan-ui.js'],
      ()=>{ window.__g=EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0}); },
      {play:'#gdPlay', hint:'#gdHint', pass:'#gdPass'});
    report('掼蛋', gd);

    const pk = await probe(browser,'poker',
      ['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'],
      ()=>{ window.__g=EHPokerGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0}); },
      {play:'#pkCall', hint:'#pkCall', pass:'#pkFold'});   // 德州: 一律 check/call 快速推到摊牌
    report('德州', pk);
  }catch(e){ console.error('harness 异常', e); }
  await browser.close();
  console.log('\n截图: /tmp/eh-flow-*.png');
})();
