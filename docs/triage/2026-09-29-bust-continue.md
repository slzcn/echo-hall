# 输光一次继续玩，满 5 次才封盘

**日期**: 2026-09-29

## 诉求
游戏输光一次后要能继续玩，不要直接返回房间；只有当天输光 5 次才进「提示返回房间」的封盘页。

## 根因
`showOver` 里 `iLeaveNow = iBust` —— 一输光就只给「返回房间」并离席；`pkRestart` 只在通吃分支露出。

## 方案
1. 输光后先 `pkAddPlay` 再判额度：**1~4 次**留桌给「再来一局」（`resetMatch` 重买）+「返回房间」；**第 5 次** `showDailyCap` 封盘页（今日已输光 5 次 · 返回房间）。
2. `iLeaveNow = false`：输光不强制离席/腾座。
3. 结算文案「今日已输光 X/5 次 · 还可再来」。

**验证**: `probe-poker-two-player` 17/17 · `journey-poker-play` · `journey-chip-authenticity` · `ci-check`
