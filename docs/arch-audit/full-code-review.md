# 全项目代码逻辑审查报告

**日期:** 2026-10-10
**范围:** 24k 行代码(引擎/联机/UI/SQL)
**方法:** 逐模块审查关键判定逻辑 + 边界条件 + 状态一致性

---

## 一、审查结论

### ✅ 正确的核心逻辑(已验证)
| 模块 | 函数 | 结论 |
|------|------|------|
| 德州引擎 | legalActions / applyAction | 全下/短加/加注上限/最小加注全部正确 |
| 德州引擎 | needsActionFrom / advanceStreet | 全下短路/跑牌摊牌正确 |
| 联机持有者 | gtEngineHolder | 座位推导,单一事实源 ✓ |
| 联机持有者 | gtHandleHolderChange | 释放+接管统一处理 ✓ |
| 联机持有者 | gtCheckEngineTransfer | resume+seq+重试 ✓ |
| 散桌 | gtCheckNoHumansThenClose | 等待队列守卫+5s宽限 ✓ |
| 散桌 | _gtCheckDeadRoom | 多重条件收紧 ✓ |
| 数据 | gtWritePokerHands / gtPullHoleCards | UUID过滤+RLS隔离 ✓ |
| 数据 | gtSettleChipsToGlobal | _gtReleasingHolder防重复 ✓ |
| 重连 | hello/resync/_gtPendingHello | 完整覆盖 ✓ |
| SQL | eh_gt_leave / eh_gt_join / eh_gt_start | for update防竞态+边界检查 ✓ |

### ⚠️ 发现的问题(按严重度)

**P1(安全): gtAcceptRemoteAct uid 校验被注释**
- 位置: app.js ~line 1253
- 问题: fallback路径(非_EH_GT_NET)的uid校验被注释掉
- 影响: 任何客户端可伪造他人出牌
- 修复: 恢复uid校验

**P2(代码质量): 472个空catch块**
- 位置: app.js 全文
- 问题: catch(_){} 吞掉所有错误,隐藏潜在bug
- 影响: 调试困难,bug可能长期潜伏
- 建议: 关键路径改为 _ehCatch(ctx,e) 记录日志

**P3(dead code): anyHuman 变量未使用**
- 位置: gtCheckNoHumansThenClose
- 问题: 计算了 anyHuman 但从未使用
- 影响: 无功能影响,代码可读性
- 修复: 删除或使用

**P4(过时): _gtProcessWaitingQueue 的 seat!==0 守卫**
- 位置: _gtProcessWaitingQueue
- 问题: 踢AI时不踢seat 0,但新架构下seat 0无特殊含义
- 影响: seat 0的AI可能无法被踢给等待玩家
- 修复: 移除 seat!==0 限制

**P5(过时): _gtCheckDeadRoom 用 host_uid**
- 位置: _gtCheckDeadRoom
- 问题: 检查 host_seat.away 用的是 host_uid(旧逻辑)
- 影响: 低(主条件"全员away"正确)
- 建议: 改用 gtEngineHolder
