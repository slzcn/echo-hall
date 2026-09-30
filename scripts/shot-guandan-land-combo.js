#!/usr/bin/env node
'use strict';
/* 复现主人反馈"横屏竖列组牌牌跑到右侧": 横屏视口(812×375)开单机掼蛋→满牌→切竖列组牌, 截图。
 * 用法: node scripts/shot-guandan-land-combo.js <out前缀>  → /tmp/eh-lobby/<前缀>-day.png / -night.png */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const PREFIX = process.argv[2] || 'gd-land';
const SHOT_DIR = '/tmp/eh-lobby';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const DAY = '--bg:#eff8f8;--bg2:#daf1ef;--panel:rgba(255,255,255,.9);--panel-solid:#ffffff;--line:rgba(0,127,118,0.28);--line2:rgba(0,127,118,0.42);--ink:#0c312e;--sub:#3d8f89;--dim:#81bbb7;--cyan:#007f76;--magenta:#ef006e;--violet:#7b5cff;--amber:#C8892E;--green:#148566;--accent:#007f76;--grid:rgba(0,127,118,0.06);--glow-cyan:0 2px 10px rgba(0,127,118,0.18);--glow-mag:0 2px 10px rgba(239,0,110,0.16);';
const NIGHT = '--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';

let chromium;
try { ({ chromium } = require('playwright')); }
catch(_) { try { ({ chromium } = require('playwright-core')); } catch(__) {} }
const EXE = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});

async function shot(browser, palette, tag){
  const ctx = await browser.newContext({ viewport:{width:812,height:375}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  const modeAttr = tag==='day' ? ' data-mode="day"' : '';
  await page.setContent('<!doctype html><html'+modeAttr+'><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>html{'+palette+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"PingFang SC",sans-serif}'
    + '#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>', { waitUntil:'load' });
  for (const f of ['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-ui.js']) await page.addScriptTag({ content: G(f) });
  await page.evaluate(() => {
    const noop=()=>{};
    // 残局复现: 包住 createGame, 把我(seat0)手牌裁到"一对+一炸"式的少牌(6 张), 触发少列竖列态
    const E = window.EHGuandanEngine, orig = E.createGame.bind(E);
    E.createGame = function(cfg){
      const g = orig(cfg);
      try{
        const h = g.players[0].hand;
        const pick = [];
        const byR = new Map();
        for (const c of h){ if(c.joker) continue; const r=c.label; if(!byR.has(r)) byR.set(r,[]); byR.get(r).push(c); }
        // 找一个凑够 4 张的点数当炸, 再找一个凑 2 张的当对子
        let bomb=null, pair=null;
        for (const [r,cs] of byR){ if(!bomb && cs.length>=4) bomb=cs.slice(0,4); }
        for (const [r,cs] of byR){ if(!pair && cs.length>=2 && cs!==bomb) pair=cs.slice(0,2); }
        if (bomb) pick.push(...bomb); if (pair) pick.push(...pair);
        if (pick.length>=4) g.players[0].hand = pick;
        else g.players[0].hand = h.slice(0,6);
      }catch(_){}
      return g;
    };
    window.EHGuandanGame.open({
      names:['量子麋鹿','下家','对家','上家'], avatars:['🦌','🤖','🤝','👾'],
      isAI:[false,true,true,true], seed:12345,
      onResult:noop,
    });
  });
  await page.waitForTimeout(500);
  // 切竖列组牌: 对 #gdSort 派发一次短按(pointerdown→pointerup)
  await page.evaluate(() => {
    const b = document.getElementById('gdSort'); if(!b) return;
    const r = b.getBoundingClientRect(); const x=r.left+r.width/2, y=r.top+r.height/2;
    const opt = {bubbles:true, cancelable:true, pointerId:1, pointerType:'touch', clientX:x, clientY:y};
    b.dispatchEvent(new PointerEvent('pointerdown', opt));
    setTimeout(()=>{ b.dispatchEvent(new PointerEvent('pointerup', opt)); }, 60);
  });
  await page.waitForTimeout(600);
  const out = path.join(SHOT_DIR, PREFIX+'-'+tag+'.png');
  await page.screenshot({ path: out });
  if (errs.length) console.log('  ⚠ 渲染报错['+tag+']:', errs.slice(0,3).join(' | '));
  console.log('  📸 '+out);
  await ctx.close();
}

(async () => {
  if (!chromium || !EXE){ console.log('缺 playwright/Chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE });
  await shot(browser, DAY, 'day');
  await shot(browser, NIGHT, 'night');
  await browser.close();
  console.log('done');
})().catch(e=>{ console.error(e); process.exit(1); });
