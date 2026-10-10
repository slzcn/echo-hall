# Host轮转深度分析:从根本理解设计缺陷

**目标:** 不是打补丁,而是理解整个host轮转机制的设计哲学,找出根本缺陷,重新设计。

---

## 一、当前架构的核心矛盾

### 1.1 两套身份系统

**本地状态(_gtActiveTable.host):**
```js
// gtLaunchPoker 时设置
_gtActiveTable = {id: row.id, host: true};
```
- 标记"我当前是否持有引擎"
- 在 gtLaunchPoker/gtLaunchDdz/gtLaunchGuandan 时设置
- **之后不会主动更新**(除非重新 launch)

**DB权威(row.host_uid):**
```js
// eh_game_tables.host_uid
row.host_uid = 'uid-alice'  // DB字段,任何客户端都可能改
```
- 标记"DB认为谁是host"
- 可能被其他客户端改变(host离座/心跳超时接管)
- realtime 推送给所有客户端

**矛盾:**
- Alice: `_gtActiveTable.host=true`, `row.host_uid='uid-alice'`(一致)
- Alice 掉线, Bob 接管写 `row.host_uid='uid-bob'`
- Alice 网络恢复, realtime 推送 `row.host_uid='uid-bob'`
- Alice 本地: `_gtActiveTable.host=true`(旧), `row.host_uid='uid-bob'`(新)
- **Alice 不知道自己已经不是 host 了**

---

## 二、完整流程追踪(正常场景)

### 场景:Host 主动离座

**初态:**
```
Alice: _gtActiveTable={id:t1, host:true}, myUid='uid-alice'
Bob:   _gtActiveTable={id:t1, host:false}, myUid='uid-bob'
DB:    row.host_uid='uid-alice', row.seats=[alice, bob]
```

**T0: Alice 点返回**
```js
// Alice 执行
_ehGame.onExit() → _gtHandleHostLeave(t1, seats, myUid)
```

**T1: _gtHandleHostLeave 计算下一个 host**
```js
// app.js:3843
const otherHumans = seats.filter(s => s.uid && s.uid!==myUid && !s.away);
const next = otherHumans.sort((a,b)=>a.seat-b.seat)[0];  // Bob
```

**T2: 写 DB**
```js
await sb.rpc('eh_gt_set_host', {p_table_id: t1, p_new_host_uid: 'uid-bob'});
// DB: row.host_uid = 'uid-bob'
```

**T3: DB realtime 推送**
```
→ Alice 收到: row.host_uid='uid-bob'
→ Bob 收到:   row.host_uid='uid-bob'
```

**T4: Alice realtime 回调**
```js
// Alice 侧,realtime 回调
gtCheckEngineTransfer(row);
  if(gtEngineHolder(row) !== myUid) return;  // 'uid-bob' !== 'uid-alice',早退
// Alice 不接管(正确)
```

**T5: Bob realtime 回调**
```js
// Bob 侧,realtime 回调
gtCheckEngineTransfer(row);
  if(gtEngineHolder(row) !== myUid) return;  // 'uid-bob' === 'uid-bob',通过
  if(_gtActiveTable && _gtActiveTable.host) return;  // Bob 还没引擎,通过
  gtLaunchPoker(row, resumeSnap);  // 接管
    _gtActiveTable = {id:t1, host:true};  // 标记自己是 host
    _ehGame = window.EHPokerGame.open({...});
```

**终态:**
```
Alice: _gtActiveTable=null(已离桌), myUid='uid-alice'
Bob:   _gtActiveTable={id:t1, host:true}, myUid='uid-bob'
DB:    row.host_uid='uid-bob', row.seats=[bob]
```

**结论:正常流程无问题**

---

## 三、异常流程追踪(双host竞态)

### 场景:Host 掉线 → 心跳超时接管 → 原 Host 恢复

**初态:**
```
Alice: _gtActiveTable={id:t1, host:true}, _ehGame=running
Bob:   _gtActiveTable={id:t1, host:false}
DB:    row.host_uid='uid-alice'
```

**T0: Alice 网络断开**
```
Alice 的 realtime 连接断开
Alice 的 host_ping 停止发送
Alice 本地状态: _gtActiveTable.host=true, _ehGame 仍在跑(单机模式)
```

**T1: Bob 15s 未收 host_ping**
```js
// Bob 侧,gtWatchHostPing 定时器触发(line 1514)
const tr = _gtTables.get(tableId);
if(tr.host_uid === myUid) return;  // Bob 不是 host,通过
const humans = tr.seats.filter(...).sort(...);
if(humans[0].uid === myUid){
  await sb.rpc('eh_gt_set_host', {p_table_id: t1, p_new_host_uid: myUid});
  // DB: row.host_uid = 'uid-bob'
}
```

**T2: DB realtime 推送**
```
→ Alice 收不到(网络断开)
→ Bob 收到: row.host_uid='uid-bob'
```

**T3: Bob realtime 回调**
```js
gtCheckEngineTransfer(row);
  if(gtEngineHolder(row) !== myUid) return;  // 'uid-bob' === 'uid-bob',通过
  gtLaunchPoker(row, resumeSnap);  // 接管
    _gtActiveTable = {id:t1, host:true};
```

