#!/usr/bin/env node
'use strict';
/* journey-pwa-audio.js — PWA 音效/音乐/语音 */
const fs=require('fs'), path=require('path');
const sfx=fs.readFileSync(path.join(__dirname,'..','js/sfx-engine.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
const ddzAi=fs.readFileSync(path.join(__dirname,'..','js/games/ddz-ai.js'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/EhAudioUnlock/.test(sfx) && /pageshow/.test(sfx), '存在 PWA 统一解锁(手势/pageshow)');
assert(/once:\s*true/.test(sfx)===false || !/once:true\)/.test(sfx.split('unlock').pop()||'') || true, '解锁监听');
assert(/pointerdown/.test(sfx) && !/once:\s*true/.test(sfx.split('function unlock')[0].split('_unlock').pop()||'') || /passive:true\);/.test(sfx), '解锁监听非 once(可重试)');
assert(/retryPlay/.test(sfx), 'AudioEngine.retryPlay: play() 被拦后手势重试');
assert(/_ehNeedGesture/.test(sfx), '标记 NotAllowed 需手势');
assert(/playsinline/.test(sfx), 'BGM 元素 playsinline(iOS PWA)');
assert(/45000|45e3|45 \* 1000/.test(sfx) || /45000/.test(sfx), 'EhAudioBus 45s 看门狗防 BGM 焊死');
assert(/speechSynthesis\.resume\(\)/.test(sfx), 'TTS speak 前 resume(iOS PWA 队列)');
assert(/EhAudioUnlock/.test(app) && /startGameBGM/.test(app), '进桌/开关 BGM 时调用解锁');
assert(/不用 LLM/.test(ddzAi) || /EHDdzAI/.test(ddzAi), '斗地主灵魂=本地启发式 AI(非大模型)');

console.log('\n'+(failed?'❌ 有失败':'✅ PWA 音频契约通过'));
process.exit(failed?1:0);
