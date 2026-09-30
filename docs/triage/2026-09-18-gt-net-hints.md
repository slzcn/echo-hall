# Echo — 真机矩阵外自干项: gt-net 迁移 + 空 catch + 提示增强

> 主人 2026-09-18:「那四个不需要我的就直接开干，做完就发布」

## 本批(无需主人)
1. **联机纯逻辑迁出**: `js/modules/gt-net.js` (stamp/acceptMove/sendAct/resumeRemote)
   - app.js 保留兼容包装; 空 snap send/cleanup 改 `_ehCatch`
2. **提示增强**: 掼蛋/斗地主 leadScore 或 playCost 同分时「多清散牌」
3. **score 模块 / eh_gt_act RPC / 补位同型**: 前序已上线

## 仍需主人
- 真机矩阵(iOS/安卓/PWA)人工玩局反馈
- app.js 深度拆分(>9000 行)、结构 D–F — 长期债

## 验证
`journey-gt-net-module.js` + AI hint 单测 + ci-check 全绿
