# Echo Bug 最小诊断单（P0 铁律）

> **7/29 立**：Echo「bug 总修不好」的根因不是技术难，是修复流程失控——3 天 91 个非 merge 提交、键盘协同重写 7 版、顶部白条 2 小时追 5 个「真凶」。**任何 bug 修复提交前，必须先填完本表。填不满就不许提「真修」**，只能提「探索性尝试」并挂 `[exploratory]` 前缀。

---

## 使用方式

1. 复制一份到 `docs/triage/YYYY-MM-DD-<bug-slug>.md`
2. 修 bug 之前把 §1-§4 填完
3. 修复完再回填 §5-§7
4. 每一次改动都要能对应到本表的**单一**假设；换假设=开新单

---

## §1 现象（Reproducibility）

- **设备**：（iPhone 15 Pro / Android Pixel 7 / Xiaomi 14 / 等等，精确到机型）
- **OS 版本**：（iOS 18.2 / Android 14 / MIUI 15）
- **运行环境**：⬜ Safari  ⬜ Safari-standalone-PWA  ⬜ Chrome  ⬜ Chrome-PWA  ⬜ MIUI 浏览器  ⬜ 微信内嵌  ⬜ 其他：______
- **主题/时段**：（深夜模式 / 日间 / 特殊时段）
- **触发步骤**（能被别人 100% 复现的最短路径）：
  1.
  2.
  3.
- **预期结果**：
- **实际结果**：
- **修前视频/GIF**（≥3 秒动态录屏，静态截图不算）：`docs/triage/media/<slug>-before.mp4`

### 关键运行时数值（键盘/布局类 bug 必填）

| 指标 | 值 |
|------|----|
| `window.innerHeight` |  |
| `visualViewport.height` |  |
| `visualViewport.offsetTop` |  |
| `visualViewport.width` |  |
| `document.documentElement.clientHeight` |  |
| `getComputedStyle(document.documentElement)['--vh']` |  |
| `.stage` computed height |  |
| `#hall` computed height |  |

取值代码（真机 DevTools 粘贴）：
```js
const s=document.querySelector('.stage'),h=document.getElementById('hall');
copy({
  innerH: innerHeight,
  vvH: visualViewport?.height, vvT: visualViewport?.offsetTop, vvW: visualViewport?.width,
  clientH: document.documentElement.clientHeight,
  vh: getComputedStyle(document.documentElement).getPropertyValue('--vh'),
  stageH: s && getComputedStyle(s).height,
  hallH: h && getComputedStyle(h).height,
  BUILD_VER: window.BUILD_VER, SW_VERSION: window.SW_VERSION,
});
```

---

## §2 稳定复现（必须做到）

- ⬜ 我在一台真机上连续 3 次都能复现
- ⬜ 至少 2 种运行环境都能复现（Safari+PWA / Chrome+PWA），或明确标注仅 X 环境复现
- ⬜ 有修前视频

**⚠️ 达不到「稳定复现」就是探索性调查，不要提交生产修复。**

---

## §3 单一根因假设（Single Hypothesis）

> 铁律：**一张诊断单只允许一个假设**。有第二嫌疑 = 开第二张单。

- **本次假设根因**：
- **证据链**（为什么怀疑它）：
  1.
  2.
  3.
- **可以证伪它的实验**（在不改代码的前提下，用 query flag / DevTools 覆盖 CSS / 暂停动画 / disable JS 等）：
  -
- **证伪结果**：⬜ 已证伪，本假设排除  ⬜ 未被证伪，继续修复

**⚠️ 顶部白条事件教训**：验证 A 假设时**不许恢复上一版被禁用的 B/C/D 嫌疑**。变量不独立=永远查不到真凶。

---

## §4 修复方案（Fix Plan）

- **动到的文件**（越少越好，一 commit 只做一件事）：
  -
- **动到的模块/函数/行号区间**：
  -
