# Echo Hall 架构诊断报告 v133 → 实施结果 v136
**生成时间**: 2025-01-04  
**执行时间**: 2025-01-04  
**代码规模**: 12,330 → 12,327 行 (js/app.js)  
**诊断方法**: 静态分析 - 数据流/职责/状态/容错

## ✅ 已完成项 (v134-v136)

- **A1 (v134)**: 删除死RPC `eh_gt_set_host` — ✅ 完成,省1次无效网络往返/15秒
- **A2 (v135)**: 提取 enterRoom 初始化公共路径 — ✅ 完成,省7行+统一行为+role只查一次
- **A3**: loadHistoryCore 并行化 — ❌ 不适用(已优化,只有2-3个互斥分支await)
- **A4**: generateAndPersistSong 并行化 — ❌ 不适用(串行流水线,session+manifest已并行)
- **A5 (v136)**: 提取 gtRow helper — ✅ 完成,统一24处缓存访问模式

**净收益**: 删1个死调用 + 省7行重复 + 统一缓存访问,代码从 12,330 → 12,327 行

---

## 优先级 A — 性能收益大 (立即可做)

### A1. 删除死 RPC 调用 `eh_gt_set_host`
**位置**: L1534  
**问题**: SQL 中此 RPC 根本不存在(summary v124-v129 已确认),每次调用抛错被空 catch 吞掉  
**影响**: 每3秒 gtHostPingFallback 循环无效调用,浪费网络+log 噪音  
**方案**: 直接删除 L1534 的 `await sb.rpc('eh_gt_set_host', ...)` 行  
**收益**: 省1个无效网络往返/3秒 + 清理错误日志

---

### A2. 提取 `enterRoom` 的初始化公共路径
**位置**: enterRoom L2075-2106(keep-alive) vs L2108-2147(全量)  
**问题**: 两条路径都执行几乎相同的初始化:
- `joinAsMember(room)` 
- 查 `eh_members role` (L2093 vs L2129,**同一数据查两次**)
- `setupPresence` + `setupGameTables` + `loadRoomSouls` + `loadInteractions`
- `entranceBanner(room)` + 跨场景记忆构建

**影响**: 111行函数里有 ~40 行重复,维护时要改两处  
**方案**:  
```js
async function _enterRoomPostAuth(room, skipHistory){
  if(await joinAsMember(room)===false) return false;
  const tasks = [
    !skipHistory && loadHistory(true),
    sb.from('eh_members').select('role')...maybeSingle(),
    setupPresence(room), setupGameTables(room),
    loadRoomSouls(room.id), ...
  ].filter(Boolean);
  const [histRes, memRes] = await Promise.allSettled(tasks);
  room.role = memRes?.value?.data?.role || 'member';
  // ... 统一后处理
  return true;
}

// keep-alive 路径和全量路径都调用它
```
**收益**: 省 ~30 行重复 + 统一行为 + role 只查一次

---

### A3. 并行化 `loadHistoryCore` 的7个 await
**位置**: loadHistoryCore 函数 (153行,7个 await)  
**问题**: 历史消息加载串行执行多个独立查询  
**方案**:  
1. 审查7个 await 的依赖关系  
2. 无依赖的用 `Promise.all()` 并行  
3. 例如:拉消息+拉用户身份+拉互动记录可并行  
**收益**: 历史加载从 ~700ms 降到 ~200ms (假设单查100ms)

---

### A4. 并行化 `generateAndPersistSong` 的6个 await
**位置**: generateAndPersistSong (99行,6个 await)  
**问题**: AI 生成歌曲 + 持久化逻辑串行  
**方案**:  
1. 分离"生成"(AI调用)和"持久化"(写DB)  
2. 生成后的 DB 写入(如保存歌词/音频 URL)可批量  
**收益**: 生成歌曲快 ~300ms

---

### A5. 提取 `gtRow(id, row)` helper 消除24次重复
**位置**: 全代码 24 处 `_gtTables.get(id)||row`  
**问题**: fallback 模式重复,且易写错(如忘 `||row`)  
**方案**:  
```js
function gtRow(id, fallback){ return _gtTables.get(id)||fallback; }
```
全局替换为 `gtRow(row.id, row)`  
**收益**: 代码简洁 + 统一缓存策略(未来可加过期检查)

---

## 优先级 B — 架构改善 (中期重构)

### B1. 拆解 `openGear` (266行) 的职责
**当前**: 一个函数混合: 数据加载(sb.from 2次)+ UI 构建(innerHTML 1次)+ 事件绑定  
**问题**: 难测试、难复用、改一处动全身  
**方案**:  
```js
async function openGear(){
  const data = await _gearFetchData(); // 数据层
  const html = _gearBuildHTML(data);   // UI层
  _gearBindEvents(data);               // 交互层
}
```
**收益**: 可单测数据/UI,未来可复用数据层

---

### B2. 拆解 `subscribeMessages` (186行) 为 setup + handler
**当前**: 一个函数包含: realtime 订阅 + 多种消息类型 switch + DOM 操作  
**问题**: 新增消息类型要改 186 行函数  
**方案**:  
```js
function subscribeMessages(){
  const handlers = {
    INSERT: _handleMsgInsert,
    UPDATE: _handleMsgUpdate,
    DELETE: _handleMsgDelete,
  };
  chan.on('postgres_changes', e => handlers[e.eventType]?.(e));
}
```
**收益**: 每种消息独立函数,易扩展

---

