#!/usr/bin/env node
/* Edge Function 安全不变量：防止匿名生成、越权生成和无限大输入回归。 */
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const bgm = read('supabase/functions/eh-bgm-gen/index.ts');
const cover = read('supabase/functions/eh-sing-cover/index.ts');
const app = read('js/app.js');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const before = (src, a, b) => {
  const ai = src.indexOf(a), bi = src.indexOf(b);
  return ai >= 0 && bi >= 0 && ai < bi;
};

test('BGM 所有 POST 先统一鉴权再进入生成流程', () => {
  assert(/async function authenticate\(/.test(bgm), '缺 authenticate 中间件');
  const handler = bgm.slice(bgm.indexOf('Deno.serve'));
  assert(before(handler, 'await authenticate(req)', 'handleUserGen('), '生成流程前未统一鉴权');
});
test('BGM 校验房间成员且前端传 roomId', () => {
  assert(/async function requireRoomMember\(/.test(bgm), 'BGM 缺房间成员校验');
  assert(/await requireRoomMember\(authResult\.uid/.test(bgm), 'BGM 未调用成员校验');
  const area = app.slice(app.indexOf('async function sendBgmGen'), app.indexOf('async function sendBgmGen') + 2600);
  assert(/roomId:room\.id/.test(area), 'BGM 前端未传 roomId');
});
test('BGM 旧匿名兼容入口已关闭', () => {
  assert(/legacy_endpoint_disabled/.test(bgm), '旧匿名接口未显式关闭');
  assert(!/否则走旧的 fallback 房间 bgm 生成/.test(bgm), '仍保留匿名 fallback 注释/路径');
});
test('翻唱所有 POST 先统一鉴权再进入 preprocess / cover', () => {
  assert(/async function authenticate\(/.test(cover), '缺 authenticate 中间件');
  const handler = cover.slice(cover.indexOf('Deno.serve'));
  assert(before(handler, 'await authenticate(req)', 'await preprocess('), 'preprocess 前未统一鉴权');
  assert(before(handler, 'await authenticate(req)', 'await coverGen('), 'cover 前未统一鉴权');
});
test('翻唱服务校验房间成员', () => {
  assert(/async function requireRoomMember\(/.test(cover), '缺房间成员校验');
  assert(/await requireRoomMember\(/.test(cover), '未调用房间成员校验');
});
test('翻唱服务绑定本人房间 song 消息并复用已生成文件', () => {
  assert(/async function requireSongMessage\(/.test(cover), '缺消息所有权校验');
  assert(/await requireSongMessage\(authResult\.uid, roomId, mid\)/.test(cover), '未调用消息所有权校验');
  assert(/async function existingSongUrl\(/.test(cover), '缺已生成文件复用');
  assert(/cachedSong/.test(cover), '未在生成前复用已生成文件');
});
test('翻唱限制请求和音频大小', () => {
  assert(/MAX_BODY_BYTES/.test(cover), '缺 body 上限');
  assert(/MAX_AUDIO_BYTES/.test(cover), '缺音频上限');
  assert(/payload_too_large/.test(cover), '缺 413 错误路径');
});
test('翻唱限制远程母版来源', () => {
  assert(/ALLOWED_MASTER_HOSTS/.test(cover), '缺母版域名白名单');
  assert(/master_host_not_allowed/.test(cover), '缺非法母版拒绝路径');
});
test('翻唱离线 preprocess 入口不向普通客户端开放', () => {
  assert(/mode === "preprocess"\) return j\(\{ error: "legacy_endpoint_disabled" \}, 410\)/.test(cover), 'preprocess 维护入口仍向普通用户开放');
});
test('Storage 使用 Authorization + apikey 双头', () => {
  assert(/"apikey": SB_SERVICE/.test(cover), 'Storage 缺 apikey header');
});
test('前端翻唱请求携带用户访问令牌', () => {
  const area = app.slice(app.indexOf('async function generateAndPersistSong'), app.indexOf('async function generateAndPersistSong') + 9000);
  assert(/sb\.auth\.getSession\(\)/.test(area), '翻唱前未取 session');
  assert(/Authorization:\s*'Bearer '\+/.test(area), '翻唱请求未传 Authorization');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (error) { failed += 1; console.error(`✗ ${name}: ${error.message}`); }
}
if (failed) { console.error(`\n${failed}/${tests.length} 项失败`); process.exit(1); }
console.log(`\n全部 ${tests.length} 项 Edge 安全不变量通过`);
