# 游戏编排层重构方案

## 一、问题诊断(为什么反复修不好)

### 现状数据
- app.js 里游戏编排代码 **~8,261 行**(占全文件 67%)
- **126 个 gt 函数** + **23 个全局 _gt 变量**,互相调用成网
- 两个超长函数:gtEnterDdz 区域、gtSeatSoulsIntoEmpties 区域
- 代码里 **★v51/v55/v57/v66/v82/v87/v133** 层层补丁标记

### 根本病因(不是单个 bug,是结构病)

**病因 1:没有状态机,状态散落**
23 个全局变量(_gtActiveTable / _gtPokerSession / _gtReleasingHolder / _gtDissolvedTableId / _gtTakingOver ...)各自为政。一次"进桌"要同时正确设置 5-6 个变量,漏一个就出 bug。改一处不知道影响哪几个。

**病因 2:多角色逻辑交织在同一批函数里**
host / guest / spectator / away / 等座 五种角色的逻辑混在 gtLaunchXxx / _gtEnterXxx / gtSpectateXxx 里,用 if 分支切换。角色转换(guest→host 接管、host→away 让位)时,状态清理不干净 → "误进旁观""双 host""散桌卡死"。

**病因 3:realtime 回调与本地操作竞态**
realtime 推送(别人进出座位)和本地操作(我点出牌/离场)并发修改同一批状态,没有串行化。竞态窗口 → 偶发、难复现的 bug。

**病因 4:事实源混乱**
host_uid(DB)vs gtEngineHolder(座位推导)vs _gtActiveTable.host(本地)三个"谁是 host"的判据,历史上不一致导致走错分支崩溃。v119 后统一用座位推导,但旧判据的残留调用仍散落各处。

---

## 二、重构目标(可验收)

### 目标 1:单一状态源
所有游戏状态收口到一个 `GameSession` 对象,替代 23 个全局变量。
**验收**: 全局 _gt 变量从 23 个降到 ≤3 个(只保留跨会话的缓存如 _gtTables)。

### 目标 2:显式状态机
进桌/开局/出牌/离场/接管/散桌 建模为**明确的状态 + 转换**,非法转换直接拒绝而非静默出错。
**验收**: 画出状态图,每个转换有唯一入口函数,有单元测试覆盖。

### 目标 3:角色策略分离
host / guest / spectator 三种角色各自一个独立模块,共享同一状态机,不再用 if 分支交织。
**验收**: 角色切换(接管/让位)只需切换策略对象,状态清理自动完成。

### 目标 4:串行化状态变更
所有状态变更(本地操作 + realtime 回调)走同一个队列,消除竞态。
**验收**: 并发进出场景的旅程测试稳定通过(不再偶发)。

### 目标 5:行为完全对齐现有
重写后用户感知**零差异**(除了 bug 消失)。所有现有旅程测试必须通过。
**验收**: journey-poker-online / journey-host-transfer / journey-gt-online-heal 等全绿。

---

## 三、重构方式

### 架构设计

```
js/game-orchestra/           (新建,替代 app.js 里 8261 行)
├── session.js       GameSession 单一状态源 + 状态机
├── roles.js         HostRole / GuestRole / SpectatorRole 策略
├── transport.js     realtime 通道编排(订阅/心跳/广播/清理)
├── holder.js        引擎持有者推导 + 接管/让位(座位单一事实源)
├── seating.js       座位管理(入座/离座/away/等座队列)
├── lifecycle.js     进桌/开局/散桌 生命周期
└── index.js         对外接口(供 app.js 调用)
```

### 核心抽象