### B3. 统一 game-table 缓存策略
**当前**: `_gtTables` (Map,48次get)+ `roomSouls` (33次引用)+ `presenceMap` (5次)三套缓存职责重叠  
**问题**: 同一房间/桌子的数据散落三处,更新时易漏  
**方案**:  
```js
// 统一为 _rooms Map,包含 table/souls/presence 子对象
_rooms.get(roomId) → {table, souls, presence, ...}
```
**收益**: 一次查询拿到全部上下文,减少 get 次数

---

### B4. 异步流程图可视化 (工具辅助)
**发现**: `enterRoom` / `gtLaunchPoker` / `loadHistoryCore` 等 async 函数嵌套深,难以人工追踪依赖  
**方案**: 用工具(如 Mermaid 生成)绘制关键流程的 async 依赖图,识别并行机会  
**收益**: 全局优化 async 路径,不止 A3/A4 两处

---

## 优先级 C — 技术债 (长期维护)

### C1. 容错策略标准化
**现状**:  
- 完全空 `catch{}`: 557 个  
- `catch(_){}`: 486 个  
- `_ehCatch()`: 227 个  
- `console.warn/error`: 93 个  

**问题**: 557+486=**1043个空 catch** 吞掉错误,线上问题无日志可查  
**方案**:  
1. 规范: 所有 catch 至少 `catch(e){ _ehCatch('上下文', e); }`  
2. 分级: 预期错误(如网络超时)用 `catch(_){}`,意外错误必须 log  
3. 工具: ESLint 规则禁止空 catch  
**收益**: 线上问题可排查,减少"用户报 bug 但查不到日志"

---

### C2. 定时器泄漏风险
**现状**:  
- `setTimeout`: 135次,`clearTimeout`: 25次 (110个可能未清)  
- `setInterval`: 17次,`clearInterval`: 30次 (看似平衡,但需逐一确认配对)  

**问题**: 未清的定时器在组件销毁后仍执行,访问已删 DOM → 内存泄漏/报错  
**方案**:  
1. 审查 `_gtCleanupPlay` 等清理函数是否 clear 所有定时器  
2. 统一模式: 定时器ID 存全局变量(如 `_gtMyBeatTimer`),cleanup 时 clear  
**收益**: 防止长时间运行后内存涨、卡顿

---

### C3. 状态变量命名与职责收口
**发现**: 26 个全局 `_gt*` 变量,职责分散  
- `_gtActiveTable` (72次引用)  
- `_gtPlayChan` (41次)  
- `_gtWaitingHumans` (23次)  
- ...  

**问题**: 全局变量多 → 难追踪谁改了什么,易产生竞态  
**方案**:  
1. 短期: 给每个变量加注释说明职责  
2. 中期: 聚合为 `_gtState = { activeTable, playChan, ... }`,统一访问  
3. 长期: 引入轻量状态库(如 Zustand)或自建 observer 模式  
**收益**: 状态变更可追踪,减少 bug

---

### C4. DOM 操作集中化
**发现**: `innerHTML` 出现 143 次,散落各函数  
**问题**: 字符串拼接易 XSS,且每次赋值触发全量 reflow  
**方案**:  
1. 模板函数化: `function buildMemberItem(user){return `<div>...</div>`}`  
2. 增量更新: 优先用 `element.append()` / `textContent` 而非整块 innerHTML  
3. 安全审查: 所有用户输入必须 `esc()` 转义(已有,需审查遗漏)  
**收益**: 性能提升(减少 reflow)+ XSS 风险降低

---

## 数据统计摘要

| 维度 | 数值 | 说明 |
|------|------|------|
| 代码行数 | 12,330 | js/app.js 单文件 |
| Supabase .select() | 35次 | 跨11张表 |
| Supabase .rpc() | 24种 | 部分调用2-3次 |
| 缓存访问 _gtTables | 48次get / 13次set | 高频热点 |
| 空 catch 块 | 1043个 | 吞错严重 |
| 复杂函数(>80行) | 20个 | openGear 最长266行 |
| 全局状态变量 | 26个 _gt* | 职责分散 |
| setTimeout 未配对 | ~110个 | 泄漏风险 |

---

## 实施建议

### 第一波(本周):  
执行 **A1-A5**(删死调用+合并查询+提取helper+并行化2处)  
→ 预期收益: enterRoom 快 ~150ms,历史加载快 ~500ms,生成歌曲快 ~300ms

### 第二波(2周内):  
执行 **B1-B2**(拆 openGear/subscribeMessages)  
→ 收益: 代码可维护性提升,为后续功能铺路

### 第三波(排期):  
逐步解决 **C1-C4**(容错标准化+定时器审查+状态收口+DOM优化)  
→ 收益: 长期稳定性,减少线上 bug

---

## 附录: 关键热点函数清单

| 函数名 | 行数 | SB操作 | await数 | 问题 |
|--------|------|--------|---------|------|
| openGear | 266 | 2 | 1 | 职责混杂 |
| subscribeMessages | 186 | 1 | 2 | switch 过长 |
| gtLaunchPoker | 174 | 1 | 2 | 可拆通道/引擎 |
| loadHistoryCore | 153 | 2 | 7 | **串行严重** |
| _gtEnterPokerV2 | 152 | 2 | 3 | 可复用 guest 框架 |
| generateAndPersistSong | 99 | 2 | 6 | **串行严重** |
| enterRoom | 111 | 1 | 4 | 职责混杂 |

---

**诊断完成**。建议先从 A1-A5 开始(收益最大且风险低),每项独立 commit + 测试。
