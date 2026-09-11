#!/usr/bin/env node
'use strict';
/* 复现"斗地主出牌时牌桌跳来跳去": 进叫分→抢地主→进出牌, 连打多手, 每手记录牌桌关键容器的位置,
 * 找出哪个容器在出牌/对手出牌时发生位移。用法: node scripts/probe-ddz-jump.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const SHOT='/tmp/eh-lobby'; fs.mkdirSync(SHOT,{recursive:true});
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});

// 只测这些"应当稳定"的结构容器(不含手牌/播放区这类本就会动的)
async function marks(page){
  return await page.evaluate(()=>{
    const pick=['.ddz-room','.ddz-bar','.ddz-felt','.ddz-mid','.ddz-table','#ddzBanner','.ddz-self','.ddz-hand-wrap','.ddz-acts','.ddz-oppo','.ddz-seat'];
    const out={};
    for(const sel of pick){ const el=document.querySelector(sel); if(!el) continue;
      const r=el.getBoundingClientRect(); out[sel]={x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)}; }
    return out;
  });
}
function diff(a,b){ const d=[]; for(const k of Object.keys(a)){ const p=a[k],q=b[k]; if(!q) continue;
  if(Math.abs(p.x-q.x)>1.5||Math.abs(p.y-q.y)>1.5||Math.abs(p.w-q.w)>1.5||Math.abs(p.h-q.h)>1.5)
    d.push(`   ${k}: x${p.x}->${q.x} y${p.y}->${q.y} w${p.w}->${q.w} h${p.h}->${q.h}`); } return d; }

(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"PingFang SC",sans-serif}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of ['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js']) await page.addScriptTag({content:G(f)});
  await page.evaluate(`window.EHDdzGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0})`);
  await page.addStyleTag({content:SHARED});
  await page.waitForTimeout(800);

  // 抢地主(叫 3 分)
  try{ await page.locator('.ddz-btn',{hasText:'3分'}).first().click({timeout:1500}); }catch(_){ try{await page.locator('.ddz-btn',{hasText:'抢'}).first().click({timeout:1000});}catch(__){}}
  await page.waitForTimeout(1600);
  // 加倍阶段: 选"不加倍"直接进出牌
  try{ await page.locator('.ddz-btn',{hasText:'不加倍'}).first().click({timeout:1500}); }catch(_){}
  await page.waitForTimeout(1600);
  console.log('叫分后阶段:', await page.evaluate(()=>{const b=document.querySelector('#ddzBanner');return b?b.textContent.trim():'(无banner)';}));

  let base=await marks(page); let maxJump={};
  await page.screenshot({path:path.join(SHOT,'ddzjump-0.png')});
  // 连打若干手: 每手截图 + 对比容器位移
  for(let t=1;t<=6;t++){
    // 我的回合: 提示→出牌; 非我回合: 等
    const isMine=await page.evaluate(()=>{ const b=document.querySelector('.ddz-btn');
      return !!document.querySelector('.ddz-acts .ddz-btn:not([disabled])'); });
    try{ await page.locator('.ddz-btn',{hasText:'提示'}).first().click({timeout:1200}); await page.waitForTimeout(150);
         await page.locator('.ddz-btn',{hasText:'出牌'}).first().click({timeout:1200}); }
    catch(_){ try{ await page.locator('.ddz-btn',{hasText:'不出'}).first().click({timeout:800}); }catch(__){}}
    await page.waitForTimeout(1100);
    const now=await marks(page);
    const d=diff(base,now);
    if(d.length) console.log(`第${t}手后 容器位移:\n`+d.join('\n'));
    else console.log(`第${t}手后 容器位移: 无`);
    await page.screenshot({path:path.join(SHOT,'ddzjump-'+t+'.png')});
    base=now;
  }
  console.log(errs.length?('⚠ '+errs.slice(0,2).join(' | ')):'(无 pageerror)');
  console.log('📸 /tmp/eh-lobby/ddzjump-*.png');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
