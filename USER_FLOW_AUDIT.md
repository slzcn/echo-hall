# EH 用户使用流程与运行机制审计（2026-07-13）

## 一、场景（Scene）总览

EH 是三场景 SPA：

| 场景 id | 用途 | DOM 位置 |
|---------|------|---------|
| `#enter` | 登录/注册入场页（临时身份/匿名进入/账号登录） | 1066 |
| `#lobby` | 房间列表页（官方房 + 公开房 + 我的私密房 + 创建/加入按钮） | 1096 |
| `#hall` | 房间内聊天页 | 1118 |

**场景切换唯一入口**：`goScene(id)`（1986）
所有场景转换都走这个函数，没有绕过点。

## 二、持久化状态（localStorage）

| Key | 含义 | 何时写入 | 何时清除 |
|-----|------|----------|----------|
| `eh_identity_v2` | 用户身份（id/name/emoji/color） | 登录/注册/生成临时身份 | 从不主动清除（换新身份=生成新的覆盖） |
| `eh_last_room` | 上次进入的房间信息 | 进房时（enterRoom）| leaveRoom / 登出 |
| **`eh_in_room`** | **⭐ 是否处于房间态（同步标记）** | **goScene('hall') 自动置'1'** | **goScene('enter'\|'lobby') 自动清除** |
| `eh_theme` | 当前全局主题 | applyTheme | / |
| `eh_mode` | 输入模式（文字/语音/神曲/虚空） | setMode | / |
| `eh_ver_last` | 上次到达的版本号（版本自愈防循环） | 版本自愈 | / |

## 三、刷新恢复决策链

1. **HTML 解析期 首帧防闪 IIFE**（1307-1330）
   - 判据：`eh_identity_v2.id` + `eh_last_room.id` + `eh_in_room==='1'`
   - 三者齐全 → 立刻画 hall 骨架（避免闪 enter/lobby 再跳）
   - 否则 → 保持默认 #enter，等 auth 恢复

2. **主脚本加载完后 `preRestoreScene()`**（2251）
   - 判据同上（增加 `me.id` 非空）
   - 用于「已预绘」的情形，补齐主题/图标等运行时装饰

3. **`resumeAfterAuth()`**（2245）⭐ 最终裁决者
   - Supabase session 恢复后调用
   - 判据：`lastRoom() && eh_in_room==='1'`
   - true → `enterRoom(room)`（走完整进房流程，含连接订阅）
   - false → `goScene('lobby'); renderLobby()`

## 四、修复前后对比

### 原 Bug（今日修复）
用户 A 进过房间 → 未走「返回按钮」而是关掉页面 / 或走返回但异步 leaveRoom 未完成 →
`eh_last_room` 残留 → 下次刷新 preRestoreScene 只看 last_room 就把用户拉回老房间。

### 根因
`eh_last_room` 承担了「上次房间信息」与「当前是否在房」双重语义，清除依赖异步 leaveRoom（多个 await + fire-and-forget），存在竞态。

### 修复方案
引入 **`eh_in_room`** 独立同步标记：
- **由 `goScene` 统一收口**：切 hall 自动置'1'，切 enter/lobby 自动清除
- **同步、即时**：不依赖任何 await/RPC，切场景瞬间生效
- **判据一致**：首帧 IIFE / preRestoreScene / resumeAfterAuth 三处都以 `eh_in_room==='1'` 为准

### 覆盖的所有路径
| 用户动作 | in_room 状态变化 | 刷新表现 |
|----------|------------------|----------|
| 全新进入（enterBtn）| 明确清除（防遗留）| 停 lobby ✅ |
| 账号登录成功 | goScene('lobby') 自动清 | 停 lobby ✅ |
| 注册成功 | goScene('lobby') 自动清 | 停 lobby ✅ |
| 点击房间进入（enterRoom）| goScene('hall') 自动置'1' | 恢复房间 ✅ |
| 点返回按钮（backToLobby）| goScene('lobby') 自动清 | 停 lobby ✅ |
| 浏览器返回键（popstate → backToLobby）| 同上 ✅ |
| 房主/主动 leaveRoom | leaveRoom 兜底清 + goScene 兜底 | 停 lobby ✅ |
| 登出（换新身份）| goScene('enter') 自动清 + 手动清 last_room | 停 enter ✅ |
| Auth 超时兜底（5288）| goScene('enter') 自动清 | 停 enter ✅ |

## 五、CDP 端到端实测（真实 Supabase 匿名登录 + 官方房「闲聊广场」）

| 场景 | 期望 | 实测 |
|------|------|------|
| 进房后立即状态 | 场景=hall, in_room=1, last_room=有 | ✅ 全对 |
| 在房刷新恢复 | preRestoreScene=true, resumeAfterAuth 进房=true | ✅ 恢复房间 |
| 返回列表（同步清标记） | 场景=lobby, in_room=null 即时清 | ✅ 不等异步 |
| **返回后立即刷新** | preRestoreScene=false, 进房=false | ✅ **停 lobby（原 bug 已修）** |

## 六、附带改进

1. 登录页副标题打字机结束后光标残留（绿方块）已修复（子布问题）
2. 登出时同步清除 `eh_last_room`，避免多用户同浏览器时残留信息
