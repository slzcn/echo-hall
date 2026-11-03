# 诊断单：消息双发 / 失败重试双份

**日期**: 2026-11-02  
**状态**: 根因假设唯一（H1）  
**关联**: 审查报告 B6/B7；用户弱网连点发送

---

## §1 现象

- 弱网下连点「发送」→ 同一句出现两条。  
- 发送失败点「重试」→ 库里/屏上可能出现两条（上次 insert 实际已成功）。  
- 属聊天最基本动作，体验级高优先。

## §2 稳定复现目标

1. **双击**：同一 payload 在途时第二次 `send()` 不得再次 insert。  
2. **重试幂等**：库中已有同房/同用户/同文/2 分钟内消息时，`retryFailedSend` 不得再 insert，应回填已有 id。  
3. **反证**：旧 `localId` 假锁（新建 Set 项再 `has`）必红；无预检的重试必红。

## §3 根因假设（只允许一条）

**H1**：防重锁键错误 + 重试无幂等预检。  
- `send()`：`localId` 每次 `Date.now()+Math.random()` 新建，再 `_sendInFlight.has(localId)` **永不命中**（假锁）。  
- `retryFailedSend`：直接 `insert(payload)`，不查重、不复用 in-flight、成功后不 `dedupStreamByMid`。

## §4 状态转换

| 状态 | 事件 | 当前 | 期望 |
|------|------|------|------|
| 空闲 | 点发送 | insert | in-flight 加指纹锁 → insert |
| in-flight | 再点发送 | **再 insert（bug）** | 直接 return |
| 失败条 | 点重试且库里已有 | **再 insert（bug）** | 回填已有 id，删失败条 |
| 失败条 | 点重试且库里确无 | insert | insert + 去重上屏 |

## §5 修复方向

1. `_sendInFlight` 改为 **payload 指纹**（room+user+kind+text+reply）。  
2. 重试前 2 分钟同指纹查询；命中则回填不插。  
3. 重试成功后跑 `dedupStreamByMid`（若可用）。  
4. 顺带 B8：`_ehDbg` 读 `#cin` 不是 `#input`。

## §6 回归矩阵

| 场景 | 期望 |
|------|------|
| 连点发送 2 次 | 仅 1 条入库 |
| 失败→重试（库已有） | 仍 1 条 |
| 失败→重试（库确无） | 1 条，失败条消失 |
| 故意再发同一句（第一条已完成） | 允许第 2 条 |

## §7 旅程

- `scripts/journey-send-singleflight-idempotent.js`：旧假锁必红 / 新指纹锁+预检必绿。

## §8 验证记录

- 指纹锁：`_sendFingerprint` + `_sendInFlight` Map；`send()`/`retryFailedSend()` 共用；finally 释放。  
- 重试幂等：2 分钟内同房/同用户/同文/同 kind 预检 → 命中回填 id 不插；成功后 `dedupStreamByMid`。  
- 反证：`journey-send-singleflight-idempotent.js` 断言旧 localId 假锁不得存在。  
- 测试：`journey-send-singleflight-idempotent.js` / `journey-submit-singleflight.js` / `journey-message-send-failure.js` 全绿；`ci-check.sh` 全绿。
