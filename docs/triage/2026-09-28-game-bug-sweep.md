# 三款游戏扫 bug：旁观回座 · 每日门禁 · 破产腾席 · 操作栏一致性

**日期**: 2026-09-28

## 斗地主 / 掼蛋 / 德州 共有
1. **`enterSpectator` 不进旁观**：只 `idleOut`→开托管，`spectating` 仍 false → `resumeSeat` 早退，`onSeatResume` 永不通知 host 回座。改为直接置 `spectating` 并把该席交 AI；`resumeSeat` 逆向收回 `gameIsAI`/`seatIsAI`/`isAI`。
2. **每日门禁误锁**：`startDeal` 里 `d.reached()` 不传 game，score 默认查 `nlhe` → 德州打满后斗地主/掼蛋也被锁。改为 `reached('doudizhu')` / `reached('guandan')`。
3. **旁观操作栏缺文案**：msg/hint 已写「旁观中/已离座」，操作栏只有「接管座位」→ 三处不一致。补 `🔭 旁观中 · 已离座`。

## 德州
4. **破产腾席顺序反了**：`nextHand` 先 `autoFillVacants` 再 `newHand` 标 `vacated` → 补位把 bust 席填掉，`onSeatVacate` 不发、DB 座不腾。抽出 `markBustedVacant()`，在补位前跑。
5. **共享层王字号**：`.card.joker .cc` 写 `* .92 !important` 盖掉局内 `* .8`，与花色牌比例不一致。统一 `* .8`。

## 测试对齐（非产品）
- `journey-finish-all` 版本写死 `20260920-finish-all` → 改查 ver.txt/BUILD_VER/__EH_APP_VER 一致。
- `test-pk-settle-nums` 仍找 `bumpGameStats` 旁的 `bankBump` → 改查 `bumpSeatBanks` 链。
- `journey-gd-joker-size` / `probe-poker-fold-boardback` / `probe-poker-leave-invite` 断言对齐现设计（补位钮 `data-fill`、人灰牌不灰、王字号 .8）。

**验证**: 全量 `test-*`/`journey-*` 仅 `test-edge-auth`（缺 Edge 源码）红 + `bash scripts/ci-check.sh`
