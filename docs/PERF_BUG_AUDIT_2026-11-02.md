# Echo 全面性能与缺陷审查报告

**日期**: 2026-11-02  
**范围**: `index.html` / `js/app.js` / `js/poker-ui.js` / `sw.js` / 键盘与音频链路 / 版本更新链路  
**方法**: 静态证据审查 + 对照既有 triage / ARCH_AUDIT / journey 门禁 + 本地 `scripts/ci-check.sh`（全绿）  
**性质**: 只读审计，未改代码。按 AGENTS.md，任何后续修复需单独立诊断单 + 稳定复现 + 旅程测试。

---

## 0. 执行摘要

CI 门禁当前全绿，说明「已修问题未回归」。但门禁覆盖的是**行为回归与版本一致性**，不是性能预算、发版工具链正确性、以及弱网/离线体验。本次审查在这些盲区里找到一批真实问题。

**2026-11-02 修复进度**（详见 `docs/triage/2026-11-02-*.md`）：
- ✅ **超时→游戏自动结束**（用户重点）：本席连续超时不再离座/散桌；假 `bumpMiss` 已修
- ✅ **B6/B7** 发送指纹防重 + 重试幂等
- ✅ **B9** 抢座先 join 成功再拆旧局
- ✅ **B3/B4** 换房游标防串房 + prefetch 防崩
- ✅ **C5/C6/C7** 发版脚本正则 + `__EH_APP_VER` 漂移核对 + 缓存保护
- ✅ **P13** 公开房 tail 小 lim 增量 / 私密房 id 增量
- ✅ **B11** host 超时标 away 接管闭环，删除 `eh_gt_set_host` 死调用

**未做（后续）**：载荷分层（P1/P2）、定时器统一生命周期、BGM Range 缓存（C1）、离线状态条（C11）、更新提示（C8）等。

三块结论：

1. **性能**：冷启动载荷偏大（HTML+JS 合计约 1.2MB raw），进房 `ensureBottom` 多帧布局抖动明显，公开房每 20s 全量补拉最多 500 行，房内多套固定频率定时器叠罗汉。体感瓶颈主要在「进房首秒」和「挂着聊天时的流量/耗电」。
2. **缺陷**：20 条可证据化问题。用户最痛的是**消息双发/重试双份（B6/B7）**、**抢座失败拆掉进行中牌局（B9）**、**换房历史错乱/白屏（B3/B4）**、**host 掉线整桌卡死（B11）**。`_sendInFlight` 是假锁，现有 journey-submit-singleflight 未覆盖真实 `send()` 入口。
3. **SW / 更新 / 离线**：比 2026-08 的「缓存自锁」已加固很多，但发版脚本 `bump-version.sh` 的 SW 模式串已过期（会静默漏改），运行时字节漂移检测未真正落地，BGM 持久缓存对 Range 媒体几乎无效，`hardRecover` 过激清缓存。**更新/离线体验可用，但不够可托付。**

**建议优先序（ROI）**  
1. **B6/B7** 发送假锁 → 真防重 + 重试幂等（聊天最基本动作）  
2. **B9** 抢座先 join 成功再拆旧局  
3. **B3/B4** 换房历史写全局游标前先校 rid  
4. **C6/C5** 修 `bump-version.sh` + 补 `__EH_APP_VER` 运行时核对（发版正确性）  
5. **P13** 公开房 tail 补拉改增量（流量+CPU 双杀）  
6. **B11** host 超时后标 away 触发 holder 重算，闭环接管  
7. **P4** `ensureBottom` 去定时器布局抖动  
8. **C1** BGM Range `bytes=0-` 也写持久缓存  

---

## 1. 性能审查

审查基线：`app.js` 12432 行 / 748KB raw / gzip 约 270KB；`poker-ui.js` 3140 行 / 232KB；`index.html` 内联 CSS 约 179KB。`ARCH_AUDIT_v133` 已 dismiss 的项（setTimeout 配对非泄漏、空 catch 批量改无收益）不重复列出。

### 1.1 启动 / 载荷

