#!/usr/bin/env node
'use strict';
/* 验证: 报牌/操作语音(EhSfx.say)播放期间压低 BGM, 修"牌桌上 BGM+音效+报牌语音 三条声硬叠、报牌听不清"。
 *   D1 一说话就 duck(true)(同步)。
 *   D2 连续报牌期间不抬回(duck(false) 不被调用) —— 一串报完才恢复, 避免音量抖动。
 *   D3 最后一句念完(onend)~800ms 后抬回一次 duck(false)。
 *   D4 关语音(setVoice(false))后再 say 不 duck; 且关的当下把已压低的 BGM 抬回。
 *   D5 onend 丢失(部分浏览器)时, 超时兜底仍会抬回 —— 绝不把 BGM 焊死在低音量。
 * 用 Node vm 跑 sfx-engine.js(喂假 window/speechSynthesis/AudioEngine), 不启浏览器 → 确定性、秒级、不卡。 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const ROOT=path.join(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/sfx-engine.js'),'utf8');

// ---- 假 DOM/浏览器环境 ----
const duckLog=[];      // 记录 AudioEngine.duck 调用
let spoken=[];         // 记录被念出的文本
let fireEnd=true;      // false 时模拟"onend 丢失"(部分浏览器行为), 靠兜底恢复
const END_DELAY=30;

const ls={ _d:{}, getItem(k){ return (k in this._d)?this._d[k]:null; }, setItem(k,v){ this._d[k]=String(v); } };
function SpeechSynthesisUtterance(t){ this.text=t; this.onend=null; this.onerror=null; }
const speechSynthesis={
  getVoices(){ return [{name:'Tingting', lang:'zh-CN'}]; },
  cancel(){ /* 打断: 真浏览器会给被打断句发 onerror, 这里不触发, 靠 seq 守卫即可 */ },
  speak(u){ spoken.push(u.text); if(fireEnd){ setTimeout(()=>{ try{ u.onend && u.onend(); }catch(_){} }, END_DELAY); } },
  onvoiceschanged:null,
};
const ctx={
  console, Math, Date, JSON, String, Number, Boolean, Set, Array, Object,
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance:{ now:()=>Date.now() },
  localStorage: ls,
  document:{ addEventListener(){}, removeEventListener(){}, hidden:false, createElement(){ return { style:{}, classList:{add(){},remove(){}}, appendChild(){}, remove(){}, addEventListener(){} }; }, body:{ appendChild(){} } },
  navigator:{},
  AudioContext:function(){ throw new Error('no audio ctx in node'); },   // say 不需要; play 才用, 且在 try 内
};
ctx.window=ctx; ctx.self=ctx;
ctx.SpeechSynthesisUtterance=SpeechSynthesisUtterance;
ctx.speechSynthesis=speechSynthesis;
vm.createContext(ctx);
vm.runInContext(SRC, ctx);

// 覆盖 AudioEngine 为 spy(say 内 _bgmDuck 惰性取 window.AudioEngine → 拿到 spy)
ctx.AudioEngine={ duck(on){ duckLog.push(!!on); } };
const EhSfx=ctx.EhSfx;
if(!EhSfx||!EhSfx.say){ console.log('❌ 未取到 EhSfx.say'); process.exit(1); }
EhSfx.setVoice(true);

const wait=ms=>new Promise(r=>setTimeout(r,ms));
let ok=true; const fail=m=>{ok=false;console.log('❌ '+m);};
const reset=()=>{ duckLog.length=0; spoken=[]; };
const WHO=n=>({name:n, key:n, isSoul:true});

(async()=>{
  // ---------- D1 一说话即 duck(true) ----------
  console.log('===== D1 say 立即压低 BGM =====');
  reset();
  EhSfx.say('对三', WHO('狼姐'));
  if(duckLog[0]!==true) fail('D1 say 未触发 duck(true): '+JSON.stringify(duckLog));
  else console.log('✅ D1 say 同步触发 duck(true)');

  // ---------- D2 连续报牌期间不抬回 ----------
  console.log('===== D2 连续报牌期间保持压低 =====');
  reset();
  for(let i=0;i<4;i++) EhSfx.say('牌型'+i, WHO('老K'));   // 同步连发(模拟一圈几席快速出牌/连续过牌)
  if(duckLog.includes(false)) fail('D2 连续报牌途中过早抬回: '+JSON.stringify(duckLog));
  else if(!duckLog.includes(true)) fail('D2 期间未压低: '+JSON.stringify(duckLog));
  else console.log('✅ D2 连续报牌全程保持压低(未抖动抬回)');

  // ---------- D3 最后一句念完 ~800ms 后抬回 ----------
  console.log('===== D3 整串报完后抬回 =====');
  await wait(1100);   // 过 onend(30ms) + 恢复延迟(800ms)
  if(duckLog[duckLog.length-1]!==false) fail('D3 报完未抬回(末位应 false): onend不定, duck='+JSON.stringify(duckLog));
  else console.log('✅ D3 整串报完后抬回 duck(false)');

  // ---------- D4 关语音: 不再 duck, 且当下抬回 ----------
  console.log('===== D4 关语音不 duck 且抬回 =====');
  EhSfx.say('先压低', WHO('狼姐'));   // 先压低
  reset();
  EhSfx.setVoice(false);              // 关语音 → 应立即抬回
  const d4a=duckLog.slice();
  EhSfx.say('不该出声', WHO('狼姐'));  // 关后再说
  if(!d4a.includes(false)) fail('D4 关语音未抬回被压低的 BGM: '+JSON.stringify(d4a));
  else if(spoken.length) fail('D4 关语音后 say 竟仍出声: '+JSON.stringify(spoken));
  else if(duckLog.includes(true)) fail('D4 关语音后 say 竟仍 duck: '+JSON.stringify(duckLog));
  else console.log('✅ D4 关语音立即抬回、之后 say 不出声不 duck');

  // ---------- D5 onend 丢失: 超时兜底抬回 ----------
  console.log('===== D5 onend 丢失时兜底抬回 =====');
  EhSfx.setVoice(true); fireEnd=false;   // 让 speak 不触发 onend
  reset();
  EhSfx.say('无结束事件', WHO('图灵'));
  if(duckLog[0]!==true) fail('D5 未先压低: '+JSON.stringify(duckLog));
  // 兜底 est=min(8000,600+len*260/rate)+1600; 5字约 3.2s → 等 5s 保险
  await wait(5000);
  if(duckLog[duckLog.length-1]!==false) fail('D5 onend 丢失时兜底未抬回(会永久卡低音量): '+JSON.stringify(duckLog));
  else console.log('✅ D5 onend 丢失时超时兜底抬回, 不焊死低音量');

  console.log(ok?'\n🎉 全部通过':'\n💥 有失败');
  process.exit(ok?0:1);
})();
