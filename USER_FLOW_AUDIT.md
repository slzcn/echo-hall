# 回声厅 EH — 用户流程与运行机制审计（2026-07-13 14:xx）

> 本次审计目标：系统梳理整个用户使用流程与运行机制，主动找出并修复「刷新态错乱 / 状态不一致 / 身份判断错」类问题，不留给用户发现。
> **前提约束**：「刷新自动回到上次房间」是**有意设计**（keep-alive 体验），本次不改动该设计，只修复破坏它一致性的边界竞态。

---

## 一、三场景状态机

EH 是单文件 SPA，三个场景由 `goScene(id)` 统一切换（唯一收口，幂等）：

| 场景 | 用途 |
|------|------|
| `#enter` | 入场页（临时身份 / 匿名进入 / 账号登录注册） |
| `#lobby` | 房间列表 |
| `#hall`  | 房间内聊天 |

`goScene` 只切 DOM class + 清残留遮罩，**不写任何 localStorage**。状态持久化完全靠下面的 key。

## 二、持久化状态（localStorage）

| Key | 含义 | 写入时机 | 清除时机 |
|-----|------|----------|----------|
| `eh_identity_v2` | 身份（id/name/emoji/color/registered/username/email） | 登录/注册/生成临时身份 | 仅登出时 |
| `eh_last_room` | 上次所在房间（刷新恢复依据） | enterRoom 进房时 | **本次强化：所有主动离房动作同步清除** |
| `eh_theme` / `eh_mode` | 主题 / 输入模式 | 用户切换 | / |
| `eh_ver_last` | 版本自愈已到达版本 | 自愈重载前 | / |
| `eh_me_cache_v1` | 个人空间缓存 | 打开个人空间 | 登出 |
| `eh_echo_mru` | 反应表情最近使用 | 贴表情 | / |

## 三、刷新恢复决策链（有意设计，未改）

刷新时判据三处**统一**（一致）：
1. 首帧防闪 IIFE（1309）：`eh_identity_v2.id + eh_last_room.id` → 同步预绘 hall 骨架（不闪首页）
2. `preRestoreScene()`（2256）：同判据 + `me.id` → 预绘（主脚本兜底，goScene 幂等无副作用）
3. `resumeAfterAuth()`（2247）：session 就绪后 `if(lastRoom) enterRoom` 否则进 lobby

session 真失效时靠 5292 的 4 秒兜底回落 enter（已知可接受设计）。

## 四、本次发现并修复的 bug（5 处竞态/残留）

**根因统一**：`eh_last_room` 的清除原本只在 `leaveRoom()` 最后一行，而 leaveRoom 藏在多个 await 网络 RPC 之后（leavePresence / removeChannel / eh_leave_room）。多个「用户主动离开房间场景」的动作，清除时机滞后于用户可能的刷新时机 → 刷新态错乱。

**统一修复**：新增同步函数 `clearLastRoom()`（2248），在所有「用户主动导航到非房间场景」的动作里**第一时间同步调用**（先于任何 await）：

| # | 位置 | 场景 | 修复前风险 |
|---|------|------|-----------|
| 1 | `backToLobby`（4720） | 点返回键回大厅 | 点返回后立即刷新 → leaveRoom 未完成 → 又回旧房间 |
| 2 | `logoutIdentity`（4697） | 登出/换身份 | 不在房间里登出（curRoom=null）→ leaveRoom 被跳过 → last_room 残留 → 换账号进错房 |
| 3 | `enterBtn`（5019） | 匿名进入 | 同浏览器前一用户残留 last_room → 刷新进到别人房间 |
| 4 | `doLogin`（4888） | 账号登录成功 | 登录不同账号后刷新进旧账号的房间 |
| 5 | `doRegister`（4921） | 注册成功 | 新账号携带"历史房间"残留 → 进错房 |

## 五、CDP 端到端实测（真实 Supabase 匿名登录 + 官方房「闲聊广场」）

| 测试 | 期望 | 结果 |
|------|------|------|
| 刷新回房间（有意设计仍工作） | 进房→刷新→回 hall | ✅ hall |
| 返回大厅后刷新 | 返回→last_room 同步清 null→刷新停 lobby | ✅ lobby，last_room=null |
| 换账号残留清除 | clearLastRoom 可清残留 | ✅ 已清 |

## 六、纵深防御待办（触发链窄，本次未改，记录备查）

- `joinAsMember`（2368）对私密房也直接 insert eh_members，若「换新 uid + last_room 残留私密房」组合会把新身份自动塞进私密房成员。本次 5 处 clearLastRoom 已堵住"残留"上游来源，此为二次纵深防御，风险已大幅降低。若后续要根治：resumeAfterAuth 进私密房前先校验成员资格，非成员则回落 lobby。

## 七、身份系统（上一轮已修，本次复核无新问题）

paintIdentity 用多重判据 `me.registered || me.username || me.email` 识别正式账号 + 自愈回写；auth 事件同步 saveIdentity+paintIdentity 消除"已登录显示临时"中间态。本次复核未发现新的身份判断错。
