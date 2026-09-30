# Echo Bug 最小诊断单 — 掼蛋大小王与其他牌尺寸不一致

> 来源：主人反馈 2026-09-18。「掼蛋的大小王和其他牌的大小不一样」。

## §1 现象
- 手牌/台面：大小王看着比 3/A/K 等更大或更挤

## §2 根因
- 大小王中心用 emoji `🃏`，系统字体字宽/字号与花色符号不一致
- `.card.joker .cc` 倍率与 mini 规则优先级交错

## §3 修复
- `guandan-ui.js` / `game-ui.js`：中心改「王」字
- `table-shared.css`：joker 角标/中心与普通牌同比例；mini 单独缩放

## §4 验证
`scripts/journey-gd-joker-size.js`

## §5–§7
随本 release；CI 全绿后合入。
