# Echo Bug 最小诊断单 — 德州 iOS 竖屏底部留白 / 横屏乱版

> 来源：主人反馈 2026-09-18。「德州在iOS下竖屏感觉没有占满底部空间，在横屏下乱版」。

## §1 现象
- iOS 竖屏：牌桌椭圆居中，felt 下半空一大块，底部操作区像没铺满
- 横屏（物理旋转或 ⟳）：座位/操作栏被撑乱（乱版）

## §2 稳定复现
- ☑ 竖屏 CSS：`@media(max-width:599px) .pk-table{top:50%; height:58vh}` 居中留空
- ☑ 横屏：`table-shared.css` 给 `.pk-seat/.pk-acts` 写死 `min-height:88px`，横屏总高 ~375px 时挤爆
- ☑ `scripts/test-pk-layout-contract.js` 断言竖屏贴底 + 横屏 min-height 清零 + eh-rot 紧凑变量

## §3 单一根因假设
1) 竖屏桌面高度锚定错误（居中而非贴底吃满 felt）
2) 结构锁定未区分 `.is-land`，横屏仍用竖屏骨架高度

## §4 修复方案
- `poker-ui.js`：竖屏 `bottom:0; height:min(100%-6px,620px)`；`is-land`/`eh-rot` 紧凑牌面与清零 min-height
- `table-shared.css`：德州 `.pk-seat` 不锁 88px；`.is-land` 下 bar/acts/me/seat 全部 min-height:0 + safe-area
- `table-orient.js`：`apply()` 后立刻 `reflect`；orientationchange 延后重算

## §5 回归
| 场景 | 结果 |
|------|:-:|
| 竖屏 felt 下半有桌/座位 | contract |
| 横屏对手席不再 88px | contract |
| 操作区 safe-area 底 | contract |
| 出牌结构仍稳 | 既有 seatSig/骨架 |

## §6–§7
随本 release CI 全绿合入。
