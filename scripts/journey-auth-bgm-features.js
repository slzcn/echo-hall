#!/usr/bin/env node
'use strict';
/* journey-auth-bgm-features.js — C续: auth/bgm 迁移 + host requireViaRpc + 聊天功能不变量 */
const fs=require('fs'), path=require('path');
const auth=require(path.join(__dirname,'..','js/modules/auth.js'));
const bgm=require(path.join(__dirname,'..','js/modules/bgm.js'));
const msg=require(path.join(__dirname,'..','js/modules/messages.js'));
const app=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
const idx=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const gt=fs.readFileSync(path.join(__dirname,'..','js/modules/gt-net.js'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

console.log('\n── A 续: auth / bgm ──');
assert(auth && auth.shouldRerollIdentity && auth.isRegisteredSession, 'auth 模块纯逻辑可 require');
assert(auth.shouldRerollIdentity({registered:true})===true && auth.shouldRerollIdentity({name:'月光'})===false, 'shouldRerollIdentity');
assert(auth.sessionUid({user:{id:'u1'}})==='u1' && auth.sessionUid(null)===null, 'sessionUid');
assert(bgm && bgm.pickRoomTrack && bgm.bgmOnFrom, 'bgm 模块纯逻辑可 require');
const track=bgm.pickRoomTrack([{room_name:'闲聊广场',url:'u1'},{room_name:'深夜电台',url:'u2'}], '闲聊广场', ()=>0);
assert(track && track.url==='u1', 'pickRoomTrack 按房名过滤');
assert(bgm.shouldSkipGen(true,false)===true && bgm.shouldSkipGen(false,false)===false, '作曲防重入');
assert(/modules\/auth\.js/.test(idx) && /modules\/bgm\.js/.test(idx), 'index 挂载 auth/bgm');
assert(/EH_AUTH_MODULE/.test(app) && /bgmOnFrom|EH_BGM_MODULE/.test(app), 'app 接线 auth/bgm');
assert(/hadRegIdentity|shouldRerollIdentity/.test(app), '匿名残留正式身份重掷走模块');

console.log('\n── B 续: host requireViaRpc ──');
assert(/requireViaRpc:\s*true/.test(app), 'host 打开 requireViaRpc(新客户端须 via=rpc)');
assert(/requireViaRpc/.test(gt) && /via_not_rpc/.test(gt), 'gt-net 支持 via_not_rpc');
assert(/payload\.via/.test(app), 'host 读取 payload.via');

console.log('\n── C 续: 聊天功能不变量 ──');
assert(/function sendVoice\(/.test(app) && /VOICE_BUCKET|eh-voice/.test(app), '语音消息发送路径存在');
assert(/function sendSong\(|EH_BGM_FN|eh-bgm-gen/.test(app), '神曲生成路径存在');
assert(/function toggleEcho\(/.test(app) && /echoState/.test(app), '多情绪回声 toggleEcho');
assert(/VOICE_URL_PREFIX|blob:/.test(app), '语音 URL 白名单(安全)');
assert(/function send\(/.test(app) && /cin/.test(app), '主聊天 send 入口');
assert(msg && msg.stillInRoom('a','a') && !msg.stillInRoom('b','a'), '消息模块切房守卫仍可用');

console.log('\n'+(failed?'❌ 有失败':'✅ auth/bgm + requireViaRpc + 聊天功能通过'));
process.exit(failed?1:0);
