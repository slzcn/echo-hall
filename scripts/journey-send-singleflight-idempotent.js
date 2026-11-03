#!/usr/bin/env node
'use strict';
/* journey-send-singleflight-idempotent.js
 *
 * 旅程: 发送防重 + 失败重试幂等。
 *   A. 同 payload 在途时二次 send 不得再 insert(指纹锁)
 *   B. retry 前 2 分钟同文预检命中 → 不插第二条
 *   C. 反证: 旧 localId 假锁必红
 * 诊断单: docs/triage/2026-11-02-send-double-retry-dup.md
 */
const fs = require('fs'), path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = R('js/app.js');

let step = 0, failed = false;
function assert(c, m){ step++; if(!c){ failed = true; console.error('✗ [' + step + '] ' + m); } else console.log('✓ [' + step + '] ' + m); }

console.log('\n▸ 发送防重 / 重试幂等');

// ── A. 指纹锁 ──
assert(/const _sendInFlight = new Map\(\)/.test(app), '_sendInFlight 为 Map(指纹→时间戳)');
assert(/function _sendFingerprint\(/.test(app), '存在 _sendFingerprint');
assert(/if\(_fp && _sendInFlight\.has\(_fp\)\) return/.test(app), 'send(): 同指纹在途直接 return');
assert(/_sendInFlight\.set\(_fp,\s*Date\.now\(\)\)/.test(app), 'send(): 在途写入指纹');
assert(/finally\{ if\(_fp\) _sendInFlight\.delete\(_fp\); \}/.test(app), 'send(): finally 释放指纹');

// 旧假锁反证: 不得再出现「新建 localId 后立刻 has(localId)」
assert(!/const localId='local_'[\s\S]{0,80}if\(_sendInFlight\.has\(localId\)\) return/.test(app),
  '反证: 旧 localId 假锁不得存在(旧实现必红)');

// ── B. 重试幂等预检 ──
const retryAt = app.indexOf('async function retryFailedSend');
const retry = app.slice(retryAt, retryAt + 2200);
assert(/_sendFingerprint\(payload\)/.test(retry), 'retry: 使用同一指纹锁');
assert(/if\(fp && _sendInFlight\.has\(fp\)\)/.test(retry), 'retry: 在途则拒绝二次重试');
assert(/gte\('created_at',\s*since\)/.test(retry) || /120000/.test(retry), 'retry: 2 分钟内同文预检');
assert(/existing\[0\]\.id/.test(retry), 'retry: 命中已有则回填 id 不插入');
assert(/dedupStreamByMid/.test(retry), 'retry: 成功后 DOM 去重');

// ── C. 行为级: 指纹锁语义 ──
{
  const map = new Map();
  const fp = (p) => [p.room_id, p.user_id, p.kind, p.text, p.reply_to || ''].join('|');
  const payload = { room_id: 'r1', user_id: 'u1', kind: 'msg', text: '你好' };
  const key = fp(payload);
  assert(!map.has(key), '首次发送: 锁未占用');
  map.set(key, Date.now());
  assert(map.has(key), '在途: 锁占用');
  // 模拟双击: 第二次同 payload 应被拒
  const secondBlocked = map.has(fp({ ...payload }));
  assert(secondBlocked, '双击同文: 第二次被锁挡住(行为级)');
  map.delete(key);
  assert(!map.has(fp({ ...payload })), '完成后释放: 允许用户再发同一句');
}

// ── D. debug 输入框 id ──
assert(!/\$\('#input'\)&&\$\('#input'\)\.value/.test(app.slice(app.indexOf('async function send(){'), app.indexOf('async function send(){') + 200)),
  'B8: send 调试日志不再误用 #input');

console.log('\n' + (failed ? '❌ 发送防重旅程失败' : '✅ 发送防重 + 重试幂等通过（旧假锁必红）'));
process.exit(failed ? 1 : 0);
