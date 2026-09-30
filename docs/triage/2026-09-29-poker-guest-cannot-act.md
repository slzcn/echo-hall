# 多人德州：客人不能出牌（RPC 日志列写错 → 全链路拒招）

**日期**: 2026-09-29

## 现象
多玩家德州，其中一名玩家（客人）不能出牌；点弃牌/跟注/加注后一直「已提交 · 等待裁决」，本手再也无法操作。引擎持有者（开桌那位）自己能正常出牌。

## 根因（三层叠加）
1. **`eh_gt_act` 写日志用错列**：`insert into eh_logs (kind, payload)`，但 `eh_logs` 实际列是 `scope/tag/actor_id/payload/...`，**没有 `kind`**。整个 RPC 抛错，永远到不了 `ok:true`。
2. **降级路径被二次拒**：RPC 报错 → `sendAct` 回退 broadcast（`via='bc'`）→ host 端 `acceptMove(..., {requireViaRpc:true})` 一刀切拒掉 `via_not_rpc`。客人动作一条都进不了引擎。
3. **UI 锁死**：`humanAct` 置 `awaitingHost=true` 后只有收到快照才复位；动作被拒时 host 不会广播新快照 → 按钮永久停在「已提交」。

## 方案
- SQL：日志改写 `scope/tag/actor_id/payload` 真实列，并包 `exception when others` —— 记日志失败不阻断出牌。已重新 `CREATE OR REPLACE` 部署到线上。
- `gt-net.acceptMove`：`via=bc` 时若 **双方 uid 都在且一致**（已过 mismatch 检查）降级放行，RPC 挂掉不再死锁。
- `poker-ui`：`awaitingHost` 加 8s 超时复位（「提交超时 · 请重试」），收到快照/关桌时清定时器。

## 验证
`journey-gt-act-rpc`（含反回退断言）/ `journey-gt-net-module` / `journey-poker-online` / `bash scripts/ci-check.sh`
