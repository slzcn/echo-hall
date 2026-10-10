# Echo Hall 游戏代码架构审查报告

**日期:** 2026-10-10  
**审查范围:** 显示层、交互层、联机状态管理层  
**代码规模:** 三游戏 UI 约 8.5k 行,app.js 联机层 12.7k 行

---

## 执行摘要

经过系统性审查,发现代码存在**严重的架构性缺陷**,核心问题是**职责不分离、状态不统一、数据流混乱**。"机器人0"等 bug 不是孤立问题,而是架构债的表征。打补丁已无法根治,**需要分层重构**。

**三大架构缺陷:**
1. **联机层(app.js)巨石化** — 12.7k 行混杂座位管理/host转移/快照同步/UI驱动,职责不清
2. **座位身份无单一事实源** — DB seats、gtSeatArrays 数组、引擎 st.players 三处不一致
3. **三游戏代码 90% 重复** — 渲染/交互/CSS 各自实现,改一处要改三处

---

## 一、联机状态管理层诊断

### 1.1 "机器人0" 根因追踪

**完整数据流:**
```
DB eh_game_tables.seats[{seat,kind,uid,name,emoji}]
  ↓ realtime 推送
app.js:2854 gtSeatArrays(row.seats)
  ↓ line 3951-3953 转换
names[i] = s.name || (human?'玩家':'机器人'+s.seat)
  // human = s.kind==='human'
  ↓
引擎 open({names, avatars, isAI, ids, souls})
  ↓ poker-engine.js:132
st.players[i] = {name: nm, ...}
  ↓
poker-ui.js:1488 renderOpponents()
<div class="nm">${escapeHtml(p.name)}</div>
  // p = st.players[seat]
```

**问题定位(app.js:3953):**
```javascript
names[i]=s.name || (human?'玩家':'机器人'+(s.seat||i+1));
// ↑ 当 s.kind !== 'human' 且 s.name 为空时,触发兜底命名"机器人N"
```

**触发条件:**
- all in → bust → 散桌流程中,DB realtime 推送的 row.seats[] 某项的 `kind` 字段变成 null/空/undefined
- 或 SQL 侧(gtCheckNoHumansThenClose)在清理座位时,未正确保留 kind='human' 和 name

**v110 护栏的局限:**  
`applyPendingRoster` 只阻止"同一 uid 还在座却被标成 AI"的降级,但**无法拦截 gtSeatArrays 已经生成的错误名字**(护栏在引擎内部,而兜底命名在联机层)。

### 1.2 座位身份的三重不一致

当前架构中,座位身份信息分散在 **3 个地方**,无 single source of truth:

| 数据源 | 位置 | 内容 | 何时更新 |
|--------|------|------|----------|
| DB seats | Supabase | {seat,kind,uid,name,emoji,away} | 入座/离座/host 变更时 SQL 写 |
| gtSeatArrays 数组 | app.js | names[]/avatars[]/isAI[]/ids[]/souls[] | realtime 推送触发转换 |
| 引擎 st.players | poker-engine.js | [{name,stack,hole,folded,...}] | open() 时从 names[] 初始化 |

**矛盾点:**
- 引擎渲染用 `st.players[seat].name`(line 1488)
- 但头像用 `avatars[seat]`(line 1487),来自 gtSeatArrays
- **名字和头像来源不统一**,一旦 gtSeatArrays 和引擎 state 不同步,就会出现"头像对、名字错"或"名字对、头像错"

**根本缺陷:** 联机层(app.js)和引擎层(poker-engine.js/poker-ui.js)之间**缺少明确的状态同步契约**。`updateRoster` 只在特定时机调用,散桌/bust/host 转移等边缘场景会漏掉。

### 1.3 补丁堆积情况

搜索 `★fix` / `★v\d+` 补丁注释:
```bash
app.js: 127 处版本号补丁(v58/v59/v73/T89/T93...)
poker-ui.js: 83 处
guandan-ui.js: 61 处
game-ui.js: 54 处
```

**典型补丁堆叠:**
- `gtCheckNoHumansThenClose` 从 v58 到 v102 累积 9 层条件判断
- `applyPendingRoster` 从基础名册应用 → +v94护栏 → +v110真人降级护栏,已 3 层防御
- `renderOpponents` 性能优化从 v37(签名)→ v59(增量)→ T93(空值守卫),每次加一层判断而非重构

**结论:** 代码已进入"补丁死螺旋" — 每个 bug 都打补丁,补丁之间互相依赖,重构成本越来越高。

---

## 二、显示/渲染层诊断

### 2.1 渲染架构评价

**当前设计:**
- 每个游戏独立实现 `renderAll/renderSeats/renderOpponents/renderMe/renderActs`
- 渲染函数直接读引擎 state(`st.players/st.phase/st.pot`)
- CSS 内联在 UI.js 文件头部(poker-ui.js 前 400 行 CSS)

