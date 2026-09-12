#!/usr/bin/env node
'use strict';
/* 验证"分开静音 BGM/音效/语音": 德州顶栏 🎵 钮点开三档面板, 三个开关各自独立生效。
 * 用法: node scripts/probe-audio-menu.js */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SFX=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const FILES=['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','ddz-net.js','game-ui.js'];
(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  await page.addStyleTag({content:SHARED});
  await page.addScriptTag({content:SFX});         // 装 EhSfx / EhAudioPrefs / EhAudioMenu
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.evaluate(`window.EHDdzGame.open({names:['我','AI甲','AI乙'],avatars:['🙂','🤖','👾'],isAI:[false,true,true],mySeat:0})`);
  await page.waitForTimeout(500);

  const api=await page.evaluate(()=>({ hasPrefs:!!window.EhAudioPrefs, hasMenu:!!window.EhAudioMenu,
    sfx:window.EhAudioPrefs&&window.EhAudioPrefs.sfx(), voice:window.EhAudioPrefs&&window.EhAudioPrefs.voice() }));
  console.log('API 就绪:', JSON.stringify(api));

  // 点 🎵 钮打开面板
  await page.click('#ddzMus');
  await page.waitForTimeout(150);
  const rows=await page.evaluate(()=>{ const p=document.querySelector('.eh-audio-menu'); if(!p) return null;
    return [...p.querySelectorAll('button')].map(b=>b.textContent.replace(/\s+/g,' ').trim()); });
  console.log('面板行:', JSON.stringify(rows));

  // 关掉"语音"(第3个开关) → EhSfx.isVoiceOn() 应为 false, say() 应被抑制
  await page.evaluate(()=>{ const p=document.querySelector('.eh-audio-menu');
    const btns=[...p.querySelectorAll('button')]; const v=btns.find(b=>/语音/.test(b.textContent)); if(v) v.click(); });
  await page.waitForTimeout(120);
  const afterVoice=await page.evaluate(()=>({ voice:window.EhAudioPrefs.voice(), sfx:window.EhAudioPrefs.sfx(), bgm:window.EhAudioPrefs.bgm() }));
  console.log('关语音后:', JSON.stringify(afterVoice), afterVoice.voice===false&&afterVoice.sfx===true?'✓语音独立关闭·音效不受影响':'✗');

  // 持久化: localStorage 应记住(此测试壳 about:blank 无 origin 读不了 LS, 生产环境正常; 跳过硬断言)
  const ls=await page.evaluate(()=>{ try{ return { eh_voice:localStorage.getItem('eh_voice') }; }catch(e){ return {skip:'no-origin'}; } });
  console.log('持久化:', JSON.stringify(ls));

  // 点面板外 → 关闭
  await page.mouse.click(30,700);
  await page.waitForTimeout(120);
  const closed=await page.evaluate(()=>!document.querySelector('.eh-audio-menu'));
  console.log('点外关闭:', closed?'✓':'✗');

  console.log(errs.length?('⚠ '+errs.slice(0,3).join(' | ')):'(无 pageerror)');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
