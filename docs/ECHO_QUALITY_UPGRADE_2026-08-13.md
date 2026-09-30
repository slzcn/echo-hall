# Echo 全面质量提升方案（2026-08-13）

> 目标：把 Echo 从“主人发现问题后反复补丁”升级为“系统主动发现、稳定复现、单变量修复、自动防回归”。

## 一、今天的实战结论

新能力体系有效，但也暴露出过去审计的盲区：旧 `CODE_REVIEW.md` 结论“真 bug 极少”已经不可信。今天用功能、输入法兼容、视觉一致性、性能架构四条线重审，主动发现多个发布阻断问题。

### 已完成并形成门禁

1. **主聊天中文输入法候选期 Enter 误发送**
   - 修前行为测试：7 项中 5 项失败。
   - 修复：`compositionstart/end + isComposing + keyCode 229`，且合成态不抢 `@`／`/` 菜单。
   - 修后：7／7 通过，已接入 CI。
   - 提交：`373fa8b`。

2. **三引擎九视口页面加载矩阵**
   - Chromium／WebKit／Firefox × 390×844／820×1180／1440×900。
   - 9／9 HTTP 200、无页面异常、无横向溢出、资源指纹正确。
   - 说明：这是页面加载与布局基线，不冒充真实系统 IME 几何测试。

3. **音频生成接口安全边界（本地完成，线上待部署）**
   - 11 条安全不变量通过：统一 JWT、房间成员、消息所有权、旧匿名入口关闭、大小上限、母版域名白名单、Storage 双头、前端令牌。
   - 公开仓库提交：`572a9bb`；私密 Edge 源码不入 Git。
   - `[阻塞]` 本机缺 Supabase management token，Edge 线上尚未部署；私密部署记录：`docs/private-deploy/2026-08-13-audio-edge-auth.md`。

## 二、发布阻断问题（P0）

### P0-1 房间生命周期竞态

**现象**：A 房 `leaveRoom()` 在 await 期间进入 B，A 的旧清理会读取全局 `curRoom/msgChan/presChan`，误删 B 的订阅、presence，甚至对 B 调离房 RPC 后把 `curRoom=null`。

**根因**：房间生命周期没有 epoch/scope，旧异步任务没有统一失效机制。

**修复方案**：
1. 建 deferred mock，稳定复现 A→B 各种释放顺序。
2. `enterRoom()` 每次创建 `roomEpoch`。
3. channel/timer/request 都归属 `RoomScope`；旧 scope 只能释放自己捕获的资源。
4. await 后统一 `scope.isCurrent()`，禁止再直接读写新一代全局状态。
5. 先止血 `leaveRoom`，再迁移 `subscribeMessages/setupPresence/refreshSnapshotTail`。

**退出标准**：A/B 交错、连续三次切房、网络拒绝共至少 12 个顺序测试全绿；最终只存在 B 的 channel/timer/role/UI。

### P0-2 键盘设备分类与双状态机

**已主动发现**：
- Android WebView/模拟器可能报告 `pointer:fine`，当前 JS 会完全跳过软键盘避让。
- 键盘打开时旋转，主聊天可能清基线后再扣 VK 高度；DM 可能沿用旧方向 `_baseH`。
- 主聊天与 DM 是两套几何状态机；DM 未复用 `__ehKbVisibleH`。
- iOS `visualViewport.offsetTop` 未进入几何契约。
- 宽度 >640 的触屏平板仍受桌面 `max-height:92dvh` 截断。

**修复方案**：建立统一 `KeyboardGeometryAdapter`，输入为 VV/VK/layout viewport/方向/前后台事件，输出唯一 `{top,height,keyboardState,source,epoch}`；hall 与 DM 只读快照，不各算一遍。

**退出标准**：设备仿真覆盖 resizes-content／resizes-visual／overlay／三信号全哑、pointer fine/coarse、方向切换、后台恢复；真实 iOS/Android/MIUI 矩阵发布前通过。

### P0-3 音频 Edge 安全线上部署

本地代码和门禁已完成，必须取得 Supabase management token 后部署，再执行匿名 401、旧接口 410、非成员 403、合法生成冒烟四项验证。未部署前不得宣称线上已封。

## 三、功能与数据完整性（P1）

1. **普通消息/私信无持久化幂等键**：服务端已成功但客户端超时后重试会重复落库。方案：client message UUID + 数据库唯一约束/upsert；按钮锁只作为 UI 优化，不作为幂等保障。
2. **`_snapTailBusy` 是全局锁**：A 房补拉占锁时 B 房补拉被丢弃。方案：按 roomId 的 single-flight + pending replay。
3. **PWA 三刷新入口竞争**：版本自愈、SW controllerchange、下拉刷新缺共享 reload gate。方案：唯一 `ReloadCoordinator`，全局最多导航一次。
4. **远程配置 schema 错型**：`themes/songStyles` 实际是数组，却标为 object，后台配置静默丢弃。方案：schema 从 `EH_CONFIG_DEFAULT` 自动推导并做数组下发回归。
5. **错误可观察性不足**：500 余个 catch，大量静默。方案：统一 `EhError + request_id + room_epoch + duration + source`；空 catch 预算只能下降不能上升。

