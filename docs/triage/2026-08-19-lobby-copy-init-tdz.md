# 大厅复制助手初始化顺序导致主脚本中断

## §1 现象（Reproducibility）

- **设备**：自动化 Chromium（Echo 线上健康探测）
- **OS 版本**：macOS 26.6.1
- **运行环境**：Chrome（CDP）
- **主题/时段**：无关
- **触发步骤**：
  1. 无缓存加载线上 `https://slzcn.github.io/echo-hall/`。
  2. 浏览器解析 `js/app.js?v=20260819-lobby-copy-invite`。
  3. 读取控制台异常。
- **预期结果**：主脚本完整初始化，大厅与登录恢复链路可用。
- **实际结果**：稳定抛出 `ReferenceError: Cannot access 'copyInvite' before initialization`（app.js:1392）；主脚本中断后，boot 恢复链又触发未完成初始化的 `_restoreScrollPending`，产生第二条级联异常。
- **修前证据**：`python3 scripts/health-probe.py` 于 2026-08-19 13:30 连续页面加载稳定捕获上述两条异常，退出码 1；JSON 保存于本轮 `/tmp/health-probe.json`。

## §2 稳定复现

- ✅ 健康探测的真实浏览器加载稳定复现。
- ✅ 源码最小执行反证稳定复现：在 `const copyInvite` 初始化前把它作为实参读取，必定触发 TDZ `ReferenceError`。
- **环境范围**：ECMAScript `const` 暂时性死区语义跨现代浏览器一致，与设备、主题无关。
- **视频**：—（脚本启动期异常，以浏览器控制台、探测 JSON 和可执行反证为准）。

## §3 单一根因假设（Single Hypothesis）

- **本次假设根因**：提交 `e709505` 将函数声明 `copyInvite` 迁成 `const copyInvite = createCopyInvite(...)`，却保留了原先“先注入 `createRenderMyRooms({ copyInvite })`、后声明”的顺序。函数声明可提升，`const` 不可提升，导致模块初始化在 TDZ 读取处中断。
- **证据链**：
  1. 首条异常精确指向 `createRenderMyRooms` 依赖对象中的 `copyInvite`。
  2. 当前源码中该读取位于 `const copyInvite` 初始化之前。
  3. 父提交使用可提升的 `function copyInvite`，同一顺序不会报错；迁移提交只改变了声明形态。
  4. `_restoreScrollPending` 异常发生于首错导致 app.js 后半段未完成初始化之后，是同一初始化中断的级联结果。
- **证伪实验**：只把 `const copyInvite` 工厂初始化移动到首次读取之前，不改变复制实现、auth 或滚动恢复逻辑；若浏览器两条异常同时消失，则假设成立。
- **证伪结果**：未被证伪，执行最小顺序修复。

## §4 修复方案

- **动到的文件**：`js/app.js`、`scripts/review/test-module-contracts.js`、版本三处、本文档。
- **动到的模块/函数**：大厅 `copyInvite` 工厂初始化与 `renderMyRooms` 依赖装配顺序。
- **方案**：把 `const copyInvite = ...` 原样移动到 `createRenderMyRooms({ copyInvite })` 之前；不改变任何运行时行为。
- **回归门禁**：模块契约测试新增初始化顺序断言，并用最小旧顺序 fixture 自证必红、当前顺序必绿。
- **影响平台**：所有平台启动初始化；修复仅消除 ECMAScript TDZ，无平台分支。
- **历史检索**：已检查 `e709505` 及父提交差异，确认是本次函数声明→const 迁移引入。
- **回滚方案**：回滚本原子提交。

## §5 回归矩阵

| 场景 | 结果 |
|---|---|
| 主脚本初始化 | ✅ |
| 大厅渲染 | ✅ |
| 登录态恢复 | ✅ |
| 私密房邀请码复制契约 | ✅ |
| 页面运行时异常 | ✅（0 条） |

键盘/布局/BGM/PWA 均未改动，不适用。

## §6 提交约束

- ✅ 单一根因、最小顺序修复。
- ✅ `BUILD_VER` / `SW_VERSION` / `ver.txt` 保持同步为 `20260819-guandan-rows`；修复资源指纹为 `js/app.js?v=20260819-lobby-copy-tdz`。
- ✅ 针对性模块契约、旧实现反证与 `bash scripts/ci-check.sh` 全绿。

## §7 修后确认

- **旧实现反证**：对 `e709505` 执行声明顺序门禁，`copyInvite` 位置 68747 晚于 `renderMyRooms` 位置 68128，稳定 FAIL。
- **当前实现测试**：`node scripts/review/test-module-contracts.js` 全绿；`d12d95b` 顺序门禁 PASS。
- **CI 结果**：本地 `bash scripts/ci-check.sh` 退出码 0；GitHub `CI Gate` run 32219805730 success。
- **线上版本／资源指纹**：`ver.txt=20260819-guandan-rows`；线上 index 引用 `js/app.js?v=20260819-lobby-copy-tdz`；Pages deploy run 32219805750 success。
- **线上健康探测**：2026-08-19 13:34 退出码 0、`issues=[]`、`cdp.js_errors=[]`、白屏 false、Realtime WebSocket open。
- **提交哈希**：`d12d95b7d81d53c8202bb8ac15d71b27ccec622d`。
