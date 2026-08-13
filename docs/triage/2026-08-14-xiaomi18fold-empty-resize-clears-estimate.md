# 小米 18 Fold 覆盖式键盘空 resize 清除估算

## §1 现象（Reproducibility）

- **设备**：小米 18 Fold，展开态，逻辑视口宽度 608px
- **运行环境**：Android 浏览器，键盘诊断页
- **触发步骤**：
  1. 打开 `kbdebug.html`。
  2. 点输入框弹起系统键盘。
  3. 保持键盘弹起并观察诊断横幅。
- **预期结果**：Echo Hall composer 位于键盘上方、可见可操作。
- **实际结果**：composer 位于全高页面底部，被覆盖式键盘遮挡。
- **证据**：主人 2026-08-14 01:30 截图；静态现场截图已足以确认运行时数值，动态录屏待补，不把它冒充成已完成项。

### 关键运行时数值

| 指标 | 值 |
|---|---:|
| `innerWidth` | 608 |
| `innerHeight` | 718 |
| `visualViewport.height` | 719 |
| `visualViewport.width` | 未展示 |
| `VK.boundingRect.height` | 0 |
| `EVT window.resize` | 2 |
| `EVT visualViewport.resize` | 2 |
| `EVT geometrychange` | 0 |
| `visibleHeight` | 718px |

## §2 稳定复现

- ⏳ 真机连续 3 次：尚未完成，当前有一张稳定现场截图。
- ⏳ 第二运行环境：未验证；本单当前明确限定为小米 18 Fold 覆盖式键盘路径。
- ⏳ 修前视频：未提供。
- 目前定义为**证据充分的探索性修复**；若未取得三次真机复现，不能把跨设备普适性写成已证明。

## §3 单一根因假设

**本次假设根因**：`visualViewport.resize` 事件仅表示事件发生，不代表视口高度变化；覆盖式键盘在高度不变时发出空 resize，现有回调无条件清零 `estimatedKbH`，撤销了三信号全哑路径刚建立的键盘高度估算。

**证据链**：
1. 键盘可见，但 `IH=718 / VV=719 / VK=0`，三类几何信号没有有效缩高。
2. `winR=2 / vvR=2 / vkG=0`，事件发生但数值没有变化。
3. 生产代码在 `visualViewport.resize` 回调中无条件执行 `estimatedKbH = 0`。

**可证伪实验**：在生产行为模拟中，将键盘估算设为 273px，再触发一个高度不变的 `visualViewport.resize`；若旧逻辑把估算清零、可视高度回到 718px，而修复逻辑保留估算、可视高度维持 445px，则根因得到行为级确认。

**证伪结果**：☑ 未被证伪；行为模拟与现场数据一致，继续修复

## §4 修复方案

- **动到的文件**：`js/keyboard.js`、`scripts/journey-kb-overlay-empty-resize.js`、`scripts/ci-check.sh`、`index.html`、`sw.js`、`ver.txt`、本诊断单。
- **模块**：现有 `visualViewport.resize` 回调；不新增常驻监听器。
- **方案**：仅当 visualViewport 高度相对 focus 基线发生有意义变化时，才清零估算；高度不变的空 resize 保留估算。
- **其他平台影响**：真实 VV 高度发生变化时仍回到真值主链；iOS/Android 正常缩高路径不改变。
- **回滚方案**：回滚本原子提交即可恢复旧回调。

## §5 回归矩阵

| 场景 | iOS Safari | iOS PWA | Android Chrome | Android PWA | MIUI 浏览器 |
|---|:-:|:-:|:-:|:-:|:-:|
| 输入框弹起键盘 | — | — | — | — | ⏳真机待复验 |
| 输入框收键盘 | — | — | — | — | ⏳ |
| 现有旅程回归 | ✅沙盒 | ✅沙盒 | ✅沙盒 | ✅沙盒 | ⏳ |

## §6 提交约束

- [x] 本 commit 只修空 resize 清估算这一件事
- [x] 本地 `bash scripts/ci-check.sh` 全绿
- [x] 版本号三处同步：`20260814-xiaomi18emptyresize` / `eh-sw-v285-20260814-xiaomi18emptyresize`

## §7 修后确认

- 修后视频：⏳未取得（当前不虚报真机视频）
- CI：☑ 本地全量 `bash scripts/ci-check.sh` 全绿；远端待推送后核验
- Pages：⏳待推送后部署
- 线上真机：⏳待主人复验
