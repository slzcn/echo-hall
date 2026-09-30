# 多人德州：出牌误报 + 结算弹窗与第一人不一致

**日期**: 2026-09-29

## 现象
1. 第二个玩家出牌仍弹「出牌没成功，再试一次」。
2. 每局结束都弹结算面板；第一个玩家（单机路径）却是横幅+自动下一手——体验不一致。

## 根因
1. **座位认错**：host 用 payload 的 seat 比对 `remoteSeats`（DB 座号）/ `st.toAct`（引擎下标），错位即拒招 → 客人 8s 超时才报「出牌没成功」。RPC `ok:false` 时又不回退 broadcast。
2. **结算路径分叉**：`isLocalSolo` 才走「横幅+自动下一手」；联机人人走完整结算大面板，客人还只能干等「下一手即将开始」。

## 方案
- host **按 uid 认引擎座位**（`ids.findIndex(uid)`），不再信 payload 座号；guest 的 `eh_gt_act` 传 DB 座号。
- RPC `ok:false` 也 `sendBc` 回退，不弹错锁死。
- 常规手（未输光/未通吃）**人人**走横幅+自动下一手：host 2.3s `nextHand`，客人等权威快照接下一手；完整面板只留输光/通吃/本场终结。

## 验证
`scripts/probe-poker-two-player.js`（双人 UI 流程）/ `journey-poker-play` / `journey-poker-online` / `journey-ui-consistency` / `bash scripts/ci-check.sh`
