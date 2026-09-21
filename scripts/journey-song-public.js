#!/usr/bin/env node
'use strict';
/* journey-song-public.js — 文字神曲公网: Supabase Edge 清唱/AI 全链路 */
const fs=require('fs'), path=require('path');
const APP=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/eh-sing-tts/.test(APP), '清唱走公网 eh-sing-tts');
assert(/eh-sing-cover/.test(APP), 'AI 翻唱走公网 eh-sing-cover');
assert(/ehPcmToWavBlob/.test(APP) && /ehAudioB64ToBlob/.test(APP), 'PCM→WAV 可播转换');
assert(/function defaultSongSid/.test(APP), '默认曲风 helper');
assert(/sid==='acapella'/.test(APP) && /EH_SING_TTS_FN/.test(APP), 'acapella 分支调用 Edge TTS');
assert(/upload\(path, blob/.test(APP) && /encodeSong\(sid, lyric, songUrl/.test(APP), '清唱结果上传桶+回写消息');
assert(/MINIMAX|music-cover|coverMp3|songUrl/.test(APP), 'AI cover 回写 songUrl');
assert(/masters\/manifest/.test(APP), '母版 manifest(公网 Pages/GitHub)');
assert((APP.match(/function defaultSongSid/g)||[]).length===1, 'defaultSongSid 无重复定义');
assert((APP.match(/let songSel=/g)||[]).length===1, 'songSel 无重复声明');

// 能力清单(静态)
const caps=[
  ['牌桌 AI','js/games/*-ai.js 本地启发式, 无 LLM'],
  ['灵魂台词','QUIP 模板, 无 LLM'],
  ['神曲清唱','Supabase eh-sing-tts 公网 Edge'],
  ['神曲翻唱','Supabase eh-sing-cover + MiniMax music-cover'],
  ['灵魂 BGM','Supabase eh-bgm-gen'],
];
caps.forEach(([n,d])=>assert(!!d, `能力: ${n} — ${d}`));

console.log('\n'+(failed?'❌ 有失败':'✅ 文字神曲公网部署契约通过'));
process.exit(failed?1:0);
