# 掼蛋: 级牌先打普通花色 + 大小王重绘

**日期**: 2026-09-20  
**现象**: 打 2 时灵魂先打 ♥2(逢人配), 而不是 ♦2 等普通级牌; 大小王视觉丑。

**根因**:
1. AI `groups` 将 ♥级 牌计入 wilds, `byRank[级]` 仅剩普通级; 「3 普通+1 百搭」被当成现成炸, 拆普通级 +120 > 打百搭 +60 → 反优先。
2. 大小王旧金/蓝渐变 + 居中「王」观感生硬。

**方案**:
- `guandan-ai.js`: `wildWastePenalty`(百搭可被普通级替代则重罚) + `levelBombBreakPen`(拆普通级轻罚) + `breaksBomb` 对「3普通+百搭」拆普通级放行; `playCost`/`leadScore`/hints 同源。
- `table-shared.css` / game-ui: 大小王改纸牌质感(大王朱砂、小王墨蓝、宋体「王」、细内框)。

**验证**: `node scripts/journey-gd-level-wild.js` + 既有 `test-guandan-hint.js` + ci-check
