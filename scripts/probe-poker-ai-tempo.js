#!/usr/bin/env node
'use strict';
/* 验证: 德州 AI"思考时长"按决策难易变化, 不再每步都耗满 2~7s(主人: 别每次都把思考时间用光)。
 *   T1 免费过牌/弃牌普遍很快(中位数 < 1.5s), 与"需跟注/主动进攻/全下"拉开梯度。
 *   T2 存在明显 snap(样本里出现 < 1200ms 的行动), 证明旧 2200ms 地板已被打破。
 *   T3 上限受控: 极端长考也不超过 ~6.2s(区间上沿 4000 + 深思 2200)。
 *   T4 全流程无回归: 全 AI 桌能自动打完一手到摊牌, 无 pageerror。 */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const NIGHT='--bg:#070a12;--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--line:rgba(0,229,212,0.24);--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const FILES=['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'];

(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.addStyleTag({content:G('table-shared.css')});

  let ok=true; const fail=m=>{ok=false;console.log('❌ '+m);};

  // 开一桌(拿到测试钩子)
  await page.evaluate(()=>{
    const seats=[{seat:0,kind:'human',name:'你',uid:'me'},{seat:1,kind:'soul',name:'狐狸'},{seat:2,kind:'soul',name:'铁头'},{seat:3,kind:'soul',name:'冷面'}];
    window.__pk=window.EHPokerGame.open({
      names:seats.map(s=>s.name), avatars:['🙂','🦊','🤖','😐'], isAI:seats.map(s=>s.kind!=='human'),
      mySeat:0, sb:5, bb:10, startStack:1000, seed:20260915, seats,
    });
  });
  await page.waitForTimeout(150);

  // ---------- T1/T2/T3 按决策类型采样思考时长 ----------
  const stats=await page.evaluate(()=>{
    const la=(canCheck,canCall)=>({canCheck,canCall,toCall:canCheck?0:20});
    const N=400;
    const sample=(d,l)=>{ const a=[]; for(let i=0;i<N;i++) a.push(window.__pk._aiThinkMs(d,l)); a.sort((x,y)=>x-y);
      return { min:a[0], med:a[N>>1], p90:a[Math.floor(N*0.9)], max:a[N-1] }; };
    return {
      check: sample({action:'check'}, la(true,false)),
      fold:  sample({action:'fold'},  la(false,true)),
      call:  sample({action:'call'},  la(false,true)),
      raise: sample({action:'raise'}, la(false,true)),
      allin: sample({action:'allin'}, la(false,true)),
    };
  });
  console.log('  思考时长采样(ms):');
  for(const k of ['check','fold','call','raise','allin']) console.log('   '+k.padEnd(6), JSON.stringify(stats[k]));

  // T1: 梯度 —— check/fold 中位数明显低于 call, call 低于 raise, raise 低于 allin
  if(!(stats.check.med < 1500)) fail('T1 免费过牌中位数未 < 1.5s: '+stats.check.med);
  if(!(stats.fold.med  < 1500)) fail('T1 弃牌中位数未 < 1.5s: '+stats.fold.med);
  if(!(stats.check.med < stats.call.med && stats.call.med < stats.raise.med && stats.raise.med < stats.allin.med))
    fail('T1 思考时长梯度不成立: '+JSON.stringify({c:stats.check.med,call:stats.call.med,r:stats.raise.med,a:stats.allin.med}));
  else console.log('✅ T1 梯度成立: 过牌/弃牌秒决 < 跟注 < 加注 < 全下');

  // T2: 打破旧 2200ms 地板 —— 过牌样本最小值远低于 2200
  if(!(stats.check.min < 1200)) fail('T2 未见 <1200ms 的 snap 行动(旧地板未打破): '+stats.check.min);
  else console.log('✅ T2 已见 snap 行动(过牌 min='+stats.check.min+'ms), 旧 2200ms 地板打破');

  // T3: 上限受控(<=6200)
  const worst=Math.max(...['check','fold','call','raise','allin'].map(k=>stats[k].max));
  if(worst>6200) fail('T3 长考上限超 6.2s: '+worst);
  else console.log('✅ T3 长考上限受控('+worst+'ms ≤ 6200)');

  // ---------- T4 打完真实一手, AI 靠新计时+缓存决策推进, 无报错 ----------
  console.log('===== T4 打完一手(AI 计时+缓存决策推进) =====');
  // 我方(座0)每到自己回合就点"过/跟"(#pkCall)让手继续; AI 座靠 aiTimer 自动出手。观察走到 over/showdown。
  let phase='', hops=0, myActs=0;
  for(let i=0;i<160;i++){
    const s=await page.evaluate(()=>{
      const st=window.__pk.state();
      let clicked=false;
      if(st.toAct===window.__pk.mySeat() && st.phase!=='over' && st.phase!=='showdown'){
        const b=document.querySelector('#pkCall'); if(b){ b.click(); clicked=true; }
      }
      return {phase:st.phase, toAct:st.toAct, clicked};
    });
    if(s.clicked) myActs++;
    if(s.phase!==phase){ phase=s.phase; hops++; }
    if(s.phase==='over'||s.phase==='showdown') break;
    await page.waitForTimeout(120);
  }
  if(errs.length) fail('T4 有 pageerror: '+errs.join(' | '));
  if(phase==='over'||phase==='showdown') console.log('✅ T4 打到 '+phase+'(阶段推进 '+hops+' 次, 我方行动 '+myActs+' 次), AI 计时+缓存决策无回归、无报错');
  else fail('T4 未在时限内走到结算, 停在 '+phase+'(hops='+hops+', myActs='+myActs+')');

  await browser.close();
  console.log(ok?'\n🎉 全部通过':'\n💥 有失败');
  process.exit(ok?0:1);
})();
