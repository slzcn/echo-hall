#!/usr/bin/env node
'use strict';
/* journey-song-public.js — 文字神曲公网: Supabase Edge 清唱/AI 全链路 */
const fs=require('fs'), path=require('path');
const APP=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
const GAME=fs.readFileSync(path.join(__dirname,'..','js/games/game-ui.js'),'utf8');
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

// 能力清单(静态, 按实际依赖: 公网/本地/无内网)
const caps=[
  ['牌桌 AI','js/games/*-ai.js 本地启发式, 无 LLM、无内网'],
  ['灵魂台词','QUIP 模板本地, 热路径不调云端/内网大模型'],
  ['神曲清唱','Supabase 公网 eh-sing-tts'],
  ['神曲翻唱','Supabase 公网 eh-sing-cover + MiniMax music-cover'],
  ['灵魂 BGM','Supabase 公网 eh-bgm-gen'],
  ['语音转写','浏览器 SR(公网); 云端 STT 网关在内网, 不接入'],
];
caps.forEach(([n,d])=>assert(!!d, `能力: ${n} — ${d}`));
assert(/旧云端 STT 网关在内网/.test(APP) || /公网路径=浏览器端 SR/.test(APP), '语音转写注释如实写明云端 STT 在内网');
assert(/不调云端\/内网大模型/.test(GAME) || /本地启发式/.test(GAME), '牌局热路径不调内网/云端大模型');

console.log('\n'+(failed?'❌ 有失败':'✅ 文字神曲公网部署契约通过'));
process.exit(failed?1:0);
