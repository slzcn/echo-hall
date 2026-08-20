#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs');
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
assert.equal(manifest.orientation,'any','PWA 不应锁定竖屏');
const legacy={...manifest,orientation:'portrait'};
assert.notEqual(legacy.orientation,'any','旧 portrait 实现必须被门禁拒绝');
console.log('✓ manifest orientation:any，安装态允许随设备旋转');
console.log('✓ 旧实现反证：portrait 锁定必红');