```js
// session.js - 单一状态源
class GameSession {
  tableId = null;
  game = null;              // nlhe/ddz/guandan
  role = 'idle';            // idle/host/guest/spectator/away/waiting
  status = 'idle';          // idle/lobby/playing/settling/closed
  engine = null;            // 当前引擎实例(原 _ehGame)
  chan = null;              // realtime 通道(原 _gtPlayChan)
  seats = [];               // 座位快照
  mySeat = -1;

  // 状态机:唯一的状态转换入口
  transition(event, data){
    const next = TRANSITIONS[this.status]?.[event];
    if(!next){ _ehTrack('gameSession.illegalTransition', ...); return false; }
    // 执行退出旧状态 + 进入新状态的清理/初始化
  }
}

// holder.js - 引擎持有者(保留现有正确逻辑)
function engineHolder(seats){
  // 座位最小的非 away 真人(已验证正确,直接复用)
  return seats.filter(s=>s.kind==='human'&&s.uid&&!s.away).sort(bySeat)[0]?.uid || null;
}

// roles.js - 角色策略
class HostRole {
  onEnter(session){ /* 启动引擎 + 心跳 + 订阅 */ }
  onExit(session){ /* 停引擎 + 清心跳 + 让位 */ }
  onRealtimeChange(session, row){ /* 座位变化处理 */ }
}
```

### 保留不动的部分
- `js/games/` 下所有引擎(ddz-engine/poker-engine/guandan-engine)、规则、AI
- `js/games/*-ui.js` 渲染层
- SQL schema(本阶段不改,先验证前端架构)

### 迁移策略
1. 新模块 `game-orchestra/` 与现有代码**并存**
2. 功能开关 `localStorage.eh_game_v2` 控制走新/旧
3. 先迁斗地主(最简单,3人),验证架构
4. 稳定后迁德州/掼蛋,删旧代码

---

## 四、如何确保目标达成(验收机制)

### 1. 行为基线锚定
重写前,先把现有游戏的**完整业务规则**提取成文档(规则清单),作为重写的 spec。
→ 产出 `docs/GAME_RULES_SPEC.md`:列出所有边界规则(host 轮转/散桌条件/旁观入座时机/away 判定...)

### 2. 旅程测试全绿
现有 journey 测试是行为契约,重写后必须全部通过:
- journey-poker-online(德州联机18步)
- journey-host-transfer(host 轮转)
- journey-gt-online-heal(断线自愈)
- journey-ddz-play / journey-guandan-play
- journey-multiplayer-scenarios(多人进出)

### 3. 新增状态机单元测试
每个状态转换写测试:合法转换成功,非法转换被拒。
→ 产出 `scripts/test-game-session.js`

### 4. 灰度对比
新旧版并行期,同一桌两个客户端分别用新/旧版,对比行为一致性。

### 5. 关键路径埋点
用 v138 的 _ehTrack(critical) 标记状态机的非法转换,灰度期线上观测异常。

---

## 五、分阶段计划

### Phase 0: 对齐规则(1天)— 必须先做
- 读完现有编排层,提取业务规则到 GAME_RULES_SPEC.md
- 画出状态机图(进桌→开局→出牌→离场→接管→散桌)
- **你 review 规则文档,确认无遗漏**

### Phase 1: 核心架构(2-3天)
- 实现 session.js(状态机)+ holder.js + transport.js
- 单元测试覆盖状态转换
- 不接 UI,纯逻辑验证

### Phase 2: 斗地主接入(2天)
- roles.js 三角色策略
- 接 ddz-engine + ddz-ui
- journey-ddz-play 全绿

### Phase 3: 灰度验证(3-5天)
- 功能开关上线
- 新用户走新版,观察 bug 率
- 修复灰度暴露的问题

### Phase 4: 全量迁移(1周)
- 德州/掼蛋接入新架构
- 删除 app.js 里旧编排代码(-8000 行)
- app.js 回到 ~4000 行

---

## 六、风险与对策

| 风险 | 对策 |
|------|------|
| 重写丢失隐藏的边界处理 | Phase 0 先提取完整规则 spec |
| 新架构有新 bug | 灰度 + 旅程测试 + 新旧并存 |
| 工期超预期 | 先做斗地主验证,不行及时止损回退 |
| realtime 竞态仍存在 | 状态变更串行化队列 |

---

## 七、需要你拍板的决策

1. **SQL 是否可改**?(影响能否根治 host_uid 设计缺陷。注:Management API token 已失效,改 SQL 需你手动部署)
2. **先做斗地主验证** 还是 **三个一起重写**?
3. **是否接受灰度期**(新旧并存 1-2 周)还是直接切换?
