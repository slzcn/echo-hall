# PC 聊天输入框聚焦后跳动

## §1 现象（Reproducibility）

- **环境**：PC Chrome。
- **步骤**：进入房间，点击聊天输入框，等待约 250ms。
- **预期**：聊天厅尺寸与输入框位置保持稳定。
- **实际**：输入框及聊天厅发生明显跳动，桌面布局尺寸也偏离原设计。

## §2 稳定复现

- 主人 PC 真机复现。
- 代码路径可确定：PC 聚焦后没有软键盘，`vv.height`、`window.innerHeight`、VirtualKeyboard 均不变化；250ms 无信号定时器因此落入“无信号 WebView”估算分支。

## §3 单一根因假设

- **根因**：移动端无信号软键盘兜底没有设备边界，在 PC 上也执行；PC 正常的“无软键盘、无视口变化”被误判为键盘信号丢失，`estimatedKbH = viewport.height × 0.38`，随后 `#hall` 被强制缩短。
- **附带影响**：控制器初始化时在 PC 上也给 `#hall` 写入整个 VisualViewport 高度，覆盖桌面 CSS 的 `min(92dvh,900px)`。
- **证伪实验**：只让聊天软键盘布局控制器在 `hover:none + pointer:coarse` 的触屏移动环境运行；PC 聚焦前后 `#hall` 高度和输入框位置应不变，移动端代码保持原样。

## §4 修复方案

- 新增统一环境边界 `usesSoftKeyboardLayout()`。
- PC：`applyLayout` 清除 inline height 并返回；聊天输入框 focusin/focusout 不启动软键盘估算、轮询和布局回写。
- 移动触屏：保留 VisualViewport、VirtualKeyboard、小米无信号估算、后台恢复守卫全部现有逻辑。
- 不新增事件监听器，不抬高 CI 基线。

## §5 回归矩阵

| 场景 | 结果 |
|---|---|
| PC 进入房间保持桌面 CSS 高度 | ✅ 828px（92vh），无 inline height |
| PC 聚焦 1 秒输入框不跳 | ✅ 100／450／1050ms 坐标完全一致 |
| PC 输入发送 | ⏳ |
| Android Chrome 软键盘控制 | ⏳ 代码路径保留 |
| Android PWA 无信号估算 | ⏳ 代码路径保留 |
| iOS Safari／PWA VisualViewport | ⏳ 代码路径保留 |

## §6 提交约束

- 单一 PC 回归；版本三处同步；提交前运行 `bash scripts/ci-check.sh`。

## §7 修后确认

- 修前自动化复现：聚焦 400ms 后 `#hall` 从 828px 缩至 558px，composer top 从 787px 跳至 652px。
- 修后自动化复测：聚焦前及 100／450／1050ms，`#hall` 始终 828px，composer top 始终 787px，inline height 始终为空。
- 移动端真实 IME 仍需真机决定性验证。
