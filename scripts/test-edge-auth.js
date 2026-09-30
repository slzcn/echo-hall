#!/usr/bin/env node
/* Edge Function 安全不变量：鉴权 / 越权 / 输入边界回归。
 * 对齐现存函数: edge-functions/eh-auth + edge-functions/eh-sing-gen(与 supabase/functions 同构)。 */
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const auth = read('edge-functions/eh-auth/index.ts');
const sing = read('edge-functions/eh-sing-gen/index.ts');
const app = read('js/app.js');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const before = (src, a, b) => {
  const ai = src.indexOf(a), bi = src.indexOf(b);
  return ai >= 0 && bi >= 0 && ai < bi;
};

test('谱曲 POST 无 Bearer 直接 401 auth_required', () => {
  const handler = sing.slice(sing.indexOf('Deno.serve'));
  assert(/req\.method !== 'POST'/.test(handler), '非 POST 未拒绝');
  assert(before(handler, "req.headers.get('Authorization')", 'auth_required'), '鉴权不在生成前');
  assert(/if \(!token\) return json\(\{ ok: false, error: 'auth_required' \}, 401\)/.test(handler), '缺 401 auth_required');
});

test('谱曲歌词输入截断到 60 字(防无限大 prompt)', () => {
  assert(/slice\(0, 60\)/.test(sing), '歌词未 slice(0,60)');
  assert(/missing_lyric/.test(sing), '缺 missing_lyric 400');
  assert(/prompt \|\| 'catchy pop vocal'\)\.slice\(0, 280\)/.test(sing), 'cover prompt 未截断');
  assert(/String\(lyric \|\| '回声'\)\.slice\(0, 20\)/.test(sing), '标题未截断');
});

test('谱曲 Storage 上传走 service key, 路径含 room/mid', () => {
  assert(/SUPABASE_SERVICE_ROLE_KEY|SB_SERVICE_KEY/.test(sing), '缺 service key 读取');
  assert(/songs\/\$\{roomId/.test(sing), '存储路径未绑定 room');
  assert(/Authorization: `Bearer \$\{serviceKey\}`/.test(sing), 'Storage 未用 service key');
});

test('注册: 用户名/密码/邮箱边界', () => {
  const reg = auth.slice(auth.indexOf('action === "register"'), auth.indexOf('action === "register"') + 1200);
  assert(/\^\[A-Za-z0-9_一-龥\]\{3,20\}\$/.test(reg), '用户名未限 3-20 位');
  assert(/password\.length < 6/.test(reg), '密码未限 ≥6 位');
  assert(/isEmail/.test(reg), '邮箱未校验格式');
  assert(/用户名已被占用/.test(reg) && /该邮箱已注册/.test(reg), '缺重复占用 409');
});

test('注册: 匿名转正继承 uid, 不新建身份', () => {
  assert(/anonUid/.test(auth), '缺 anonUid 参数');
  assert(/匿名转正/.test(auth), '缺匿名转正注释/路径');
  assert(/users\/" \+ anonUid/.test(auth) || /users\/\$\{anonUid\}/.test(auth) || /users\/" \+ anonUid/.test(auth), '未升级既有匿名 user');
});

test('改邮箱: 必须带前台 token, 失败 401', () => {
  const area = auth.slice(auth.indexOf('修改真实邮箱'), auth.indexOf('修改真实邮箱') + 1800);
  assert(/Bearer/.test(area), '改邮箱未验 token');
  assert(/401/.test(area), '缺 401 分支');
  assert(/uid/.test(area), '未按 token uid 定位用户');
});

test('内部登录邮箱映射稳定(uname2email)', () => {
  assert(/function uname2email/.test(auth), '缺 uname2email');
  assert(/u_.*@eh\.local|@eh\.local/.test(auth), '邮箱映射域名不对');
});

test('前端谱曲请求携带用户访问令牌', () => {
  const area = app.slice(app.indexOf('eh-sing-gen'), app.indexOf('eh-sing-gen') + 2000)
    || app.slice(app.indexOf('sid'), app.indexOf('sid') + 2000);
  assert(/Authorization/.test(app), '前端未传 Authorization');
  assert(/getSession|access_token/.test(app), '前端未取 session token');
});

test('谱曲 API key 不回传客户端', () => {
  assert(!/MINIMAX_API_KEY['"]?\s*[:,]\s*body|sunoKey\s*\+\s*res|return json\(\{[^}]*apiKey/.test(sing), '疑似把上游 key 回传');
  assert(/Deno\.env\.get\('MINIMAX_API_KEY'\)/.test(sing), '上游 key 只在服务端读');
});

test('错误 detail 不整包倾倒(截断)', () => {
  assert(/\.text\(\)\)\.slice\(0, 200\)|text\.slice\(0, 400\)|JSON\.stringify\(j\)\.slice\(0, 200\)/.test(sing), '错误体未截断');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (error) { failed += 1; console.error(`✗ ${name}: ${error.message}`); }
}
if (failed) { console.error(`\n${failed}/${tests.length} 项失败`); process.exit(1); }
console.log(`\n全部 ${tests.length} 项 Edge 安全不变量通过`);
