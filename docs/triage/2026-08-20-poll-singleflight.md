# Echo Bug 诊断单：Presence 与私信轮询慢网重叠

## 1．用户旅程
弱网停留房间／私信 → 上轮请求未完成时到达下一周期 → 不应叠加同类请求；恢复后应继续刷新。

## 2．稳定复现
15 秒 interval 无 in-flight 锁；请求超过周期时下一轮仍启动。

## 3．单一根因假设
周期任务没有 single-flight 与超时边界。

## 4．验证方法
新增旅程模拟悬挂 Promise，断言多 tick 仅一组请求、完成后下一 tick 可运行；旧实现必红。

## 5．回归矩阵
- 正常网络
- 慢网超过周期
- reject
- 切房／关私信
- 完成后恢复

## 6．修复结果
新增 `journey-poll-singleflight.js`，先在旧实现上确认 Presence 契约因缺少锁、DM 契约因缺少锁而失败。Presence 轮询现在按 room id 保存 in-flight Promise；DM 轮询按 thread id 保存 in-flight Promise。周期内再次 tick 复用已有 Promise，`finally` 只释放自身；完成或 reject 后下一 tick 可重新运行。DM 晚归结果还会校验当前 thread，Presence tick 会校验当前 room，避免切换后串写。

状态不变量：同一 room/thread 最多一个周期请求；旧房/旧会话结果不渲染到新目标；完成或失败均释放锁；停止 interval 不取消已发请求，但晚归结果无跨目标副作用。

本地验证：旧实现四项旅程中的该项必红；修复后 journey 与 JS 语法检查通过，并已接入 `scripts/ci-check.sh`。

## 7．发布验证
未发布（本任务要求不改版本号、不提交）。发布后需在 DevTools 慢网下确认同类请求并发数不超过 1，恢复网络后下一周期继续请求。
