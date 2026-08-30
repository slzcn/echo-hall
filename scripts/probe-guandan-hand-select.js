#!/usr/bin/env node
'use strict';
// probe-guandan-hand-select.js — 真渲染验证掼蛋手牌两处修复:
//   #2 两排大小牌【竖向重叠】码放(下排上移盖住上排下半, 省竖向空间);
//   #1 手动选牌【不串排】(点下排牌选中的必是下排牌, 不再被上排 ±26 容差抢走)。
// 用 playwright 内置 chromium 手机视口渲染, dispatch 真 PointerEvent 命中坐标, 读 .sel 归属。
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
    const old=document.querySelector('.gd-room'); if(old) old.remove();
    window.__g=window.EHGuandanGame.open({names:['我','AI甲','AI乙','AI丙'],avatars:['🙂','🤖','👾','🐱'],isAI:[false,true,true,true],mySeat:0});
    await sleep(900);   // 等发牌+首次布局
    const hand=document.querySelector('.gd-hand');
    const room=document.querySelector('.gd-room');
    const rows=[...hand.children].filter(r=>r.children.length);
    const rrect=r=>{const b=r.getBoundingClientRect();return{top:+b.top.toFixed(1),bottom:+b.bottom.toFixed(1),left:+b.left.toFixed(1),right:+b.right.toFixed(1),n:r.children.length};};
    const out={ nRows:rows.length, rowRects:rows.map(rrect),
      handRect:rrect(hand), roomRect:(()=>{const b=room.getBoundingClientRect();return{left:+b.left.toFixed(1),right:+b.right.toFixed(1),bottom:+b.bottom.toFixed(1)};})(),
      combo: hand.classList.contains('combo'), myTurn: !hand.classList.contains('locked') };

    // ── 选牌命中测试: 对每排, 挑几张牌, 在其"露出条"里 dispatch pointerdown/up, 看选中的是不是它 ──
    function idOfCardAt(cardEl){ return cardEl.dataset.id; }
    function tap(x,y){
      hand.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y,pointerId:1}));
      hand.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:x,clientY:y,pointerId:1}));
    }
    function selIds(){ return [...hand.querySelectorAll('.card.sel')].map(c=>c.dataset.id); }
    // 样本间彻底清空选择: 点牌桌绒面空白处触发"点空白取消选中"(清内部 selected 集合), 只清 .sel class
    // 不够——内部 selected 会跨样本累积, 且 autoExtendSelection 会连选同点数牌, 污染下一次判定。
    const felt=document.querySelector('.gd-felt');
    function clearSel(){
      if(felt) felt.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:195,clientY:300,pointerId:9}));
    }
    const tests=[];
    // 全程按 data-id 操作: tap 会触发 autoExtend→renderHand 重建 DOM, 早捕获的元素引用会失效(rect 归零),
    // 故每次 tap 前都用 freshRows() 现查当前两排的元素与坐标。
    const freshRows=()=>[...hand.children].filter(r=>r.children.length);
    const idsOf=rowEl=>[...rowEl.children].map(c=>c.dataset.id);
    const rowsNow0=freshRows();
    if(rowsNow0.length===2 && !out.combo){
      // 采样: 每排取第 1/中/末 张的 id(末张露全宽最好点; 首末测边界)
      const pick3=ids=>[ids[0], ids[Math.floor(ids.length/2)], ids[ids.length-1]].filter(Boolean);
      const topIds=pick3(idsOf(rowsNow0[0])), botIds=pick3(idsOf(rowsNow0[1]));
      const rowIdxOf=id=>{ const rs=freshRows(); for(let i=0;i<rs.length;i++){ if(rs[i].querySelector(`.card[data-id="${id}"]`)) return i; } return -1; };
      const runOne=(wantId, rowName, yPick)=>{
        clearSel();                     // 清内部 selected(否则跨样本累积+autoExtend 连选污染)
        const el=hand.querySelector(`.card[data-id="${wantId}"]`); if(!el){ tests.push({row:rowName,want:wantId,got:null,hit:false,selCount:0,gotInBot:false,tapX:0,tapY:0}); return; }
        const cr=el.getBoundingClientRect();
        const x=cr.left+2;              // 露出条左沿右侧 2px → 命中"left≤x 的最右张"=它自己
        const y=yPick();               // y 现算(基于当前两排 rect)
        tap(x,y);
        // 判据: 点到的【那张目标牌】是否被选中(autoExtend 会连带同点数牌一起选, 属正常, 不用 selCount===1)。
        const selNow=hand.querySelector(`.card[data-id="${wantId}"]`);
        const hit = !!(selNow && selNow.classList.contains('sel'));
        const botIdx=freshRows().length-1;
        const inBot = rowIdxOf(wantId)===botIdx;
        tests.push({ row:rowName, want:wantId, got:hit?wantId:(selIds()[0]||null), hit, selCount:selIds().length, gotInBot:inBot, tapX:+x.toFixed(1), tapY:+y.toFixed(1) });
      };
      // 下排: 关键回归点——在下排【上沿+3px】(旧代码会误判成上排)也必须命中下排牌
      botIds.forEach(id=> runOne(id, 'bot', ()=>freshRows()[1].getBoundingClientRect().top+3));
      // 上排: 在下排上沿之上(上排露出条中部)命中上排牌
      topIds.forEach(id=> runOne(id, 'top', ()=>{ const rs=freshRows(); const tr=rs[0].getBoundingClientRect(); return (tr.top+rs[1].getBoundingClientRect().top)/2; }));
    }
    out.tests=tests;
    return out;
  });

  await browser.close();

  // ── 判定 ──
  let fail=0;
  const P=(ok,msg)=>{ console.log((ok?'✓':'✗')+' '+msg); if(!ok) fail++; };
  console.log(`手牌: ${R.nRows} 排, combo=${R.combo}, 我的回合=${R.myTurn}`);
  R.rowRects.forEach((r,i)=>console.log(`  排${i}: ${r.n}张 top=${r.top} bottom=${r.bottom} left=${r.left} right=${r.right}`));
  console.log(`  .gd-hand: left=${R.handRect.left} right=${R.handRect.right} | .gd-room: left=${R.roomRect.left} right=${R.roomRect.right} bottom=${R.roomRect.bottom}`);

  if(R.nRows===2 && !R.combo){
    const [t,b]=R.rowRects;
    P(b.top < t.bottom, `#2 两排竖向重叠(下排 top ${b.top} < 上排 bottom ${t.bottom}, 叠量 ${(t.bottom-b.top).toFixed(1)}px)`);
    P(b.top > t.top, `#2 下排在上排之下(非完全覆盖: 上排露出 ${(b.top-t.top).toFixed(1)}px)`);
  } else {
    console.log(`(非两排布局, 跳过重叠断言: nRows=${R.nRows} combo=${R.combo})`);
  }
  // 无横向溢出 / 底部不被裁
  P(R.handRect.left >= R.roomRect.left-0.5 && R.handRect.right <= R.roomRect.right+0.5, `手牌不横向溢出牌桌`);
  P(R.handRect.bottom <= R.roomRect.bottom+0.5, `手牌底部不被牌桌裁切`);

  // 选牌命中
  const bad=R.tests.filter(t=>!t.hit);
  R.tests.forEach(t=> P(t.hit, `#1 点${t.row}排 (${t.tapX},${t.tapY}) → 选中 ${t.got} ${t.hit?'✓正是目标':'✗应为 '+t.want+' (选了'+t.selCount+'张, 命中下排='+t.gotInBot+')'}`));
  if(R.tests.length){
    const botTests=R.tests.filter(t=>t.row==='bot');
    P(botTests.every(t=>t.gotInBot), `#1 所有下排点击都落在下排(无串排到上排)`);
  }

  console.log(fail? `\n✗ ${fail} 项失败`:`\n✓ 全部通过`);
  process.exit(fail?1:0);
})().catch(e=>{ console.error('probe 异常:', e); process.exit(2); });