- **是否会影响其他平台**（iOS / Android / PWA / 桌面）：
- **是否会重新暴露以前修过的 bug**（在 `git log --oneline -- <file>` 里搜过关键词吗）：
- **回滚方案**（假设线上出问题，10 秒内能怎么退回）：

---

## §5 回归矩阵（Regression Matrix）

> **键盘/布局/BGM/PWA 类 bug 必过**。其他类 bug 至少要过跟自己领域相关的行。

| 场景 | iOS Safari | iOS PWA | Android Chrome | Android PWA | MIUI 浏览器 |
|------|:-:|:-:|:-:|:-:|:-:|
| 大厅进入 |  |  |  |  |  |
| 官方频道进房 |  |  |  |  |  |
| 用户房间进房 |  |  |  |  |  |
| 输入框弹起键盘 |  |  |  |  |  |
| 输入框收键盘 |  |  |  |  |  |
| 消息发送 |  |  |  |  |  |
| 消息流不跳/不抖 |  |  |  |  |  |
| 切后台再切回 |  |  |  |  |  |
| 旋转（横竖屏切换） |  |  |  |  |  |
| 返回按钮收键盘 |  |  |  |  |  |
| BGM 菜单打开/关闭 |  |  |  |  |  |
| PWA 更新（触发 SW 换代） |  |  |  |  |  |

格子填 ✅（过） / ❌（回归） / — （不适用） / ⏳（未测）。

**存在任何 ❌ = 本单不能合入 main。**

---

## §6 提交约束（Commit Discipline）

- ⬜ 本 commit **只修一个 bug**，不混其他改动
- ⬜ commit message 描述现象+根因+方案，不用「真修/终于/真凶」这类词
- ⬜ 数据库字段变更**已先落地 migration**（不是先前端 select 再手工粘 SQL）
- ⬜ 版本号三处已同步：`index.html` 的 `BUILD_VER`、`sw.js` 的 `SW_VERSION`、`ver.txt`
- ⬜ 已本地跑过 `scripts/ci-check.sh`，全绿

---

## §7 修后确认（Post-Fix Verification）

- **修后视频**：`docs/triage/media/<slug>-after.mp4`
- **CI 结果**：⬜ 语法检查通过  ⬜ 版本号一致  ⬜ Playwright（如接入）通过
- **回归矩阵通过率**：X / Y
- **合入 main 时间**：
- **合入后 24h 有无线上反馈**：

---

## 附录：Echo 已知陷阱清单（改前必查）

- **键盘协同**：`.stage / #hall / --vh` 目前由「主聊天键盘 IIFE (9324-9410) + 弹窗键盘 IIFE (9416-9523) + CSS 100vh/100dvh + goScene 的 __ehApplyVVH」四层同时写。**任何键盘改动必须先想清楚这次动的是哪一层，其他三层会不会冲突。**
- **房间状态**：`curRoom / msgChan / presChan` 在 3708-3721 是全局可变状态，8 处异步路径各自做 rid 校验（enterRoom 4087、loadHistory 4307、refreshSnapshotTail 4205、refreshPresence 4811、beat 4616、Realtime 回调 4436/4487、foregroundResync 7397）。**新增任何异步路径必须补 rid 校验，或推动引入 roomSessionId 统一取消机制。**
- **重复 DOM ID**：`#cntLed`（3914/3915/4705）、`#meEmail`（8504/8639/8640）在 innerHTML 中间态可能同时存在多个。**修相关模块时先想清楚 getElementById 会命中哪一个。**
- **重复函数名**：`tick` 有 7 处、`check` 有版本自愈(1826)和深夜模式(9673)两处、`esc/done/fire/kick/loop/noise/push/tone` 各有多处。**grep 前用 `function <name>\b` 精确匹配，不要模糊搜。**
- **PWA 三套刷新入口**：版本自愈 1823-1848、SW installed 9785-9803、下拉刷新 9946-9955。**改任何刷新逻辑先想清楚这三条会不会同时触发。**
- **空 catch 约 380 处**：真错会被静默吞掉。**修 bug 时如果发现异常路径，先把该处 catch 打印出来再谈修复。**
