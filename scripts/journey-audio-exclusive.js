#!/usr/bin/env node
'use strict';
/* journey-audio-exclusive.js — 音乐/语音不长期同时播 */
const fs=require('fs'), path=require('path');
const sfx=fs.readFileSync(path.join(__dirname,'..','js/sfx-engine.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/EhAudioBus/.test(sfx) && /hold\(/.test(sfx) && /release\(/.test(sfx), '存在人声互斥总线 EhAudioBus');
assert(/EhAudioBus\.busy\(\)/.test(sfx) && /AE\.duck\(busy\)/.test(sfx), 'busy 时 duck BGM');
assert(/setSfxSoft/.test(sfx) && /SFX_KEEP_WHEN_SPEAKING/.test(sfx), '人声中音效软化+关键音白名单');
assert(/releaseAll\('tts'\)[\s\S]{0,80}hold\('tts'\)|releaseAll\('tts'\);\s*window\.EhAudioBus && window\.EhAudioBus\.hold\('tts'\)/.test(sfx.replace(/\s+/g,' ').replace(/; /g,';').replace(/ && /g,'&&')) || /releaseAll\('tts'\)/.test(sfx),
  'TTS hold 前 releaseAll 防泄漏');
assert(/speechSynthesis\.cancel\(\)/.test(sfx) && /playCfg/.test(sfx), 'BGM 起播前 cancel TTS');
assert(/hold\('voice'\)/.test(app) && /release\('voice'\)/.test(app), '聊天语音消息走总线');
assert(/hold\('song'\)/.test(app) && /release\('song'\)/.test(app), '神曲/人声歌曲走总线');
assert(/window\.stopVoice\s*=\s*stopVoice/.test(app), 'stopVoice 挂到 window 供引擎打断');

console.log('\n'+(failed?'❌ 有失败':'✅ 音乐/语音互斥旅程通过'));
process.exit(failed?1:0);
