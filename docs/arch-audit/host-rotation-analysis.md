# 真人Host轮转完整流程分析

**目标:** 彻底搞定真人host方案,放弃服务端host,确保host轮转流程完整、无bug。

---

## 一、当前实现(v117)

### 1.1 核心函数链路

```
Host离场
  ↓
_gtHandleHostLeave(tableId, seats, myUid)  // app.js:3843
  ├─ 计算下一个候选(非away真人,按seat升序)
  ├─ 无候选 → 散桌(gtClose)
  └─ 有候选 → eh_gt_set_host RPC(写DB host_uid)
  ↓
DB realtime 推送 row(host_uid=新host)
  ↓
所有客户端收到 row
  ↓
gtCheckEngineTransfer(row)  // app.js:3894
  ├─ if gtEngineHolder(row)!==myUid → return(不是我,不接管)
  ├─ if 已有引擎在跑 → return(防重复)
  ├─ 读最后快照(_ehGame.lastSnap 或 _gtSnapCache)
  └─ gtLaunchPoker(row, snap) + resync()
```

### 1.2 心跳超时兜底

Host 每8s发 `host_ping` 广播(line 1471)。Guest 监听(line 1492):
- 15s 未收到 → 标记 `host_offline`,锁UI提示
- 3s 后自动触发接管:
  - 检查自己是否seat最小的非away真人
  - 如果是 → 调 `eh_gt_set_host` 写自己为host
  - 触发 DB realtime → 走正常接管流程

---

## 二、已发现的问题

### 2.1 ✅ 已修复:away真人不接管

**问题(line 3875-3883):**
- 原逻辑:所有真人都away时,会把host_uid交给away真人
- away真人可能已离线,永不接管 → 牌桌卡死

**修复(v117已有):**
- 检测next.away → 立即散桌,不转移host
- journey-host-transfer + journey-multiplayer-scenarios 已覆盖

---

### 2.2 ⚠️ 接管失败只重试1次,无彻底兜底

**问题(line 3923-3943):**
- gtCheckEngineTransfer 失败后,5s后重试1次
- 如果重试仍失败,没有再选下一个候选的机制
- 桌子进入"有host但引擎未启动"的卡死状态

**影响场景:**
- 新host网络故障:snapshot拉取失败
- 新host引擎损坏:resync抛错
- 新host刷新页面(重试时已不在桌)

**建议修复:**
- 重试失败后,调 `eh_gt_set_host` 把host_uid改为下一个候选
- 或散桌(host接管失败=游戏无法继续)

---

### 2.3 ⚠️ 中途离座可能丢失最新游戏状态

**问题:**
- Host离座时,_gtHandleHostLeave 只写 host_uid,不写snapshot
- 如果host刚推进了游戏(eg.发了第5手牌),但还没广播snapshot就离座
- 新host接管时读到的是第4手的snapshot
- 结果:玩家看到"时光倒流"(手牌/筹码回退)

**当前缓解(line 3906-3909):**
- gtCheckEngineTransfer 优先用 `_ehGame.lastSnap()` 或 `_gtSnapCache`
- 这两个缓存的是"guest本地看到的最后一帧"
- 但如果host离座太快(guest还没收到最新广播),缓存也是旧的

**建议修复:**
- _gtHandleHostLeave 开头先写snapshot:`eh_gt_write_snapshot`
- 或 gtLeave RPC 里原子写(seats+host_uid+snapshot)

---

### 2.4 ⚠️ 多人同时离座的竞态

**场景:**
- Host=Alice, guest=[Bob, Carol]
- Alice, Bob 同时点返回(200ms内)
- Alice离座 → host_uid=Bob
- Bob离座(几乎同时) → host_uid=Carol

**问题:**
- Bob收到第一次realtime(host_uid=Bob),开始接管
- Bob收到第二次realtime(host_uid=Carol),但接管已执行一半
- Bob的gtCheckEngineTransfer 没有版本号检查,可能继续启动引擎
- 结果:Bob和Carol都认为自己是host(双host冲突)

**当前缓解(line 3902):**
```js
if(gtEngineHolder(row)!==myUid) return;   // 最新host_uid不是我 → 早退
```
这能挡住**大部分**竞态(Bob收到row时先检查host_uid),但仍有极小窗口:
- Bob读row.host_uid=Bob,通过检查
- Bob开始gtLaunchPoker(异步,耗时100ms)
- gtLaunchPoker还没完成时,第二次realtime到达(host_uid=Carol)
- gtLaunchPoker完成,Bob引擎启动
- 结果:Bob引擎在跑,但host_uid已是Carol