| ID | 级别 | 问题 | 证据 | 影响 | 方向 |
|----|------|------|------|------|------|
| P1 | P0 | 壳体积过大：HTML 248KB（内联 CSS ~179KB）+ 同源 JS ~1.0MB | `index.html:33` 起 `<style>` len≈179344；`src=./js/*` 合计 ~1,048,260 | 中低端机冷启动 parse 竞争，首帧可点变慢 | CSS 外置走 SW cache-first；`app.js` 按大厅/房内/牌桌 code-split |
| P2 | P1 | 约 20 个 defer 脚本无入口分层，大厅也拉牌桌模块 | `index.html:2758-2803` | 只逛大厅也解析 poker/games | `game-loader.js` 已有 lazy 雏形，按需 `import()` |
| P3 | P2 | 冷启动固定 1.4s 遮罩 + auth 1.5s/3s fallback | `index.html:2266`；`js/boot.js:120-130` | 「可点但空转」窗口 | 数据就绪即淡出 |

### 1.2 运行时 CPU

| ID | 级别 | 问题 | 证据 | 影响 | 方向 |
|----|------|------|------|------|------|
| P4 | P0 | `ensureBottom` 多帧强制布局抖动 | `js/app.js:2172-2191` 最多 36 次 × 读写 `scrollHeight`，100–120ms | 进房后 1–3.6s 反复 style→layout，中端安卓掉帧 | `ResizeObserver` 或单次 rAF 贴底 |
| P5 | P1 | 实时消息去重走 O(n) `querySelector` | `js/app.js:2657` | 200–300 节点时密聊刷屏 CPU 尖峰 | INSERT 路径复用已有 `domByMid` Map |
| P6 | P2 | `refreshSnapshotTail` 每轮全量扫 `[data-mid]` | `js/app.js:2310-2320` | 20s 一轮样式计算扫描 | 增量维护 Map |
| P7 | P2 | 打字机 + 快照序列化 + dedup 三重 DOM 税 | `typewriterInto` 6896；`persistRoomSnap` 1852-1871；`ensureStreamDedupObserver` 1917 | 灵魂连发时段叠加卡顿 | 打字机 rAF 分片；快照限频/限长 |
| P8 | P2 | 牌局 `renderAll` 整块 `innerHTML` 重建 | `js/poker-ui.js:3009` 及约 40 处 `innerHTML=` | 每 action 全桌重绘 | 按 seat/street keyed 局部更新 |
| P9 | P3 | `_ehLegendListen` 永久 1.5s 轮询 | `js/app.js:12274`，`FunInit` 12417 后常驻 | 空闲常驻闭包 + 电量噪音 | 挂到牌局生命周期 |

### 1.3 内存

| ID | 级别 | 问题 | 证据 | 影响 | 方向 |
|----|------|------|------|------|------|
| P10 | P1 | `roomSnap` + `eh_room_snap` 双份大 HTML | `app.js:1848/1870` | 长卡片快照数百 KB ×2 | 结构化存储或字节上限 |
| P11 | P2 | 消息 DOM 仅贴底修剪（`MAX_STREAM=300`） | `app.js:6113`，`trimStreamHead` 仅 `nearBot` | 长期上翻时 DOM 线性涨 | 硬上限 / 虚拟列表 |
| P12 | P3 | `_gtTables` / `_gtPlayerLastBeat` / `_soulQ` 等无上限 | 分散定义 | 长局缓慢涨 | LRU/TTL |

### 1.4 网络

| ID | 级别 | 问题 | 证据 | 影响 | 方向 |
|----|------|------|------|------|------|
| P13 | P0 | 公开房兜底补拉每 20s 最多 500 行全量 RPC | `app.js:2813` + `2289` `eh_public_recent` lim=500 | 挂着聊天 = 流量+CPU 双杀 | `id > domMaxMid` 增量 + 空闲退避 |
| P14 | P1 | 房内定时器堆叠无自适应 | presence 15s / tail 20s / reap 120s / poker ping 8s / db keep 90s / DM 15s | 耗电 + Supabase 配额 | 统一调度：hidden 拉长，游戏态才开游戏定时器 |
| P15 | P2 | 进房副作用多路 RPC 挤占历史渲染 | `enterRoom` 2084+：fishBottle @2.6s/@4.2s、echoes、identity、song prefetch、`await reap()` | 首秒带宽竞争 | `requestIdleCallback` 队列 |
| P16 | P2 | `fetchEchoes` 无本地缓存 | `app.js:9128-9132` | 分批渲染多次往返 | 按 mid 缓存 |
| P17 | P3 | SW install 全量预取壳内 asset | `sw.js:108-125` | 换版时可能重下 MB 级 | shell 只预取关键路径（JS_CACHE/LIB_CACHE 设计本身正确，勿回退） |

