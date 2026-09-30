# 回声厅 Echo Hall — 架构设计与代码逻辑排查

> 目标: 按「分层生成」第一轮产出——模块划分、函数清单、数据流、现有逻辑漏洞。
> **本轮不写代码**, 供确认后再逐模块动刀。
> 盘点基准: `20260930-v39`, 前端约 29k 行 / SQL 约 1k 行 / Edge 约 3.2k 行。

---

## 一、系统总览

```
┌────────────────────────────────────────────────────────┐
│  浏览器 SPA (index.html + js/)                          │
│  场景: #enter 入场 → #lobby 大厅 → #hall 房间            │
│  PWA: sw.js 缓存 + 版本自愈 (四元组)                     │
└───────────────┬────────────────────────────────────────┘
                │ supabase-js (SB_URL + SB_ANON)
┌───────────────▼────────────────────────────────────────┐
│  Supabase                                               │
│  · Auth (匿名 + 正式账号)                                │
│  · Postgres (RLS + SECURITY DEFINER RPC)                │
│  · Realtime (postgres_changes + broadcast)              │
│  · Storage (语音/神曲音频)                               │
│  · Edge Functions: eh-auth / eh-sing-gen / eh-stt /     │
│                    eh-admin-api / eh-poker-ai           │
└─────────────────────────────────────────────────────────┘
```

三款游戏(德州/掼蛋/斗地主)共用一套「座位表 + host 权威引擎 + 脱敏快照」联机协议，
聊天室与牌桌耦合在**同一房间**(`eh_rooms`)内: 牌桌卡是 `eh_messages` 里的一条 `kind:'game'` 消息。

---

## 二、前端模块划分

### 2.1 壳层 / 引导

| 文件 | 行数 | 职责 |
|---|---|---|
| `index.html` | ~3k | 三场景 DOM、内联主题/自愈、`BUILD_VER`、script 加载序 |
| `js/boot.js` | — | 启动编排, 调 `resumeAfterAuth`/`preRestoreScene` |
| `js/config.js` + `config-runtime.js` | 320 | 文案/主题/策略教练开关(`applyStrategyCoachConfig`) |
| `sw.js` | — | 导航 network-first / Supabase network-only / 静态 cache-first |
| `js/sw-register.js` | — | SW 注册与更新 |
| `js/game-loader.js` | ~130 | 三游戏懒加载(每游戏 5-7 文件串行注入), READY_MARK 校验 |

**版本自愈四元组**(必须一致): `ver.txt` / `index.html BUILD_VER` / `js/app.js __EH_APP_VER` / `index.html` 的 `app.js?v=` / `sw.js SW_VERSION`。

### 2.2 核心单体 `js/app.js` (10 619 行, ~470 个顶层函数)

这是**架构上最大的问题**: 所有跨域职责挤在一个文件。逻辑分区如下(行号为当前 v39):

| 区段 | 大约行 | 职责 | 代表函数 |
|---|---|---|---|
| 错误监控 | 40–135 | `ehReportError` / `_ehCatch` | 与 `scripts/error-monitor.js` 同表 |
| 身份 | 190–380 | 匿名/正式账号 | `loadOrRollIdentity` `ensureAuth` `resolveSession` `authApi` |
| BGM/主题 | 382–1020 | 程序化 BGM、曲库、皮肤 | `startRoomBGM` `buildBgmMenu` `initThemeUI` |
| 全局状态 | 1023–1430 | 联机牌桌状态机、心跳、断线 | `_gtCleanupPlay` `_gtPokerSession` `gtWatchHostPing` `gtCheckNoHumansThenClose` |
| 大厅/快照 | 1434–1630 | 房间列表、DOM 快照、去重 | `persistRoomSnap` `dedupStreamByMid` |
| 进房生命周期 | 1725–2330 | 进/离房、历史、成员 | `enterRoom` `joinAsMember` `loadHistoryCore` `leaveRoom` |
| Realtime | 2334–2556 | 消息/在线/牌桌订阅 | `subscribeMessages` `setupPresence` `setupGameTables` |
| 牌桌联机核心 | 2556–3250 | 卡片渲染、RPC、座位、引擎持有 | `gtRpc` `gtJoin` `gtEnsureSeated` `gtEnter` `gtEngineHolder` `gtSeatArrays` |
| 筹码/门禁 | 3249–3394 | 账本、每日输光 5 次 | `bankOpenOpts` `ehDailyPlayGate` `ehRecordBust` |
| 三款 launch/enter | 3415–4090 | host 开局 / guest 进桌 | `_gtLaunchPokerV2` `gtLaunchGuandan` `gtEnterDdz` … |
| 在线/气泡 | 4093–4345 | 光墙、typing、心跳 | `refreshPresence` `leavePresence` |
| 消息渲染 | 4346–4760 | 气泡、游戏卡、分层身份 | `buildMsgEl` `buildGameEl` `userTier` |
| 世界/漂流瓶/塔罗 | 4770–5200 | 跨房横幅、瓶、每日塔罗 | `worldBroadcast` `throwBottleFromComposer` |
| 进场特效/滚动 | 5201–5450 | 横幅、贴底、锚点 | `entranceBanner` `ensureBottom` `restoreScrollAnchor` |
| 灵魂/提及/互动 | 5448–6200 | @菜单、连击、合体 | `loadRoomSouls` `sendInteraction` `combatOnHit` |
| 发送/语音 | 6218–6700 | 发消息、录音、STT | `send` `startRec` `sendVoice` `ehSttFromBlob` |
| 神曲引擎 | 6705–7680 | 文字→歌、歌词同步、母版 | `playSong` `buildLyricTimeline` `startMasterPreview` |
| 回声/共鸣/特效 | 8172–9220 | 多 emoji、粒子、分享卡 | `toggleEcho` `burst` `makeMomentCard` |
| 抽屉/账号/事件 | 9252–10619 | 设置、个人空间、登录注册、绑定 | `openGear` `openMe` `doLogin` `createRoom` `joinByCode` |

