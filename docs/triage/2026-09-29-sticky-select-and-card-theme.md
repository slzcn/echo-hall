# 按钮粘性选中态 + 牌面/牌背跟主题

**日期**: 2026-09-29

## 1. 点按钮后程序当成「已选中」
**现象**: 点游戏按钮后有选中效果，下一回合程序仍当默认选中该动作。
**根因**: 德州预选 `preAct` 与加注额 `raiseTo` 跨回合残留：点过预选/调过注，下一回合被当成已勾选的默认动作。
**方案**: 手动 `humanAct` 清 `preAct`/`raiseTo`；进回合 `raiseTo` 从 0 重算；预选执行后立刻 `renderActs(true)` 去掉 `.on`。

## 2. 牌桌写死色改主题配套
- 卡背青纹 `#10a89b…` → `--card-back-*`（`color-mix(var(--accent))`，各皮肤成套）
- 正面纸色/描边 → `--card-face-*` / `--card-border`
- 花色红黑、大小王渐变 → `--card-red/blk`、`--card-joker-big/sm-*`
- `#132a29`→`var(--panel-solid)`，`#0d1524`→`var(--bg2)`

**验证**: `journey-table-visual` 99 步（卡背白纸青花）· `journey-poker-play` · `ci-check`
