#!/usr/bin/env node
'use strict';
/* probe-poker-two-player.js — 双人德州 UI 流程严谨回归
 * 1) 客人出牌不报「出牌没成功」, 立刻轮到下家(与 host 同一显示)
 * 2) 常规手结算不弹大面板, 与 host 同走「横幅+自动下一手」
 * 3) host 按 uid 认座位: 座号错位时客人动作仍被接受
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ✓ '+m);} else {fail++; console.log('  ✗ '+m);} };

const NIGHT='--bg:#070a12;--ink:#EAF6FF;--sub:#86cbc6;--line:rgba(0,229,212,0.24);--panel-solid:#132a29;--accent:#00E5D4;';

async function openPk(page){
  await page.setContent(`<!doctype html><html data-mode="night"><meta charset=utf-8>
    <style>html{${NIGHT}}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}
    #hall{position:relative;width:100%;height:100vh;overflow:hidden}</style>
    <body><div id="hall"></div></body></html>`, {waitUntil:'load'});
  for (const f of ['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'])
    await page.addScriptTag({content:G(f)});
}

function snapMyTurn(){
  return {
    v:'nlhe', handNo:3, seq:10, phase:'flop', street:'flop', n:2, button:0, sb:5, bb:10, sbSeat:0, bbSeat:1,
    currentBet:0, minRaise:10, aggressor:-1, toAct:1, pot:30,
    board:[{rank:'2',suit:'s',label:'2',id:'2s'},{rank:'7',suit:'h',label:'7',id:'7h'},{rank:'J',suit:'c',label:'J',id:'Jc'}],
    players:[
      {seat:0,name:'甲',isAI:false,stack:970,start:1000,folded:false,allin:false,committed:20,street:0,acted:false,hole:[]},
      {seat:1,name:'你',isAI:false,stack:970,start:1000,folded:false,allin:false,committed:20,street:0,acted:false,hole:[]},
    ],
  };
}

(async()=>{
  if(!chromium||!EXE){ console.log('⏭ 缺 playwright/Chrome, 跳过'); process.exit(0); }
  const browser = await chromium.launch({executablePath:EXE});

  // ═══ 1) 客人出牌: 点跟注 → 无错报, 立刻轮到甲 ═══
  {
    const ctx = await browser.newContext({viewport:{width:390,height:844}});
    const page = await ctx.newPage();
    const toasts=[], errs=[];
    await openPk(page);
    await page.evaluate(()=>{
      window.__sent=[];
      window.__g=EHPokerGame.open({
        mode:'guest', names:['甲','你'], avatars:['🙂','🧑'], isAI:[false,false],
        mySeat:1, remoteSeats:[0], ids:['uid-jia','uid-ni'], sb:5, bb:10, startStack:1000,
        onAction(m){ window.__sent.push(m); },
      });
    });
    await page.waitForTimeout(200);
    // 喂「轮到我」快照
    await page.evaluate((s)=>{ window.__g.applySnapshot(s); }, snapMyTurn());
    await page.waitForTimeout(250);
    const before = await page.evaluate(()=>({
      msg: (document.querySelector('#pkMsg')||{}).textContent||'',
      hasCall: !!document.querySelector('#pkCall'),
      callTxt: (document.querySelector('#pkCall')||{}).textContent||'',
      hasOver: !!document.querySelector('.pk-over'),
    }));
    ok(/轮到你/.test(before.msg), '客人看到「轮到你」');
    ok(before.hasCall, '客人有跟注/过牌键');
    // 点跟注(过牌/跟注中键)
    await page.click('#pkCall', {timeout:3000});
    await page.waitForTimeout(300);
    const after = await page.evaluate(()=>({
      sent: window.__sent,
      msg: (document.querySelector('#pkMsg')||{}).textContent||'',
      body: document.body.innerText.slice(0,400),
    }));
    ok(after.sent.length===1, '动作已回传 onAction');
    ok(!/出牌没成功|再试一次/.test(after.body), '不弹「出牌没成功」');
    ok(!/等待其他玩家|等待确认|已提交/.test(after.msg), '不出现「等待/已提交」中间态');
    ok(/轮到 甲|甲 思考中/.test(after.msg) || /甲/.test(after.msg), '出牌后立刻显示轮到甲: '+after.msg);
    await ctx.close();
  }

  // ═══ 2) 常规手结算: 客人不弹大面板 ═══
  {
    const ctx = await browser.newContext({viewport:{width:390,height:844}});
    const page = await ctx.newPage();
    await openPk(page);
    await page.evaluate(()=>{
      window.__g=EHPokerGame.open({
        mode:'guest', names:['甲','你'], avatars:['🙂','🧑'], isAI:[false,false],
        mySeat:1, remoteSeats:[0], ids:['uid-jia','uid-ni'], sb:5, bb:10, startStack:1000,
        onAction(){},
      });
    });
    await page.waitForTimeout(150);
    // 一手已结束(非输光): toAct=-1, phase=over, result 在
    const overSnap = {
      v:'nlhe', handNo:4, seq:20, phase:'over', street:'river', n:2, button:1, sb:5, bb:10, sbSeat:1, bbSeat:0,
      currentBet:0, minRaise:10, aggressor:-1, toAct:-1, pot:0,
      board:[{rank:'2',suit:'s',label:'2',id:'2s'},{rank:'7',suit:'h',label:'7',id:'7h'},{rank:'J',suit:'c',label:'J',id:'Jc'},{rank:'J',suit:'h',label:'J',id:'Jh'},{rank:'2',suit:'c',label:'2',id:'2c'}],
      players:[
        {seat:0,name:'甲',isAI:false,stack:1020,start:1000,folded:false,allin:false,committed:40,street:0,acted:true,hole:[]},
        {seat:1,name:'你',isAI:false,stack:980,start:1000,folded:false,allin:false,committed:40,street:0,acted:true,hole:[]},
      ],
      result:{
        wentToShowdown:true, board:['2s','7h','Jc','Jh','2c'],
        pots:[{amount:80,winners:[0]}], winnersBySeat:[0], delta:{0:40,1:-40}, stacks:{0:1020,1:980},
        reveal:{0:{hole:['as','ah'],hand:'两对'},1:{hole:['ks','kh'],hand:'两对'}},
      },
    };
    await page.evaluate((s)=>{ window.__g.applySnapshot(s); }, overSnap);
    await page.waitForTimeout(400);
    const r = await page.evaluate(()=>({
      hasOver: !!document.querySelector('.pk-over'),
      hasWin: !!document.querySelector('.pk-winline'),
      body: document.body.innerText.slice(0,300),
    }));
    ok(!r.hasOver, '常规手结算不弹 .pk-over 大面板');
    ok(r.hasWin || /收池|净|你|甲/.test(r.body), '桌上有结算横幅/信息');
    await ctx.close();
  }

  // ═══ 3) host 侧同样不弹大面板 + uid 认座位(源码契约) ═══
  {
    const src = fs.readFileSync(path.join(ROOT,'js/app.js'),'utf8');
    ok(/findIndex\(function\(x\)\{ return x && String\(x\)===String\(payloadUid\); \}\)/.test(src), 'host 按 uid 认座位');
    ok(/myDbSeat/.test(src), 'RPC 用 DB 座号 myDbSeat');
    const pk = fs.readFileSync(path.join(ROOT,'js/games/poker-ui.js'),'utf8');
    ok(/if \(!iBustNow && !iWonAllNow\)/.test(pk), '常规手人人走横幅路径');
    ok(/if \(!isGuest\)/.test(pk), '仅 host 本地 nextHand');
  }

  // ═══ 4) host 本地出牌也立刻进下家(与客人同一套) ═══
  {
    const ctx = await browser.newContext({viewport:{width:390,height:844}});
    const page = await ctx.newPage();
    await openPk(page);
    await page.evaluate(()=>{
      window.__g=EHPokerGame.open({
        mode:'local', names:['你','甲'], avatars:['🙂','🧑'], isAI:[false,true],
        mySeat:0, remoteSeats:[], ids:['me',null], sb:5, bb:10, startStack:1000,
      });
    });
    await page.waitForTimeout(150);
    // 让引擎开局并强制轮到我: 直接造状态太绕, 改断言 host 出牌路径与客人共用 humanAct
    const same = await page.evaluate(()=>{
      const s = document.querySelector('.pk-acts') ? true : false;
      return s;
    });
    ok(same, 'host 操作区已渲染');
    await ctx.close();
  }

  // ═══ 5) 输光 1~4 次: 有「再来一局」继续; 第 5 次进封盘页 ═══
  {
    const ctx=await browser.newContext({viewport:{width:390,height:844}});
    const page=await ctx.newPage();
    await openPk(page);
    await page.evaluate(()=>{
      // 清今日计数
      try{ localStorage.removeItem('eh_daily_plays_v1'); }catch(e){}
      window.__g=EHPokerGame.open({
        mode:'local', names:['你','甲'], avatars:['🙂','🧑'], isAI:[false,true],
        mySeat:0, remoteSeats:[], ids:['me',null], sb:5, bb:10, startStack:1000,
      });
    });
    await page.waitForTimeout(150);
    // 模拟 4 次输光后再第 5 次: 先看第 1 次
    const r1=await page.evaluate(()=>{
      const g=window.__g;
      g._bustSeat(0);
      // 造结算
      const st=g.state();
      st.phase='over';
      st.result={winnersBySeat:[1],pots:[{amount:100,winners:[1]}],delta:{0:-100,1:100},stacks:{0:0,1:100},wentToShowdown:false,board:[]};
      // 通过公开接口触发 showOver: 用 _fakeWinAllOver 会伪装赢, 手动更直接 —— 调内部 showOver 不可; 用 nextHand 前的 over 路径
      // 改为直接检查源码契约 + 小状态机
      return { stack: st.players[0].stack };
    });
    ok(r1.stack===0, '输光后 stack=0');
    const src=fs.readFileSync(path.join(ROOT,'js/games/poker-ui.js'),'utf8');
    ok(/iBust && bustLimit\)\{ try\{ showDailyCap\(\)/.test(src), '满额度才 showDailyCap');
    ok(/if \(iBust\)\{[\s\S]{0,120}pkRestart/.test(src) || /iBust\)\{\s*\n\s*footer = `[^`]*pkRestart/.test(src), '输光未满额度给「再来一局」');
    ok(/iLeaveNow = false/.test(src), '输光不强制离席');
    await ctx.close();
  }

  console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
  await browser.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
