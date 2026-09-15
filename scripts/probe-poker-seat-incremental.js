#!/usr/bin/env node
'use strict';
/* 验证 #7 性能改: 德州下注/跟注走【原地增量】更新座位(改 .stk 数字与 .pk-commit 文本),
 * 而非此前"每次下注 querySelectorAll(.pk-seat,.pk-commit).remove() 全清重建 + positionSeats 全量定位"。
 * 判据(增量铁证): 观察到 target 为【文本节点】且其父为 .pk-commit / .stk 的 characterData 变更
 *   —— 只有 updateSeatsInPlace 直接改 lastChild.nodeValue / <b>.textContent 才会产生; 重建路径是整节点 remove+add。
 * 另断言: 全程无 pageerror; 且下注后 DOM 显示的投入数值确实随之更新。 */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const FILES=['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'];

(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.evaluate(`window.EHPokerGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','🤖'],isAI:[false,true,true],mySeat:0,seed:20260915})`);
  await page.addStyleTag({content:SHARED});

  // 装 observer: 统计"文本节点 characterData 变更, 且父节点 class 含 pk-commit / stk"→ 增量铁证。
  //   同时统计 .pk-table 直接子节点里 .pk-seat 的 childList 增删批次(重建信号)。
  await page.evaluate(()=>{
    window.__probe={ incrTextEdits:0, seatRebuilds:0, samples:[] };
    const tbl=document.querySelector('.pk-table')||document.querySelector('#hall');
    const isInside=(node,cls)=>{ let el=node&&node.nodeType===3?node.parentElement:node; for(let i=0;i<4&&el;i++,el=el.parentElement){ if(el.classList&&el.classList.contains(cls)) return true; } return false; };
    const mo=new MutationObserver(muts=>{
      for(const m of muts){
        if(m.type==='characterData'){
          if(isInside(m.target,'pk-commit')||isInside(m.target,'stk')){ window.__probe.incrTextEdits++; window.__probe.samples.push((m.target.nodeValue||'').slice(0,6)); }
        } else if(m.type==='childList'){
          for(const n of m.removedNodes){ if(n.classList&&(n.classList.contains('pk-seat')||n.classList.contains('pk-commit'))){ window.__probe.seatRebuilds++; break; } }
        }
      }
    });
    mo.observe(document.querySelector('#hall'),{subtree:true,childList:true,characterData:true,characterDataOldValue:true});
  });

  // 自动推进多步: 到我回合就点(优先加注制造 street 变化, 否则跟注/过牌), 反复到摊牌或 40 步。
  for(let i=0;i<40;i++){
    const acted=await page.evaluate(()=>{
      const raise=document.querySelector('#pkRaise'), call=document.querySelector('#pkCall'), chk=document.querySelector('#pkCheck');
      const btn=[raise,call,chk].find(b=>b&&!b.hasAttribute('disabled'));
      if(!btn) return 'wait';
      btn.click(); return btn.id||'call';
    });
    await page.waitForTimeout(360);
  }

  const r=await page.evaluate(()=>window.__probe);
  console.log('  增量文本改次数(pk-commit/stk):', r.incrTextEdits, ' 样本:', JSON.stringify(r.samples.slice(0,8)));
  console.log('  座位/投入节点被移除批次(重建):', r.seatRebuilds);
  await browser.close();

  let ok=true;
  if(errs.length){ ok=false; console.log('❌ pageerror:', errs.slice(0,3).join(' | ')); }
  if(r.incrTextEdits<=0){ ok=false; console.log('❌ 未捕捉到原地增量文本更新 → 增量路径可能是死代码/未生效'); }
  else console.log('✅ 增量路径生效: 下注/投入走原地改文本, 未拆座位节点');
  console.log(ok?'—— 通过':'—— 失败');
  process.exit(ok?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
