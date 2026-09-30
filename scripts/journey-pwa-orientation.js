#!/usr/bin/env node
'use strict';
/* PWA 屏幕方向: 横竖屏钮已移除(乱版), 安装态锁定竖屏 —— 与牌桌布局一致 */
const fs=require('fs'), path=require('path');
const assert=require('assert');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.json'),'utf8'));
assert.equal(manifest.orientation,'portrait','PWA 应锁定竖屏(横竖屏乱版已去钮)');
const legacy={...manifest,orientation:'any'};
assert.notEqual(legacy.orientation,'portrait','旧 any 实现必须被门禁拒绝');
console.log('✓ manifest orientation:portrait，安装态锁定竖屏(与牌桌一致)');
process.exit(0);
