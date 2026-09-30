# Android Chrome 偶发键盘遮挡聊天输入框

## §1 现象（Reproducibility）

- **环境**：Android Chrome。
- **步骤**：进入房间，多次弹起／收起软键盘。
- **预期**：输入框始终位于键盘上方。
- **实际**：偶发被键盘遮挡；收起后重新弹出通常恢复。

## §2 稳定复现

- 主人真机可偶发复现；桌面 CDP 没有真实 Android IME，只能验证布局路径，不能冒充真机复现。

## §3 单一根因假设

- **根因**：当前 `interactive-widget=resizes-visual` 只缩 Visual Viewport，不缩 Layout Viewport；`#hall` 又是 fixed 容器，布局依赖 VisualViewport 事件及时回写。Chrome 偶发时序竞态时，输入框会短暂仍锚定旧布局视口并被遮挡。
- **官方依据**：Chrome 108 起默认只缩 Visual Viewport；Chrome 官方建议需要固定底部控件随键盘布局时使用 `interactive-widget=resizes-content`，让 Layout Viewport 与初始包含块一并缩小。
- **证伪实验**：只把 viewport 策略改为 `resizes-content`；保留现有 VisualViewport 控制器与 `overlaysContent=false` 兜底。

## §4 修复方案

- viewport meta：`resizes-visual` → `resizes-content`。
- 不恢复 `overlaysContent=true`，避免再次主动制造覆盖式键盘。
- 不新增监听器，不改小米 PWA 的无信号估算与后台恢复守卫。

## §5 回归矩阵

| 场景 | 结果 |
|---|---|
| Chrome 布局视口随键盘缩小 | ✅ 策略静态确认 |
| VisualViewport 兜底仍在 | ✅ |
| VirtualKeyboard overlaysContent=false | ✅ |
| 小米 PWA 估算兜底保留 | ✅ |
| Android Chrome 真机偶发遮挡 | ⏳ 需真实 IME 长时间复测 |
| iOS 浏览器／PWA | ⏳ iOS 忽略该键，继续走 VisualViewport |

## §6 提交约束

- 单一键盘视口策略问题；版本三处同步；提交前跑 `bash scripts/ci-check.sh`。

## §7 修后确认

- 以官方视口策略和本地布局门禁作为发布依据；不宣称桌面 CDP 已验证真实软键盘。
