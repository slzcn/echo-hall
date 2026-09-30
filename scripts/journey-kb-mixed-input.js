#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs');
function decide({touch,coarse,hoverNone,geometry}){const manage=touch||coarse;const estimate=touch&&hoverNone&&!geometry;return{manage,estimate};}
assert.deepEqual(decide({touch:true,coarse:false,hoverNone:false,geometry:true}),{manage:true,estimate:false});
console.log('✓ pointer:fine 触屏仍接收真实键盘几何');
assert.deepEqual(decide({touch:true,coarse:false,hoverNone:true,geometry:false}),{manage:true,estimate:true});
console.log('✓ 折叠屏 pointer:fine 无几何信号时保留 39% fallback');
assert.deepEqual(decide({touch:true,coarse:true,hoverNone:true,geometry:false}),{manage:true,estimate:true});
console.log('✓ coarse WebView 仍保留无信号 fallback');
const old=({touch,coarse,hoverNone})=>coarse&&hoverNone;assert.equal(old({touch:true,coarse:false,hoverNone:true}),false);console.log('✓ 旧实现反证：pointer:fine 折叠屏被错误挡掉 fallback');
const s=fs.readFileSync('js/keyboard.js','utf8');assert(s.includes('const hasTouch ='));assert(s.includes("const allowNoSignalEstimate = () => hasTouch() && window.matchMedia('(hover:none)').matches;"));assert(s.includes('!changed && allowNoSignalEstimate()'));
console.log('✓ 生产实现拆分触屏几何管理与百分比估算资格');
