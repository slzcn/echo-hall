#!/usr/bin/env node
'use strict';
// probe-guandan-group-tidy.js — 验证 #3「选一组牌能手动理在一起」:
//   1. 出牌态默认大小排, 点选 3 张分散的牌(索引拉开, 中间隔着没选的);
//   2. 长按 #gdSort 进手动拖排, 选中态应保留(3 张仍 .sel);
//   3. 抓其中一张往行首拖动落下 → 这 3 张应作为连续块落在同一排、彼此相邻;
//   4. 对照: 单拖(未选中的另一张)仍只挪一张, 不误动别的。
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SFX=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const FILES=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','card-counter.js','guandan-ui.js'];
const CSS='html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';

(async()=>{
  if(!chromium){ console.log('⚠ 无 playwright, 跳过'); process.exit(0); }
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage();
  await page.setContent('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>'+CSS+'</style><div id="hall"></div>');
  await page.addScriptTag({content:SFX});
  await page.evaluate(()=>{const S=window.EhSfx||{};S.say=()=>{};S.play=()=>{};window.EhSfx=S;window.EhGameBgm={enter:()=>{},exit:()=>{}};});
  for(const f of FILES) await page.addScriptTag({content:G(f)});

  const R=await page.evaluate(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    window.__g=window.EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0});
    await sleep(900);
    const hand=document.querySelector('.gd-hand');
    if(hand.classList.contains('combo')) return {skip:'combo'};
    const rc=el=>el.getBoundingClientRect();
    const selIds=()=>[...hand.querySelectorAll('.card.sel')].map(c=>c.dataset.id);
    const domRowsIds=()=>[...hand.children].filter(r=>r.children.length).map(r=>[...r.children].map(c=>c.dataset.id));
    function tap(x,y){
      hand.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y,pointerId:1}));
      hand.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:x,clientY:y,pointerId:1}));
    }
    async function drag(fromX,fromY,toX,toY){
      hand.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:fromX,clientY:fromY,pointerId:2}));
      await sleep(20);
      for(let s=1;s<=6;s++){ const x=fromX+(toX-fromX)*s/6, y=fromY+(toY-fromY)*s/6;
        hand.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:x,clientY:y,pointerId:2})); await sleep(12); }
      hand.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:toX,clientY:toY,pointerId:2}));
      await sleep(120);
    }
    const out={tests:[]};

    // 取牌最多的一排作操作行
    const rows=[...hand.children].filter(r=>r.children.length);
    const row=rows.reduce((a,b)=>b.children.length>a.children.length?b:a);
    let kids=[...row.children];
    // 选 3 张分散的牌(拉开索引, 中间隔未选)
    const pickIdx=[1, Math.floor(kids.length/2), kids.length-2].filter((v,i,a)=>a.indexOf(v)===i && v>=0 && v<kids.length);
    for(const i of pickIdx){ const r=rc(kids[i]); tap((r.left+r.right)/2, rc(kids[i]).top+6); await sleep(80); }
    // 实际选中的牌以 DOM .sel 为准(两排竖向重叠, 点某坐标未必命中 kids[i], 故不能用 kids[i].id 记账)
    const pickedIds=selIds();
    out.tests.push({name:'① 点选若干分散牌', pass: pickedIds.length>=2, got:pickedIds.length});

    // 长按 #gdSort 进手动拖排
    const btn=document.querySelector('#gdSort');
    btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:3}));
    await sleep(420);
    btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:3}));
    await sleep(120);
    out.tests.push({name:'② 长按进手动态', pass: hand.classList.contains('arranging'), got:hand.className});
    out.tests.push({name:'③ 进手动态后选中保留', pass: selIds().length===pickedIds.length, got:selIds().length});

    // 拖前先确认这组是分散的(否则测不出"理在一起"): 任一排里选中牌的位置不应已经连续
    const preRows=domRowsIds();
    let preScattered=true;
    for(const arr of preRows){ const pos=pickedIds.map(id=>arr.indexOf(id)).filter(p=>p>=0); if(pos.length===pickedIds.length){ const s=[...pos].sort((a,b)=>a-b); if(s.every((p,i)=>i===0||p===s[i-1]+1)) preScattered=false; } }
    out.tests.push({name:'③b 拖前该组是分散的', pass:preScattered});

    // 抓一张选中的牌(取中间那张)往行首拖
    const freshRow=()=>{ const rs=[...hand.children].filter(r=>r.children.length); return rs.reduce((a,b)=>b.children.length>a.children.length?b:a); };
    let r2=freshRow();
    const grabEl=[...r2.children].find(c=>c.dataset.id===pickedIds[1]);
    const gr=rc(grabEl); const rr=rc(r2);
    const gy=gr.top+6;   // 抓可见顶部条(两排竖向重叠, 卡中心可能被下排盖住 → 命中错牌)
    await drag((gr.left+gr.right)/2, gy, rr.left+12, gy);

    // 落位后: 3 张选中的牌应在同一排且连续相邻
    const rowsIds=domRowsIds();
    let contiguous=false, landedRow=-1, positions=null;
    for(let ri=0;ri<rowsIds.length;ri++){
      const arr=rowsIds[ri];
      const pos=pickedIds.map(id=>arr.indexOf(id));
      if(pos.every(p=>p>=0)){
        const sorted=[...pos].sort((a,b)=>a-b);
        const isRun=sorted.every((p,i)=> i===0 || p===sorted[i-1]+1);
        if(isRun){ contiguous=true; landedRow=ri; positions=sorted; break; }
      }
    }
    out.tests.push({name:'④ 组落位后整组连续相邻', pass:contiguous, landedRow, positions, rowsLen:rowsIds.map(a=>a.length)});

    // 对照: 单拖一张【未选中】的牌, 只挪它一张(不把选中组带走)
    const before=domRowsIds();
    const beforeFlat=before.flat();
    let r3=freshRow();
    const solo=[...r3.children].find(c=>!pickedIds.includes(c.dataset.id));
    if(solo){
      const sr=rc(solo), rr3=rc(r3); const sy=sr.top+6;
      await drag((sr.left+sr.right)/2, sy, rr3.right-12, sy);
      const after=domRowsIds().flat();
      // 集合不变(只是顺序变), 且选中 3 张仍连续
      const sameSet = beforeFlat.length===after.length && beforeFlat.every(id=>after.includes(id));
      const rowsIds2=domRowsIds();
      let stillRun=false;
      for(const arr of rowsIds2){ const pos=pickedIds.map(id=>arr.indexOf(id)); if(pos.every(p=>p>=0)){ const s=[...pos].sort((a,b)=>a-b); stillRun=s.every((p,i)=>i===0||p===s[i-1]+1); break; } }
      out.tests.push({name:'⑤ 单拖未选牌不打散已理好的组', pass: sameSet && stillRun, sameSet, stillRun});
    } else out.tests.push({name:'⑤ 单拖对照', pass:'no-solo(跳过)'});

    return out;
  });

  await browser.close();
  if(R.skip){ console.log('跳过('+R.skip+')'); process.exit(0); }
  console.log('掼蛋组理牌探针:');
  let allPass=true;
  for(const t of R.tests){
    const ok = t.pass===true || (typeof t.pass==='string' && t.pass.includes('跳过'));
    if(!ok) allPass=false;
    console.log(`  ${ok?'✅':'❌'} ${t.name}  ${JSON.stringify(t)}`);
  }
  console.log(allPass?'—— 全部通过':'—— 有失败');
  process.exit(allPass?0:1);
})();
