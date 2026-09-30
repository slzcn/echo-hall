#!/usr/bin/env node
'use strict';
/* shot-ddz-states.js — 真机渲染斗地主各状态截图, 供人工核 乱版。
 * 覆盖: 招募态(host,有空位) / 招募态(满座) / 叫分 / 出牌(含托管) / 结算。
 * 用法: node scripts/shot-ddz-states.js   → 存 /tmp/ddz-<state>.png */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let chromium; try { ({chromium} = require('playwright')); } catch(_) { try { ({chromium} = require('playwright-core')); } catch(__){} }
function findChrome(){
  const c = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
             '/Applications/Chromium.app/Contents/MacOS/Chromium', process.env.CHROME_PATH].filter(Boolean);
  return c.find(p => { try { return fs.existsSync(p); } catch(_){ return false; } });
}
const CSS_ROOT = ':root{--accent:#00e5d4;--amber:#ffc24d;--sub:#86cbc6;--ink:#eaf6ff;--bg:#070a12;--bg2:#0d1524;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel-solid:#132a29;--dim:#498d88;--glow-cyan:0 0 12px rgba(0,229,212,.5);--glow-mag:0 0 12px rgba(255,45,142,.5);--panel:rgba(21,50,48,.8);--magenta:#ff2d8e;--green:#34e0b0;--btn-ink:#04060c}html,body{margin:0;background:#070a12;color:#eaf6ff;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}#hall{position:relative;width:390px;height:844px;overflow:hidden}';

(async () => {
  const exe = findChrome();
  if (!chromium || !exe) { console.log('⏭ 无 playwright/Chrome, 跳过'); process.exit(0); }
  const SHARED = R('js/games/table-shared.css');
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+CSS_ROOT+'</style><div id="hall"></div>');
  await page.addStyleTag({ content: SHARED });
  await page.addScriptTag({ content: R('js/sfx-engine.js') });
  await page.evaluate(()=>{ const S=window.EhSfx||{}; S.say=()=>{}; S.play=()=>{}; window.EhSfx=S; window.EhGameBgm={enter:()=>{},exit:()=>{}}; window.EH_BGM={on:()=>{},off:()=>{},toggle:()=>{},isOn:()=>false}; });
  for (const f of ['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','card-counter.js','game-ui.js'])
    await page.addScriptTag({ content: R('js/games/'+f) });

  async function shot(name){ await page.waitForTimeout(500); await page.screenshot({ path:'/tmp/ddz-'+name+'.png' }); console.log('✓ /tmp/ddz-'+name+'.png'); }

  // ── 招募态: host, 差 2 席 ──
  await page.evaluate(()=>{
    const lobbySeats=[{seat:0,kind:'human',uid:'me',name:'我',emoji:'🦞'},{seat:1,kind:'empty'},{seat:2,kind:'empty'}];
    window.__g = EHDdzGame.open({ mount:document.getElementById('hall'), scoreKey:'t', lobby:true, isHost:true, lobbySeats,
      lobbyCtx:{myUid:'me',souls:[{auth_uid:'s1',name:'狼姐',emoji:'🐺'}],actions:{fillSouls:()=>{},start:()=>{},inviteHumans:()=>{},seatSoul:()=>{},kick:()=>{},close:()=>{}}},
      names:['我','席1','席2'], avatars:['🦞','🤖','🤖'], isAI:[false,true,true], mySeat:0, remoteSeats:[],
      chat:{post:()=>{}}, onBeat:()=>{}, onSync:()=>{}, onResult:()=>{} });
  });
  await shot('lobby-empty');

  // ── 招募态: 满座 ──
  await page.evaluate(()=>{
    if(window.__g && window.__g.setLobby) window.__g.setLobby([
      {seat:0,kind:'human',uid:'me',name:'我',emoji:'🦞'},
      {seat:1,kind:'soul',uid:'s1',name:'狼姐',emoji:'🐺'},
      {seat:2,kind:'soul',uid:'s2',name:'熵增狼',emoji:'🐺'}]);
  });
  await shot('lobby-full');

  // ── 叫分态: 就地发牌进正局(此刻为 bid) ──
  await page.evaluate(()=>{ try{ window.__g && window.__g.startDeal && window.__g.startDeal(); }catch(e){} });
  await shot('bid');

  // ── 出牌态: 我一路「不叫」让 AI 当地主并先出, 轮到我时桌上有一手牌(复刻主人图2) ──
  //    有几率都不叫触发重发, 故最多重试 6 轮。
  let reached=false;
  for(let attempt=0; attempt<6 && !reached; attempt++){
    for(let i=0;i<8;i++){
      const clickedPass = await page.evaluate(()=>{
        const b=[...document.querySelectorAll('[data-bid="0"]')].find(x=>!x.disabled);
        if(b){ b.click(); return true; } return false;
      });
      await page.waitForTimeout(600);
      const phase = await page.evaluate(()=> (window.__g && window.__g.debugPhase) ? window.__g.debugPhase() : (document.querySelector('#ddzPlay')?'play':(document.querySelector('[data-bid]')?'bid':'?')));
      if(phase==='play'){ reached=true; break; }
      if(!clickedPass && phase!=='bid'){ break; }
    }
    if(!reached){ // 可能重发, 重新拿到 bid 面板继续
      await page.waitForTimeout(600);
      const stillBid = await page.evaluate(()=> !!document.querySelector('[data-bid]'));
      if(!stillBid && !document.querySelector('#ddzPlay')) break;
    }
  }
  await page.waitForTimeout(1200); // 等 AI 地主先出一手, 桌面出现牌堆
  await shot('play');
  await page.waitForTimeout(2500); // 动画彻底落定后再拍一张, 用于区分"瞬时动画帧"vs"残留牌堆"
  await shot('play-settled');

  if(errs.length) console.log('ERR:', errs.slice(0,4).join(' | '));
  await browser.close();
})().catch(e=>{ console.error(e); process.exit(1); });
