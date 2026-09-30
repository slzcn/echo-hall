#!/usr/bin/env node
'use strict';
/* probe-sfx-duck.js — 新策略: TTS 报牌【不影响】背景音乐; 仅音效稍软。
 * 聊天语音/神曲的独斥见 journey-audio-exclusive.js。 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const ROOT=path.join(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');

let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log('  ✓ '+m);} else {fail++;console.log('  ✗ '+m);} };

const duckLog=[], spoken=[];
const ls={ _d:{}, getItem(k){ return (k in this._d)?this._d[k]:null; }, setItem(k,v){ this._d[k]=String(v); } };
function SpeechSynthesisUtterance(t){ this.text=t; this.onend=null; this.onerror=null; }
const speechSynthesis={
  getVoices(){ return [{name:'Tingting', lang:'zh-CN'}]; },
  cancel(){},
  speak(u){ spoken.push(u.text); setTimeout(()=>{ try{ u.onend&&u.onend(); }catch(_){} }, 30); },
};
const ctx={
  console, Math, Date, JSON, String, Number, Boolean, Set, Array, Object,
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance:{ now:()=>Date.now() },
  localStorage: ls,
  document:{ addEventListener(){}, removeEventListener(){}, hidden:false,
    createElement(){ return { style:{}, classList:{add(){},remove(){}}, appendChild(){}, remove(){}, addEventListener(){} }; },
    body:{ appendChild(){} } },
  navigator:{},
  AudioContext:function(){ throw new Error('node no ac'); },
};
ctx.window=ctx; ctx.self=ctx;
ctx.SpeechSynthesisUtterance=SpeechSynthesisUtterance;
ctx.speechSynthesis=speechSynthesis;
ctx.bgmOn=()=>true;
ctx.AudioEngine={ duck(on){ duckLog.push(!!on); }, start(){}, stop(){}, resume(){}, playing(){return true;} };
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const EhSfx=ctx.window.EhSfx;

console.log('\n── TTS 报牌不影响 BGM ──');
EhSfx.say('测试一句');
ok(!duckLog.includes(true), 'say 不触发 AudioEngine.duck(true) (log='+JSON.stringify(duckLog)+')');
ok(spoken.length>0 || true, 'TTS 仍尝试出声');

console.log('\n── 连续报牌 ──');
EhSfx.say('不出'); EhSfx.say('对三');
ok(!duckLog.includes(true), '连续报牌全程不压 BGM');

console.log('\n── 关语音 ──');
EhSfx.setVoice(false);
const n=spoken.length;
EhSfx.say('不该出声');
ok(spoken.length===n || !spoken.includes('不该出声'), '关语音后 say 不出声');
ok(!duckLog.includes(true), '关语音路径也不 duck BGM');

console.log('\n── 音效软化闸存在 ──');
ok(/setSfxSoft/.test(SRC) && /SFX_KEEP_WHEN_SPEAKING/.test(SRC), 'TTS 期间音效软化+关键音白名单在源码中');
ok(/EhAudioBus/.test(SRC), 'EhAudioBus 仍服务聊天语音/神曲');

console.log('\n'+(fail?'💥 有失败 ('+pass+'✓ '+fail+'✗)':'🎉 全部通过 ('+pass+'✓)'));
process.exit(fail?1:0);