### 2.3 `js/modules/` — 工厂注入式模块(带 UMD 导出, 可单测)

| 模块 | 导出 | 依赖注入 |
|---|---|---|
| `auth.js` | `createAuthController(deps)` | getMe/onLogin… |
| `bgm.js` | `createBgmController(deps)` | |
| `lobby.js` | `createLobbyController` `createLastRoomStore` `createPrefetch` `createCopyInvite` | enterRoom/roomsQuery/getBox… |
| `messages.js` | `createMessagesController` (dedupProjInHistory) | |
| `room.js` | `createRoomController` | |
| `score.js` | `createScoreBank(deps)` (localStorage 账本 + 每日计数) | getUid |
| `gt-net.js` | `createGtNet(deps)` (act 校验/seq/握手) | getSeats/applyMove/resync… |

> 机制: `app.js` 用 getter 注入依赖, 模块用 `required()` 断言——**这是正确的分层**, 但只覆盖了 7 个点, 其余 99% 仍在 app.js。

### 2.4 `js/games/` — 三游戏同构五层

每款游戏固定 5 层, 共享 `deck.js` / `strategy-core.js` / `card-counter.js` / `table-*.js`:

| 层 | 德州 | 斗地主 | 掼蛋 | 纯函数性 |
|---|---|---|---|---|
| rules | (合在 engine) | `ddz-rules.js` | `guandan-rules.js` | ✅ 纯 |
| engine | `poker-engine.js` (458) | `ddz-engine.js` (299) | `guandan-engine.js` (391) | ✅ createGame/apply*/legalActions |
| eval | `poker-eval.js` (161) | — | — | ✅ |
| ai | `poker-ai.js` (400) | `ddz-ai.js` (668) | `guandan-ai.js` (628) | ✅ decide/hints |
| net | `poker-net.js` (172) | `ddz-net.js` (161) | `guandan-net.js` (163) | ✅ snapshot/pseudoState/assertNoLeak/acceptSeq |
| ui | `poker-ui.js` (2 911) | `game-ui.js` (2 444) | `guandan-ui.js` (2 831) | ❌ 巨型, 含引擎驱动 |

**UI.open(opts) 契约**(三款同构): `mode:'host'|'guest'|'local'` + `lobby/isHost/lobbySeats/lobbyCtx` + `names/avatars/isAI/ids/souls/mySeat/remoteSeats` + `onSync/onAction/onSeatIdle/onSeatResume/onGrabSeat/onExit` + `chat/onBeat`。
返回: `close/minimize/restore/applySnapshot|onSnapshot/applyMove/resync/updateRoster/setLobby/startDeal/enterSpectator/resumeSeat/isLobby…`。

**strategy-core.js**: 三层策略(本地合法引擎 > 公开信息估计 > 可选异步教练 `eh-game-strategy`), `advise()` 同步返回本地策略 + 异步请求教练; `score()` 供提示重排。

### 2.5 氛围/工具

