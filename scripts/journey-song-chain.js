#!/usr/bin/env node
'use strict';
/* journey-song-chain.js — 神曲生成/播放/刷新一致性契约(主人: 神曲失败+刷新后不一致)
 * 1) 生成成功但 Edge PATCH 失败 → 不判死, 前端补写 URL(刷新/他人可播)
 * 2) parseSong: sid 钳定白名单, 5 段解出 URL 即 ready(与认不认识 sid 无关)
 * 3) 存储路径与 Edge 一致(roomId||'public')
 * 4) 播放: 有 URL 走 <audio>, 加载失败退本地合成; 无 URL 不假标"伴奏+人声"
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ✓ '+m);} else {fail++; console.log('  ✗ '+m);} };

console.log('\n── 生成链严谨 ──');
ok(/const gotUrl = res && res\.songUrl/.test(APP), '解出 songUrl 与 ok 判定解耦');
ok(/songPatchRetry|\.update\(\{text:newText\}\)/.test(APP), 'PATCH 失败由前端补写 URL');
ok(/encodeSong\(sid, lyric, gotUrl/.test(APP), '补写走 encodeSong(与 Edge 同编码)');

console.log('\n── parseSong 解码严谨 ──');
ok(/clampSid/.test(APP), 'sid 白名单钳定(配置变更不毁旧消息)');
ok(/parts\.length>=5[\s\S]{0,320}ready:!!songUrl/.test(APP), '5 段解出 URL 即 ready');

console.log('\n── 存储路径一致 ──');
ok(/songs\/\$\{\(curRoom&&curRoom\.id\)\|\|'public'\}/.test(APP), 'probeSongReady 路径含 ||public');
ok(/songs\/\$\{curRoom\.id\|\|'public'\}/.test(APP), 'resumeStuckPendingSongs 路径含 ||public');

console.log('\n── 播放链兜底 ──');
ok(/a\.onerror=/.test(APP), 'audio 加载失败有 onerror');
ok(/playSongLegacy/.test(APP), '失败退本地合成 playSongLegacy');
ok(/playSingingHybrid/.test(APP), '无副歌结构先试伴奏+人声叠播');
ok(/\.song-play/.test(APP) && /document\.addEventListener\('click'/.test(APP), '播放按钮全局委托绑定');

console.log('\n── 刷新一致性 ──');
ok(/el\.dataset\.songTs=Date\.parse\(m\.created_at\)/.test(APP), '刷新后仍带 songTs(超时判定可续)');
ok(/probeSongReady/.test(APP), '点 pending 卡先探测真相(不无脑重生成)');
ok(/resumeStuckPendingSongs/.test(APP), '进房自动续生成中/断写的歌');

console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
