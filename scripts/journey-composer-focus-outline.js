#!/usr/bin/env node
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
function ok(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

const cinRule = src.match(/\.cin\{[^}]*outline:none[^}]*\}/);
ok(cinRule, '主聊天 textarea 基础规则显式移除自身 outline');
ok(/\.cin:focus,.cin:focus-visible\{[^}]*outline:none!important[^}]*box-shadow:none!important\}/.test(src), '主聊天 textarea 的 focus 与 focus-visible 都不覆盖外层焦点指示器');
ok(/\.cin-wrap:focus-within\{[^}]*border-color:[^}]*box-shadow:[^}]*\}/.test(src), '外层 cin-wrap 保留唯一焦点边框与光晕');
ok(!/textarea:focus-visible\{[^}]*outline:2px solid/.test(src), '全局 textarea focus-visible 不再单独绘制会叠加的 outline');

const old = src.replace(/\.cin:focus,.cin:focus-visible\{[^}]*\}\s*/, '');
const oldGlobalFocus = old.match(/[^{}]*textarea:focus-visible[^{}]*\{[^}]*\}/)?.[0] || '';
ok(/textarea:focus-visible/.test(oldGlobalFocus) && /outline:2px solid/.test(oldGlobalFocus), '旧实现反证：全局 textarea outline 会重新出现');
console.log('✅ 主聊天输入框焦点轮廓旅程通过：仅外层绘制焦点态，旧双边框实现必红');
