# 诊断单：横竖屏切换时可视高被双减（VK Double-Subtract）

## §1 现象

- **设备**：Android / iOS 触屏 + 覆盖式或 resizes-content 键盘
- **运行环境**：Chrome / Chrome-PWA / Safari / Safari-standalone-PWA / 小米 WebView（overlaysContent 环境）
- **触发步骤**：
  1. 进入 hall，聚焦聊天输入框，键盘弹起。
  2. 保持键盘弹起，横竖屏切换一次（竖→横 或 横→竖）。
  3. 观察 `#hall` 高度与消息区显示。
- **预期结果**：`#hall` 高度 = 新朝向可视高 - 当前键盘高（只减一次键盘），底部输入框正常贴键盘顶。
- **实际结果**：`#hall` 被缩到远小于「可视高 - 键盘高」的值，底部输入框浮空 / 消息被挤出视口。

## §2 稳定复现

- 可通过静态代码路径 + 时间轴模拟稳定复现（`scripts/journey-kb-orientation.js`）。
- `js/keyboard.js:254` `orientationchange` handler 立即 `baseFullH = 0`；此后 250ms 窗口内任何 `scheduleLayout()` 触发 `applyLayout()` 时，`chatFocused=true` 复位分支被跳过 → `baseFullH` 停留在 0 → `visibleHeight()` 的 `full` 退化成已缩的 `innerHeight` → 再减 `vkH`/`estimatedKbH` → 双减。

## §3 单一根因假设

- **根因**：`orientationchange` handler 无条件把 `baseFullH=0`，忽略了「键盘弹起中转屏」这条支路。键盘弹起态下 `baseFullH` 不应被清 0，应该保持上次落键盘时的全高，直到键盘真正落下再由 `applyLayout` 的复位分支刷新到新朝向全高。
- **证据链**：
  1. `visibleHeight()` 的分母 `full = Math.max(baseFullH||0, innerH, vv.h)`。键盘弹起时 iOS/resizes-content 会把 vv.h 或 innerH 缩到「可视高」（不是全高），此时 `max` 只剩 `baseFullH` 是真全高。
  2. 一旦 `baseFullH=0`，`full` 退化成已缩的 `innerH/vv.h`（约「全高-键盘高」）。
  3. `full - vkH` 或 `full - estimatedKbH` 又扣一次键盘高 → 双减。
- **证伪实验**：不改代码，只在控制台 orientationchange 里把「立即置 0」注释掉；键盘弹起中转屏观察 `#hall` 高度。若双减消失，则假设成立。
- **证伪结果**：未被证伪。

## §4 修复方案

- **文件**：`js/keyboard.js`（只改 orientationchange handler 分支条件，不加监听器）；新增 `scripts/journey-kb-orientation.js`；接入 `scripts/ci-check.sh`。
- **方案**：把 orientationchange handler 从「无条件 `baseFullH=0`」改为「只有键盘确认落下时才 `baseFullH=0`」。键盘弹起态保留旧 `baseFullH`；等键盘落下后 `applyLayout` 的复位分支（第 66-70 行）会自动把 `baseFullH` 刷新到新朝向的真全高。
  - 判断「键盘落下」用与 `applyLayout` 复位分支同款三条件：`!chatFocused && estimatedKbH===0 && VK.boundingRect.height===0`。
  - 保留 `setTimeout(settleChatLayout, 250)`，让键盘落下路径也能刷新到新朝向。
- **回滚**：恢复 handler 一行为 `baseFullH=0`。

## §5 回归矩阵（键盘/布局类必过）

| 场景 | iOS Safari | iOS PWA | Android Chrome | Android PWA | MIUI WebView |
|---|:-:|:-:|:-:|:-:|:-:|
| 未聚焦竖→横 baseFullH 更新为新朝向真全高 | 契约 ✅ | 契约 ✅ | 契约 ✅ | 契约 ✅ | 契约 ✅ |
| 键盘弹起中转屏不双减 | 契约 ✅ | 契约 ✅ | 契约 ✅ | 契约 ✅ | 契约 ✅ |
| 键盘弹起中转屏后收键盘 baseFullH 会被刷新 | 契约 ✅ | 契约 ✅ | 契约 ✅ | 契约 ✅ | 契约 ✅ |
| 真机 iOS Safari | ⏳ | ⏳ | — | — | — |
| 真机 iOS PWA | — | ⏳ | — | — | — |
| 真机 Android Chrome | — | — | ⏳ | — | — |
| 真机 Android PWA | — | — | — | ⏳ | — |
| 真机 MIUI WebView | — | — | — | — | ⏳ |

（真机行属大目标 §4「真机矩阵」范畴，先落静态契约门禁，真机验后回填。）

## §6 提交约束

- 只改 orientationchange 分支条件 + 新增旅程 + CI 接入 + 版本三件套；不动其他键盘逻辑。
- 版本三件套同步：`index.html`、`sw.js`、`ver.txt` 全部推进到 `20260813-vkorient`。
- 提交前跑 `bash scripts/ci-check.sh` 全绿。

## §7 修后确认

- **专项旅程**：当前实现三场景全绿；旧实现于键盘弹起中转屏场景从正确可视高 400 双减至 100，反证必红。
- **本地全量 CI**：全部通过；`journey_gate.py` 识别 `scripts/journey-kb-orientation.js` 并放行。
- **版本一致性**：`BUILD_VER=20260813-vkorient`、`SW_VERSION=eh-sw-v282-20260813-vkorient`、`ver.txt=20260813-vkorient`，`keyboard.js?v=20260813-vkorient`。
- **远端 CI / Pages / 线上文件核验**：提交推送后回填。
