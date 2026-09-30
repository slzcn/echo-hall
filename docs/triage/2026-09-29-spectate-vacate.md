# 旁观 = 起身让座（德州无代打/托管）

**日期**: 2026-09-29

## 定义（主人）
旁观 = 起身、释放座位（不再是当前玩家），**不离开游戏房间**；想玩就加入某个空座。  
**不是**请 AI/灵魂帮你打；德州没有代打/托管功能。

## 改动
1. `doEnterSpectator`：不再 `isAI[mySeat]=true`（不交 AI）；本地置空该席 + `onSeatIdle(vacate)` → `gtLeave` 腾 DB 座；`mySeat=-1` 留在房间。
2. `resumeSeat`：改为**坐进空位**（不原席复活），空位菜单首项「🪑 我来坐这个位」；无空位提示等待。
3. `idleOut` 我方超时 = 起身旁观，不代打；他席超时才交本机 AI 打完本手（防卡局，非托管功能）。
4. 三处文案一致：「旁观中 · 座位已让出 / 已让座 / 点空位可坐下」。

**验证**: `probe-poker-spectate-consistency` · `probe-resume-seat` 18✓ · `journey-poker-play` · `journey-ui-consistency` · `ci-check`
