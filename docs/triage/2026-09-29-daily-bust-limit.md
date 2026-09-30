# 每日上限按「输光」计，不是局数/进出

**日期**: 2026-09-29

## 诉求
「游戏只能玩 5 次」是 bug——上限应是**输光 5 次**，不是打 5 局或进出 5 次。

## 根因
- `recordTexasResult` 等**每一手结算**都 `ehRecordPlay` 往 `eh_game_plays` 插一行 → 打满 5 局就被锁。
- 本地 `pkAddPlay` 只在**单机**输光时 +1，联机输光不计；服务端与本地两套口径。
- 文案写「今日已玩 X/5 局」，语义就错了。

## 改动
1. **只记输光**：`ehRecordPlay` → `ehRecordBust`，仅在 `showOver` 判定 `myStack<=0` 时落账（单机/联机同一判定）；每手结算的三处 `ehRecordPlay` 全部移除。
2. **门禁只管德州**：`ehDailyPlayGate` 对 doudizhu/guandan 直接放行（无筹码概念）；两桌 `startDeal` 本地闸一并去掉。
3. **文案**：「今日已输光 X/5 次」「今日还可输光 N 次」。
4. host/guest 都注入 `onBustCount`，不依赖用户是否点「返回房间」。

**验证**: `journey-chip-authenticity` / `journey-ui-consistency` / `bash scripts/ci-check.sh`
