#!/usr/bin/env node
'use strict';
/* journey-finish-all.js — 收尾: 消息/BGM 空catch/结构F/聊天功能 */
const fs=require('fs'), path=require('path');
const msg=require(path.join(__dirname,'..','js/modules/messages.js'));
const auth=require(path.join(__dirname,'..','js/modules/auth.js'));
const bgm=require(path.join(__dirname,'..','js/modules/bgm.js'));
const app=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
const sh=fs.readFileSync(path.join(__dirname,'..','js/games/table-shared.css'),'utf8');
const idx=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

console.log('\n── 消息模块扩展 ──');
assert(msg.isTrustedVoiceSrc('blob:abc', [])===true, 'blob: 语音信任');
assert(msg.isTrustedVoiceSrc('https://evil.com/x', ['https://cddkniwbhvcbfgkgomtl.supabase.co/storage/'])===false, '非白名单语音拒收');
assert(msg.isTrustedVoiceSrc('https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/x', ['https://cddkniwbhvcbfgkgomtl.supabase.co/storage/'])===true, '桶前缀语音信任');
assert(msg.messageKindLabel('voice')==='🎙️ 语音消息' && msg.messageKindLabel('game')==='🎴 牌局', '消息类型文案');
assert(msg.shouldStreamKind('song')===true && msg.shouldStreamKind('voice')===false, '流式 kind 判定');
assert(/isTrustedVoiceSrc/.test(app), 'voiceHtml 白名单走模块');

console.log('\n── auth/bgm 仍可用 ──');
assert(auth.shouldRerollIdentity({email:'a@b.c'})===true, 'auth 重掷判定');
assert(bgm.pickRoomTrack([{room_name:'r',url:'u'}], 'r', ()=>0).url==='u', 'bgm 选曲');

console.log('\n── 关键空 catch 已降 ──');
assert(/_ehCatch\('rmMsgChan'/.test(app), '消息通道清理有日志');
assert(/_ehCatch\('rmPresChan'/.test(app), 'presence 通道清理有日志');
assert(/_ehCatch\('rmGtChan'/.test(app), '牌桌通道清理有日志');
assert(/_ehCatch\('bgmManual'/.test(app), '手动 BGM start 有日志');
assert(/_ehCatch\('startLobbyBGM'/.test(app), '大厅 BGM 有日志');

console.log('\n── 结构 F / z-index 语义 ──');
assert(/语义容器|fx-bg|fx-modal|9997/.test(sh) || fs.existsSync(path.join(__dirname,'..','docs/layering-contract.md')), 'z-index 契约文档仍在');
assert(/z-index:\s*6/.test(sh) && /z-index:\s*9999/.test(sfxOrApp()), '关键层级仍在共享层定义');
function sfxOrApp(){ return app + fs.readFileSync(path.join(__dirname,'..','js/sfx-engine.js'),'utf8'); }

console.log('\n── 版本与模块挂载 ──');
assert(/20260920-finish-all/.test(app) && /20260920-finish-all/.test(idx), '版本三处对齐 finish-all');
assert(/modules\/auth\.js/.test(idx) && /modules\/messages\.js/.test(idx), 'auth/messages 仍挂载');

console.log('\n'+(failed?'❌ 有失败':'✅ 收尾契约全部通过'));
process.exit(failed?1:0);
