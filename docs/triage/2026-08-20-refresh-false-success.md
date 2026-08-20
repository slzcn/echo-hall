# Echo Bug 诊断单：下拉刷新失败却显示成功

## 1．用户旅程
下拉刷新 → 内容／在线状态请求失败 → 刷新控件应提示失败并允许重试，不能收起后伪装成功。

## 2．稳定复现
刷新入口分别 catch 后吞错，最终无条件返回 `{ok:true}`。

## 3．单一根因假设
刷新聚合器没有汇总子任务结果，错误被局部吞掉后丢失。

## 4．验证方法
新增内容刷新 reject 旅程：任一关键子任务失败时结果 `ok:false`；全部成功才 `ok:true`；旧实现必红。

## 5．回归矩阵
- 房间全部成功
- 消息失败
- presence 失败
- 大厅失败
- 失败后重试

## 6．修复结果
`EH_SOFT_REFRESH` 不再在关键任务上局部吞掉 reject：房间消息与 presence 使用 `Promise.all` 汇总，大厅刷新 reject 交由外层 catch 处理；任一关键任务失败返回 `{ok:false}`，全部成功才返回 `{ok:true}`。新增 reject 注入旅程测试并接入 CI。

## 7．发布验证
`node scripts/journey-refresh-resilience.js` 通过：全部成功为 `ok:true`、任一关键任务 reject 为 `ok:false`，旧局部吞错实现反证为错误成功。
