#!/usr/bin/env node
'use strict';
/* journey-audio-exclusive.js — 音频互斥策略(TTS 压 BGM; 神曲/语音独占时 TTS 让路) */
const fs=require('fs'), path=require('path');
const sfx=fs.readFileSync(path.join(__dirname,'..','js/sfx-engine.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/EhAudioBus/.test(sfx), '存在 EhAudioBus');
assert(/hold\('tts'\)/.test(sfx), 'TTS hold 总线(压 BGM, 音乐/语音不同时响)');
assert(/busyExcept/.test(sfx), '神曲/语音播放时 TTS 让路不 cancel');
assert(/hold\('voice'\)/.test(app) && /release\('voice'\)/.test(app), '聊天语音独占');
assert(/hold\('song'\)/.test(app), '神曲独占');
assert(/window\.stopVoice\s*=\s*stopVoice/.test(app), 'stopVoice 可被引擎调用');
assert(/releaseAll\(\)/.test(app), '关 BGM 清全部人声占用');

console.log('\n'+(failed?'❌ 有失败':'✅ 音频互斥: TTS/BGM 不叠; 神曲语音优先'));
process.exit(failed?1:0);
