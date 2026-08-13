#!/usr/bin/env node
/* 主聊天输入法行为回归：直接提取生产输入处理器并派发事件序列。 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const startMarker = "const cin=$('#cin');";
const endMarker = '} // if(cin) — #cin 缺失(弱网旧壳)时跳过绑定, 不中断后续';
const start = source.lastIndexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('无法从 js/app.js 定位主聊天输入处理器');
const productionHandler = source.slice(start, end + 1);

function createHarness({ atActive = false, slashActive = false } = {}) {
  const handlers = Object.create(null);
  const calls = { send: 0, pickAt: 0, pickSlash: 0 };
  const cin = {
    value: 'ni', scrollHeight: 42, style: {},
    addEventListener(type, fn) { handlers[type] = fn; },
  };
  const context = {
    console, Date,
    requestAnimationFrame: fn => { fn(); return 1; },
    curRoom: null, beat() {}, markSelfTyping() {}, checkAtTrigger() {},
    renderSlashMenu() {}, hideSlash() {}, renderAtMenu() {}, hideAt() {},
    pickAt() { calls.pickAt += 1; }, pickSlash() { calls.pickSlash += 1; },
    syncSendBtn() {}, send() { calls.send += 1; },
    _coarsePointer: true, _atActive: atActive, _atSel: 0, _atList: [{}],
    _slashActive: slashActive, _slashSel: 0, _slashList: [{}],
    $: selector => selector === '#cin' ? cin : null,
    window: {},
  };
  vm.runInNewContext(productionHandler, context, { filename: 'js/app.js#composer-input' });
  return { handlers, calls };
}

function key(overrides = {}) {
  let prevented = false;
  return {
    key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13,
    preventDefault() { prevented = true; },
    get prevented() { return prevented; },
    ...overrides,
  };
}
function assert(condition, message) { if (!condition) throw new Error(message); }
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('普通 Enter 发送一次', () => {
  const h = createHarness(); const e = key(); h.handlers.keydown(e);
  assert(h.calls.send === 1, `send=${h.calls.send}`); assert(e.prevented, '应阻止换行');
});
test('Shift+Enter 保留换行', () => {
  const h = createHarness(); const e = key({ shiftKey: true }); h.handlers.keydown(e);
  assert(h.calls.send === 0, `send=${h.calls.send}`); assert(!e.prevented, '不应阻止换行');
});
test('isComposing 时 Enter 不发送', () => {
  const h = createHarness(); const e = key({ isComposing: true }); h.handlers.keydown(e);
  assert(h.calls.send === 0, `send=${h.calls.send}`); assert(!e.prevented, '候选确认键应交给输入法');
});
test('Android IME keyCode=229 时 Enter 不发送', () => {
  const h = createHarness(); h.handlers.keydown(key({ keyCode: 229 }));
  assert(h.calls.send === 0, `send=${h.calls.send}`);
});
test('compositionstart 到 compositionend 之间 Enter 不发送', () => {
  const h = createHarness();
  assert(typeof h.handlers.compositionstart === 'function', '缺 compositionstart 监听');
  assert(typeof h.handlers.compositionend === 'function', '缺 compositionend 监听');
  h.handlers.compositionstart({}); h.handlers.keydown(key());
  assert(h.calls.send === 0, `合成期 send=${h.calls.send}`);
  h.handlers.compositionend({}); h.handlers.keydown(key());
  assert(h.calls.send === 1, `合成结束后 send=${h.calls.send}`);
});
test('合成态不会抢 @ 菜单 Enter', () => {
  const h = createHarness({ atActive: true }); h.handlers.compositionstart({}); h.handlers.keydown(key());
  assert(h.calls.pickAt === 0, `pickAt=${h.calls.pickAt}`); assert(h.calls.send === 0, `send=${h.calls.send}`);
});
test('合成态不会抢斜杠菜单 Enter', () => {
  const h = createHarness({ slashActive: true }); h.handlers.compositionstart({}); h.handlers.keydown(key());
  assert(h.calls.pickSlash === 0, `pickSlash=${h.calls.pickSlash}`); assert(h.calls.send === 0, `send=${h.calls.send}`);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (error) { failed += 1; console.error(`✗ ${name}: ${error.message}`); }
}
if (failed) { console.error(`\n${failed}/${tests.length} 项失败`); process.exit(1); }
console.log(`\n全部 ${tests.length} 项输入法行为测试通过`);