### 1.5 移动端 / 布局

| ID | 级别 | 问题 | 证据 | 影响 | 方向 |
|----|------|------|------|------|------|
| P18 | P1 | 键盘收起探测 300ms 轮询常驻 | `keyboard.js:173-208` | 输入法弹收 resize 风暴 | `virtualKeyboard` 优先，轮询仅兜底 |
| P19 | P2 | `.msg` 滤镜/阴影/动画密度高 | `index.html`：backdrop-filter×25、blur×44、box-shadow×149、animation×137 | 低端 GPU 滚动掉帧 | 离屏关 filter/shadow |
| P20 | P2 | `content-visibility` 估算高导致锚点漂移 | `index.html:450/865`；补偿逻辑 `2588-2600` | 翻页多帧校正 | 统一 anchor 恢复工具 |
| P21 | P3 | 进房瞬间 audio unlock + 转场特效 | `app.js:2088-2091`；`sfx-engine.js:387` fade interval | 首帧抢主线程 | idle 预热 |
| P22 | P3 | `kbdebug` 250ms 轮询写在生产 HTML | `index.html:2842` | 误开才痛 | 拆 debug 模块 |

---

## 2. SW / 缓存 / 更新 / 离线体验

对照 `sw.js`、版本自愈、`sw-register.js` / `pull-refresh.js` / `pwa-install.js`，以及 `journey-refresh-resilience` / `journey-audio-cache-limit` 等门禁。

### 2.1 SW 缓存

| ID | 级别 | 问题 | 证据 | 症状 | 方向 |
|----|------|------|------|------|------|
| C1 | 高 | BGM 持久缓存可能长期填不上 | `sw.js:339-363`：Range network-first 且**不写缓存**；`sfx-engine.js:362-400` `new Audio().src` | Chrome/Safari 媒体常发 `Range: bytes=0-`，离线 BGM 易 504 空声 | 对 `bytes=0-` 或完整响应也写缓存，或 `fetch` 整曲 + `createObjectURL` |
| C2 | 中 | AUDIO_CACHE 淘汰是 FIFO 非 LRU | `sw.js:17-19` `keys.shift()` | 常听老曲被挤掉 | 命中时重写 key |
| C3 | 中 | versioned JS 离线兜底可能混版本 | `sw.js:56` `ignoreSearch:true` | 断网拿到旧指纹脚本 | 离线精确指纹匹配 |
| C4 | 低 | 导航注释 3s、实现 1.5s | `sw.js:222-239` | 与预期不符 | 统一参数 |

### 2.2 版本更新（发版正确性 — 最高优先）

