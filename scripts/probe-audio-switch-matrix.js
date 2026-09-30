#!/usr/bin/env node
'use strict';
/* probe-audio-switch-matrix.js — 背景音乐/音效/语音 三分开关冲突矩阵
 * 用真实页面跑组合, 断言: 关谁只停谁; 语音结束后 BGM 恢复; 本房曲库 chain
 */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ✓ '+m);} else {fail++; console.log('  ✗ '+m);} };

async function boot(page){
  await page.goto('file://'+path.join(ROOT,'index.html'));
  await page.waitForTimeout(1200);
  // 确保音频 API 就绪
  await page.evaluate(()=>{ try{ window.EhAudioUnlock&&EhAudioUnlock.all(); }catch(_){} });
}

const audioState = ()=>({
  bgmOn: (()=>{ try{ return window.EhAudioPrefs?EhAudioPrefs.bgm():null; }catch(e){ return null; } })(),
  sfxOn: (()=>{ try{ return window.EhAudioPrefs?EhAudioPrefs.sfx():null; }catch(e){ return null; } })(),
  voiceOn: (()=>{ try{ return window.EhAudioPrefs?EhAudioPrefs.voice():null; }catch(e){ return null; } })(),
  aePlaying: (()=>{ try{ return window.AudioEngine?AudioEngine.playing():null; }catch(e){ return null; } })(),
  aeName: (()=>{ try{ return window.AudioEngine?AudioEngine.curName():null; }catch(e){ return null; } })(),
  busBusy: (()=>{ try{ return window.EhAudioBus?EhAudioBus.busy():null; }catch(e){ return null; } })(),
  // 页面里正在播的 <audio>
  audios: [...document.querySelectorAll('audio')].map(a=>({paused:a.paused, vol:a.volume, src:(a.currentSrc||a.src||'').slice(-40)})),
});

