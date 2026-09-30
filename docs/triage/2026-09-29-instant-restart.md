# 再来一局秒进：自己入座即开、灵魂按批次补

**日期**: 2026-09-29

## 诉求
点「再来一局」要第一时间进入；自己先入座，部分灵魂按规则入座（不必坐满），然后开始游戏。

## 根因
1. `launchTexas` 等 `gtSeatSoulsIntoEmpties` + 1.2s 兜底才 `gtStart` —— 入口拖好几秒。
2. `gtStart` 内 `await` 灵魂补满再开局。
3. `resetMatch`/`startDeal` 带 `dealAnim=true` 发牌动画拖慢体感。

## 方案
1. `launchTexas`：**立刻 `gtStart`**，灵魂补位改为后台批次（德州 `soulCap` 本就留空位给真人，不焊死坐满）。
2. `gtStart`：灵魂补位不再 `await` 阻塞开局。
3. `resetMatch`/`startDeal`：`dealAnim=false`，入座即发牌。

**验证**: `probe-poker-two-player` 17/17 · `journey-poker-play` · `journey-table-visual` · `ci-check`