## 四、视觉与一致性（P1）

### 先修可用性，不继续堆特效

1. 自定义交互 `div/span` 改原生 button，或补 role/tabindex/Enter/Space。
2. 全局统一 `focus-visible`，禁止无替代的 `outline:none`。
3. 操作热区至少 44×44px；图标视觉尺寸可保持 30-36px。
4. 日间模式 `--sub` 约 3.54:1、`--dim` 约 2.00:1，普通正文未达 WCAG 4.5:1，必须调深。
5. 聊天流用 `role=log/aria-live`，modal/drawer 加 aria-modal、focus trap、返回焦点。

### 设计系统收口

- 当前 `index.html` 有约 153 个非 token 字号、286 个非 token 间距、97 个非 token 圆角。
- 先定义 CSS token，不机械一次性替换；从高频组件迁移：正文 14/16、辅助 12/14、控件圆角 8、卡片 12、弹层 16、热区 44。
- 主题单一真相源：一份主题数据生成前台/后台首屏 CSS 和运行时配置；禁止三处手工同步。
- `jianghu.html` 明确定位：独立体验则统一产品壳/导航/无障碍；产品子页则接入主题与 token。

## 五、性能与架构（P1/P2）

### 当前量化热点

- `js/app.js`：约 7,400 行、486 KB、394 个函数、196 个顶层声明。
- `subscribeMessages`：174 行，复杂度代理约 106。
- `_buildMsgElRaw`：122 行，复杂度代理约 88。
- `app.js`：约 519 个 catch、71 个事件监听器、仅 1 个 removeEventListener。
- Realtime、20 秒补拉、15 秒 presence、快照、预取、前后台恢复同时作用于房间状态。

### 分阶段目标架构

```text
UI adapters
  scene / composer / messageView / presenceView / modal
Application services
  roomService / messageService / presenceService / songService / accountService
Domain stores
  sessionStore / roomStore / chatStore / mediaStore / uiStore
Infrastructure
  supabaseAdapter / realtimeHub / cacheStore / keyboardAdapter / reloadCoordinator
```

### 迁移顺序

1. 先建 `RoomScope/epoch` 和行为测试，不拆文件。
2. 提取 RealtimeHub，先迁移读路径，再迁移写路径。
3. 提取 message renderer，建立每种 kind 的 fixture/snapshot。
4. 提取 composer/input，主聊天和 DM 共用输入语义层。
5. 合并 keyboard geometry adapter。
6. 提取 song/audio service。
7. `deploy_*` 改为构建产物，不再保存多份可编辑源码；发布记录 canonical hash、产物 hash、线上 hash。

## 六、新测试金字塔

### 每次提交

- 语法/版本/资源指纹。
- 输入法语义（已接入）。
- Edge 安全不变量（本地私密源码存在时强制）。
- RoomScope deferred 竞态。
- 配置 schema 类型。
- 消息幂等。

### 每次功能合并

- Chromium/WebKit/Firefox 多视口。
- 10 测试视角：数据、时序、状态、交互、环境、并发、异常、权限、兼容、反直觉。
- 视觉 lint：token、对比度、44px、focus、ARIA。
- 性能预算：首屏、长任务、DOM 节点、请求次数、定时器/监听器净增长。

### 每次发布

- iOS Safari/PWA、Android Chrome/PWA、MIUI/WebView 真机输入法矩阵。
- 真实 Supabase 房间 A/B 竞态、断网重连、后台恢复。
- canonical/deploy/线上 hash 一致。
- Edge 匿名/越权/合法路径冒烟。

## 七、执行纪律升级

1. 一个诊断单一个根因，一个 commit 一个领域。
2. 修前必须红灯；无法稳定复现只能标探索，不进生产。
3. 自动测试必须读取/驱动生产代码，不复制一份实现自测自己。
4. 代码形态门禁不能替代行为门禁；数量阈值只作报警。
5. 本地、构建产物、线上三层都要验证；缓存版本必须纳入证据。
6. 不让主人做功能测试员；主人只参与真实偏好和无自动化设备的最终验收。

## 八、接下来三批原子工作

1. **房间生命周期 scope/epoch + 竞态测试**（最高优先）。
2. **统一键盘设备仿真 + hall/DM 几何适配器**。
3. **视觉 P0：焦点、热区、日间对比度、ARIA；同时落设计 lint**。

每批完成后独立提交、独立验证、独立发布，不再混成一次“大优化”。
