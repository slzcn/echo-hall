# 诊断单：host 掉线整桌卡死（接管闭环缺口）

**日期**: 2026-11-02  
**状态**: 根因假设唯一（H1）  
**关联**: 审查报告 B11

---

## §1 现象
host 进程被杀/崩溃后，guest 显示 `host_offline`，无人接管引擎，整桌卡死在等待状态。

## §2 复现目标
1. host_ping 超时 15s+ 且 holder 座位仍非 away → 最小座位真人把失联 holder 标 away → holder 重算 → 新 holder 启动引擎。  
2. 反证：空的 `eh_gt_set_host` 分支（RPC 不存在）必红，无法恢复。

## §3 根因假设
**H1**：引擎持有者由 `gtEngineHolder(seats 最小非 away 真人)` 推导；host 崩溃时座位仍非 away → holder 仍是死者 → 无人启动引擎。v133 删掉了无效 `eh_gt_set_host` 写库，但**没有补「标 away 触发重算」**这一环。pagehide 仍 keepalive 调不存在的 RPC（死请求）。

## §4 修复方向
host_ping 超时且我应接管时：`gtHostMarkAway(tableId, holder, true)` 标失联 holder away；seats 变化 → realtime → `gtCheckEngineTransfer`。删除 pagehide 的 `eh_gt_set_host` 死调用。

## §5-8
- `host_ping` 超时：`gtEngineHolder(tr)` 找失联 holder，我为次小非 away 真人时 `gtHostMarkAway(holder,true)` + toast「房主掉线 · 正在接管牌桌」。  
- pagehide：删除 `eh_gt_set_host` 死请求，改为 `eh_gt_set_away` 自标离线。  
- 旅程 `journey-host-takeover.js` 含旧死 RPC 反证，全绿；`ci-check.sh` 全绿。
