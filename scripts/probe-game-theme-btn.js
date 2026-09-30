#!/usr/bin/env node
'use strict';
/* probe-game-theme-btn.js — 牌桌顶栏 🎨 换肤: 三款都有钮, 点开能切主题/日夜 */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const NIGHT='--bg:#070a12;--ink:#EAF6FF;--sub:#86cbc6;--line:rgba(0,229,212,0.24);--panel-solid:#132a29;--bg2:#0d1524;--accent:#00E5D4;';
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ✓ '+m);} else {fail++; console.log('  ✗ '+m);} };

const GAMES={
  ddz:{files:['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','game-ui.js'], open:'EHDdzGame', skin:'#ddzSkin', n:3},
  gd:{files:['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-ui.js'], open:'EHGuandanGame', skin:'#gdSkin', n:4},
  pk:{files:['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-ui.js'], open:'EHPokerGame', skin:'#pkSkin', n:2},
};

(async()=>{
  if(!chromium||!EXE){ console.log('⏭ 缺 Chrome'); process.exit(0); }
  const browser=await chromium.launch({executablePath:EXE});

  // 源码契约
  for(const [k,f] of [['ddz','js/games/game-ui.js'],['gd','js/games/guandan-ui.js'],['pk','js/games/poker-ui.js']]){
    const src=fs.readFileSync(path.join(ROOT,f),'utf8');
    ok(/eh-skin/.test(src)&&/EhThemeMenu\.toggle/.test(src), f+' 有 🎨 并接 EhThemeMenu');
  }
  ok(/EhThemeMenu/.test(fs.readFileSync(path.join(ROOT,'js/app.js'),'utf8')), 'app.js 暴露 EhThemeMenu');

  // 真机: 每款开桌 → 🎵 旁有 🎨 → 点开面板 → 选主题生效
  for(const [key,g] of Object.entries(GAMES)){
    const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
    const page=await ctx.newPage();
    const errs=[]; page.on('pageerror',e=>errs.push(e.message));
    await page.setContent(`<!doctype html><html data-mode="night"><meta charset=utf-8><style>html{${NIGHT}}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div></body></html>`,{waitUntil:'load'});
    await page.addStyleTag({content:fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8')});
    await page.addScriptTag({content:fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8')});
    await page.evaluate(()=>{ window.EhSfx=window.EhSfx||{play:()=>{},playClick:()=>{},say:()=>{}}; window.EhGameBgm={enter:()=>{},exit:()=>{}}; });
    // 最小 theme controller stub (与 app.js _themeCtrl 同签名)
    await page.evaluate(()=>{
      window.__themeLog=[];
      window.EhThemeMenu=(function(){
        let panel=null, anchor=null;
        return {
          toggle(a){
            if(panel && anchor===a){ panel.remove(); panel=null; return; }
            document.querySelectorAll('.eh-theme-menu').forEach(x=>x.remove());
            anchor=a;
            const p=document.createElement('div'); p.className='eh-theme-menu';
            p.style.cssText='position:fixed;z-index:99999;top:60px;right:8px;min-width:150px;padding:10px;background:#132a29;border:1px solid #ccc;border-radius:12px;color:#fff';
            p.innerHTML='<div data-theme="vapor">迈阿密日落</div><div data-mode="day">日间</div>';
            p.querySelector('[data-theme]').onclick=()=>{ window.__themeLog.push('theme:'+p.querySelector('[data-theme]').dataset.theme); p.remove(); panel=null; };
            p.querySelector('[data-mode]').onclick=()=>{ window.__themeLog.push('mode:day'); p.remove(); panel=null; };
            document.body.appendChild(p); panel=p;
          }
        };
      })();
    });
    for(const f of g.files) await page.addScriptTag({content:G(f)});
    await page.evaluate((g)=>{
      const names=['你','甲','乙','丙'].slice(0,g.n);
      const avatars=['🙂','🧑','👩','👨'].slice(0,g.n);
      const isAI=names.map((_,i)=>i!==0);
      window.__g=window[g.open].open({ names, avatars, isAI, mySeat:0, mount:document.getElementById('hall'), startStack:1000, sb:5, bb:10, startDeal:true });
    }, g);
    await page.waitForTimeout(400);
    const hasSkin=await page.locator(g.skin).count();
    ok(hasSkin>0, `[${key}] 顶栏有 🎨`);
    await page.click(g.skin);
    await page.waitForTimeout(150);
    const menuOpen=await page.locator('.eh-theme-menu').count();
    ok(menuOpen>0, `[${key}] 点 🎨 打开换肤面板`);
    if(menuOpen){
      await page.click('.eh-theme-menu [data-theme]');
      await page.waitForTimeout(100);
      const logged=await page.evaluate(()=>window.__themeLog);
      ok(logged.some(x=>String(x).startsWith('theme:')), `[${key}] 选主题已回调 pickTheme (${logged})`);
      await page.click(g.skin);
      await page.waitForTimeout(80);
      const menu2=await page.locator('.eh-theme-menu').count();
      ok(menu2>0, `[${key}] 再点 🎨 可再次打开`);
    }
    ok(errs.length===0, `[${key}] 无 pageerror ${errs.slice(0,1).join('|')}`);
    await ctx.close();
  }

  console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
  await browser.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
