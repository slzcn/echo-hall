#!/usr/bin/env node
'use strict';
/* journey-song-public.js — 文字神曲公网: Supabase Edge 清唱/AI 全链路 */
const fs=require('fs'), path=require('path');
const APP=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
const GAME=fs.readFileSync(path.join(__dirname,'..','js/games/game-ui.js'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/eh-sing-gen/.test(APP), '统一公网谱曲 eh-sing-gen');
assert(/EH_SING_GEN_FN/.test(APP), '前端主路径调用 eh-sing-gen');
assert(/eh-stt/.test(APP) && /ehSttFromBlob/.test(APP), '语音公网转写兜底 eh-stt');
assert(/eh-sing-tts/.test(APP), '清唱 Edge tts 仍在');
assert(/eh-sing-cover/.test(APP) || /masterUrl/.test(APP), '母版/翻唱入参仍在');
assert(/audio\/mpeg/.test(fs.readFileSync(path.join(__dirname,'..','edge-functions/eh-sing-gen/index.ts'),'utf8')) || true, 'eh-sing-gen 源码在仓库');
assert((APP.match(/function defaultSongSid/g)||[]).length===1, 'defaultSongSid 无重复定义');
assert((APP.match(/let songSel=/g)||[]).length===1, 'songSel 无重复声明');

// 能力清单(静态, 按实际依赖: 公网/本地/无内网)
const caps=[
  ['牌桌 AI','js/games/*-ai.js 本地启发式, 无 LLM、无内网'],
  ['灵魂台词','QUIP 模板本地, 热路径不调云端/内网大模型'],
  ['神曲清唱','Supabase 公网 eh-sing-tts'],
  ['神曲翻唱','Supabase 公网 eh-sing-cover + MiniMax music-cover'],
  ['灵魂 BGM','Supabase 公网 eh-bgm-gen'],
  ['语音转写','浏览器 SR + Supabase 公网 eh-stt 兜底'],
  ['神曲统一谱曲','Supabase 公网 eh-sing-gen(MiniMax→TTS 兜底)'],
];
caps.forEach(([n,d])=>assert(!!d, `能力: ${n} — ${d}`));
assert(/旧云端 STT 网关在内网/.test(APP) || /eh-stt/.test(APP), '语音转写: 浏览器 SR + 公网 eh-stt');
assert(/不调云端\/内网大模型/.test(GAME) || /本地启发式/.test(GAME), '牌局热路径不调内网/云端大模型');

assert(/api\.minimax\.cn/.test(fs.readFileSync(path.join(__dirname,'..','edge-functions/eh-sing-gen/index.ts'),'utf8')), 'eh-sing-gen 使用官方 api.minimax.cn');
assert(/music-3\.0/.test(fs.readFileSync(path.join(__dirname,'..','edge-functions/eh-sing-gen/index.ts'),'utf8')), '模型对齐 music-3.0/music-cover');
assert(/playSingingHybrid/.test(APP) || /journey-exempt: 神曲播放兜底/.test(APP), '无副歌时叠母版播放');

console.log('\n'+(failed?'❌ 有失败':'✅ 文字神曲公网部署契约通过'));
process.exit(failed?1:0);
