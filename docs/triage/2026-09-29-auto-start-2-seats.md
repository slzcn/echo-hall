# 德州：满 2 席（含灵魂）自动开局 + 开始兜底

**日期**: 2026-09-29

## 现象
房间里 2 个及以上玩家（含灵魂）时不会自动开始；德州又没有开始按钮——1 真人+1 灵魂永远开不了。

## 根因
1. `gtCheckAutoStart` / 牌桌卡提示只数 `kind==='human'`，灵魂/AI 不算 → `occupied<2` 不触发。
2. 招募操作区对 nlhe 故意去掉「开始」按钮（指望满 2 真人自动开），条件不满足时无任何开局入口。
3. `eh_gt_start` 仍 `host only`，开桌人离席后引擎持有者也无法手动开。

## 方案
1. 自动开局改按**占用席**（human/soul/ai，`kind!=='empty'`）≥2；poker-ui 本地补位/入座同口径。
2. 招募态恢复「▶ 开始」兜底按钮（占用≥2 时显示，人人可点）；提示「再来 N 席自动开始（含灵魂）」。
3. `eh_gt_start`：德州改为**任一在座真人**可开；斗地主/掼蛋仍 host。已部署。

**验证**: `journey-ui-consistency` / `journey-poker-play` / `probe-poker-two-player` / `bash scripts/ci-check.sh`
