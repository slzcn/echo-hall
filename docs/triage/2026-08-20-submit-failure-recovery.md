# Echo Bug 诊断单：网络异常后操作永久卡住

## 1．用户旅程
登录／建房／邀请码加入／注册／找回等操作 → 网络异常 → 应恢复按钮、释放锁并给出明确反馈 → 用户可重试。

## 2．稳定复现
在请求 Promise reject 时，部分按钮恢复只写在正常返回路径，外围缺少统一 catch/finally。

## 3．单一根因假设
异步操作的视觉状态恢复与 single-flight 锁释放没有共用 finally 契约。

## 4．验证方法
扩展 single-flight 旅程，注入 reject，断言按钮恢复、锁释放、反馈出现、第二次可重试；旧实现必红。

## 5．回归矩阵
- 成功
- 后端返回 error
- Promise reject／断网
- 重复点击
- 失败后重试

## 6．修复结果
已修复关键入口 `createRoom`、`joinByCode`、`doLogin`：Promise reject 统一进入 catch，按钮在 finally 恢复，single-flight 锁释放，并显示可重试的友好反馈。旅程测试注入 reject，覆盖失败后重试；旧实现反证保持必红。

## 7．发布验证
`node scripts/journey-submit-singleflight.js` 通过：成功、重复点击、reject 后按钮恢复／锁释放／反馈／重试均通过。
