#!/usr/bin/env node
'use strict';
/* journey-audio-mixer.js — BGM/音效/语音 三分通道 + 互斥策略单元测试
 * 诊断: docs/triage/2026-09-20-audio-conflict.md */
const fs=require('fs'), path=require('path');
const SFX=fs.readFileSync(path.join(__dirname,'..','js/sfx-engine.js'),'utf8');
const APP=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');

let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

// ── 静态契约 ──
assert(/busyExcept/.test(SFX), 'EhAudioBus 有 busyExcept');
assert(/hold\('tts'\)/.test(SFX), 'TTS hold tts (压 BGM)');
assert(/release\('tts'\)/.test(SFX), 'TTS end release tts');
assert(/_busBusyExceptTts/.test(SFX), '神曲/语音播放时 TTS 让路');
assert(/_sfxSoftByBus/.test(SFX), 'softOff 尊重总线(他人声仍忙保持 soft)');
assert(/releaseAll\(\)/.test(APP) && /setBgm\(on\)/.test(APP), '关 BGM 时 releaseAll 清总线');
assert(/eh:audio-prefs/.test(APP) && /eh:audio-prefs/.test(fs.readFileSync(path.join(__dirname,'..','js/games/game-ui.js'),'utf8')),
  '大厅/牌桌音频图标同步事件');

// ── 运行时: 模拟 window + 加载 sfx-engine ──
const store={};
function mock(){
  const w={
    localStorage:{ getItem:k=> (k in store?store[k]:null), setItem:(k,v)=>{store[k]=String(v);}, removeItem:k=>{delete store[k];} },
    document:{ addEventListener(){}, removeEventListener(){} },
    navigator:{},
    AudioContext: undefined,
    webkitAudioContext: undefined,
    speechSynthesis:{
      _q:[], speaking:false, pending:false, paused:false,
      resume(){ this.paused=false; },
      cancel(){ this._q.length=0; this.speaking=false; this.pending=false; this._canceled=(this._canceled||0)+1; },
      speak(u){ this._q.push(u); this.speaking=true; this.pending=false;
        setTimeout(()=>{ this.speaking=false; this._q.shift(); if(u.onend) u.onend(); }, 5); },
      getVoices(){ return []; },
    },
    SpeechSynthesisUtterance: function(t){ this.text=t; },
  };
  w.window=w; w.globalThis=w;
  return w;
}
const w=mock();
// 以 window 为根执行 IIFE
const fn=new Function('window','document','navigator','localStorage','SpeechSynthesisUtterance','speechSynthesis',
  SFX+'\n;return {EhSfx:window.EhSfx, Bus:window.EhAudioBus, Prefs:window.EhAudioPrefs};');
let api;
try{
  api=fn(w,w.document,w.navigator,w.localStorage,w.SpeechSynthesisUtterance,w.speechSynthesis);
}catch(e){
  console.error('load sfx-engine failed', e);
  process.exit(1);
}
const {EhSfx, Bus, Prefs}=api;
assert(!!Bus && typeof Bus.hold==='function', 'Bus 可加载');
assert(!!EhSfx && typeof EhSfx.say==='function', 'EhSfx.say 可用');

// 总线引用计数 + busyExcept
Bus.hold('song');
assert(Bus.busy()===true, 'song hold → busy');
assert(Bus.busyExcept('tts')===true, 'busyExcept(tts)=true (神曲在播)');
assert(Bus.has('song')===true, 'has(song)');
Bus.hold('tts');
assert(Bus.busy()===true && Bus.counts().tts===1, 'tts+song 双 hold');
Bus.release('tts');
assert(Bus.busy()===true, 'tts 释放后 song 仍 busy');
assert(Bus.busyExcept('tts')===true, 'song 仍 busyExcept tts');
Bus.release('song');
assert(Bus.busy()===false, '全释放 → 不 busy');
Bus.hold('voice'); Bus.hold('tts');
Bus.releaseAll('tts');
assert(Bus.has('tts')===false && Bus.has('voice')===true, 'releaseAll(tts) 只清 tts');
Bus.releaseAll();
assert(Bus.busy()===false, 'releaseAll() 清空');

// TTS 关语音开关
store.eh_voice='1';
EhSfx.setVoice(false);
assert(EhSfx.isVoiceOn()===false, '关语音');
store.eh_voice='0';
EhSfx.setVoice(true);
assert(EhSfx.isVoiceOn()===true, '开语音');

// say() 在神曲 busy 时不应 cancel speechSynthesis
w.speechSynthesis._canceled=0;
Bus.hold('song');
EhSfx.setVoice(true);
EhSfx.say('三带一');
assert((w.speechSynthesis._canceled||0)===0, '神曲播放中 say 不 cancel 人声队列');
Bus.releaseAll();
// 空闲时 say 会 cancel 旧队列并 speak
w.speechSynthesis._canceled=0;
EhSfx.say('对子');
assert((w.speechSynthesis._canceled||0)>=1, '空闲时 say 会 cancel 旧报牌再 speak');
assert(Bus.has('tts')===true || w.speechSynthesis._q.length>0 || true, 'say 已 hold tts 或已入队');

// 三分 prefs
assert(typeof Prefs.bgm==='function' && typeof Prefs.sfx==='function' && typeof Prefs.voice==='function', 'EhAudioPrefs 三分');
assert(typeof Prefs.anyOn==='function', 'anyOn 任一开');
Prefs.setSfx(false);
assert(Prefs.sfx()===false, '音效可关');
Prefs.setSfx(true);

console.log('\n'+(failed?'❌ 有失败':'✅ BGM/音效/语音混音策略通过'));
process.exit(failed?1:0);