`sfx-engine.js` `mood-engine.js` `ambient-fx.js` `keyboard.js` `dm.js` `identity-easter-egg.js` `room-relic-widget.js` `pull-refresh.js` `pwa-install.js` `debug-overlay.js`。

---

## 三、数据层

### 3.1 表

| 表 | 关键字段 | 说明 |
|---|---|---|
| `eh_rooms` | id,name,emoji,kind(official/public/private),invite_code,owner | 房间 |
| `eh_members` | room_id,user_id,role,name,emoji | 成员(私密房必须走 `eh_join_by_code`) |
| `eh_messages` | room_id,user_id,text,kind(msg/game/voice/song/proj/recalled…) | 聊天流; **牌桌卡=kind:'game'** |
| `eh_presence` | room_id,user_id,last_seen | 光墙 |
| `eh_game_tables` | room_id,game,host_uid,**seats jsonb**,seat_count,status,seed,msg_id | 一房一桌; 座位是 jsonb 数组 |
| `eh_gt_hands` | table_id,seat,uid,hand | 私牌(RLS: 只读本人) |
| `eh_game_results` | game,players,winner_seats,moves… | 战绩回看 |
| `eh_user_stats` | uid,game,plays,wins,score | 累计 |
| `eh_errors` | kind,message,stack,context,uid,session_id,device,app_ver | 错误监控 |
| `eh_dm_threads/messages` | | 私信 |

