#!/usr/bin/env node
'use strict';
/* 验证德州打牌态: (a)对手沿宽弧均衡分布(不再堆顶) (b)单机常规手结算走"桌面赢家横幅+推池"而非弹窗。
 * 开单机 6 人局→等发牌→截"打牌态"; 再弃牌逼本手结束→截"赢家横幅"。日间+夜间。
 * 用法: node scripts/shot-poker-play.js <out前缀>  → /tmp/eh-lobby/<前缀>-play-*.png / -over-*.png */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const PREFIX = process.argv[2] || 'pk';
const SHOT_DIR = '/tmp/eh-lobby';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const DAY = '--bg:#eff8f8;--bg2:#daf1ef;--panel:rgba(255,255,255,.9);--panel-solid:#ffffff;--line:rgba(0,127,118,0.28);--line2:rgba(0,127,118,0.42);--ink:#0c312e;--sub:#3d8f89;--dim:#81bbb7;--cyan:#007f76;--magenta:#ef006e;--violet:#7b5cff;--amber:#C8892E;--green:#148566;--accent:#007f76;--grid:rgba(0,127,118,0.06);--glow-cyan:0 2px 10px rgba(0,127,118,0.18);--glow-mag:0 2px 10px rgba(239,0,110,0.16);';
const NIGHT = '--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';

let chromium;
try { ({ chromium } = require('playwright')); }
catch(_) { try { ({ chromium } = require('playwright-core')); } catch(__) {} }
const EXE = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});

async function shot(browser, palette, tag){
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  const modeAttr = tag==='day' ? ' data-mode="day"' : '';
  await page.setContent('<!doctype html><html'+modeAttr+'><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>html{'+palette+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"PingFang SC",sans-serif}'
    + '#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>', { waitUntil:'load' });
  for (const f of ['deck.js','poker-engine.js','poker-eval.js','poker-ai.js','poker-ui.js']) await page.addScriptTag({ content: G(f) });
  await page.evaluate(() => {
    const noop=()=>{};
    // 让 AI 一律弃牌: 一轮翻牌前就折到只剩一家→本手秒结束→稳定触发结算(桌面横幅), 免等满街慢思考
    try{ if(window.EHPokerAI){ window.EHPokerAI.decide = ()=>({action:'fold'}); } }catch(_){}
    window.EHPokerGame.open({
      names:['量子麋鹿','午夜DJ','代码微光','雾中人','拾荒者','回声'],
      avatars:['🦌','📻','💡','🌫️','🧺','🔊'],
      isAI:[false,true,true,true,true,true], seed:20260909,
      onResult:noop, onExit:noop,
    });
  });
  // 等发牌(过入座序列): 轮询到 pk-me 出现底牌卡
  await page.waitForFunction(()=>document.querySelector('#pkMe .pk-hole .card'), { timeout: 12000 }).catch(()=>{});
  await page.waitForTimeout(700);
  let out = path.join(SHOT_DIR, PREFIX+'-play-'+tag+'.png');
  await page.screenshot({ path: out }); console.log('  📸 '+out);

  // 逼本手结束: 我先弃牌(减少我方牵连), 之后 AI 互打到本手结束 —— 边等边点掉后续轮到我的预选, 直到桌面出现赢家横幅
  const folded = await page.evaluate(async ()=>{
    let clicked=false;
    for (let i=0;i<180;i++){
      if (document.querySelector('.pk-winline')||document.querySelector('.pk-over')) return clicked?'folded':'over';
      const fold=[...document.querySelectorAll('.pk-b')].find(b=>/弃牌|Fold/.test(b.textContent)&&!b.disabled);
      if (fold){ fold.click(); clicked=true; }
      await new Promise(r=>setTimeout(r,200));
    }
    return 'timeout';
  });
  // 抓拍: 横幅只停 ~2.3s, 出现即刻截, 别等淡出
  await page.waitForFunction(()=>document.querySelector('.pk-winline')||document.querySelector('.pk-over'), { timeout: 36000 }).catch(()=>{});
  await page.waitForTimeout(140);
  out = path.join(SHOT_DIR, PREFIX+'-over-'+tag+'.png');
  await page.screenshot({ path: out }); console.log('  📸 '+out+'  ('+folded+')');
  const hasBanner = await page.evaluate(()=>!!document.querySelector('.pk-winline'));
  const hasDialog = await page.evaluate(()=>!!document.querySelector('.pk-over'));
  console.log('    横幅='+hasBanner+' 弹窗='+hasDialog);
  if (errs.length) console.log('  ⚠ 渲染报错['+tag+']:', errs.slice(0,4).join(' | '));
  await ctx.close();
}

(async () => {
  if (!chromium || !EXE){ console.log('缺 playwright/Chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE });
  await shot(browser, NIGHT, 'night');
  await shot(browser, DAY, 'day');
  await browser.close();
  console.log('done');
})().catch(e=>{ console.error(e); process.exit(1); });
