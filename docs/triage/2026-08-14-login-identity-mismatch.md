# 登录页头像与名字不匹配

- 日期：2026-08-14
- 现象：登录/入场页显示的头像 emoji 与名字末尾动物不对应。
- 报告人：主人（附图）

## 单一根因假设
`eh_identity_v2` 是一个可被历史版本、登录恢复和匿名身份切换分别写入的对象。当前 `reconcileEmoji()` 只在 `me.registered === false` 时执行；一旦旧缓存残留 `registered/username/email` 标记，或正式账号恢复尚未完成，名字与头像的中间态会直接被 `paintIdentity()` 渲染，造成登录页看到错配。

## 代码证据
- `loadOrRollIdentity()` 读取缓存后只调用 `reconcileEmoji()`。
- `reconcileEmoji()` 对 `me.registered` 直接跳过纠偏。
- `paintIdentity()` 分别写入 `#idAv` 与 `#idName`，没有展示前的身份一致性门禁。
- `doLogin()`、`onAuthStateChange`、启动 session restore 都可能在不同时间替换 `me`，存在中间态。

## 修复边界
- 临时身份：按名字末尾动物统一推导头像，保证随机名字和 emoji 成对。
- 正式账号：不擅自按名字覆盖用户自主选择的头像；只有明确的临时身份/旧随机身份才纠偏。
- 写入和绘制前统一经过身份归一化，避免再把错配对象写回 localStorage。
- 不改数据库，不改变正式账号的自定义头像语义。

## 验证
- 新增登录页身份配对旅程，覆盖新生成、旧缓存、临时登录恢复和正式账号自定义头像不被覆盖。
- 运行 `bash scripts/ci-check.sh`。
- 线上版本三处同步并推送后，用无缓存线上页确认。