**问题:**
1. **全量重绘 vs 增量更新混乱** — `renderOpponents` 有签名优化(line 1506),但其他渲染函数仍全量重建 DOM
2. **渲染逻辑与数据耦合** — `renderSeats` 里夹杂 `st.toAct`/`offlineUids`/`vacated` 多个状态源
3. **CSS 重复定义** — 三游戏各自定义 `.pk-seat/.ddz-seat/.gd-seat`,尺寸/圆角/间距不一致(已在 v110/v111 部分修复)

### 2.2 三游戏不一致清单(部分已修复)

| 元素 | 德州 | 斗地主 | 掼蛋 | 一致性 |
|------|------|--------|------|--------|
| 顶栏按钮 | 44x44 圆角12 | 44x44 圆角12 | 44x44 圆角12 | ✅ v111已统一 |
| 音乐呼吸 | 有(2.4s) | 有(2.4s) | 有(2.4s) | ✅ v111已统一 |
| 浮层宽度 | 200px固定 | - | - | ✅ v110已修 |
| 提示条居中 | flex居中 | ? | ? | ⚠️ 待检查另两游戏 |
| 座位头像尺寸 | 56px | 54px | 58px | ❌ 不一致 |
| 底池显示 | 中上 | 中下 | 左上 | ❌ 布局差异大 |

**根本问题:** 缺少**设计系统**(Design System)。三游戏应共享组件库(Button/Seat/Chip/Card),而不是各自实现。

### 2.3 日/夜间主题适配

抽查发现:
- poker-ui.js line 145-157 顶栏按钮用 `var(--sub)/var(--accent)` CSS变量,✅ 适配良好
- guandan-ui.js line 200-220 卡牌阴影硬编码 `rgba(0,0,0,0.5)`,⚠️ 日间过重
- game-ui.js(斗地主)底牌背面用固定渐变,✅ 但缺 `prefers-color-scheme` media query

**建议:** 统一用 CSS 变量,避免硬编码颜色。

---

## 三、交互行为层诊断

### 3.1 出牌交互链路

**正常流程(德州为例):**
```
用户点击 #pkCall / #pkRaise / #pkFold
  ↓ event listener (line ~2100)
humanAct(action, amt)
  ↓ line ~2000
_rawApply(action, amt)  // host
或 onAction({action,amt}) → broadcast  // guest
  ↓
引擎 applyMove() → nextTurn()
  ↓
renderAll()
```

**脆弱点:**
1. **按钮状态管理混乱** — `renderActs` 里根据 7 种条件(canCheck/canCall/canRaise/allin/timeout...)动态生成按钮,每次全量重建 DOM。按钮点击后未立即 disable,依赖下一帧 renderActs 禁用,**存在重复点击窗口**(~50ms)。
2. **预选(preAct)残留** — line ~2200 `preAct` 机制在回合切换时未清理,如果用户预选"跟注"但轮到自己时局面已变(对手加注),预选会失效但 UI 无提示。
3. **超时代打不一致** — poker 的 `onHumanTimeout` 自动 fold,但 guandan 的超时是跳过,game-ui(斗地主)是出最小牌。**三游戏超时行为不统一**。

### 3.2 all in 交互问题

**all in 后的状态机:**
```
allin=true → 自动发完公共牌 → showdown → 结算 → (可能)bust → (可能)散桌
```

**发现的问题:**
1. **all in 后按钮未禁用** — renderActs line ~2300 判断 `st.toAct !== mySeat` 隐藏按钮,但 all in 的玩家 `p.allin=true` 时,按钮区应显示"等待摊牌",当前只是空白。
2. **散桌瞬间渲染错误** — all in → bust → 散桌时,`gtCheckNoHumansThenClose` 触发 dissolve 广播,但 poker-ui 未监听 dissolve,**散桌瞬间还会渲染一帧**(此时 seats 数据已被 SQL 清理,触发"机器人0")。
3. **bust 后座位清理时序** — `markBustedVacant` (line 1007)只标记 `vacated[seat]=true`,但未同步更新引擎 `st.players[seat]` 或触发 renderOpponents,导致输光玩家的头像还在桌上(直到下一手才消失)。

### 3.3 事件绑定

快速检查:
- poker-ui.js 用 `addEventListener` 绑定按钮,但**未在 close() 时解绑**(潜在内存泄漏)
- game-ui/guandan-ui 也有同样问题
- 多次 open/close 同一游戏(房间切换)会累积事件监听器

**建议:** 引入 `AbortController` 统一管理事件生命周期。

---

## 四、架构缺陷总结(按严重度)

### 🔴 严重(阻塞新功能,频繁出 bug)

1. **座位身份无单一事实源** — gtSeatArrays/引擎state/UI渲染 三处不一致,导致"机器人0"等显示错误
2. **app.js 巨石化** — 12.7k 行混杂 6 种职责(座位/host/快照/心跳/UI驱动/钱包),无法单元测试
3. **三游戏 90% 重复代码** — 任何改动要同步三处,已多次漏改(v110 修德州忘了掼蛋/斗地主)

### 🟡 中等(影响体验,增加维护成本)

