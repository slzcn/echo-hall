# Echo Bug 最小诊断单 — 德州局中无法邀请灵魂 / 灵魂与机器人应同型补位

> 来源：主人反馈 2026-09-18。「德州在牌局中无法邀请灵魂，但是可以邀请机器人」「灵魂和机器人当做一个类型，有灵魂优先灵魂补位」。

---

## §1 现象

- **设备**：任意联机/单机德州牌桌（host）
- **触发步骤**：
  1. 德州开局后对手输光离场，空位显示「点击邀请」
  2. 点空位打开邀请菜单
  3. 菜单只有「🤖 邀请机器人」；房里有灵魂也列不出来（或分两栏且灵魂不可用）
  4. 聊天牌桌卡空位的灵魂下拉仅在 `status==='lobby'` 出现，局中没有
- **预期**：局中可补位；灵魂与机器人视为同一类「对战补位」，有灵魂时优先灵魂
- **实际**：局中只能邀机器人；灵魂被单独对待且局中入口缺失
- **修前录屏**：无（主人反馈 + 代码路径）

---

## §2 稳定复现

- ☑ 代码路径可稳定复现：`table-net.js` `ctx.status==='lobby' && souls`；`poker-ui openInviteMenu` 灵魂段依赖 `acts.seatSoul` 且与机器人分栏
- ☑ 新增 `scripts/journey-pk-fill-seat.js`：有灵魂时 fillSeat 优先 seatSoul，无灵魂时落 inviteBot

---

## §3 单一根因假设

- **假设**：补位入口把「机器人/灵魂」拆成两类；灵魂入口被 lobby-only 门控；局中 vacant 菜单只接本机 `inviteBot`，未把 `lobbyCtx.souls`+`seatSoul` 接到同一补位动作。
- **证据**：
  1. `table-net.js:88` 灵魂下拉 `status==='lobby'` 才渲染
  2. `poker-ui.js openInviteMenu` 先固定 `data-bot`，灵魂仅在 `acts.seatSoul` 时另起「灵魂」段
  3. 局中 `pk-vacant[data-invite]` 虽绑定 `openInviteMenu`，但无灵魂时等同只邀机器人
- **证伪**：若有灵魂且 seatSoul 存在时 fillSeat 仍只调 inviteBot → 假设不成立

---

## §4 修复方案

- **文件**：`js/games/poker-ui.js`（统一 `fillSeat`：灵魂优先→机器人兜底）、`js/games/table-net.js`（host 空位在 lobby 或 nlhe playing 均可选灵魂）、`js/app.js`（版本）
- **回滚**：revert 对应 commit
- **影响**：仅邀请/补位交互；不改引擎发牌与联机权威

---

## §5 回归矩阵

| 场景 | 结果 |
|------|:-:|
| 局中空位可点邀请 | probe |
| 有灵魂 fillSeat → seatSoul | probe |
| 无灵魂 fillSeat → inviteBot | probe |
| 聊天卡 nlhe playing host 空位有灵魂下拉 | 代码断言 |
| 单机无 lobbyCtx 仍可邀机器人 | probe |

---

## §6 提交约束

- ☑ 单一主题：补位同型 + 灵魂优先
- ☑ 版本号同步 + CI

---

## §7 修后确认

- **CI**：待本批 UI 改动一并跑