| ID | 级别 | 问题 | 证据 | 症状 | 方向 |
|----|------|------|------|------|------|
| C5 | **高** | `__EH_APP_VER` 运行时交叉核对**并未实现** | `js/app.js:3-8` 注释与 `ci-check.sh:3b` 声称可验字节漂移；`index.html:2302-2315` 的 `check()` 只比 `BUILD_VER`↔`ver.txt` | CDN 把旧 `app.js` 写进新 `?v=` 时，自愈永远认为已最新 | load 后比对 `__EH_APP_VER!==__EH_BUILD_VER` → 硬恢复 |
| C6 | **高** | `bump-version.sh` 模式串已过期 | 脚本写死 `eh-sw-v550-`，当前 `sw.js:9` 为 `eh-sw-v642-…`；`sed` 未命中不报错 | **一键升版可能只改 ver.txt/index，SW 不换代** | 正则匹配 `eh-sw-v[0-9]+-` 或失败即 exit |
| C7 | 中 | `hardRecover` 过激且无提示 | `index.html:2285-2300` 注销 SW + `caches.keys()` **全删**（含 audio/lib） | 部署非原子时误判锁死，清掉数 MB 音频缓存、闪两次页 | 只清 shell/js，保留 AUDIO/LIB |
| C8 | 中 | 静默 `location.replace` 可打断用户 | `index.html:2318-2322`、`2334` | 打字/出牌中突然重载 | 提示「发现新版」或空闲再刷 |
| C9 | 低 | `__ehJustReloaded` 死标记 | `index.html:2319` 写入；`sw-register.js:28-31` 不读 | 维护者误判仍有协同 | 删或恢复契约 |
| C10 | 中 | 弱网更新窗口被 800ms 超时吞掉 | `index.html:2305-2309`；`pull-refresh.js:118-128` | Slow3G 整场停在旧代码 | 后台低频补检 + 「可更新」入口 |

### 2.3 离线 / 在线

| ID | 级别 | 问题 | 证据 | 症状 | 方向 |
|----|------|------|------|------|------|
| C11 | 中 | 无离线/弱网用户态 | 全站无 `navigator.onLine` / offline banner | 断网时用户不知是网络 | 顶部细条 + 发送失败可重试 |
| C12 | 低 | 离线壳与动态能力落差大 | `sw.js:78-127` 只预缓存壳；Supabase network-only | 可开壳但聊天全不可用 | 离线欢迎态说明边界 |
| C13 | 中 | `online` 时多条恢复链并行 | `index.html:2334` + `app.js:8892-8916` + `sw-register.js:8-10` | 恢复瞬间「刷数据+换 SW+整页替换」叠拍 | 单一恢复协调器 |

### 2.4 交互 / 音频体验

| ID | 级别 | 问题 | 证据 | 症状 | 方向 |
|----|------|------|------|------|------|
| C14 | 中 | 关键路径失败大量静默 | `app.js` 空 catch 约 500 处 | 真错只进 console | 关键路径 toast/重试（配合已有 `_ehTrack`） |
| C15 | 低 | 下拉刷新指示器依赖软刷 promise 收口 | `pull-refresh.js:90-116` + `app.js:11636-11660` | 某支挂起则「刷新中…」不落 | 软刷整体 8s 兜底 |
| C16 | 低 | manifest 安装信息弱 | `manifest.json` id 含 `?v=pwa2` | 商店式安装信息不足 | 补 screenshots/shortcuts |
| C17 | 中 | `duck()` 名存实亡，混音靠「叠」 | `sfx-engine.js:451-457` | 报牌/神曲与 BGM 抢音量 | 可选 duck 或人声增益 |
| C18 | 低 | 桌面打字氛围层 DOM churn | `ambient-fx.js:88-96` | 长打字持续建销 | 对象池 |

**SW/更新结论**：比 2026-08「缓存自锁」明显加固（network-first 导航、`?v=` 指纹 JS_CACHE、静默 controllerchange、journey 门禁）。用户「永久卡旧版」概率下降。  
**但三处硬伤仍在**：运行时字节漂移检测未落地（C5）、发版脚本可能漏改 SW（C6）、音频持久缓存对 Range 媒体几乎无效（C1）。叠加静默整页替换、hardRecover 全清缓存、无离线提示，弱网/发版窗口仍会「闪、丢缓存、不知道发生什么」。  
**C1/C5/C6 建议列为发版前必修；C7/C8/C11 为体验门槛。**

---

## 3. 缺陷审查

审查范围：`js/app.js` / `js/poker-ui.js` / `js/keyboard.js` / `js/pull-refresh.js` / `js/sw-register.js` / games。已对照 `docs/triage/`、`ARCH_AUDIT_v133.md` 排除已知已修项。**CI 全绿不覆盖下述竞态。**

### 3.1 冷启动 / 认证

