# 游戏按钮点击后不留「选中」焦点环

**日期**: 2026-09-29

## 诉求
点游戏按钮后有选中效果，下一次以为是默认选中该按钮。

## 方案
顶栏/操作键 `:focus{outline:none}` + `:focus-visible` 仅键盘留环；`bindTap` 点完 `blur()`，不残留焦点态。三款共用 `table-shared.css`。

## 验证
`journey-poker-play` / `journey-ui-consistency` / `ci-check`