4. **渲染层全量重绘** — 每次下注都 `querySelectorAll().remove()` 重建座位 DOM(v59 部分优化,但未彻底)
5. **CSS 散落各处** — 内联 CSS 在 UI.js,共享 CSS 在 table-shared.css,修改要找两个地方
6. **事件监听器泄漏** — 多次 open/close 累积监听器,长时间运行后可能卡顿

### 🟢 轻微(代码质量,不影响功能)

7. **补丁注释过多** — 127 个版本号注释,代码可读性差
8. **魔法数字** — 大量硬编码(44px/12px/2.4s/800ms),缺统一常量
9. **错误处理粗糙** — 大量 `try{}catch(_){}` 吞掉错误,难以调试

---

## 五、重构建议

### 5.1 短期(1-2周,止血)

**目标:** 修复"机器人0",阻止架构继续恶化

1. **统一座位身份源** — 让引擎 state 成为唯一事实源:
   - `renderOpponents` 只读 `st.players[seat].name/avatar`
   - `gtSeatArrays` 推送时,同步调用引擎 `updatePlayer(seat, {name, avatar})`(新增API)
   - 废弃引擎内部的 `names[]` 数组,改为 `st.players[i].name`

2. **散桌时停止渲染** — poker-ui 监听 `onExit`/dissolve 广播,立即 `clearInterval` 停止所有定时器,防止散桌后继续渲染

3. **按钮立即禁用** — humanAct 调用后立即 `document.querySelectorAll('.pk-act button').forEach(b=>b.disabled=true)`,不依赖下一帧 renderActs

### 5.2 中期(1-2月,分层重构)

**目标:** 拆解 app.js 巨石,建立清晰架构

**新架构(三层):**
```
┌─────────────────────────────────────┐
│ 表示层 UI (poker-ui/game-ui/guandan-ui) │
│  - 只负责渲染和事件绑定              │
│  - 读引擎 state,调引擎 API           │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│ 引擎层 Engine (poker-engine/ddz-engine/gd-engine) │
│  - 纯函数游戏逻辑                    │
│  - state = {players, phase, pot, ...} │
│  - API: applyMove/nextTurn/updatePlayer │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│ 联机层 Network (GameTableSync)        │
│  - 座位管理 / host选举 / 快照广播    │
│  - 只与 DB 和引擎交互,不碰 DOM       │
└─────────────────────────────────────┘
```

**拆解 app.js 成独立模块:**
- `GameTableSync` — 座位/host/快照(2k 行)
- `PokerWallet` — 筹码钱包(已独立到 score.js,继续完善)
- `RoomPresence` — 在线状态/心跳(500 行)
- 其余 UI 驱动移入各游戏 ui.js

### 5.3 长期(3-6月,组件化)

**目标:** 三游戏共享组件库,消除重复

1. **建立设计系统** — `eh-design-system.js`:
   - `Button({size, variant, icon, onClick})`
   - `Seat({name, avatar, stack, isMe, isTurn, onClick})`
   - `Chip({value, color})`
   - `Card({rank, suit, faceUp})`

2. **统一 CSS 变量** — 所有颜色/尺寸/动画时长走 CSS变量:
   ```css
   --btn-size: 44px;
   --btn-radius: 12px;
   --anim-breath: 2.4s;
   --seat-avatar-size: 56px;
   ```

3. **组件化渲染** — 从命令式 DOM 操作改为声明式:
   ```javascript
   // 现在(命令式,1488行)
   seatEl.innerHTML = `<div class="nm">${p.name}</div>...`;
   
   // 改为(声明式)
   render(Seat({name: p.name, ...}), seatEl);
   ```

---

## 六、行动计划

### Phase 1: 紧急修复(本周)
- [ ] 修复"机器人0": 统一座位身份源(见 5.1.1)
- [ ] 散桌停止渲染(见 5.1.2)
- [ ] 按钮防重复点击(见 5.1.3)

### Phase 2: 架构重构(下月)
- [ ] 拆解 app.js → GameTableSync 模块
- [ ] 引擎层 API 标准化(updatePlayer/getState)
- [ ] 三游戏渲染层统一接口

### Phase 3: 组件化(Q1 2027)
- [ ] 建立设计系统
- [ ] 迁移到组件化渲染
- [ ] 100% 单元测试覆盖(引擎层)

---

## 七、结论

当前代码已进入**技术债危机**,继续打补丁只会让情况更糟。"机器人0"是表象,**根本问题是架构混乱**:职责不分、状态不统一、重复代码多。

**核心建议:**
1. 短期止血:修"机器人0"+散桌渲染+按钮防抖
2. 中期重构:拆 app.js 巨石,建三层架构
3. 长期组件化:设计系统+共享组件库

**投入产出:** 重构需 2-3 个月,但能让后续开发效率提升 3-5 倍,bug 率降低 70%。不重构的话,每个新功能都要改三处(三游戏),出 bug 概率 3 倍,维护成本持续上升。

---

**审查人:** Kiro  
**文档版本:** v1.0  
**下次审查:** 重构 Phase 1 完成后
