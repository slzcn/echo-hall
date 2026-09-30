# 全站体检：交互路径 / 踢人异常 / 中途离桌 / 文档与死代码

**日期**: 2026-09-29

## 1. 战绩卡「再来一局」被拦
**现象**: 牌桌未收工时点聊天卡「再来一局」弹「先收工当前牌局」，与牌桌内同名按钮（同桌续局）行为不一致；德州写「下一局」另成一词。
**根因**: 卡片走 `launch*` → `_restoreActiveGameIfAny` 同类全屏时只 toast；文案三款不统一。
**方案**: 新增 `ehRelaunchGame` / `ehForceCloseActiveGame`：结算/折叠残留先收掉再开新；真打中局仍提示先收工。三款文案统一「再来一局」。

## 2. `+` 双语义
**现象**: 无模式开菜单，有模式点 + 只退出，换模式要退两步。
**方案**: `+` 始终展开菜单；`setMode` 同名互斥（菜单里再点当前模式=退出）。菜单展开时 `+` 旋成 ×。

## 3. 浮层叠层
**现象**: 个人抽屉与建房/登录弹窗可同时开，关一层另一层还在。
**方案**: `openModal` ↔ `openMe` 互斥先关对方。

## 4. 踢人网络异常卡死
**现象**: `mi-kick` 的 `Promise.all` 无 try/catch，reject 时行停在 opacity .4 且无提示。
**方案**: 包 try/catch，失败恢复透明度并 toast。

## 5. 中途弃不了局
**现象**: 斗地主/掼蛋 `close()` 只挂结算「收工」；返回=折叠，折叠片只能展开，打到一半想走只能干等。
**方案**: 顶栏加「离桌」+ 折叠片 ✕，均走 `close()`（内部 `onExit`：房主 `gtClose` 散桌 / 客人清场可重进）。

## 6. 文档/死代码
**现象**: README 缺三款牌桌/私信/PWA/BGM/Suno，斜杠表缺 /bgm 与三款开局；`ddz-prototype.html` 未说明；记牌器 UI 死代码仍在；`/bgm切换` 已下线仍可敲。
**方案**: README 补全；`ddz-prototype.html` 打归档横幅；删记牌器 UI（保留 `EHCardCounter.tally` 策略数据源）；移除 `/bgm切换` 命令入口。

**验证**: `bash scripts/ci-check.sh` + journey-ddz/guandan/poker-play + probe-topbar-unify
