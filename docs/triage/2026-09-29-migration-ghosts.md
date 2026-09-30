# 迁移残留收口：每日门禁假状态 · 邮箱丢失 · 德州引擎转移 · 离桌/解散语义

**日期**: 2026-09-29

## 1. 每日剩余恒「99 次」+ 上限不拦
**现象**: 全站显示「今日还可玩 99 次」，打多少局都不锁。
**根因**: 服务端计数迁移时把 `dailyPlayReached` 写成恒 `false`、`dailyPlayLeft` 恒 `99`、`dailyPlayBump` 空实现，`ehDailyPlayGate` 直接 `return true`；`eh_game_plays` 只写不读。
**方案**: `score.js` 增 `setDailyFromServer`，由 `ehRefreshDailyPlays` 按天读 `eh_game_plays` 灌入；`reached/left` 按 `DAY_MAX=5` 真算；门禁恢复按游戏分闸。`bump` 基于当前 store 乐观 +1（不新建空对象防清零）。

## 2. 新注册邮箱进不了 me，验证邮件入口消失
**现象**: 注册时填了邮箱，个人空间也没有「发送验证邮件」。
**根因**: `doRegister` 写 `me.email=me.email||''` 丢掉刚填的邮箱；`acctKnown = me.email !== undefined` 让空串也算已缓存，不再回查 `eh_users`。
**方案**: `doRegister` 写入 `email` 并标 `emailVerified=false`；`acctKnown` 改 `!!me.email`。

## 3. boot.js 仍读冻结的 `eh_accounts`
**现象**: 换设备/清缓存登录后用户名、邮箱、角色徽章、验证态取不到或取旧值。
**根因**: `eh-auth`/`eh-admin-api`/前台主链路已改 `eh_users`，刷新恢复两处仍读 `eh_accounts`（残留表，role 已与 `eh_users` 分叉）。
**方案**: boot.js 两处并成一次 `eh_users` 查询。旧表 `eh_accounts` 不再被读；数据是否归档/停用待运维（不在本次动库）。

## 4. 德州引擎持有者离场后牌局冻死
**现象**: 无房主桌有人走了，剩下的人拿不到引擎，牌不再推进。
**根因**: ①「离桌」只清本地不 `gtLeave`，座位仍占着，`gtEngineHolder` 还是走的人；②`gtCheckEngineTransfer` 对「已在桌内」直接 return，在桌 guest 永不接管。
**方案**: poker host/guest `onExit` 统一 `gtLeave` 腾席（`onBust` 不再重复调）；`gtCheckEngineTransfer` 在桌 guest 且已成为持有者时拆本地实例并以 host 重挂。

## 5. 「离桌/解散」三款语义打架
**现象**: 同一个按钮，德州=只清本地、斗地主/掼蛋 房主=散桌、客人=留座位；playing 态还有「解散」与「不支持手动解散」注释矛盾。
**方案**: `ehPaintLeaveButton` 按游戏/角色改文案（德州「离桌·AI顶上」/ 房主「散桌」/ 客人「离桌·座位保留」）；`解散` 全局只留 lobby，playing 一律不给中途散桌入口。

**验证**: `journey-chip-authenticity`（门禁契约）+ `bash scripts/ci-check.sh`