| ID | 级别 | 问题 | 证据 | 复现假设 | 修向 |
|----|------|------|------|----------|------|
| B1 | P2 | 公开房入会失败仍 `return true`，静默进房 | `app.js:2419-2426` upsert 超时仅 warn | 弱网点公开房 → members 无行 → RLS/踢人不一致 | 失败降级或重试，勿无条件 true |
| B2 | P3 | `beat()` 在 `ensureAuth` await 后直读 `curRoom.id` | `app.js:4803-4807` | 进房瞬间未就绪已离房 → TypeError 丢心跳 | await 后重校 `curRoom` |

### 3.2 进房 / 离房 / 换房

| ID | 级别 | 问题 | 证据 | 复现假设 | 修向 |
|----|------|------|------|----------|------|
| B3 | **P1** | `loadHistoryCore` **先写全局 `oldestId` 再校 rid** | `app.js:2475/2483/2507-2508` | A 房历史未完切 B → 游标被 A 覆盖 → 「加载更早」跳段/重复 | rid 校验提前，或局部变量再提交 |
| B4 | **P1** | await 后 `delete prefetchCache[curRoom.id]` 未防 null | `app.js:2469/2488`；`leaveRoom` 10338 置 null | 预取中快速离房 → TypeError → 消息区空白卡「连接中」 | 用 `_enterRid` 做 key，写前判 `curRoom` |
| B5 | P2 | `leaveRoom` 清 presence 空 catch → 幽灵在线 35s | `app.js:5062` | 离房网络抖动 → 光墙仍显示你 | `_ehTrack` 或确认 pagehide keepalive 覆盖 |

### 3.3 聊天发送 / 历史 / 重连

| ID | 级别 | 问题 | 证据 | 复现假设 | 修向 |
|----|------|------|------|----------|------|
| B6 | **P1** | `send()` 防重复是**死代码**，双击会双发 | `app.js:7165-7167` localId 每次新建后立刻 `has(localId)` **永不命中** | 弱网连点发送 → 两条相同消息 | 按 payload 指纹或发送中按钮锁 |
| B7 | **P1** | `retryFailedSend` 与 realtime 无去重，可再造一条 | `app.js:5080-5092` 直接 insert，无 in-flight/幂等键 | 超时标失败实已成功 → 重试 → 库/屏双份 | 幂等键 + 成功后 `dedupStreamByMid` |
| B8 | P2 | 调试日志读错输入框 id（`#input` vs `#cin`） | `app.js:7126` vs `7127` | 排障日志永远 len=0 | 改 `#cin` |

**B6/B7 是用户最痛点**：聊天最基本动作。现有 `journey-submit-singleflight.js` 未测到真实 `send()` 入口（假锁在 Set 里永远查不到自己）。

### 3.4 多人牌局

| ID | 级别 | 问题 | 证据 | 复现假设 | 修向 |
|----|------|------|------|----------|------|
| B9 | **P1** | `_gtGrabSeat` **先拆桌再 join**，失败无回滚 | `app.js:4477-4484` | 两人抢同一位 → 后者 join 失败 → 自己进行中牌局已被 close | 先 join 成功再 close 旧引擎 |
| B10 | P2 | `gtHostMarkAway` 读改写 seats 无并发保护 | `app.js:1571-1585` 整表覆盖 | 标 away 与入/离座并发 → 后写覆盖 | 原子 RPC / 乐观锁 |
| B11 | P2 | host 接管分支是**空操作**（RPC 已注释） | `app.js:1557-1562`；holder 仅 seats 变化时重算 `3771-3801` | host 进程死且 seats 未标 away → `host_offline` 后无人接管 → 整桌卡死 | 超时后最小座位真人标原 host away |
| B12 | P2 | 超时标 away 用可能过期的 `row` 闭包快照 | `app.js:4198-4201` | 换桌后 timer 仍跑 → 误标/误踢 | 每 tick `gtEnsureRow` |
| B13 | P3 | `gtWritePokerHands` 失败静默 | `app.js:3864-3871` | host 写底牌瞬时失败 → guest 永远无牌 | 失败重试 + 超时提示 |
| B14 | P2 | `setupGameTables` 初始快照空 catch | `app.js:2904-2905` | 进房查询失败 → 别人开的桌看不见 | toast/`_ehTrack` + 手动刷新 |
| B15 | P3 | `pkPrefetchChips` 只填空槽不刷新 | `app.js:3918-3922` | 同会话多桌筹码已变读旧缓存 | 结算后 invalidate |

