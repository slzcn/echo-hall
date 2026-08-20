# Echo Bug 诊断单：空闲回合提醒常驻轮询

## 1．用户旅程
用户从未打开牌桌／已收工 → 不应每 2.5 秒常驻检查回合提醒；开桌后启用，收工／离房后停止。

## 2．稳定复现
app 初始化即全局 `setInterval(gtTickTurnAlert, 2500)`，与牌桌生命周期无关；未开桌、已收工和离房后仍持续唤醒。

## 3．单一根因假设
回合提醒被实现成全局兜底，而非牌桌资源的一部分。

## 4．验证方法
新增 `scripts/journey-turn-alert-timer.js`：断言初始化无常驻 interval；三种牌桌 host／guest 激活路径都启动；重复启动保持单例；统一清理会 clear；并重建旧全局轮询确认反证成立（旧实现必红）。

## 5．回归矩阵
- ✅ 未开桌无 2.5s 提醒定时器
- ✅ 德州／掼蛋／斗地主 host 和 guest 开桌启动
- ✅ 重复启动不叠加
- ✅ 收工统一清除
- ✅ 房主散桌／客人被清场统一清除
- ✅ 离房调用牌桌清理并停止
- ✅ 折叠牌桌仍属活跃桌，提醒保持工作

## 6．修复结果
- 新增 `_turnAlertT`、`_gtStartTurnAlert`、`_gtStopTurnAlert`。
- 删除 app 初始化阶段的常驻 2.5s interval。
- 六条牌桌激活路径在 UI 成功打开后启动；`_gtCleanupPlay` 统一停止，因此收工、散桌、离房均闭环。
- 旅程测试已接入 `scripts/ci-check.sh`。

## 7．发布验证
- ✅ `node scripts/journey-turn-alert-timer.js`
- ✅ `node --check js/app.js`
- ✅ 未修改版本号。