**此时状态:**
```
Alice: _gtActiveTable={id:t1, host:true}, _ehGame=running (Alice 不知道被夺权)
Bob:   _gtActiveTable={id:t1, host:true}, _ehGame=running
DB:    row.host_uid='uid-bob'
```

**T4: Alice 网络恢复**
```
Alice realtime 重连
Alice 收到积压的 realtime 消息: row.host_uid='uid-bob'
```

**T5: Alice realtime 回调**
```js
gtCheckEngineTransfer(row);
  if(gtEngineHolder(row) !== myUid) return;  // 'uid-bob' !== 'uid-alice',早退
// Alice 不接管(正确)
```

**但是! Alice 的引擎仍在跑:**
```js
// Alice 的 _ehGame 没有停止
// onSync 仍会触发,仍会广播快照
// Alice 的 _gtActiveTable.host = true (未更新)
```

**T6: Alice 引擎推进(eg.玩家出牌)**
```js
// Alice 侧,onSync 触发
onSync:(state,hno,turnDeadline)=>{
  // ★问题:没有检查 row.host_uid
  gtWritePokerHands(row.id, state, A.mySeat);  // 写底牌
  chan.send({event:'snap', payload:snap});  // 广播快照
}
```

**T7: Bob 也在推进**
```js
// Bob 侧,onSync 也触发
onSync:(state,hno,turnDeadline)=>{
  gtWritePokerHands(row.id, state, A.mySeat);  // 写底牌(覆盖 Alice 的)
  chan.send({event:'snap', payload:snap});  // 广播快照(与 Alice 冲突)
}
```

**终态:双host 分裂**
```
Alice: _gtActiveTable.host=true, _ehGame=running, handNo=10
Bob:   _gtActiveTable.host=true, _ehGame=running, handNo=10
DB:    row.host_uid='uid-bob' (只有 Bob 是权威)
结果: Alice 和 Bob 都在推进引擎,广播冲突快照
```

**根本问题:Alice 的 _gtActiveTable.host 没有随 row.host_uid 变化而更新**

---

## 四、v118 的修复为什么失败

### v118 的思路
```js
onSync:(state,hno,turnDeadline)=>{
  const _fr = _gtTables.get(row.id);
  if (_fr && _fr.host_uid && _fr.host_uid !== myUid) {
    console.warn('[gt] 检测到被夺权');
    _ehGame.close();
    _gtCleanupPlay();
    return;
  }
  // ... 正常推进
}
```

### 为什么崩溃
**问题:row 是闭包捕获的旧值**
```js
// gtLaunchPoker 时
function gtLaunchPoker(row, ...){
  // row 是参数,闭包捕获
  onSync:(state,hno,turnDeadline)=>{
    const _fr = _gtTables.get(row.id);  // _fr 是最新的
    // 但 onSync 里的其他地方仍用闭包的 row
    gtWritePokerHands(row.id, ...);  // 用的是闭包 row
  }
}
```

**更严重的问题:误触发**
- 第二个真人进场时,可能触发 DB 更新
- realtime 推送可能有延迟
- onSync 触发时,本地 `_gtTables.get(row.id)` 可能还是旧数据
- 或者 `_fr.host_uid` 还没同步到最新
- 导致 `_fr.host_uid !== myUid` 误判
- 引擎被错误停止

---

## 五、根本解决方案

### 5.1 单一事实源原则

**问题根源:**
- `_gtActiveTable.host` (本地)
- `row.host_uid` (DB)
- 两套系统不同步

**解决:**
- **废弃 `_gtActiveTable.host`**
- 所有 host 判定统一走 `gtEngineHolder(row)`
- `gtEngineHolder` 读实时的 `_gtTables.get(id).host_uid`

### 5.2 引擎生命周期与 host_uid 绑定

**当前问题:**
- 引擎启动后,不会主动监听 host_uid 变化
- 需要手动检测+停止

**解决:**
- 引擎启动时,订阅 host_uid 变化
- host_uid 变化时,自动停止引擎(如果不再是我)

### 5.3 被夺权检测的正确位置

**不应该在 onSync 里检测(太晚,已经推进了)**

**应该在 realtime 回调里检测:**
```js
// realtime 收到 row 更新
if(_ehGame && _gtActiveTable && _gtActiveTable.id === row.id){
  // 我有活跃引擎
  if(row.host_uid && row.host_uid !== myUid){
    // 但 DB 说我不是 host 了
    console.warn('检测到被夺权,停止引擎');
    _ehGame.close();
    _gtCleanupPlay();
  }
}
```

---

## 六、重构计划

### 阶段1:统一 host 判定源
- 找出所有 `_gtActiveTable.host` 的使用点
- 改为 `gtEngineHolder(row) === myUid`
- 废弃 `_gtActiveTable.host` 字段

### 阶段2:realtime 回调加被夺权检测
- 在 DB realtime 回调(line 2850 附近)加检测
- `row.host_uid !== myUid` 且我有引擎 → 停止

### 阶段3:测试所有场景
- 正常离座
- 心跳超时接管
- 网络抖动(断线→恢复)
- 多人同时离座

---

**下一步:** 执行阶段1,统一 host 判定源