**架构注**：`eh_gt_set_host` 在 SQL 中不存在（`sql/eh_game_tables.sql` 无此函数；注释写明 host 离座不转移、引擎持有者由 `gtEngineHolder` 从 seats 推导）。但 `app.js:1188` pagehide 仍 keepalive 调用该 RPC——死请求，应在清理时一并删掉（与 B11 接管闭环一起收）。

### 3.5 键盘 / 移动布局

| ID | 级别 | 问题 | 证据 | 复现假设 | 修向 |
|----|------|------|------|----------|------|
| B16 | P2 | 估算键盘高与 VK 几何仍可能双扣 | `js/keyboard.js:50-56` 两个独立 `min` | 半哑 WebView 弹键盘 → `#hall` 偏矮 | 有正 VK 时强制 `estimatedKbH=0` |
| B17 | P3 | `goScene` 的 `__ehApplyVVH` 与 CSS `100dvh!important` 双源 | `app.js:1083`；`index.html:681-688` | 折叠屏展开首帧跳高 | 单一高度源 |

### 3.6 PWA / 版本自愈

| ID | 级别 | 问题 | 证据 | 复现假设 | 修向 |
|----|------|------|------|----------|------|
| B18 | P2 | 下拉 ver 检查 800ms 超时 → 软刷旧壳 | `pull-refresh.js:129-142`；`sw-register.js:28-33` 不 reload | 发版后弱网下拉 → 新代码到不了 | 软刷前比 `__EH_APP_VER`；落后给提示条 |
| B19 | P3 | 「已到达版本」写入后失败不再重试 | `index.html:2316-2318` reload 前就写 last | reload 被拦 → 永卡旧版 | pageshow 成功后再记 last |

### 3.7 音频

| ID | 级别 | 问题 | 证据 | 复现假设 | 修向 |
|----|------|------|------|----------|------|
| B20 | P3 | `startMasterPreview` 与 `stopSong` 抢 AudioBus + duck | `app.js:8205-8215` / `8128-8131` | 预览中点语音 → BGM 被永久 duck | 统一状态机，release 幂等按 token |

### 3.8 关键路径静默 catch / 失败语义

| ID | 级别 | 问题 | 证据 | 影响 | 修向 |
|----|------|------|------|------|------|
| B21 | P2 | `joinAsMember` 超时与「非成员」文案混用 | `app.js:2397-2415` | 网络问题误报为要邀请码 | 超时阻断+自动重试 |
| B22 | P3 | `gtRpc` toast 后返回 null，调用方多忽略 | `app.js:3213-3216` | 本地座位与 DB 分叉 | 调用方检查返回值并回滚 |

### 缺陷 Top 5（用户可感知）

1. **B6/B7** 消息双发 / 重试双份 — 弱网必现  
2. **B9** 抢座失败拆掉进行中牌局 — 多人最痛  
3. **B3/B4** 换房历史错乱 / 白屏 — 必经路径，无旅程覆盖  
4. **B11** host 掉线整桌卡死 — 联机高价值场景  
5. **B18** 发版后下拉刷不到新代码 — 修复无法及时到达  

---

## 4. 与既有结论的边界

- **不重复** ARCH_AUDIT_v133 已 dismiss：空 catch 批量改、openGear/subscribeMessages 强拆、setTimeout 配对泄漏。
- **不回退** sw.js 的 `JS_CACHE` / `LIB_CACHE` / `AUDIO_CACHE` 指纹持久缓存设计（这是好设计，问题在实现细节）。
- **CI 全绿 ≠ 体验全绿**：版本一致性、危险 API 密度、旅程门都有覆盖；性能预算、发版工具链、离线 UX 是盲区。
- **修复纪律**：本报告只给方向。任何 P0/高优先修复必须按 AGENTS.md 走「诊断单 → 稳定复现 → 单变量 → 旅程测试（含旧实现反证）→ `bash scripts/ci-check.sh` 全绿」。

