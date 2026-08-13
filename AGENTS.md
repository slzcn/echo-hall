# AGENTS.md — Echo 项目协作宪法

> 任何 AI 编程助手（Claude Code / Cursor / Copilot / OpenClaw / Codex CLI 等）进入本项目，**第一件事读完本文件**，再动任何代码。
> 本文件是 Echo「bug 总修不好」教训的固化产物。不遵守 = 大概率复现「修 A 回归 B」的死循环。

---

## 0. 一句话背景

Echo（回声大厅）主体是 `index.html` 单文件 ~1 万行、400+ 函数、多套键盘/房间/PWA 机制并存。**它没有一个「全部健康」的静态终点**，只能靠「稳定复现 + 单变量证伪 + 门禁防回归」逐个收敛。所有纪律都是为这一点服务。

---

## 1. 修 bug 的强制流程（铁律）

1. **先填诊断单**：复制 `docs/bug-triage-template.md` 到 `docs/triage/YYYY-MM-DD-<bug-slug>.md`，把 §1-§4 填完再动代码。
2. **达不到「稳定复现」（§2）就不许提「真修」**：只能提探索性尝试，commit message 加 `[exploratory]` 前缀。
3. **一张诊断单只允许一个根因假设（§3）**：有第二嫌疑 = 开第二张单。验证 A 假设时**绝不恢复上一版被禁用的 B/C/D 嫌疑**（变量不独立=永远查不到真凶）。
4. **用户旅程先于实现**：改动涉及身份／登录、用户可见状态、异步等待、生成／上传、重复提交、房间／页面切换、多入口同步时，先写状态转换表和跨阶段不变量，再新增 `scripts/journey-*.js`。只有函数级测试不够。
5. **旅程测试必须自证有效**：至少包含一个旧错误实现反证（旧实现必红、当前实现必绿），并覆盖中间态、失败恢复和重复操作；只查源码字符串不算完整旅程测试。
6. **提交前本地必跑**：`bash scripts/ci-check.sh`，全绿才提交；其中 `scripts/journey-gate.py` 命中旅程维度但缺 journey 测试／明确豁免时会直接阻塞。
7. **修完回填 §5-§7**：键盘/布局/BGM/PWA 类必须过回归矩阵（§5），存在任何 ❌ 不许合入 main。

---

## 2. 提交纪律（原子提交）

- **一个 commit 只做一件事**。禁止一次混：业务修复 + 版本号升级 + SQL 变更 + 重构。
- commit message 写「现象 + 根因 + 方案」，**禁用「真修 / 终于 / 真凶 / 彻底解决」这类词**（历史上这些词后面 90% 又回归了）。
- 数据库字段变更**先落地 migration**（`sql/` 下），不是先前端 `select *` 再手工粘 SQL。
- 版本号三处必须同步：`index.html` 的 `BUILD_VER`、`sw.js` 的 `SW_VERSION`、`ver.txt`。CI 会挡下不一致。

---

## 3. Echo 已知陷阱清单（改前必查）

- **键盘协同四层同写**：`.stage / #hall / --vh` 由「主聊天键盘 IIFE + 弹窗键盘 IIFE + CSS 100vh/100dvh + goScene 的 __ehApplyVVH」四层同时写。任何键盘改动**先想清楚动的是哪一层，其他三层会不会冲突**。
- **房间状态异步竞争**：`curRoom / msgChan / presChan` 是全局可变状态，多条异步路径各自做 rid 校验（enterRoom / loadHistory / refreshSnapshotTail / refreshPresence / beat / Realtime 回调 / foregroundResync）。**新增任何异步路径必须补 rid 校验**。
- **重复 DOM ID**：`#cntLed`、`#meEmail` 在 innerHTML 中间态可能同时存在多个。修相关模块先想清楚 `getElementById` 命中哪一个。CI 监控其数量不上涨。
- **重复函数名**：`tick`（7 处）、`check`（版本自愈 + 深夜模式两处）、`esc/done/fire/kick/loop/noise/push/tone` 各有多处。grep 用 `function <name>\b` 精确匹配。
- **PWA 三套刷新入口**：版本自愈 / SW installed / 下拉刷新。改任何刷新逻辑先想清楚这三条会不会同时触发。
- **空 catch 约 380 处**：真错会被静默吞掉。修 bug 时发现异常路径，先把 catch 打印出来再谈修复。

---

## 4. 谁负责让 CI 全绿

- 谁提交 / 谁开 PR，谁负责让 `CI Gate` workflow 全绿。**红叉不合并，没有例外**。
- CI 检查项见 `scripts/ci-check.sh`：内联 JS 语法 / 单点行为回归 / 用户旅程回归 / 旅程覆盖门 / 版本号一致 / 重复 ID 密度 / 危险 API 密度 / 提交范围。
- **旅程门不可豁免为沉默**：确实不需要旅程测试时，必须在改动中写 `journey-exempt: <具体理由>`；空理由、口头说明或“改动很小”不算。
- 修 bug 类 PR（打 `bug-fix` label）**必须包含新的 `docs/triage/*.md` 诊断单文件**，否则 CI 挡下。纯基础设施 / 文档 / 内容类 PR 打 `no-triage` label 可豁免。

---

## 5. 不要做的事

- ❌ 不要在没有稳定复现的情况下改 `index.html` 然后说「应该修好了」。
- ❌ 不要一个 commit 塞多个领域的改动。
- ❌ 不要为了让某平台好看，删掉另一平台的兜底（例：删 Android 的 100dvh 兜底救 iOS）。跨平台改动必须过回归矩阵。
- ❌ 不要新增 `.bak` 文件到仓库根目录（用 git 历史，不用手工备份文件；`.gitignore` 已忽略 `*.bak.*`）。
- ❌ 不要绕过 CI Gate（改 workflow 放水、加 `[skip ci]` 硬推）。

---

_本文件随教训迭代。改动时在 commit message 说明为什么。_
