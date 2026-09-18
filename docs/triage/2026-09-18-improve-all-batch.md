# Echo 诊断 — 全量改进批次

> 来源：主人 2026-09-18「全做」(审查清单 1–9 可落地项)。

## 本批范围
1. 三游戏补位同型·灵魂优先 (fillSeat)
2. 联机 act uid 反冒名 + sql/eh_gt_act.sql phase-2
3. 生涯积分结算可见 (德州 myLine + ddz/gd toast)
4. score 账本迁出 app.js → js/modules/score.js
5. 德州联机：生涯筹码带入 + 其余席 START(公平) — 已有 bankOpenOpts
6. 提示/选牌 — 前序已做
7. 真机矩阵 — 待人工
8. app.js 深度迁移/空 catch 结构 D–F — 继续债务

## 验证
`journey-fill-seat-all.js` + 既有 bankroll/xdevice/settle 旅程 + ci-check
