# 掼蛋理牌 × 提示 × 重组

**日期**: 2026-09-20  
**现象**: 「提示」不优先按理牌出; 理得不合理时重组麻烦; 选牌/出牌与理牌脱节。

**根因**:
1. `doHint` 仅在 `rows` 或 `sortMode==='combo'` 时做理牌优先; 默认「按大小」完全不理玩家看到的同点成组。
2. 手动整理短按=完成却把 `rows` 清掉, 码完即丢; 长按重排种子不一定按牌型。
3. 拖排后未清 `hintCycle`, 下次提示仍用旧序。

**方案** (`guandan-ui.js`):
- 提示恒从当前视觉理牌序(`rows` → combo `arrangeGroups` → `Rules.sortHand`) `runGroups` 取成型组优先; 顺序=走完 → 理出的非炸组(更长/贴合已选优先) → AI 其余。
- 理牌钮: 手动中「✓完成」保留码牌; 有码牌时「↺恢复自动」(优先按牌型); 无码牌大小↔牌型切换。
- 手动整理种子恒优先 `arrangeGroups`; 落位清 hint 缓存; 大小态也标同点组缝。

**验证**: `node scripts/journey-guandan-arrange-hint.js` + `node scripts/journey-guandan-play.js` + `ci-check.sh`
