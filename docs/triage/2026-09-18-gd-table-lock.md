# Echo Bug 最小诊断单 — 掼蛋出牌过程中对家座位视觉跳动

> 来源：主人反馈 2026-09-18。「当我掼蛋出完牌，在出牌过程中，对家的牌跳来跳去」+「游戏桌面不要跳来跳去，要固定牌桌结构，兼顾横屏」。

## §1 现象
- 掼蛋出牌过程中，对家/侧家座位区域上下跳动；桌面骨架不稳，横屏亦有位移。

## §2 稳定复现
- ☑ `renderSeats()` 每次 `renderAll` 对四席整段 `innerHTML` 重建
- ☑ `.gd-tags` / lastplay 无固定占位，标签增删改变高度
- ☑ `scripts/journey-gd-table-lock.js` 断言：签名未变时对手席 DOM 不被替换；tags/lastplay 有 min-height

## §3 单一根因假设
座位 DOM 每步全量重建 + 标签/上一手行高度不稳定 → 视觉跳动；与引擎牌数据无关。

## §4 修复方案
- `js/games/guandan-ui.js`：`seatSig` 增量渲染；`_seatSigs` 新副清空
- `js/games/table-shared.css`：席带/操作区/手牌托盘 min-height 锁定；tags/lastplay 恒占位

## §5 回归
出牌后剩牌数/回合高亮/报牌标签仍更新；say 气泡不被无关重绘吞掉。

## §6–§7
与本批 UI/交互同一 release；CI 全绿后合入。
