#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
for (const file of ['game-ui.js', 'guandan-ui.js', 'poker-ui.js']) {
  const source = fs.readFileSync(path.join(root, 'js/games', file), 'utf8');
  const calls = source.match(/(?<![\w.])vibrate\((?:\d+|\[[^\]]*\])\)/g) || [];
  assert.deepStrictEqual(calls, ['vibrate(8)'], file + ' 只能保留一次8毫秒回合提醒');
  assert(source.includes("if (mine && !lastMyTurn){ sfx('yourturn'); vibrate(8); }"), file + ' 必须在本人回合上升沿触发');
}
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const notify = app.slice(app.indexOf('function _notifyMyTurnPopup(){'), app.indexOf('function gtTickTurnAlert(){'));
assert(!notify.includes('navigator.vibrate'), '后台轮询不可重复震动');
assert(!/showCareerChip|refreshCareerChip/.test(app), '不能残留已删除的生涯提示调用');
console.log('三游戏轻震、后台去重、生涯提示清理检查通过');
