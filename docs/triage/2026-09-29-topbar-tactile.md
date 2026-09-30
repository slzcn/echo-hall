# 牌桌顶栏整理：触感即时反馈 · 形状一致 · 去托管/横竖屏

**日期**: 2026-09-29

## 诉求
游戏按钮要有触感并立即反应；顶栏形状一致、顺序与聊天室一致；德州不要托管；横竖屏去掉（总是乱版）。

## 改动
1. **触感**：顶栏圆钮与操作键统一 `:active{scale(.92)}`、`transition .12s`，按下即反馈。
2. **形状一致**：`table-shared.css` 统一顶栏钮 36px 圆（与聊天室 `.tool-btn` 同规格），🎵/🎨/托管/✕ 同壳。
3. **顺序与聊天室一致**：🎵 音乐 → 🎨 换肤 →（托管，仅斗地主/掼蛋）→ ✕ 返回。
4. **德州去掉托管** `pk-auto`；**三款去掉横竖屏** `⟳`（乱版根因），`EHTableOrient.toggle` 不再接线；`rotBtn` 残留引用一并清掉（原会 throw 导致折叠失败）。

## 验证
`probe-topbar-unify` 14/14 · `probe-game-theme-btn` 19/19 · `journey-table-fold` · `journey-table-visual` · `ci-check`
