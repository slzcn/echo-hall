# GameTableSync 模块设计

**目标:** 从 app.js 抽取游戏桌联机状态管理,建立清晰的职责边界。

---

## 一、职责范围

GameTableSync 负责**一张游戏桌的联机状态同步**,包括:

1. **座位管理** — 入座/离座/座位名册(names/avatars/isAI/ids/souls)
2. **Host 选举** — 谁是 host、host 转移、自动接管
3. **快照广播** — host 推送游戏状态、guest 接收应用
4. **在线状态** — 心跳、离线检测、断线重连
5. **动作上行** — guest → host 的出牌/下注动作

**不负责:**
- UI 渲染(由各游戏 ui.js 负责)
- 引擎逻辑(由各游戏 engine.js 负责)
- 大厅/房间列表(仍在 app.js)
- 聊天/私信(仍在 app.js)

---

## 二、模块接口

### 构造函数

```javascript
const sync = new GameTableSync({
  tableId: 'gt-xxx',           // 游戏桌 ID
  game: 'nlhe',                // 游戏类型 nlhe/ddz/gd
  myUid: 'user-abc',           // 当前用户 uid
  supabase: supabaseClient,    // Supabase 客户端
  
  // 回调
  onSeatChange(seats) {},      // 座位名册变化(names/avatars/isAI/ids/souls)
  onHostTransfer(isHost) {},   // host 身份变化
  onSnapshot(snapshot) {},     // 收到 host 快照
  onAction(action) {},         // 收到远程玩家动作
  onDissolve() {},             // 散桌
  onError(err) {},             // 错误
});
```

### 公开方法

```javascript
// 生命周期
await sync.start();            // 开始监听 realtime
sync.stop();                   // 停止监听,清理资源

// 座位操作
await sync.takeSeat(seat);     // 入座
await sync.leaveSeat();        // 离座

// Host 操作(仅 host 可调)
await sync.broadcastSnapshot(snapshot);  // 广播快照
await sync.writeHands(hands);            // 写远程玩家底牌

// Guest 操作(仅 guest 可调)
await sync.sendAction(action); // 发送动作给 host

// 查询
sync.isHost();                 // 是否是 host
sync.getMySeat();              // 我的座位号(-1表示未入座/旁观)
sync.getSeats();               // 当前座位名册
```

---

## 三、内部状态

```javascript
class GameTableSync {
  // 配置
  #tableId;
  #game;
  #myUid;
  #supabase;
  #callbacks;
  
  // 状态
  #isHost = false;
  #mySeat = -1;
  #seats = [];              // DB row.seats 原始数组
  #seatArrays = null;       // gtSeatArrays 转换后的 {names,avatars,isAI,ids,souls,...}
  #roomSouls = [];          // 房间灵魂列表
  
  // Realtime
  #channel = null;
  #heartbeatTimer = null;
  
  // 运行标志
  #running = false;
}
```

---

## 四、核心流程

### 4.1 启动流程

```
sync.start()
  ↓
订阅 realtime: eh_game_tables:id=tableId
  ↓
收到初始 row
  ↓
_handleTableUpdate(row)
  ↓
更新 #seats / #isHost / #mySeat
  ↓
触发 onSeatChange / onHostTransfer
  ↓
启动心跳定时器
```

### 4.2 座位变化流程

```
realtime 推送 row
  ↓
_handleTableUpdate(row)
  ↓
检查 status==='closed' → onDissolve, stop
  ↓
更新 #seats
  ↓
调用 gtSeatArrays(row) → #seatArrays
  ↓
检测 host 变化 → onHostTransfer
  ↓
检测座位名册变化 → onSeatChange
```

### 4.3 快照广播流程(host)

```
引擎推进状态
  ↓
sync.broadcastSnapshot({ state, handNo, ... })
  ↓
supabase.rpc('eh_gt_snapshot', { snapshot_json })
  ↓
realtime 广播给所有 guest
```

### 4.4 快照接收流程(guest)

```
realtime 收到 snapshot 广播
  ↓
_handleSnapshot(snapshot)
  ↓
触发 onSnapshot(snapshot)
  ↓
UI 层应用快照到引擎
```

---

## 五、迁移策略

### 阶段1:创建模块骨架(不影响现有代码)

1. 创建 `js/modules/game-table-sync.js`
2. 实现基础类结构和接口
3. 添加单元测试

### 阶段2:德州扑克试点(并行运行)

1. app.js 德州部分创建 GameTableSync 实例
2. 双写:旧逻辑和新模块并行运行
3. 对比输出,确保一致性
4. journey 测试覆盖

### 阶段3:切换德州到新模块

1. app.js 德州部分移除旧逻辑,只用 GameTableSync
2. 删除德州相关的旧座位/host/快照代码
3. 回归测试

### 阶段4:扩展到掼蛋/斗地主

1. 复用 GameTableSync(已支持 game 参数)
2. 逐个游戏切换
3. 全量回归

### 阶段5:清理 app.js

1. 删除所有游戏桌相关的旧代码
2. app.js 只保留:大厅/房间列表/聊天/UI驱动
3. 减重 ~4k 行

---

## 六、测试计划

### 单元测试(game-table-sync.test.js)

- [ ] 构造和销毁
- [ ] 座位名册转换(gtSeatArrays 逻辑)
- [ ] host 选举(多人同时在线)
- [ ] 快照序列化/反序列化
- [ ] 错误处理(网络断开/权限错误)

### 集成测试(journey-*)

- [ ] 德州单机(host)
- [ ] 德州联机(host + 2 guest)
- [ ] 掼蛋/斗地主联机
- [ ] host 中途离开,guest 接管
- [ ] 散桌流程

---

## 七、风险和缓解

### 风险1:状态不一致

**描述:** 旧逻辑和新模块双写时,可能产生不同结果。

**缓解:**
- 双写模式下,每次调用后对比 `#seatArrays`,不一致时报警
- journey 测试全覆盖

### 风险2:性能回退

**描述:** 新模块可能引入额外开销(对象创建/回调)。

**缓解:**
- 基准测试:对比迁移前后 renderAll 频率
- 如果回退 >5%,优化热路径

### 风险3:引入新 bug

**描述:** 重构过程中漏掉边缘场景。

**缓解:**
- 每次迁移一个游戏,逐步推进
- 保留旧代码作为参考,直到全部迁移完成
- journey 测试 100% 通过才合并

---

## 八、成功标准

- [ ] app.js 减重至少 3k 行
- [ ] GameTableSync 单元测试覆盖率 >80%
- [ ] 所有 journey 测试通过
- [ ] 性能无回退(renderAll 频率 ±5%)
- [ ] 生产环境运行 48h 无新增崩溃

---

**预计工期:** 1 周(阶段1-3),2 周(全部完成)

**负责人:** Kiro

**评审人:** 主人

---

## 附录:代码结构预览

```
js/
├── modules/
│   ├── game-table-sync.js       # 新模块
│   ├── game-table-sync.test.js  # 单元测试
│   └── score.js                  # 已有的筹码钱包模块
├── games/
│   ├── poker-engine.js
│   ├── poker-ui.js
│   └── ...
└── app.js                        # 减重后只保留大厅/聊天
```

---

**下一步:** 创建 `game-table-sync.js` 骨架,实现基础类结构。