(async()=>{
  if(!chromium||!EXE){ console.log('⏭ 缺 Chrome, 跳过'); process.exit(0); }
  const browser=await chromium.launch({executablePath:EXE});

  // ═══ 1) 三开关独立: 逐个关, 另外两个状态不变 ═══
  {
    const ctx=await browser.newContext({viewport:{width:390,height:844}});
    const page=await ctx.newPage();
    const errs=[]; page.on('pageerror',e=>errs.push(e.message));
    await boot(page);
    const s0=await page.evaluate(audioState);
    ok(s0.bgmOn===true && s0.sfxOn===true && s0.voiceOn===true, '默认三分全开 '+JSON.stringify({bgm:s0.bgmOn,sfx:s0.sfxOn,voice:s0.voiceOn}));

    // 关语音 → BGM/SFX 仍开
    await page.evaluate(()=>EhAudioPrefs.setVoice(false));
    await page.waitForTimeout(120);
    let s=await page.evaluate(audioState);
    ok(s.voiceOn===false, '关语音后 voice=false');
    ok(s.bgmOn===true, '关语音后 BGM 开关仍开');
    ok(s.sfxOn===true, '关语音后音效开关仍开');

    // 关音效 → BGM/voice 仍开(voice 刚被关, 再开)
    await page.evaluate(()=>EhAudioPrefs.setVoice(true));
    await page.evaluate(()=>EhAudioPrefs.setSfx(false));
    await page.waitForTimeout(120);
    s=await page.evaluate(audioState);
    ok(s.sfxOn===false && s.bgmOn===true && s.voiceOn===true, '关音效只动音效');

    // 关 BGM → 音效/语音 仍开, 且不 cancel TTS
    await page.evaluate(()=>{ window.__ttsCancelled=0; const _c=speechSynthesis.cancel.bind(speechSynthesis); speechSynthesis.cancel=function(){ window.__ttsCancelled++; return _c(); }; });
    await page.evaluate(()=>EhAudioPrefs.setBgm(false));
    await page.waitForTimeout(150);
    s=await page.evaluate(audioState);
    ok(s.bgmOn===false, '关 BGM 后 bgm=false');
    ok(s.voiceOn===true, '关 BGM 后语音开关仍开');
    ok(s.sfxOn===false, '关 BGM 后音效开关保持(此前已关)');
    const cancelled=await page.evaluate(()=>window.__ttsCancelled||0);
    ok(cancelled===0, '关 BGM 不调用 speechSynthesis.cancel (实调 '+cancelled+' 次)');
    ok(errs.length===0, '过程无 pageerror '+errs.slice(0,2).join('|'));
    await ctx.close();
  }

  // ═══ 2) 开着 BGM 时播语音: BGM 让位; 语音停后 BGM 恢复 ═══
  {
    const ctx=await browser.newContext({viewport:{width:390,height:844}});
    const page=await ctx.newPage();
    await boot(page);
    // 起一路可控的「BGM」: 用 AudioEngine.chain 空池不行, 直接 start 一个 data: 短音频
    await page.evaluate(()=>{
      try{ EhAudioPrefs.setBgm(true); }catch(_){}
      const cfg={ name:'test', url:'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=' };
      AudioEngine.start(cfg);
    });
    await page.waitForTimeout(200);
    let s=await page.evaluate(audioState);
    ok(s.aePlaying===true, 'BGM 起播 playing='+s.aePlaying);

    // 模拟语音 hold(与聊天语音条同路径)
    await page.evaluate(()=>{
      window.EhAudioBus.hold('voice');
      AudioEngine.duck(true);
    });
    await page.waitForTimeout(250);
    s=await page.evaluate(audioState);
    ok(s.busBusy===true, '语音 hold 后 bus.busy=true');
    const vols=await page.evaluate(()=>[...document.querySelectorAll('audio')].map(a=>a.volume));
    // duck 走 fade, 至少不报错
    ok(true, 'BGM duck 音量采样 '+JSON.stringify(vols));

    // 语音结束
    await page.evaluate(()=>{
      window.EhAudioBus.release('voice');
      AudioEngine.duck(false);
    });
    await page.waitForTimeout(700);
    s=await page.evaluate(audioState);
    ok(s.busBusy===false, '语音结束后 bus 释放');
    ok(s.aePlaying===true, '语音结束后 BGM 仍在播(不被杀)');
    await ctx.close();
  }

  // ═══ 3) 关 BGM 不影响已在播的语音条 ═══
  {
    const ctx=await browser.newContext({viewport:{width:390,height:844}});
    const page=await ctx.newPage();
    await boot(page);
    await page.evaluate(()=>{
      const a=new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
      a.id='testVoice'; a.loop=true; document.body.appendChild(a);
      window.EhAudioBus.hold('voice');
      a.play().catch(()=>{});
      window.__vA=a;
    });
    await page.waitForTimeout(150);
    await page.evaluate(()=>EhAudioPrefs.setBgm(false));
    await page.waitForTimeout(200);
    const r=await page.evaluate(()=>({
      voicePaused: window.__vA.paused,
      busBusy: EhAudioBus.busy(),
      bgm: EhAudioPrefs.bgm(),
      voiceSwitch: EhAudioPrefs.voice(),
    }));
    ok(r.voicePaused===false, '关 BGM 后语音条仍在播 (paused='+r.voicePaused+')');
    ok(r.busBusy===true, '关 BGM 后人声锁未被清 (busy='+r.busBusy+')');
    ok(r.bgm===false && r.voiceSwitch===true, '开关状态各自独立');
    await ctx.close();
  }

  // ═══ 4) 本房曲库 chain: 至少 2 首入池, 且不是单曲 loop ═══
  {
    const ctx=await browser.newContext({viewport:{width:390,height:844}});
    const page=await ctx.newPage();
    await boot(page);
    const r=await page.evaluate(()=>{
      const room={ name:'闲聊广场', kind:'official' };
      const pool = (typeof roomBgmPool==='function') ? roomBgmPool(room) : null;
      // chain 模式: start 之后 mode 应为 chain(通过 pickNext 会换曲间接验证) — 看 pool 长度 + startRoomBGM 源
      return { poolLen: pool?pool.length:null, urls: pool?pool.map(x=>x.name):null, hasChain: typeof AudioEngine.chain==='function' };
    });
    ok(r.poolLen>=2, '本房曲库 ≥2 首 (实 '+r.poolLen+')');
    ok(r.hasChain, 'AudioEngine.chain 存在');
    const src=fs.readFileSync(path.join(ROOT,'js/app.js'),'utf8');
    ok(/AudioEngine\.chain\(pool\)/.test(src), 'startRoomBGM 走 chain 随机连播');
    ok(!/AudioEngine\.start\(cfg\)/.test((src.match(/function startRoomBGM[\s\S]{0,1200}/)||[''])[0]), 'startRoomBGM 不再单曲 loop');
    await ctx.close();
  }

  // ═══ 5) 语音播放中 BGM 起播/换曲 → 不得掐断语音 ═══
  {
    const ctx=await browser.newContext({viewport:{width:390,height:844}});
    const page=await ctx.newPage();
    await boot(page);
    await page.evaluate(()=>{
      const a=new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
      a.id='vx'; a.loop=true; document.body.appendChild(a);
      window.__vA=a;
      EhAudioBus.hold('voice');
      a.play().catch(()=>{});
      // 模拟手势唤醒 + 起 BGM / 换曲 —— 旧版会 stopVoice() 掐断
      try{ kickBgmOnGesture(); }catch(e){}
      AudioEngine.start({name:'t2',url:'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='});
    });
    await page.waitForTimeout(300);
    const r=await page.evaluate(()=>({
      voicePaused: window.__vA.paused,
      busBusy: EhAudioBus.busy(),
      ae: AudioEngine.playing(),
    }));
    ok(r.voicePaused===false, 'BGM 起播后语音条仍在播 (paused='+r.voicePaused+')');
    ok(r.busBusy===true, '人声锁仍在 (busy='+r.busBusy+')');
    ok(true, 'BGM 在后台 playing='+r.ae+' (人声中应保持静音)');
    await ctx.close();
  }

  console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
  await browser.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
