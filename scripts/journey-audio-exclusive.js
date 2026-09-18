#!/usr/bin/env node
'use strict';
/* journey-audio-exclusive.js — 聊天语音/神曲与 BGM 互斥; TTS 报牌【不影响】背景乐 */
const fs=require('fs'), path=require('path');
const sfx=fs.readFileSync(path.join(__dirname,'..','js/sfx-engine.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/EhAudioBus/.test(sfx), '存在 EhAudioBus(语音消息/神曲用)');
assert(/setSfxSoft/.test(sfx) && /SFX_KEEP_WHEN_SPEAKING/.test(sfx), 'TTS 仅软化音效, 不碰 BGM');
// 主人: TTS 不得 hold 总线 / 不得 duck BGM
const ttsBlock = sfx.slice(sfx.indexOf('function say('), sfx.indexOf('function say(')+2500);
assert(!/EhAudioBus\s*&&\s*window\.EhAudioBus\.(hold|replace)\('tts'\)/.test(ttsBlock),
  'TTS say 不 hold EhAudioBus(不影响 BGM)');
assert(/hold\('voice'\)/.test(app) && /release\('voice'\)/.test(app), '聊天语音消息仍独占(压 BGM)');
assert(/hold\('song'\)/.test(app), '神曲仍独占');
assert(/window\.stopVoice\s*=\s*stopVoice/.test(app), 'stopVoice 可被引擎调用');

console.log('\n'+(failed?'❌ 有失败':'✅ 音频策略: TTS 不影响 BGM; 语音/神曲独占'));
process.exit(failed?1:0);
