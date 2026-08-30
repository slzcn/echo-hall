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
    const tests=[];
    if(rows.length===2 && !out.combo){
      const [topRow,botRow]=rows;
      const botTop=botRow.getBoundingClientRect().top;
      // 采样: 每排取第 1/中/末 张(末张露全宽最好点; 首末测边界)
      const sample=row=>{ const ks=[...row.children]; return [ks[0],ks[Math.floor(ks.length/2)],ks[ks.length-1]].filter(Boolean); };
      const runOne=(cardEl, rowName, y)=>{
        const cr=cardEl.getBoundingClientRect();
        const x=cr.left+2;              // 露出条左沿右侧 2px → 命中"left≤x 的最右张"=它自己
        // 先清空选择(点同坐标可能 toggle): 直接清 + 重绘由 tap 触发
        [...hand.querySelectorAll('.card.sel')].forEach(c=>c.classList.remove('sel'));
        tap(x,y);
        const sel=selIds();
        const hit = sel.length===1 && sel[0]===cardEl.dataset.id;
        const inBot = botRow.contains(document.querySelector(`.card[data-id="${sel[0]}"]`)||document.createElement('i'));
        tests.push({ row:rowName, want:cardEl.dataset.id, got:sel[0]||null, hit, selCount:sel.length, gotInBot:inBot, tapX:+x.toFixed(1), tapY:+y.toFixed(1) });
      };
      // 下排: 关键回归点——在下排【上沿+3px】(旧代码会误判成上排)也必须命中下排牌
      sample(botRow).forEach(c=> runOne(c, 'bot', botTop+3));
      // 上排: 在下排上沿之上(上排露出条中部)命中上排牌
      const topRect=topRow.getBoundingClientRect();
      sample(topRow).forEach(c=> runOne(c, 'top', (topRect.top+botTop)/2));
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
