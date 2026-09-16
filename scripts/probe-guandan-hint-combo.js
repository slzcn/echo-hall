#!/usr/bin/env node
'use strict';
/* 掼蛋提示×按牌型探针(主人诉求"按牌型排列后提示没考虑组合出"):
 * 强制我领出(turn=0/无桌面牌)→ 切到「按牌型」→ 连按提示, 看每次选中的牌 vs arrangeGroups 理出的组。
 * 判据: 提示第一手应命中我理出的某个成型牌型(非拆成散张)。用真 Chrome。
 * 用法: node scripts/probe-guandan-hint-combo.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium }=require('playwright');
const CSSVARS=':root{--accent:#00e5d4;--magenta:#ff2d8e;--amber:#ffc24d;--sub:#86cbc6;--dim:#498d88;--ink:#eaf6ff;--cw:38px;--ch:54px;'
  +'--bg:#070a12;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel:rgba(0,0,0,.2);--panel-solid:#132a29}'
  +'html,body{margin:0;background:#0a0e18;color:#eaf6ff;font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}';
const MODS=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','table-orient.js','guandan-ui.js'];
let pass=0,fail=0; const ok=(c,m)=>{ if(c){pass++;console.log('  ✓ '+m);}else{fail++;console.log('  ✗ '+m);} };

(async()=>{
  const browser=await chromium.launch({executablePath:CHROME});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><style>'+CSSVARS+'</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of MODS) await page.addScriptTag({content:G(f)});
  await page.evaluate(()=>{ window.EhSfx={say:()=>{},play:()=>{}}; window.EhGameBgm={enter:()=>{},exit:()=>{}};
    window._G=window.EHGuandanGame.open({mount:document.getElementById('hall'),seed:7,
      names:['你','机器人1','机器人2','机器人3'],avatars:['🙂','🤖','🤖','🤖'],isAI:[false,true,true,true],mySeat:0,onResult(){}}); });
  await page.waitForTimeout(900);

  // 强制我领出: phase=play / turn=0 / 无桌面牌
  const info = await page.evaluate(()=>{
    const st=window._G.state();
    st.phase='play'; st.turn=0; st.table.lastPlay=null;
    const hand=st.players[0].hand;
    const groups=window.EHGuandanAI.arrangeGroups(hand, st.level).filter(g=>g.length>=2);
    const key=g=>g.map(c=>c.id).sort().join(',');
    return { level:st.level, hand:hand.map(c=>({id:c.id,rank:c.rank,suit:c.suit,joker:c.joker})),
      groups:groups.map(g=>({ids:g.map(c=>c.id), key:key(g), n:g.length,
        parse:(function(){try{return window.EHGuandanRules? null:null;}catch(_){return null;}})()})) };
  });
  console.log('  手牌', info.hand.length, '张, 级牌', info.level);
  console.log('  arrangeGroups 理出的成型组(≥2张):', info.groups.map(g=>g.n+'张').join(', ') || '(无)');

  // 切到按牌型
  await page.click('#gdSort').catch(()=>{});
  await page.waitForTimeout(200);
  const mode1 = await page.evaluate(()=>document.querySelector('#gdSort')?.textContent||'');
  if(!/按牌型/.test(mode1)){ await page.click('#gdSort').catch(()=>{}); await page.waitForTimeout(200); }
  const mode = await page.evaluate(()=>document.querySelector('#gdSort')?.textContent||'');
  ok(/按牌型/.test(mode), '已进入「按牌型」(钮:'+mode.trim()+')');

  // 连按提示 6 次, 记录每次选中的牌 id 集
  const picks=[];
  for(let i=0;i<6;i++){
    await page.click('#gdHint').catch(()=>{});
    await page.waitForTimeout(120);
    const sel=await page.evaluate(()=>[...document.querySelectorAll('#hall .gd-hand .card.sel')].map(el=>el.dataset.id).sort());
    picks.push(sel.join(','));
  }
  const uniq=[...new Set(picks)];
  console.log('  提示循环('+uniq.length+'种):');
  const groupKeys=new Set(info.groups.map(g=>g.key));
  uniq.forEach((p,i)=>{
    const cnt=p?p.split(',').length:0;
    const isGroup=groupKeys.has(p);
    console.log('    #'+(i+1)+' '+cnt+'张 '+(isGroup?'← 命中理出的组':'')+'  ['+p+']');
  });
  const first=picks[0];
  ok(first && first.split(',').length>=2, '首个提示是成组牌(≥2张), 非拆成单张(实:'+(first?first.split(',').length:0)+'张)');
  ok(groupKeys.has(first), '首个提示命中 arrangeGroups 理出的某个组');
  const anyGroupHit = uniq.some(p=>groupKeys.has(p));
  ok(anyGroupHit, '提示循环里至少包含一个我理出的成型组');

  ok(errs.length===0, '无页面报错'+(errs.length?': '+errs[0]:''));
  console.log('\n'+(fail?('❌ '+fail+' 失败 / '+pass+' 通过'):('🎉 全部通过 ('+pass+'✓)')));
  await browser.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
