# Echo 大厅房间卡绑定初始化顺序导致主脚本中断

## §1 现象（Reproducibility）

- **设备**：自动化 Chromium（Echo 线上健康探测）
- **OS 版本**：macOS 26.6.1
- **运行环境**：Chrome（CDP）
- **触发步骤**：
  1. 无缓存加载线上 Echo 首页。
  2. 执行当前 `js/app.js?v=20260819-lobby-bind-cards`。
  3. 读取浏览器控制台异常。
- **预期结果**：主脚本完成初始化，大厅渲染与登录恢复链路可用。
- **实际结果**：稳定抛出 `ReferenceError: Cannot access 'bindRoomCards' before initialization`（app.js:1350）；随后 boot 恢复链触发 `_restoreScrollPending` 级联异常。
- **探测证据**：2026-08-19 14:30 健康探测 JSON：线上 `ver.txt=20260819-guandan-rows`，退出码 1，`cdp.js_errors` 为上述两条，资源加载无失败。

## §2 稳定复现

- ✅ 真实线上健康探测稳定捕获。
- ✅ 源码顺序反证：`createRenderOfficial` 和 `createRenderPublic` 的依赖对象在 `const bindRoomCards` 初始化前读取它，符合 ECMAScript TDZ 语义。
- **范围**：现代浏览器一致；与网络延迟无关。
- **视频**：—（启动期异常，以浏览器控制台与可执行顺序门禁为证据）。

## §3 单一根因假设

- **本次假设根因**：提交 `7711d3c` 将 `bindRoomCards` 从函数声明迁移为 `const` 工厂初始化，但保留了大厅渲染工厂先装配、绑定工厂后初始化的顺序；const 不提升，导致主脚本在参数求值时进入 TDZ。
- **证据链**：
  1. 首条异常精确指向 app.js:1350 的 `bindRoomCards`。
  2. 当前源码中两个渲染工厂先读取该变量，声明位于其后。
  3. 同一提交把原先可提升的函数声明移除，改变了初始化语义。
  4. `_restoreScrollPending` 位于后续代码，是首错中断后的级联异常。
- **证伪实验**：只把 `bindRoomCards` 工厂初始化移动到首次读取前，不改变绑定实现；若两条运行时异常同时消失，假设成立。
- **证伪结果**：未被证伪，执行最小顺序修复。

## §4 修复方案

- **动到的文件**：`js/app.js`、`scripts/review/test-module-contracts.js`、版本三处、本文档。
- **方案**：将现有 `bindRoomCards` 工厂初始化块移动到 `createRenderOfficial` 之前；增加静态初始化顺序门禁，并用旧顺序 fixture 证明必红。
- **影响平台**：所有浏览器启动初始化；不改业务逻辑和平台分支。
- **回滚方案**：回滚本原子提交。

## §5 回归矩阵

| 场景 | 结果 |
|---|---|
| 主脚本初始化 | ✅ |
| 大厅官方房渲染 | ✅ |
| 大厅公开房渲染 | ✅ |
| 登录态恢复 | ✅ |
| 房间卡预取与进房 | ✅ |
| 页面运行时异常 | ✅（本地门禁；线上待部署复测） |

键盘/布局/BGM/PWA 未改动，不适用。

## §6 提交约束

- ✅ 单一根因、最小顺序修复。
- ✅ `BUILD_VER` / `SW_VERSION` / `ver.txt` 同步为 `20260819-lobby-bind-tdz`。
- ✅ `node scripts/review/test-module-contracts.js`、`node scripts/journey-table-visual.js` 与 `bash scripts/ci-check.sh` 全绿。

## §7 修后确认

- **旧实现反证**：提交 `7711d3c` 中 `renderOfficial` 首次读取位置早于 `const bindRoomCards` 初始化，顺序门禁稳定 FAIL。
- **当前实现**：提交 `6eac231` 已将 `bindRoomCards` 初始化移到两个房间渲染器之前；模块契约门禁 PASS，并保留卡片预取/进房延迟依赖行为测试。
- **本地 CI**：`bash scripts/ci-check.sh` 退出码 0；版本一致、语法、游戏、用户旅程和范围门禁全绿。
- **线上部署与健康探测**：待本轮推送和 Pages 部署后回填。
