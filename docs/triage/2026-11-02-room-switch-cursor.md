# 诊断单：换房历史游标串房 / 预取 delete 崩

**日期**: 2026-11-02  
**状态**: 根因假设唯一（H1）  
**关联**: 审查报告 B3/B4

---

## §1 现象
快速 A→B 换房后：「加载更早」跳段/重复，或进房消息区空白卡「连接中」。

## §2 复现目标
1. A 房历史 await 中切到 B → A 的 `oldestId` 不得覆盖 B。  
2. await 中 `curRoom` 变 null → 不得 `delete prefetchCache[curRoom.id]` 抛 TypeError。  
3. 反证：先写全局 `oldestId` 后校 rid 的旧序必红。

## §3 根因假设
**H1**：`loadHistoryCore` 在 await 后把 `oldestId` 写入全局，且 `delete prefetchCache[curRoom.id]` 未防 null；rid 校验写在这些副作用**之后**。

## §4 修复方向
- 拉取结果先写局部 `_newOldest`，通过 `curRoom.id===_enterRid` 后再提交全局。  
- `prefetchCache` 用 `_enterRid` 做 key。

## §5-8
- 旅程 `journey-room-switch-cursor.js` 全绿（含旧序反证）。  
- `_newOldest` 局部提交；`prefetchCache[_enterRid]`；`ci-check.sh` 待跑。