---

## 5. 建议修复路线图

> 每项修复仍须按 AGENTS.md：诊断单 → 稳定复现 → 单变量 → 旅程测试（含旧实现反证）→ `bash scripts/ci-check.sh` 全绿。禁止一个 commit 混多领域。

### A. 发版安全（改动小、防事故，先做）
1. **C6** 修 `bump-version.sh`：`eh-sw-v[0-9]+-` 正则 + 未命中 exit 1。  
2. **C5** 实现运行时 `__EH_APP_VER` ↔ `__EH_BUILD_VER` 不一致硬恢复。  
3. **C7** `hardRecover` 保留 `eh-audio-*` / `eh-lib-*`。  
4. **B19** 版本「已到达」记到 pageshow 成功后。

### B. 聊天与换房主路径（用户最痛）
5. **B6** `send()` 真防重（payload 指纹或发送锁）；补 journey 覆盖真实入口。  
6. **B7** `retryFailedSend` 幂等键 + 成功后 `dedupStreamByMid`。  
7. **B3/B4** `loadHistoryCore` 写 `oldestId`/`prefetchCache` 前校 rid；全文件搜同类模式。  
8. **P13/P5/P6** 公开房 tail 改增量 + `domByMid` 复用（顺带消 CPU）。

### C. 联机牌局闭环
9. **B9** 抢座：先 `gtJoin` 成功再 close 旧引擎。  
10. **B11** host 超时 → 最小座位真人标原 host away，触发 `gtEngineHolder` 重算；顺带删 `eh_gt_set_host` 死调用（`app.js:1188`）。  
11. **B10/B14/B22** seats 原子更新 + 初始快照失败可见 + `gtRpc` 失败回滚。

### D. 性能与耗电（中期）
12. **P4** `ensureBottom` → ResizeObserver/单次 rAF。  
13. **P14/P9** 定时器按可见性/房内/游戏态开关。  
14. **P1/P2** CSS 外置 + 牌桌模块懒加载。  
15. **C1/C2** BGM Range 缓存 + AUDIO_CACHE LRU。  
16. **C8/C11** 更新提示条 + 离线状态条。  
17. **B16** VK 与估算键盘高互斥。

### 建议新增自动化覆盖
- **B6/B7**：弱网双击发送 / 失败重试幂等旅程（旧实现必红）  
- **B3/B4**：快速 A→B 换房历史游标旅程  
- **B9**：抢座失败不拆进行中牌局旅程  
- **B11**：host 超时后 guest 能接管旅程  
- **C5/C6**：`__EH_APP_VER` 漂移 + `bump-version.sh` 模式串自检  
- **C1**：BGM `Range: bytes=0-` 应填充 AUDIO_CACHE  
- **P13**：公开房 idle 5 分钟请求/字节预算  

---

## 附录：本次核验过的硬证据（抽样）

```
bump-version.sh:15   SW_VER="eh-sw-v550-${NEW_VER}"     # 与 sw.js:9 eh-sw-v642- 不匹配
sw.js:341-346        if (rangeHeader) { try { return await fetch(req); } … }  # 不写 AUDIO_CACHE
index.html:2302-2315 if(latest===BUILD_VER) return;    # 从不读 __EH_APP_VER
js/app.js:2172-2191  s.scrollTop=s.scrollHeight + 100–120ms 轮询 ≤36 次
js/app.js:2813/2289  setInterval(refreshSnapshotTail, 20000) + lim:500
js/app.js:2657       document.querySelector(`[data-mid="${m.id}"]`)
js/app.js:7165-7167  localId 新建后 _sendInFlight.has(localId)  # 假锁
js/app.js:2475/2507  oldestId = rows[0].id  先于 rid 校验
js/app.js:4477-4484  _ehGame.close() 在 gtJoin 之前
js/app.js:1557-1562  eh_gt_set_host 已注释；1188 仍 keepalive 调用同名不存在 RPC
```
