# Echo Bug 诊断单：灵魂预取缓存过期不回收

## 1．用户旅程
长时间浏览房间列表、房间创建／删除变化 → 灵魂预取缓存应淘汰过期和已消失房间，内存不随历史房间数单调增长。

## 2．稳定复现
`soulsCache` 原先只在相同 `rid` 再访问时检查 TTL 并覆盖；已删除／不再访问的 key 永久留存。连续浏览 30 个不同房间后可留下 30 项且继续增长。

## 3．单一根因假设
TTL 被当作复用有效期，而没有对应的主动回收机制与数量上限。

## 4．验证方法
新增 `scripts/journey-souls-cache-eviction.js`，执行实际清理函数验证：过期 key 主动删除；当前房与 pending Promise 不误删；大量房间按最旧时间收敛到 24 项。另构造旧字典写入 30 项，确认不会自行回收（旧实现必红）。

## 5．回归矩阵
- ✅ 同房 TTL 内命中
- ✅ 过期非保护项主动清理
- ✅ 大量历史房按最旧优先淘汰
- ✅ pending Promise 不被打断
- ✅ 当前房即使过期也不误删
- ✅ 预取、进房现拉、后台校正统一走缓存写入口

## 6．修复结果
- 新增 `SOULS_CACHE_MAX=24`。
- `pruneSoulsCache` 每次读／写及 Promise settled 后主动清 TTL，并在超限时按 `at` 淘汰最旧条目。
- `putSoulsCache` 标记 pending，统一管理所有缓存写入。
- 旅程测试已接入 `scripts/ci-check.sh`。

## 7．发布验证
- ✅ `node scripts/journey-souls-cache-eviction.js`
- ✅ `node --check js/app.js`
- ✅ 未修改版本号。
