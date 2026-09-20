# Echo — 按序提升 A/B/C

> 主人: 审视清单「按顺序做吧」

## A 架构
- `js/modules/messages.js`: dedupProj/dedupPlan/stillInRoom/快照节流等纯逻辑
- `js/modules/room.js`: canEnter/stillValid/clearedStateKeys
- `app.js` 注入 EH_MESSAGES / EH_ROOM; DOM/Realtime 仍在 app

## B 联机
- guest act 成功后 `via:'rpc'`; host `acceptMove` 可读 via / `requireViaRpc`
- 为将来 host 收紧留口（默认兼容 broadcast）

## C 聊天核心
- `journey-chat-core.js`: 模块契约 + mid 去重/切房守卫/订阅代次/纯逻辑单测
- 修 dedupPlan 在 idx=0 时误判「无前序」的 bug

## 验证
ci-check 全绿
