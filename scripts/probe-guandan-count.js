#!/usr/bin/env node
'use strict';
/* 掼蛋"报牌张数"核对探针: 推进多手后, 逐席核对
 *  - 座位"剩 N 张"DOM 数字 == 引擎 st.players[s].hand.length
 *  - 🔔报牌 告警只在 ≤2 且未出完时出现
 *  - 记牌器 未出张数 = 全副(8/2) - 已出(log)
 * 用真 Chrome。用法: node scripts/probe-guandan-count.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium }=require('playwright');
const CSSVARS=':root{--accent:#00e5d4;--magenta:#ff2d8e;--amber:#ffc24d;--sub:#86cbc6;--dim:#498d88;--ink:#eaf6ff;--cw:38px;--ch:54px;'
  +'--bg:#070a12;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel:rgba(0,0,0,.2);--panel-solid:#132a29}'
  +'html,body{margin:0;background:#0a0e18;color:#eaf6ff;font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}';
const MODS=['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','card-counter.js','table-orient.js','guandan-ui.js'];
let pass=0,fail=0; const ok=(c,m)=>{ if(c){pass++;console.log('  ✓ '+m);}else{fail++;console.log('  ✗ '+m);} };

(async()=>{
  const browser=await chromium.launch({executablePath:CHROME});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><style>'+CSSVARS+'</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of MODS) await page.addScriptTag({content:G(f)});
  await page.evaluate(()=>{ window.EhSfx={say:()=>{},play:()=>{}}; window.EhGameBgm={enter:()=>{},exit:()=>{}};
    window._G=window.EHGuandanGame.open({mount:document.getElementById('hall'),seed:11,
      names:['你','机器人1','机器人2','机器人3'],avatars:['🙂','🤖','🤖','🤖'],isAI:[false,true,true,true],mySeat:0,onResult(){}}); });
  await page.waitForTimeout(900);

  // 读每席 DOM "剩 N 张" + 是否有 🔔报牌 tag
  const readSeats = ()=> page.evaluate(()=>{
    const seats=[...document.querySelectorAll('#hall .gd-seat[data-seat]')];
    const out={};
    seats.forEach(s=>{ const seat=+s.dataset.seat; const b=s.querySelector('.cnt b');
      const n = b?parseInt(b.textContent,10):null;
      const alarm = !!s.querySelector('.gd-tag.alarm');
      out[seat]={ n, alarm }; });
    return out;
  });
  const engine = ()=> page.evaluate(()=>{ const st=window._G.state();
    return { phase:st.phase, players: st.players.map(p=>p.hand.length) }; });

  // 若不是我的回合, 让 AI 一直走; 是我的回合就自动选提示出牌; 反复推进多手, 每手核对计数
  let mism=0, alarmBad=0, steps=0;
  for(let iter=0; iter<120; iter++){
    const eng = await engine();
    if(eng.phase!=='play') break;
    // 核对每席 DOM 数字 vs 引擎
    const dom = await readSeats();
    for(let s=0;s<4;s++){
      if(dom[s] && dom[s].n!=null && dom[s].n!==eng.players[s]){ mism++; if(mism<=3) console.log('  ✗ 席'+s+' DOM显剩'+dom[s].n+' 引擎实'+eng.players[s]); }
      const shouldAlarm = eng.players[s]<=2 && eng.players[s]>0;
      if(dom[s] && dom[s].alarm!==shouldAlarm && eng.players[s]>0){ alarmBad++; if(alarmBad<=3) console.log('  ✗ 席'+s+' 报牌tag='+dom[s].alarm+' 但剩'+eng.players[s]+'张(应'+shouldAlarm+')'); }
    }
    // 推进一步
    const turn = await page.evaluate(()=>window._G.state().turn);
    if(turn===0){
      // 我的回合: 点提示选牌再出; 若提示为空(只能不出)则找不出按钮
      await page.click('#gdHint').catch(()=>{});
      await page.waitForTimeout(60);
      const played = await page.evaluate(()=>{
        const st=window._G.state();
        const sel=[...document.querySelectorAll('#hall .gd-hand .card.sel')].map(el=>el.dataset.id);
        if(!sel.length){ // 不出
          const pass=[...document.querySelectorAll('#hall button, #hall .gd-btn')].find(b=>/不出|过/.test(b.textContent));
          if(pass){ pass.click(); return 'pass'; } return 'stuck';
        }
        const play=[...document.querySelectorAll('#hall button, #hall .gd-btn')].find(b=>/出牌|出 /.test(b.textContent));
        if(play){ play.click(); return 'play'; } return 'stuck';
      });
      steps++;
      if(played==='stuck') break;
    } else {
      // AI 回合: 等它自动走(aiStep 由 afterMove 调度)
      await page.waitForTimeout(350);
    }
    await page.waitForTimeout(120);
  }
  console.log('  推进我方出手', steps, '次');
  ok(mism===0, '座位"剩 N 张"始终 == 引擎实际手牌数(不符 '+mism+' 次)');
  ok(alarmBad===0, '🔔报牌告警恰好在剩≤2且未出完时出现(异常 '+alarmBad+' 次)');

  // 记牌器核对
  const cnt = await page.evaluate(()=>{
    const st=window._G.state(); const CC=window.EHCardCounter;
    const rows=CC.remaining(st.log||[], 2);
    // 独立复算: 全副(rank>=16?2:8) - log已出
    const played={}; (st.log||[]).forEach(e=>{ if(e&&e.t==='play'&&e.cards) e.cards.forEach(id=>{ const r=CC.rankOfId(id); if(r!=null) played[r]=(played[r]||0)+1; }); });
    let bad=0; rows.forEach(x=>{ const tot=(x.rank>=16?2:8); const exp=tot-(played[x.rank]||0); if(x.remain!==exp) bad++; });
    return { bad, sample: rows.slice(0,3) };
  });
  ok(cnt.bad===0, '记牌器未出张数 = 全副(8/王2) - 已出(独立复算不符 '+cnt.bad+' 项)');

  ok(errs.length===0, '无页面报错'+(errs.length?': '+errs[0]:''));
  console.log('\n'+(fail?('❌ '+fail+' 失败 / '+pass+' 通过'):('🎉 全部通过 ('+pass+'✓)')));
  await browser.close(); process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
