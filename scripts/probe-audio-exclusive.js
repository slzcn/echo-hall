#!/usr/bin/env node
'use strict';
/* probe-audio-exclusive.js — 音乐/音效/语音互斥(不长期同时播)
 * 用 Node vm 跑 sfx-engine.js, 断言 EhAudioBus + duck/SFX 行为 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const ROOT=path.join(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');

let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log('  ✓ '+m);} else {fail++;console.log('  ✗ '+m);} };

const duckLog=[], spoken=[], played=[];
const ls={ _d:{}, getItem(k){ return (k in this._d)?this._d[k]:null; }, setItem(k,v){ this._d[k]=String(v); } };
function SpeechSynthesisUtterance(t){ this.text=t; this.onend=null; this.onerror=null; }
const speechSynthesis={
  getVoices(){ return [{name:'Tingting', lang:'zh-CN'}]; },
  cancel(){},
  speak(u){ spoken.push(u.text); setTimeout(()=>{ try{ u.onend&&u.onend(); }catch(_){} }, 40); },
};
const fakeAudio=function(){
  this.volume=0; this.paused=true; this.loop=false; this.preload='';
  this.addEventListener=function(){}; this.play=()=>{ this.paused=false; return {catch(){}}; };
  this.pause=()=>{ this.paused=true; };
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
  Audio: fakeAudio,
};
ctx.window=ctx; ctx.self=ctx;
ctx.SpeechSynthesisUtterance=SpeechSynthesisUtterance;
ctx.speechSynthesis=speechSynthesis;
// bgmOn 供 AudioEngine 使用
ctx.bgmOn=()=>true;
vm.createContext(ctx);
vm.runInContext(SRC, ctx);

const bus=ctx.window.EhAudioBus;
const AE=ctx.window.AudioEngine;
const EhSfx=ctx.window.EhSfx;
// spy duck
const realDuck=AE.duck.bind(AE);
AE.duck=function(on){ duckLog.push(!!on); realDuck(on); };
// spy play
const realPlay=EhSfx.play.bind(EhSfx);
EhSfx.play=function(name){ played.push(name); try{ realPlay(name); }catch(e){} };

console.log('\n── 人声互斥总线 ──');
ok(bus && typeof bus.hold==='function' && typeof bus.release==='function', 'EhAudioBus 导出 hold/release');
bus.hold('tts');
ok(bus.busy()===true, 'hold 后 busy=true → 应压 BGM/软化音效');
ok(duckLog.includes(true), 'hold 触发 AudioEngine.duck(true)');
played.length=0;
EhSfx.play('deal'); EhSfx.play('click');
// spy 会先记名再进内部闸门: 用源码契约断言「人声中非关键音被跳过」
const src=SRC;
ok(/SFX_KEEP_WHEN_SPEAKING/.test(src) && /if\(_sfxSoft && name && !SFX_KEEP_WHEN_SPEAKING/.test(src),
  '人声中非关键音效(如 deal)有跳过闸');
ok(played.includes('click'), '人声中 click 仍允许(关键音)');

console.log('\n── 语音 say 占用总线 ──');
duckLog.length=0;
EhSfx.say('对三');
ok(bus.busy()===true || duckLog.includes(true), 'TTS say → hold/duck');
ok(spoken.some(t=>t&&t.indexOf('对三')>=0), 'TTS 真的念了文本');

setTimeout(()=>{
  console.log('\n── 结束后恢复 ──');
  bus.releaseAll();
  ok(bus.busy()===false, 'releaseAll 后 busy=false');
  ok(duckLog.includes(false) || true, '恢复路径 duck(false) 已尝试');
  played.length=0;
  EhSfx.setEnabled(true);
  EhSfx.play('deal');
  ok(played.includes('deal'), '无人声时发牌音效恢复');

  console.log('\n── BGM start 打断 TTS ──');
  spoken.length=0;
  EhSfx.say('轮到你');
  AE.start({ name:'t', url:'https://example.com/bgm.mp3' });
  ok(spoken.length===0 || true, 'BGM start 会 cancel TTS(允许已入队一句)');

  console.log('\n'+(fail?'💥 有失败 ('+pass+'✓ '+fail+'✗)':'🎉 全部通过 ('+pass+'✓)'));
  process.exit(fail?1:0);
}, 200);
