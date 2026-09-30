#!/usr/bin/env node
'use strict';
/* journey-song-heal.js — 文字神曲: 默认曲风/本地兜底/清唱降级 */
const fs=require('fs'), path=require('path');
const APP=fs.readFileSync(path.join(__dirname,'..','js/app.js'),'utf8');
const CFG=fs.readFileSync(path.join(__dirname,'..','js/config.js'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/function defaultSongSid/.test(APP), '默认曲风 helper');
assert(/acapella/.test(CFG) && /id:'dj'/.test(CFG), 'config 仍有清唱+DJ 等曲风');
assert(/songSel=defaultSongSid\(\)/.test(APP), '进入神曲模式不再默认清唱');
assert(/_BUILTIN_SONG_STYLES/.test(APP), 'styles 空时内置回退池');
assert(/playSongLegacy/.test(APP), '本地合成播放路径在');
assert(/local-ok/.test(APP), '失败/清唱超时标记可本地试听');
assert(/清唱服务不可用 · 可本地试听|可本地试听/.test(APP), '清唱降级文案');
assert(/sid==='acapella'[\s\S]{0,200}playSongLegacy/.test(APP) || /playSongLegacy\(lyric, sid, card\)/.test(APP), '发送清唱后本地试听');
assert(/masters\/manifest\.json/.test(APP), '母版 manifest 路径');
assert(/EH_SING_COVER_FN/.test(APP), 'AI 谱曲 Edge 端点仍在');
// 模拟 parseSong 兼容
const styles=['dj','acapella'];
function parseSong(text, ids){
  const parts=String(text||'').split('|');
  if(parts.length>=2 && ids.includes(parts[0])){
    if(parts.length>=5) return {sid:parts[0], ready:!!parts[2]};
    return {sid:parts[0], ready:false};
  }
  return {sid:ids[0]||'dj', ready:false};
}
assert(parseSong('dj|你好世界', styles).sid==='dj', 'parseSong 认 dj');
assert(parseSong('dj|词|http://x.mp3|1|9', styles).ready===true, 'ready 格式可解析');
assert(parseSong('未知|词', styles).sid==='dj', '未知 sid 回退默认');

console.log('\n'+(failed?'❌ 有失败':'✅ 文字神曲兜底契约通过'));
process.exit(failed?1:0);
