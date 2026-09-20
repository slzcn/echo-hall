# 筹码真实性 + 每日对局 5 次

**日期**: 2026-09-20  
**现象**: 再次进房间时灵魂筹码被重置成 1000; 玩家数据不真实; 每日最多 5 次未生效(超过仍能进房玩)。

**根因**:
1. `poker-ui.js` 开局/重开对手席一律 `START=1000`, 只有本人席读 `eh_bank_v1.myStack`; 灵魂/远程真人无 uid 账本带入。
2. 结算只 `onWallet` 回写本人, 灵魂筹码不落库 → 重进必回 1000。
3. 每日限制实现为「单机输光次数」且只挡 `isLocalSolo` 开桌, 联机入口/掼蛋/斗地主完全不拦。

**方案**:
- `js/modules/score.js`: 按主体记账 `chipsOf/bumpOf/setOf(game, subject)`; 键仍为 `game:uid`; nlhe 低于 100 回补 GRANT=1000。新增 `eh_daily_plays_v1` 每日对局计数, 上限 5。
- `js/games/poker-ui.js`: `seatBuyIn` 优先 `opts.stackFor`; 结算 `emitStacks`→`opts.onStacks`; `startDeal`/`resetMatch` 每日门禁+计数。
- `js/app.js`: `pkSeatStackFor`/`pkSeatStacksWrite`/`bumpSeatBanks`; poker host/guest open 注入钩子; `ehDailyPlayGate` 接到 launch/enter/gtStart; `bumpGameStats` 全员(含灵魂)本地账本累计。
- `js/games/game-ui.js`: 斗地主 `cumScore` 对 `ids` 席位读写 `EH_BANK_*_OF`。

**验证**: `node scripts/journey-chip-authenticity.js` + `node scripts/journey-anon-bankroll.js` + `bash scripts/ci-check.sh`。

**残留**: 跨设备灵魂筹码仍各自本机账本(phase-2 可迁 `eh_user_stats.chips`); 客人显示的远程筹码以 host 快照为准。