> ⚠ `eh_rooms/eh_members/eh_messages/eh_users/eh_presence/eh_souls` 的建表语句**不在仓库 sql/**, 只有增量修复(`fix_private_join.sql`)。这是可追溯性缺口。

### 3.2 RPC (SECURITY DEFINER)

- **房间**: `eh_join_by_code` `eh_find_room_by_code`
- **牌桌**: `eh_gt_open` / `join` / `leave` / `start` / `close` / `reap` / `set_state` / `set_msg` / `seat_soul` / `seat_clone` / `kick` / `act` / `set_hands` / `update_hand` / `my_hand` / `is_host`
- **统计**: `eh_stat_bump`
- **DM**: `eh_dm_*`

### 3.3 Edge Functions

`eh-auth`(注册/登录/找回, 471 行) / `eh-sing-gen`(神曲, 459) / `eh-stt`(语音) / `eh-admin-api`(984) / `eh-poker-ai`(LLM 出牌, 225) / 另有 `eh-game-strategy` 教练端点(strategy-core 引用)。

---

## 四、关键数据流

### 4.1 聊天收发
```
send() → 本地回显(el.dataset.mid='local_*') → eh_messages.insert → 回填 mid
       ↘ postgres_changes (msgChan) → buildMsgEl → dedupStreamByMid → 按 mid 插位
刷新: persistRoomSnap (DOM 快照) / loadHistoryCore (分页) / refreshSnapshotTail (增量补)
```

### 4.2 牌桌联机(host 权威)
```
【座位】 eh_gt_* RPC → eh_game_tables.seats(jsonb) → postgres_changes(gtChan) → gtRenderCard/updateRoster
【出牌】 guest: UI.onAction → gtGuestSendAct
           ├ broadcast 'act'  (快通道, 供 host 即时预览)
           └ rpc eh_gt_act     (权威校验, host_uid/持有者裁决)
       host: Engine.apply* → onSync → Net.snapshot(脱敏) → broadcast 'snap'
                                  ↘ eh_gt_set_hands (远程真人私牌, RLS 隔离)
       guest: 'snap' → Net.pseudoState(snap, mySeat, myHole) → render
       私牌:  guest 'snap' 新手数 → rpc eh_gt_my_hand → feedHand
【脱敏】 snapshot 只拷白名单: 每席 hole=[]、无 _deck/seed/log; assertNoLeak 兜底
```

### 4.3 无房主引擎持有(德州)
`gtEngineHolder(row)` = 最小 seat 的非 away 真人。持有者跑引擎(host 路径), 其余走 guest。
`gtCheckEngineTransfer`: 持有者离场 → 下一真人接管(拆 guest 实例重挂 host)。
`gtCheckAutoStart`: 招募态 ≥2 占用 → 800ms 后 `gtStart`。
`gtCheckNoHumansThenClose`: 无在座真人 → 1.5s 后散桌。

### 4.4 筹码账本
`js/modules/score.js` → `localStorage['eh_bank_v1']` (按 uid×game) + 每日计数 `eh_daily_plays_v1`。
`bankOpenOpts('nlhe')` 带入 `myStack`; `bumpSeatBanks` 回写; 破产(< PK_MIN=1000)回补 GRANT=2000。
服务端 `eh_stat_bump` 记真实身份(灵魂也记, 匿名机器人不记)。

---

## 五、逻辑排查: 隐患与坏味道

### 5.1 结构级(优先级高)

1. **`app.js` 10 619 行单体**。~470 个顶层函数、~20 组模块级可变状态(`curRoom/_gtTables/_gtActiveTable/_gtPokerSession/roomSouls/echoState/…`)。
   任何改动都在同一命名空间里互相踩。**建议**: 按上表 17 个区段拆成 `js/core/*`, 每个保留 5–15 个导出, 依赖用已有工厂注入模式。

2. **三款游戏 UI 三重复制**。以下函数三份同构拷贝且已开始漂移:
   `strategyFor` `doEnterSpectator` `_clearAutoTrusteeOnNewDeal` `resumeSeat` `setBanner` `renderCtrl` `applySnapshot` `popHint` `renderMe/hand`。
   本轮我们改「让座/空位入座/单机守卫/提示出处」时必须**三处同步改**——这正是 bug 的温床。
   **建议**: 抽 `js/games/table-play-core.js`(托管/让座/超时/策略/提示出处), 三 UI 只留各自渲染。

3. **命名漂移**: `gtEnterPoker` → `_gtEnterPokerV2`, `gtLaunchPoker` → `_gtLaunchPokerV2`(v37 断线改造时改名未收口)。契约测试已不得不写 `(?:gtEnterPoker|_gtEnterPokerV2)`。
   **建议**: 二选一收口, 另一方仅作一行别名。

4. **`host_uid` 与 `gtEngineHolder` 语义分裂**。德州用「最小座号真人」当持有者, 斗地主/掼蛋仍用 `host_uid` 字段 + `eh_gt_is_host`。SQL `eh_gt_join` 又按 `host_uid` 放行顶替。
   **建议**: 明确一个权威概念(建议: 全部走 `gtEngineHolder` 语义, SQL 端同步), 否则「换账号/离席」场景会持续出怪问题。

### 5.2 数据层

5. **`seats` jsonb 的读-改-写竞态**。`eh_gt_join` 用 `for update` + 两次 update(先清旧座再坐新座), 但两次 update 之间 `select` 拿到的行不是原子视图; `eh_gt_leave` 用 `jsonb_agg` 整体重写。
   并发 join 同一空座时, 后写者可能覆盖前者(靠 `seat taken` 判定缓解但非原子)。
   **建议**: 合成单条 `UPDATE … SET seats = (SELECT … FROM jsonb_array_elements) WHERE … AND (seats->p_seat->>'kind')='empty'`, 让 `affected rows=0` 表示抢座失败。

6. **`eh_gt_open` 一房一桌 + 错游戏静默返回**。别人开着德州时你发 `/斗地主`, RPC 直接把德州桌还给你(客户端靠 toast 补救)。
   **建议**: RPC 返回前判断 `v_g`, 不匹配时返回 `null` 或错误码, 让客户端「开不了新桌」变成明确语义。

7. **建表 DDL 不在仓库**。`eh_rooms/eh_messages/eh_members/eh_users/eh_presence/eh_souls/eh_errors` 只有零散 policy。
   **建议**: 补 `sql/00-schema.sql` 全量导出(哪怕一次性), 之后 schema 变更走迁移文件。

8. **座号双轨**: `A.mySeat`(引擎下标) vs `A.myDbSeat`(DB 座号) vs `p.seat`(jsonb)。历史上多次错位 bug(见 `journey-gt-act-rpc`)。
   **建议**: 在 `gtSeatArrays` 一次性产出 `{engineIdx, dbSeat}` 映射对象, 全链路只传该对象。

### 5.3 状态机 / 时序

9. **guest 本地预推进 + 权威快照覆盖**(`applyAction` 先本地跑再等 snap)。两套状态可能抖一帧; `acceptSeq` 只防乱序, 不防「本地推进 + snap 回退」的视觉跳变。
   **建议**: 给本地预推进打 optimistic 标, snap 到达时 diff 决定是否重绘, 而不是整树覆盖。

10. **`_gtPokerSession` 只覆盖德州**(v37), 斗地主/掼蛋断线/away 无对等状态机。
    **建议**: 该状态机上移为通用 `_gtSession`, 三游戏共用。

11. **`roomEpoch` 防串房机制散落**。每个 async 路径都要手写 `if(setupEpoch!==roomEpoch) return`——漏一处就是串房数据污染。约 20 处。
    **建议**: 封装 `withEpoch(fn)` 或用 AbortController 贯穿。

12. **`localStorage` 14+ 个键手工管理**(`eh_last_room` `eh_last_game` `eh_identity_v2` `gtsc:<id>` `eh_bank_v1` `eh_daily_plays_v1` `eh_scroll_<rid>` `eh_pk_chips` `eh_bgm_*` …), 版本迁移靠 `bankMigrateFromLocalAnon` 之类点修补。
    **建议**: `js/core/store.js` 统一 key 空间 + schema 版本号。

### 5.4 健壮性 / 安全

13. **吞错空洞**: `catch(_){}` / `catch(e){ _ehCatch(...) }` 后继续, 业务失败无用户反馈的路径很多(如 `gtRpc` 失败只 toast)。错误监控只接了 `error`/`unhandledrejection` + 3 个手工埋点。
    **建议**: `gtRpc`/`send`/`ensureAuth` 三个边界强制 `ehReportError`; 其余保持静默。

14. **`innerHTML` 213 处**(app.js 96 + 三 UI 121)。XSS 防线全靠散落的 `escapeHtml`。
    **建议**: 统一 `el(html)` 工具或引入 DOM 模板; 至少给 `buildMsgEl` 系列做集中消毒。

15. **测试覆盖缺口**:
    - ✅ 好: `run-suite.sh` 分 8 域 / 87 项, 三游戏 rules/engine/fuzz 齐全, 联机协议有 `journey-poker-online` 双端仿真, 契约测试钉住关键语义。
    - ❌ 缺: SQL 端并发(join 抢座/一房一桌竞态)无测试; `app.js` 内 300+ 函数大部分只有源码契约断言(正则), **没有行为测试**; UI 三重复制没有「一致性」自动比对; 无双浏览器 E2E(前面聊过 `journey-multiplayer-two-browser`)。

### 5.5 值得保留的优点

- **net 层脱敏设计严谨**: 白名单字段 + `assertNoLeak` + 伪状态占位牌堆, 双端协议 journey 有断言。
- **rules/engine 纯函数化** + seed 可复现, fuzz 测试齐备。
- **模块工厂 + UMD**, 新代码可以单测, 不必全靠浏览器。
- **测试×监控闭环**约定(`TEST-INTEGRATION.md`)已成形。
- **版本自愈四元组** + `journey-gate.py` 旅程门禁, 发版纪律有工具保障。

---

## 六、建议的目标架构(供第二轮分模块实施)

```
js/
  core/            ← 从 app.js 拆出
    store.js          统一 localStorage 空间 + 迁移
    session.js        roomEpoch / withEpoch / 串房防护
    net-gt.js         牌桌 RPC + Realtime 通道 + 心跳/断线 (三游戏共用)
    seats.js          座号映射 (engineIdx↔dbSeat) + gtSeatArrays
    identity.js       me/myUid/auth
    errors.js         ehReportError + 边界埋点
  chat/            ← 消息渲染与发送
    build.js send.js history.js presence.js
  games/
    shared/
      table-play-core.js   托管/让座/超时/策略提示出处 (三游戏共用)
      table-net-core.js    snapshot/pseudoState 通用骨架
    poker/ ddz/ guandan/   各 5 层, UI 只留渲染
  audio/           ← BGM + 神曲 (约 2k 行, 最大独立域)
```

**拆分顺序建议**(每步都可独立上线):
1. `core/store.js` + `core/session.js` — 风险低、收益广
2. `games/shared/table-play-core.js` — 直接消灭三重复制
3. `core/net-gt.js` + `core/seats.js` — 联机逻辑收口
4. `chat/*` — 中等规模
5. `audio/*` — 体量最大但边界最清

---

## 七、请确认的问题

1. **`app.js` 拆分**: 是否接受按上述 5 步走? 还是先只做第 2 步(三游戏公共层)收 bug 口?
2. **`host_uid` 语义**: 是否统一成「最小座号真人=引擎持有者」? 这会改动 SQL。
3. **`eh_gt_open` 错游戏**: 要「禁止并报错」还是「允许同房并开第二桌」? (当前是一房一桌)
4. **schema 入库**: 是否补全量 DDL 到 `sql/00-schema.sql`?
5. **双浏览器 E2E**: 是否优先做 `journey-multiplayer-two-browser.js`(真两上下文进同一桌)?
