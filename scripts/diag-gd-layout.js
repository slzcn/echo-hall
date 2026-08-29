#!/usr/bin/env node
'use strict';
// 诊断用: 渲染掼蛋 招募态/对局 的 竖屏+横屏(.is-land), 截图到 /tmp/eh-diag, 供肉眼看版面问题。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const OUT = '/tmp/eh-diag'; fs.mkdirSync(OUT, { recursive:true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = require('playwright');

const CSSVARS = ':root{--accent:#00e5d4;--magenta:#ff2d8e;--amber:#ffc24d;--sub:#86cbc6;--dim:#498d88;--ink:#eaf6ff;'
  + '--bg:#070a12;--bg2:#0d1524;--panel:rgba(0,0,0,.2);--panel-solid:#132a29;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);'
  + '--glow-cyan:0 0 12px rgba(0,229,212,.5);--glow-mag:0 0 12px rgba(255,45,142,.6)}'
  + 'html,body{margin:0;background:#0a0e18;color:#eaf6ff;font-family:system-ui,"PingFang SC",sans-serif}'
  + '#hall{position:relative;width:100%;height:100vh;overflow:hidden}';

const MODS = ['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','table-orient.js','guandan-ui.js'];
const LOBBY_SEATS = JSON.stringify([
  {seat:0,kind:'human',name:'深海狐狸',emoji:'🦊'},
  {seat:1,kind:'empty'},
  {seat:2,kind:'soul',name:'狼姐',emoji:'🐺'},
  {seat:3,kind:'empty'},
]);

async function shot(browser, name, vp, land, kind){
  const ctx = await browser.newContext({ viewport:vp, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>'+CSSVARS+'</style><body><div id="hall"></div>', { waitUntil:'load' });
  for (const f of MODS) await page.addScriptTag({ content:G(f) });
  await page.evaluate(({kind,seats})=>{
    if (kind==='lobby'){
      window.EHGuandanGame.open({ mount:document.getElementById('hall'), lobby:true, isHost:true,
        names:['深海狐狸','','狼姐',''], avatars:['🦊','','🐺',''],
        lobbySeats: JSON.parse(seats),
        lobbyCtx:{ souls:[{auth_uid:'s1',name:'午夜DJ',emoji:'📻'}],
          actions:{ seatSoul(){},kick(){},start(){},inviteHumans(){},oneClick(){} } },
        onResult(){} });
    } else {
      window.EHGuandanGame.open({ mount:document.getElementById('hall'),
        names:['深海狐狸','灵魂下','狼姐','灵魂上'], avatars:['🦊','🔥','🐺','⚡'], onResult(){} });
    }
  }, { kind, seats:LOBBY_SEATS });
  await page.waitForTimeout(1600);
  if (kind==='over'){
    // 注入样例战报卡片, 验证结算页盖满全屏(不漏底部座位/理牌钮)+ 玻璃卡片样式
    await page.evaluate(()=>{
      const r=document.querySelector('.gd-room'); r.dataset.phase='over';
      const o=document.createElement('div'); o.className='gd-over win';
      o.innerHTML=`<div class="gd-over-panel"><h2>🎉 胜利</h2>
        <div class="rank-list">
          <div class="rank-row me"><span class="r">头游</span><span>深海狐狸（你）</span></div>
          <div class="rank-row"><span class="r">二游</span><span>狼姐（队友）</span></div>
          <div class="rank-row"><span class="r">三游</span><span>灵魂下</span></div>
          <div class="rank-row"><span class="r">末游</span><span>灵魂上</span></div>
        </div>
        <div class="lvlup">我方升级：2 → <b>4</b>（+2，双下）</div>
        <div class="gd-cum">本桌累计 · <span class="cm mine">我方 打<b>4</b> · 胜1副</span><span class="cm foe">对方 打<b>2</b> · 胜0副</span></div>
        <div class="gd-acts" style="margin-top:4px"><button class="gd-btn" id="gdAgain">打下一副 (5)</button><button class="gd-btn primary" id="gdDone">收工</button></div>
      </div>`;
      r.appendChild(o);
    });
  }
  if (land) await page.evaluate(()=>{ const r=document.querySelector('.gd-room'); if(window.EHTableOrient) window.EHTableOrient.reflect(r); else r.classList.add('is-land'); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, name+'.png') });
  if (errs.length) console.log('  ['+name+'] 报错:', errs.slice(0,2).join(' | '));
  console.log('  saved', name, JSON.stringify(vp), land?'(is-land)':'');
  await ctx.close();
}

(async()=>{
  const browser = await chromium.launch({ executablePath: CHROME });
  await shot(browser,'lobby-portrait',{width:390,height:844},false,'lobby');
  await shot(browser,'lobby-land',{width:812,height:375},true,'lobby');
  await shot(browser,'play-portrait',{width:390,height:844},false,'play');
  await shot(browser,'play-land',{width:812,height:375},true,'play');
  await shot(browser,'over-portrait',{width:390,height:844},false,'over');
  await shot(browser,'over-land',{width:812,height:375},true,'over');
  await browser.close();
  console.log('done →', OUT);
})();
