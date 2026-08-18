#!/usr/bin/env node
'use strict';
/**
 * journey-anon-first-time.js — 匿名用户首次进站的完整旅程回归
 *
 * 对治 anti-pattern: 只测功能点，不测用户旅程
 * 反向证明：如果这套 journey 测试早在，8/13 的匿名名字重掷 bug 就测出来了。
 *
 * 用户旅程：
 *   1. 打开首页 → 系统给一个随机名 "月光烤鹅"
 *   2. 用户手动点了几次骰子换成 "星际饺子"
 *   3. 用户点"进入" → 匿名登录 → 拿到 uid
 *   4. 名字必须还是 "星际饺子"，不能被重掷
 *   5. 进房间 → 名字仍一致
 *   6. 重新打开新 tab → localStorage 恢复的还是 "星际饺子"
 *
 * 关键断言：整条旅程中"用户可见的名字"始终一致，不能中途变。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const APP_JS = path.join(__dirname, '..', 'js', 'app.js');
const src = fs.readFileSync(APP_JS, 'utf8');

function assert(ok, msg) {
  if (!ok) throw new Error('FAIL: ' + msg);
  console.log('✓ ' + msg);
}

// —— 抽取真实生产代码里的匿名登录分支 ——
// 锤点: 包含完整 try/catch 结构，避免抽取时断尾
const anchorStart = 'const hadRegIdentity = !!(me && (me.registered || me.username || me.email));';
const anchorEnd = "}catch(e){ _ehCatch('ensureAuth',e); }";   // 分支尾: 与生产代码的错误上报 catch 对齐
const startIdx = src.indexOf(anchorStart);
if (startIdx < 0) throw new Error('无法定位匿名登录分支起点');
const catchIdx = src.indexOf(anchorEnd, startIdx);
if (catchIdx < 0) throw new Error('无法定位分支尾');
const branchSrc = src.slice(startIdx, catchIdx + anchorEnd.length);

// —— 模拟用户旅程 ——
const store = {};
const ctx = {
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => (store[k] = String(v)),
    removeItem: (k) => delete store[k],
  },
  console,
  rollCallCount: 0,
  me: null,
  loadOrRollIdentity: function () {
    // 模拟：无本地身份则新生一个"月光烤鹅"
    if (store['eh_uid_v2']) {
      const parsed = JSON.parse(store['eh_uid_v2']);
      ctx.me = parsed;
    } else {
      ctx.me = { uid: 'anon_' + Date.now(), name: '月光烤鹅', color: '#ff6' };
      store['eh_uid_v2'] = JSON.stringify(ctx.me);
    }
    return ctx.me;
  },
  rollIdentity: function () {
    // 模拟：手动换名。显式闭包 ctx，避免跨 VM 的 this 绑定干扰测试结果。
    ctx.rollCallCount++;
    ctx.me = { uid: ctx.me?.uid || 'anon_x', name: '星际饺子_r' + ctx.rollCallCount, color: '#f6f' };
    store['eh_uid_v2'] = JSON.stringify(ctx.me);
    return ctx.me;
  },
  paintIdentity: function () {
    /* UI 更新占位 */
  },
  _ehCatch: function () { /* 生产分支 catch 里的错误上报, 测试里做空桩 */ },
};
vm.createContext(ctx);

// —— 旅程步骤 1：首次打开 ——
ctx.loadOrRollIdentity();
const step1Name = ctx.me.name;
assert(step1Name === '月光烤鹅', `步骤 1: 首次打开显示随机名 "${step1Name}"`);

// —— 旅程步骤 2：用户手动换名 ——
ctx.rollIdentity();
const step2Name = ctx.me.name;
assert(step2Name === '星际饺子_r1', `步骤 2: 用户点骰子换成 "${step2Name}"`);

