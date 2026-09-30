#!/usr/bin/env node
'use strict';
/* error-monitor.js — 测试套件 × 线上错误监控 桥接层
 * 对接约定(与 js/app.js window.ehReportError 一致):
 *   ehReportError(kind, message, extra)
 *     kind  ∈ 'manual' | 'network' | 'js_error' | 'promise'
 *     extra = 任意上下文对象(stack 另存列, 其余进 context)
 *     uid / 设备 / 版本号 / session_id 由上报端自动填充, 调用方不传。
 * 本文件把该能力接到 scripts/run-suite.sh, 见 scripts/TEST-INTEGRATION.md:
 *   reportRun({mode,pass,fail,skip,failed,durationMs})  跑测结束上报
 *   collect()                                          拉线上错误指纹
 *   isCovered(error)                                   判断是否已被测试覆盖
 * 缺网络/缺表时静默降级, 绝不挡测试。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const KINDS = ['manual', 'network', 'js_error', 'promise'];

// 与 js/app.js 保持同一 Supabase 项目
function readSbConfig() {
  const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const url = (app.match(/const SB_URL\s*=\s*'([^']+)'/) || [])[1] || '';
  const key = (app.match(/const SB_ANON\s*=\s*'([^']+)'/) || [])[1] || '';
  return { url, key };
}

const RUN_LOG = path.join(ROOT, 'scripts', '.error-monitor-runs.jsonl');

async function reportRun(summary) {
  const rec = Object.assign({ at: new Date().toISOString() }, summary || {});
  try { fs.appendFileSync(RUN_LOG, JSON.stringify(rec) + '\n'); } catch (_) {}
  // 线上上报: 与前端 ehReportError 同一张表。kind 只用约定四值, 指纹放 message。
  const { url, key } = readSbConfig();
  if (!url || !key || typeof fetch !== 'function') return rec;
  try {
    await fetch(url + '/rest/v1/eh_errors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify([{
        kind: 'manual',
        message: 'suite_run ' + (rec.mode || '') + ' pass=' + rec.pass + ' fail=' + rec.fail,
        stack: null,
        context: {
          fingerprint: 'suite_run',
          mode: rec.mode, pass: rec.pass, fail: rec.fail, skip: rec.skip,
          failed: rec.failed || [], durationMs: rec.durationMs || 0,
        },
        uid: null,
        session_id: 'suite-' + process.pid,
        device: 'node-suite',
        app_ver: readAppVer(),
        url: 'scripts/run-suite.sh',
      }]),
    });
  } catch (_) {}
  return rec;
}

function readAppVer() {
  try {
    const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    return (app.match(/__EH_APP_VER\s*=\s*'([^']+)'/) || [])[1] || null;
  } catch (_) { return null; }
}

async function collect(opts) {
  const { url, key } = readSbConfig();
  const limit = (opts && opts.limit) || 50;
  const hours = (opts && opts.hours) || 24;
  if (!url || !key || typeof fetch !== 'function') return { errors: [], source: 'none' };
  try {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const q = '/rest/v1/eh_errors?select=kind,message,app_ver,created_at&created_at=gte.' +
      encodeURIComponent(since) + '&order=created_at.desc&limit=' + limit;
    const r = await fetch(url + q, {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
    });
    if (!r.ok) return { errors: [], source: 'http_' + r.status };
    const rows = await r.json();
    return { errors: Array.isArray(rows) ? rows : [], source: 'eh_errors' };
  } catch (e) {
    return { errors: [], source: 'error:' + (e && e.message) };
  }
}

// 覆盖判定: 指纹优先看 message/context.fingerprint(kind 只有四值, 不承载指纹)
function isCovered(error) {
  if (!error) return false;
  const kind = String(error.kind || '');
  const msg = String(error.message || '');
  const fp = String((error.context && error.context.fingerprint) || '');
  // 跑测上报自己视为已覆盖
  if (fp === 'suite_run' || /suite_run/.test(msg)) return true;
  // 手动埋点指纹 → 对应测试域(业务侧写在 message 或 extra.fingerprint)
  const map = {
    guest_action_failed: 'journey-multiplayer-join.js|journey-gt-act-rpc.js',
    snapshot_apply_failed: 'journey-poker-online.js|journey-gt-online-heal.js',
    grab_seat_failed: 'test-gt-join-matrix.js|journey-multiplayer-join.js',
    network_failed: 'test-error-monitor-bridge.js|journey-gt-online-heal.js',
  };
  const key = [fp, msg].find((s) => s && map[s]);
  if (key) {
    return map[key].split('|').some((f) => fs.existsSync(path.join(ROOT, 'scripts', f)));
  }
  // kind=network/js_error/promise 无指纹 → 用消息关键字扫用例
  if (kind === 'manual' && !fp && !msg) return true;
  try {
    const files = fs.readdirSync(path.join(ROOT, 'scripts'))
      .filter((f) => /^(test|journey|probe)-.*\.js$/.test(f) && f !== 'test-error-monitor-bridge.js');
    const q = (fp || msg).slice(0, 40);
    if (!q) return false;
    for (const f of files) {
      const s = fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8');
      if (s.includes(q)) return true;
    }
  } catch (_) {}
  return false;
}

async function main() {
  const mode = process.argv[2] || 'collect';
  if (mode === 'report') {
    const rec = await reportRun(JSON.parse(process.argv[3] || '{}'));
    console.log('reported', rec);
    return;
  }
  const { errors, source } = await collect();
  console.log('collect source=' + source + ' n=' + errors.length);
  const uncovered = errors.filter((e) => !isCovered(e));
  console.log('uncovered=' + uncovered.length);
  uncovered.slice(0, 10).forEach((e) => console.log('  -', e.kind, '|', String(e.message || '').slice(0, 80)));
  process.exit(0);
}

if (require.main === module) main();

module.exports = { reportRun, collect, isCovered };
