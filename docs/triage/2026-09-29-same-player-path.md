# 真人路径同一套：出牌后立刻进下家

**日期**: 2026-09-29

## 诉求
所有真人玩家的逻辑、提示、交互必须一模一样。出牌后就该轮到下一家，不要插「等待其他玩家」。

## 根因
联机里「跑引擎的人」出牌后走本地 `Engine.apply*` 立刻进下家；**客人却只回传、停在「等待」**，等权威快照回来才切回合——两套体验。

## 改动
三款真人动作路径拉成同一条：

1. 回传给对方校验（`onAction`）
2. **本地立刻 `Engine.apply*` 推进到下家**（伪状态可独立应用自己的动作）
3. 权威快照稍后到达再覆盖校正；本地失败立即解锁可重试

- 德州：`humanAct` guest 分支 → `applyAction` + `afterAction`
- 斗地主：`doCall` / `doPlay` / `doPass` guest 分支 → `applyCall` / `applyPlay` / `applyPass` + 同一套 render
- 掼蛋：`doPlay` / `doPass` 同上

显示层不再因 `awaitingHost` 插「等待其他玩家」；`awaitingHost` 只挡重复提交。出牌后所有人看到的都是「轮到 X / X 思考中」。

## 回归
`journey-ui-consistency` 增契约：三款 guest 均本地 apply*、出牌后不再弹「等待其他玩家」。

**验证**: `journey-poker-play` / `journey-ddz-play` / `journey-guandan-play` / `journey-ui-consistency` / `bash scripts/ci-check.sh`