// —— 旅程步骤 3：点"进入"触发匿名登录成功后处理 ——
// 这一步是关键：如果代码里是无条件 rollIdentity()，名字就会变
ctx.rollCallCount = 0; // 重置计数追踪登录后是否又调了 roll
const rollBefore = ctx.rollCallCount;

// 模拟匿名登录成功后的 me 状态：uid 更新，无 registered/username/email
ctx.me = { ...ctx.me, uid: 'anon_after_login_xyz' };
const preLoginName = ctx.me.name;

// 跑真实生产分支代码。块级作用域保证同一 VM 内可重复执行，避免 const 重声明。
vm.runInContext(`{${branchSrc}}`, ctx);
const step3Name = ctx.me.name;
const rollAfter = ctx.rollCallCount;
assert(
  step3Name === preLoginName,
  `步骤 3: 匿名登录后名字保持不变 "${preLoginName}" → "${step3Name}"`
);
assert(
  rollAfter === rollBefore,
  `步骤 3: 匿名登录不重掷（rollIdentity 调用次数 ${rollBefore}→${rollAfter}）`
);

// —— 旅程步骤 4：模拟"进房间" ——
// 进房不改名字（正常应该），这里只验 localStorage 一致
const stored4 = JSON.parse(store['eh_uid_v2']);
assert(stored4.name === step3Name, `步骤 4: 进房后 localStorage 名字与显示一致 "${stored4.name}"`);

// —— 旅程步骤 5：模拟新 tab 打开 ——
// me 清空，重新 load
ctx.me = null;
ctx.loadOrRollIdentity();
const step5Name = ctx.me.name;
assert(step5Name === step3Name, `步骤 5: 新 tab 恢复名字与登录后一致 "${step5Name}"`);

// —— 旅程步骤 6：残留正式账号身份场景 ——
// 用户之前登录过正式账号，退出后 localStorage 残留 registered=true
// 此时匿名登录应该触发重掷（防冒充），跟"纯临时"分支相反
store['eh_uid_v2'] = JSON.stringify({
  uid: 'anon_new_uid_2',
  name: '真名张三', // 正式账号残留名
  registered: true,
  username: 'zhangsan',
});
ctx.me = JSON.parse(store['eh_uid_v2']);
ctx.rollCallCount = 0;
vm.runInContext(`{${branchSrc}}`, ctx);
assert(
  ctx.rollCallCount === 1,
  `步骤 6: 残留正式账号名字触发重掷 (rollCallCount=${ctx.rollCallCount})`
);
assert(
  !ctx.me.registered && !ctx.me.username,
  `步骤 6: 重掷后正式账号标记清空 (registered=${ctx.me.registered}, username=${ctx.me.username})`
);

// —— 反证：把生产分支临时变回旧的“无条件重掷”，本旅程必须能抓红 ——
const oldBugBranch = branchSrc.replace(
  'if(hadRegIdentity){ rollIdentity(); }',
  'rollIdentity();'
);
assert(oldBugBranch !== branchSrc, '反证准备：已构造旧版无条件重掷分支');
const mutantStore = { 'eh_uid_v2': JSON.stringify({ uid:'anon_before', name:'用户选中的名字', color:'#ff6' }) };
const mutantCtx = {
  me: JSON.parse(mutantStore['eh_uid_v2']),
  rollCallCount: 0,
  rollIdentity(){
    mutantCtx.rollCallCount++;
    mutantCtx.me = { uid:mutantCtx.me.uid, name:'被错误重掷的名字', color:'#f6f' };
    mutantStore['eh_uid_v2'] = JSON.stringify(mutantCtx.me);
  },
};
vm.createContext(mutantCtx);
vm.runInContext(`{${oldBugBranch}}`, mutantCtx);
assert(
  mutantCtx.me.name !== '用户选中的名字' && mutantCtx.rollCallCount === 1,
  '反证通过：旧版无条件重掷会被旅程断言抓红'
);

console.log('\n✅ 匿名首次进站完整旅程通过；并已证明旧错误实现必红、当前实现必绿');