**建议修复:**
- gtLaunchPoker 完成后再检查一次 host_uid
- 或用"接管令牌"(host_uid+时间戳),接管完成时验证令牌未过期

---

### 2.5 ⚠️ 心跳超时接管的竞态

**场景:**
- Host=Alice,掉线(网络断开,但进程未崩溃)
- Guest=Bob,15s未收host_ping,判定host_offline
- Bob触发接管:调 eh_gt_set_host(myUid)
- **同时**,Alice网络恢复,继续发host_ping

**问题:**
- Bob的 eh_gt_set_host 成功,host_uid=Bob
- Alice不知道自己被夺权,仍然推进引擎、广播snapshot
- Bob接管后也推进引擎
- 结果:双host同时推进,游戏状态分裂

**当前缓解(line 1519):**
```js
if(tr.host_uid===myUid) return;   // DB里host_uid已是我 → 不用接管
```
这能防Bob重复接管自己,但防不了Alice继续当host。

**Alice侧没有"被夺权检测":**
- Alice的 _ehGame 一直在跑
- Alice不知道 host_uid 已经不是自己了
- Alice继续广播snapshot,但guest已经不听她的了(只听Bob)

**建议修复:**
- 每次广播snapshot前,检查 host_uid===myUid
- 或guest收到snapshot时,验证来源uid===host_uid,丢弃过期host的广播

---

### 2.6 ✅ 无问题:服务端host已禁用

**代码(line 3899, 3847):**
```js
if(window.EH_SERVER_HOST && _gameType==='nlhe') return;
```
所有host轮转逻辑都跳过服务端模式。当前是纯真人host,无服务端逻辑干扰。

---

## 三、测试覆盖

### 3.1 已有测试

**journey-host-transfer.js:**
- Host主动离座,guest接管
- Host掉线,guest心跳超时接管
- 覆盖基本轮转流程

**journey-multiplayer-scenarios.js:**
- 多人入座/离座
- away标记
- 散桌条件(无真人/全away)

**journey-poker-online.js:**
- Host/guest快照同步
- 远程动作上行
- 18步基本联机流程

### 3.2 缺失测试

❌ **接管失败重试失败后的兜底**(2.2)
❌ **中途离座丢失最新状态**(2.3)
❌ **多人同时离座竞态**(2.4)
❌ **心跳超时接管与原host恢复的双host竞态**(2.5)

---

## 四、修复优先级

### P0(必须修):阻塞游戏继续

**2.5 双host竞态(心跳超时):**
- 影响:游戏状态分裂,玩家看到不同结果
- 修复:Alice侧检测host_uid变化,停止引擎
- 测试:模拟host网络抖动(15s断线→恢复)

### P1(高优):影响体验

**2.2 接管失败无兜底:**
- 影响:桌子卡死,无人能推进
- 修复:重试失败后散桌或再选下一候选
- 测试:模拟snapshot拉取失败

**2.3 中途离座丢状态:**
- 影响:玩家看到时光倒流(手牌/筹码回退)
- 修复:_gtHandleHostLeave先写snapshot
- 测试:host在游戏进行中离座,验证新host拿到最新状态

### P2(中优):极端场景

**2.4 多人同时离座竞态:**
- 影响:可能双host,但概率极低(需精确时序)
- 修复:gtLaunchPoker完成后再检查host_uid
- 测试:脚本模拟200ms内连续离座

---

## 五、下一步行动

1. **立即修P0(2.5 双host):**写"被夺权检测",Alice检测host_uid变化停引擎
2. **补P0测试:**journey-host-failover-race.js(网络抖动场景)
3. **修P1(2.2接管失败):**重试失败散桌
4. **修P1(2.3丢状态):**_gtHandleHostLeave先写snapshot
5. **补P1测试:**journey-host-transfer扩充(接管失败+中途离座)
6. **评估P2(2.4):**观察生产日志,若无竞态报告,P2可延后

---

**负责人:** Kiro

**预计:** P0+P1修复 2-3小时,测试1小时

**里程碑:** v118(P0修复) → v119(P1修复) → v120(P1测试补全)
