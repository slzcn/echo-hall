# 多人进同一房/同一桌：统一入座 + 招募态可见 + 活桌浮出

**日期**: 2026-09-30

## 诉求
多个真人玩的逻辑还是混乱的，没有办法进入同一个房间。把多人玩的逻辑再修复提升。

## 根因
1. **三款 guest 进桌不统一**：德州已改自动入座，掼蛋/斗地主仍 `toast('你不在这桌')` 把第二名真人拒之门外。
2. **招募中客人被丢进对局 waiting**：`isGuest` 恒走 `waitingState()`，看不到座位/「等人入座」，像空白卡死。
3. **引擎持有者 lobby 误开对局**：`gtEnter` 一路径 `gtLaunchLocal` 直接发牌，跳过招募态。
4. **活桌卡可能不在视口**：`gtRenderCard` 只找已有 `[data-gt-id]` DOM；消息被分页埋住时真人找不到桌。
5. **一房一桌错游戏静默串桌**：开斗地主却返回别人的德州桌，无提示直接塞进去。

## 改动
1. **`gtEnsureSeated` 统一入座**：三款 guest + `gtGotoExistingTable` 先坐进空位（德州可顶替 AI/灵魂），再进桌。
2. **guest lobby 首帧**：`isGuest && lobbyMode` 走 `lobbyState`，`gtEnter*` 传 `lobby:inLobby`，招募中看得到座位。
3. **`gtEnter` 分流**：引擎持有者 + lobby → `gtLaunchLobbyLocal`（招募），playing 才 `gtLaunchLocal`。
4. **`gtSurfaceTable`**：进房/realtime 发现活桌但聊天流无卡时补一张可点入口，并 toast 提示。
5. **错游戏守卫**：`eh_gt_open` 返回别的游戏时明确提示，不再静默串桌。
6. **满座分流**：德州旁观+抢位；斗地主/掼蛋固定阵型给「座位已满」诚实提示。

## 回归
`scripts/journey-multiplayer-join.js`（18 项契约）/ `journey-poker-online` / `probe-poker-two-player` / `journey-ui-consistency` / `bash scripts/ci-check.sh`

**版本**: 20260930-v28
