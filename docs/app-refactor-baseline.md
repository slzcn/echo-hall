# app.js 重构基线 (2026-08-18)

> 本文档记录 Echo Hall 主脚本 `js/app.js` 拆分前的客观状态。
> 每一阶段结束后重跑 `scripts/review/scan-app-boundaries.py` 与 `scripts/review/scan-empty-catches.py`，与本文对比，检验是否有回归或漏拆。

## 一、生成方法

```bash
# 边界扫描（顶层函数、变量、跨文件引用）
python3 scripts/review/scan-app-boundaries.py         # 人类可读摘要
python3 scripts/review/scan-app-boundaries.py --json  # 机器可读

# 空 catch 分类
python3 scripts/review/scan-empty-catches.py          # 人类可读摘要
python3 scripts/review/scan-empty-catches.py --json   # 机器可读
python3 scripts/review/scan-empty-catches.py --klass A  # 只看 A 类
```

## 二、关键指标基线

| 指标 | 基线值 | 目标（最终阶段） |
|------|--------|------------------|
| `js/app.js` 行数 | 8646 | ≤ 2500 |
| 顶层函数数 | 445 | 由拆分决定 |
| 顶层变量数 | 204 | 减半以上 |
| window 挂载数 | 13 | 通过命名空间收拢 |
| 跨文件被引用的符号 | 51 | 保持兼容，含在 `window.EH_*` 命名空间下 |
| 最长函数 | 262 行 (`openGear`) | ≤ 80 行 |
| 空 catch 总数 | 549 | - |
| 　A 类（关键路径吞错） | 81 | 0 |
| 　B 类（预期失败静默） | 83 | 保留并注释 |
| 　C 类（可删或改造） | 385 | 减少 50% |

## 三、拆分优先级（按方案顺序）

### 第 1 阶段：关键路径错误边界

**A 类空 catch 分布（81 处，全在 `js/app.js`）**

按函数分组的 A 类空 catch 数量（估算，据基线扫描）：

- `ensureAuth`：约 15 处
- `enterRoom`：约 20 处
- `refreshSnapshotTail`：约 10 处
- `loadHistory`、`subscribeMessages`：约 15 处
- 其余关键路径：约 21 处

**处理原则**：优先补 `EH_LOG.warn(scope, error, extra)`，只带模块 + 动作 + 房间 ID 短哈希，不带用户内容。

### 第 2 阶段：拆出大厅模块 → `js/modules/lobby.js`

迁移目标函数（均已在基线扫描中确认存在）：

- `roomsQuery` L1315
- `renderLobby` L1326
- `renderOfficial` L1361
- `renderPublic` L1389
- `renderMyRooms` L1465
- `lobbyShowRetry`
- `fillRoomStats` L1424
- `prefetchRoom` L1580
- `prefetchAll` L1595
- `prefetchSouls`
- `chSkel` / `rmSkel`

外部保留接口（挂到 `window.EH_LOBBY.*`，同时保留兼容全局别名）：

```js
window.renderLobby = EH_LOBBY.render;
window.renderMyRooms = EH_LOBBY.renderMyRooms;
window.prefetchRoom = EH_LOBBY.prefetchRoom;
```

### 第 3 阶段：拆出认证模块 → `js/modules/auth.js`

迁移目标：

- `authApi` L17
- `ensureAuth` L约 200
- `awaitSb`
- 匿名登录 / 正式登录 / 会话恢复 / 登出相关函数

跨文件引用（拆分后必须保留）：

- `ensureAuth` ← `js/boot.js`
- `authApi` ← 只在 app.js 内部

### 第 4 阶段：拆出 BGM 模块 → `js/modules/bgm.js`

迁移目标（较为独立，函数集中在 L470-950 和 L5480-6300）：

- `setBgm` L519
- `initBgmUI` L870
- `buildBgmMenu` L639（167 行，需拆小）
- `startRoomBGM` / `startLobbyBGM`
- `playSongAI` L5564（155 行）
- `playSongLegacy` L5721
- `generateAndPersistSong` L6259
- BGM 全局状态：`_ehBgmGenerating` / `_ehBgmOverride` / `_bgmSoulCache`

依赖注入（避免继续读全局）：

```js
window.EH_BGM = createBgmController({
  getRoom: () => curRoom,
  getConfig: () => EH_CONFIG,
  toast,
  audioEngine: AudioEngine,
  sfx: EhSfx
});
```

### 第 5 阶段：拆出房间与消息 → `js/modules/room.js` + `js/modules/messages.js`

迁移目标：

- `enterRoom` L1646
- `backToLobby` L7929
- `subscribeMessages` L2140（174 行）
- `loadHistory` L1959（144 行）
- `refreshSnapshotTail` L1810
- `_buildMsgElRaw` L3110（128 行）
- `buildGameEl` L2972（130 行）
- `entranceBanner` L3785

重点：统一订阅、定时器、事件监听器的释放（`createScope()` 模式）。

### 第 6 阶段：清理

- 剩下的 `js/app.js` 只保留：启动、场景切换、公共工具、模块编排。
- `window.` 挂载逐步迁移到 `window.EH_*` 命名空间。

## 四、跨文件引用清单

`js/app.js` 里定义、被其他文件调用的符号（拆分后必须保留对外接口）：

- **`js/boot.js` 依赖**：`ensureAuth` / `doLogin` / `goScene` / `handleResetLink` / `loadOrRollIdentity` / `preRestoreScene` / `resolveSession` / `resumeAfterAuth` / `resyncMsgOwnership` / `saveIdentity` / `toast`
- **`js/dm.js` 依赖**：`awaitSb` / `ehArm` / `fmtTime` / `isSoulUser` / `loadHistory` / `openMe` / `send` / `toast` / `on`
- **游戏模块依赖**：`beat` / `buildGameEl` / `secureRand` / `send` / `setConn` / `toast`
- **`index.html` 内联脚本依赖**：`attachLongPress` / `awaitSb` / `buildMsgEl` / `preRestoreScene` / `resumeAfterAuth` / `roomAccentC` / `soulThemeColor` / `syncStreamOnair` / `toast`
- **`admin.html` 依赖**：`fmtTime` / `logoutIdentity` / `toast`
- **`jianghu.html` 依赖**：`ac` / `on` / `toast`
- **`js/config-runtime.js` 依赖**：`applyTheme` / `checkCachePurge` / `renderSongStrip` / `syncThemeColor`

## 五、验收自检清单（每阶段结束后）

- [ ] `node --check js/app.js` 通过
- [ ] `node --check js/modules/*.js` 通过（阶段 2+）
- [ ] 基线脚本产出无关键路径函数丢失
- [ ] 空 catch A 类计数不增加
- [ ] `git status` 无未追踪的散落文件
- [ ] 线上冷启动：新开无缓存标签，首页 DOM Interactive ≤ 1200 ms
- [ ] 首页 `eh_rooms` 请求数 ≤ 1（合并后）
- [ ] 匿名进入、正式登录、进房、返回大厅、BGM 开关、消息发送全部通过
- [ ] 新开 devtools 无 `console.error`，`?debug=1` 下能看到分模块诊断

## 六、原始基线数据存档

- `scripts/review/scan-app-boundaries.py`（脚本）
- `scripts/review/scan-empty-catches.py`（脚本）
- 基线 JSON 数据首次生成时间：**2026-08-18 21:34**
