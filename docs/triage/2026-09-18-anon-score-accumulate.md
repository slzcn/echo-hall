# Echo Bug 最小诊断单 — 临时账号游戏积分重进从 1000 开始

> 来源：主人反馈 2026-09-18。「临时账户的游戏积分，比如德州，好像没有记录下来，再次进入游戏积分好像从1000开始，要能把赢得积分积累下去」。

## §1 现象
- 设备：任意
- 步骤：临时/匿名身份打德州赢筹码 → 离桌或 `/德州` 再开一桌 → 我的筹码回到 1000
- 预期：赢来的筹码/积分跨局、跨桌累计
- 实际：每次 `startDeal` 把 `stacks` 全员重置为 `START(1000)`；`gtLaunchPokerLobby` 未传 `myStack`/`onWallet`；生涯 `eh_stat_bump` 在 `A.ids[seat]` 为空时整席跳过

## §2 稳定复现
- ☑ 读 `poker-ui.js startDeal`：`stacks = names.map(()=>START)` 无视 `MY_START`
- ☑ `gtLaunchPokerLobby` 无 `myStack`
- ☑ `scripts/test-bankroll.js`：账本累计 + startDeal 契约 + ids 兜底 myUid

## §3 单一根因假设
筹码与积分的持久化键绑在「桌 id」或未按 uid 写入；开局路径强制 START=1000；solo 时 `_statEntries` 因无 `ids[seat]` 不记分。

## §4 修复方案
- `js/app.js`：`eh_bank_v1` 按 uid 记 `{chips,net,plays,wins}`；`bankOpenOpts`/`bankBump`；匿名→uid 迁移；`_statEntries` 用 `myUid` 兜底；开桌 toast 显示带入+生涯
- `js/games/poker-ui.js`：`startDeal`/`resetMatch` 我这席用 `MY_START`
- `js/games/game-ui.js`：斗地主钱包读 `EH_BANK_*`
- 兼容旧键 `eh_pk_chips` / `eh_ddz_score`

## §5 回归
| 场景 | 结果 |
|------|:-:|
| 赢后再开桌筹码>1000 | test |
| 输到破产回补 GRANT | test |
| 匿名登录后账本迁移 | test |
| startDeal 不重置我这席 | test |

## §6–§7
CI 全绿后随 release 合入。
