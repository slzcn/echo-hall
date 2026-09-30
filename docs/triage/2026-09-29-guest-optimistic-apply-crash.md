# 第二个玩家「出牌没成功，再试一次」

**日期**: 2026-09-29

## 现象
多人德州，第二个玩家（客人）一点弃牌/跟注/加注就弹「出牌没成功，再试一次」。第一个玩家正常。

## 根因
客人本地立刻推进（与引擎持有人同一套体验）时调 `Engine.applyAction(st, …)`，但 `poker-net.pseudoState` 造出来的伪状态：
1. **没有 `log` 数组** → `state.log.push(...)` 直接 TypeError；
2. 本街打完要 `advanceStreet` 发牌 → **没有 `_deck`**，`drawCard` 再炸一次。

引擎持有人的 `st` 是完整引擎状态，所以只有客人踩坑。弹错文案后用户以为没出成，其实 `onAction` 已经回传。

## 方案
- `pseudoState` 补 `log: []` + **52 张占位牌堆**（本地推进能走完；公共牌随后被权威快照覆盖校正）。
- 本地推进失败**不再误报**：动作已回传，静默 `renderAll` 等快照；`afterAction`（台词/音效/LLM）单独 try，失败不影响出牌。

## 验证
`node` 伪状态 call/fold 用例；`journey-poker-online` / `journey-gt-act-rpc`（增 log/_deck 契约）/ `bash scripts/ci-check.sh`
