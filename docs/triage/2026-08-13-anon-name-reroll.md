# 诊断单: 匿名登录后名字被重掷, 与登录前选中的随机名不一致

- 日期: 2026-08-13 16:47 CST
- 现象: 登录前大厅显示一个随机临时名(如"熵增狼"), 用户看到并选中它 → 点进入/匿名登录后, 名字变成了另一个随机名。

## 单一根因

`ensureAuth()` 匿名登录成功分支(app.js:226)无条件执行 `rollIdentity()`:
```js
try{ if(me){ me.registered=false; me.role='user'; me.username=''; } rollIdentity(); }catch(e){}
```
`rollIdentity()` 会**重新随机生成 name/emoji/color 并覆盖 me**。于是登录前本地已 roll 好、UI 已显示、用户已认可的名字, 在登录成功后被又一次随机覆盖 → 前后不一致。

## 这段代码的原始意图(必须保留)

注释写明它是"防冒充": 防止 admin/正式账号退出时 localStorage 未清干净, `me.name`(如 yiran)+
`me.registered=true` 残留 → 匿名登录后把"yiran"这个正式账号名字带进匿名 uid → DB 里出现
"临时 yiran"这种冒充正式账号的脏数据。

→ 真正该重掷的只有一种情形: **本地缓存里带着 registered 正式账号身份**(有 registered / username / email)。
   普通临时用户(本来就是随机匿名名)不该被重掷。

## 单变量修复

把无条件 `rollIdentity()` 改成条件重掷:
- 若 `me` 曾是正式账号(me.registered || me.username || me.email) → 清残留 + rollIdentity()(保留防冒充)。
- 否则(纯临时身份) → 只清标记字段, **保留用户已选中的 name/emoji/color**, 不重掷。

不动 rollIdentity 本身, 不动正式 session 那条(230 行, 那条是"缓存标 registered 但真实 session 是匿名"的纠正, 逻辑独立)。

## 验证

- 行为测试: 模拟"纯临时身份进 ensureAuth 匿名登录" → me.name 不变;
  模拟"残留 registered=true/username 进 ensureAuth 匿名登录" → me.name 被重掷、registered 清掉。
- CI: bash scripts/ci-check.sh 全绿。
