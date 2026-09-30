# 房间生命周期竞态

## §1 现象
用户从 A 房返回大厅后立即进入 B 房，A 房的异步离房清理可能在 await 后继续读取全局 `curRoom/msgChan/presChan/gtChan` 和定时器，误删 B 房资源，表现为 B 房断联、presence 消失或牌局心跳停止。

## §2 稳定复现
让 A 房 presence 删除和频道移除延迟，在其未完成时进入 B 房；旧实现 await 后读取全局句柄，会删除 B 房频道并对 B 房执行公开房离开 RPC。

## §3 单一根因假设
房间资源由全局可变变量保存，离房异步流程没有捕获旧房句柄和生命周期代次。

## §4 状态转换与不变量
- enter A(epoch 1)→leave A(epoch 2)→enter B(epoch 3)。
- epoch 1 的认证／订阅结果不得在 epoch 2/3 落地。
- leave A 只能移除 A 的频道、心跳、轮询和 presence，不得读取 B 的全局句柄。
- 房间快照必须在清空 `curRoom` 前保存。

## §5 修复方案
增加 `roomEpoch`；进房认证后校验 epoch+room id；离房先捕获旧房及全部房间资源句柄，再清理捕获值；离房 await 后的全局状态清理仅在 epoch 未变化时执行；统一调用 `_gtCleanupPlay()`。

## §6 验证
新增 `scripts/journey-room-lifecycle.js`：覆盖旧房延迟清理、快速进 B、旧认证返回、旧频道/定时器归属和旧实现反证。

## §7 结果
待测试和全量门禁回填。
