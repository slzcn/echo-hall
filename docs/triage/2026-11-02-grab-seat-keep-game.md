# 诊断单：抢座失败拆掉进行中牌局

**日期**: 2026-11-02  
**状态**: 根因假设唯一（H1）  
**关联**: 审查报告 B9

---

## §1 现象
两人抢同一空位（或 join 被拒）时，点座位的人**自己正在进行的牌局被 close**，掉回聊天且牌局中断。

## §2 复现目标
1. 持有进行中牌局时点空位，`gtJoin` 失败 → 原牌局仍在。  
2. `gtJoin` 成功 → 才切换到新桌。  
3. 反证：先 `close` 再 join 的旧序必红。

## §3 根因假设
**H1**：`_gtGrabSeat` 先 `_ehGame.close()` + `_gtCleanupPlay()`，再 `await gtJoin`。join 失败无回滚。

## §4 修复方向
join 成功后再 close 旧引擎；失败保留原局并 toast。

## §5-7 回归 / 旅程
- 旅程 `journey-grab-seat-keep-game.js`：join 失败不拆桌（旧序反证）。  
- 手工：双开抢座、弱网点空位。

## §8 验证记录
- `_gtGrabSeat` 抢新空位路径：`gtJoin` 成功后才 `_ehGame.close()`；join 失败 toast「当前牌局未中断」并 return。  
- 旅程 `journey-grab-seat-keep-game.js` 含旧序反证，全绿。  
- `ci-check.sh` 全绿。
