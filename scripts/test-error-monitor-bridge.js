#!/usr/bin/env node
'use strict';
/* test-error-monitor-bridge.js — 测试套件 × 错误监控 桥接契约
 * 覆盖: 接口齐全 / 上报落盘 / 覆盖判定 / 缺网不抛 / 与 app.js 同项目
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ✓ '+m);} else {fail++; console.log('  ✗ '+m);} };

const monPath = path.join(ROOT, 'scripts', 'error-monitor.js');
ok(fs.existsSync(monPath), '存在 scripts/error-monitor.js 桥接层');
const mon = require(monPath);

ok(typeof mon.reportRun === 'function', '导出 reportRun');
ok(typeof mon.collect === 'function', '导出 collect');
ok(typeof mon.isCovered === 'function', '导出 isCovered');

const APP = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
ok(/window\.ehReportError\s*=/.test(APP), 'app.js 暴露 ehReportError');
ok(/\/rest\/v1\/eh_errors/.test(APP), 'app.js 上报 eh_errors 表');
ok(/addEventListener\('error'/.test(APP), '全局 JS 错误已接');
ok(/unhandledrejection/.test(APP), '未处理 Promise 已接');

// reportRun 落盘
(async()=>{
  await mon.reportRun({ mode:'selftest', pass:1, fail:0, skip:0, failed:[], durationMs:1 });
  const log = path.join(ROOT, 'scripts', '.error-monitor-runs.jsonl');
  ok(fs.existsSync(log), 'reportRun 落盘 run log');
  const tail = fs.readFileSync(log,'utf8').trim().split('\n').pop();
  ok(/selftest/.test(tail), 'run log 含本次 mode');

  // 覆盖判定
  ok(mon.isCovered({ kind:'suite_run', message:'x' })===true, 'suite_run 视为已覆盖');
  ok(mon.isCovered({ kind:'grab_seat_failed', message:'seat taken' })===true, 'grab_seat_failed 已有用例覆盖');
  ok(mon.isCovered({ kind:'guest_action_failed', message:'boom' })===true, 'guest_action_failed 已有用例覆盖');
  ok(mon.isCovered({ kind:'js_error', message:'totally_unknown_fn_xyz' })===false, '未知错误判为未覆盖');

  // collect 不抛
  const r = await mon.collect({ limit:5 });
  ok(r && Array.isArray(r.errors), 'collect 返回 errors 数组');
  ok(typeof r.source === 'string', 'collect 带 source 标记');

  console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
  process.exit(fail?1:0);
})();
