# 诊断单：折叠屏键盘弹起时展开，旧全高基线未刷新

## §1 现象

- **设备模型**：Android 折叠屏，闭合态窄屏 → 展开态大屏；`interactive-widget=resizes-content`；键盘保持弹起。
- **触发步骤**：
  1. 闭合态进入聊天房，聚焦输入框，键盘弹起。
  2. 不收键盘，展开设备。
  3. 观察聊天区底部与输入框位置。
- **预期**：展开态使用展开后的全高作为基线，聊天区可视高随新屏幕增加。
- **实际**：仍沿用闭合态 `baseFullH`，展开后聊天区少出一段高度，输入框与键盘顶之间出现错误留白/内容区偏矮。

## §2 稳定复现（生产计算链模拟）

- 典型模型：闭合全高 800、展开全高 841、键盘 320。
- 闭合键盘态：`innerHeight=480`，结果 `visibleHeight=480`。
- 展开键盘态：`innerHeight=521`，当前旧 `baseFullH=800`，结果仍为 480；正确结果应为 521。
- 误差：41px。
- 反向收折：在同一模型下仍取当前缩小后的 `innerHeight`，未复现同样偏差；高风险方向是「键盘弹起 → 展开」。

## §3 单一根因

- 当前 `baseFullH` 只在 `!chatFocused && estimatedKbH===0 && VK 收起` 时刷新。
- 折叠屏展开通常触发 `resize`，不是 `orientationchange`；键盘仍弹起时 `chatFocused=true`，因此现有复位分支跳过。
- `visibleHeight()` 继续使用闭合态 `baseFullH` 作为 `full` 分母，无法反映展开后的新全高。
- 根因：**折叠屏几何改变与键盘导致的 viewport 缩小没有区分，展开时缺少“新宽度/新屏幕几何”基线刷新。**

## §4 修复方案

- 复用既有 `resize` → `scheduleLayout` → `applyLayout` 链，不新增监听器。
- 记录上一次布局宽度；当聊天聚焦且键盘仍弹起、`innerWidth` 发生变化时，判定为折叠/展开几何改变：
  - 有真实 VK 高度时，用 `innerHeight + vkH` 更新 `baseFullH`；
  - 有估算键盘高度时，用 `innerHeight + estimatedKbH` 更新；
  - 没有键盘高度时不强行猜测，继续走现有落键盘基线逻辑。
- 保留普通键盘弹起时宽度不变的路径，避免把已缩 `innerHeight` 写进基线。
- 保留横竖屏 `orientationchange` 修复，不新增监听器。

## §5 回归矩阵

| 场景 | 预期 |
|---|---|
| 普通手机键盘弹起，宽度不变 | `baseFullH` 不被当前缩小 innerHeight 覆盖 |
| 折叠屏键盘弹起后展开 | `baseFullH` 更新为展开全高，误差消失 |
| 折叠屏键盘弹起后收折 | 取当前缩小 innerHeight，不出现双减 |
| 键盘收起后展开/收折 | 复位分支刷新新朝向全高 |
| 横竖屏键盘弹起中切换 | 原 `journey-kb-orientation.js` 继续通过 |

## §6 提交约束

- 单一根因、单独提交；不混入无关改动。
- 新增折叠屏旅程，必须包含旧实现反证。
- 本地 CI、远端 CI、Pages、线上真实文件全部核验。

## §7 修后确认

- **折叠屏专项旅程**：展开重建基线、普通手机宽度不变不污染、收折不双减、估算键盘路径全部通过；旧实现展开态可视高 480（应为 521），反证必红。
- **本地全量 CI**：全部通过；旅程门禁识别 `scripts/journey-kb-foldable.js` 并放行。
- **版本一致性**：`BUILD_VER=20260813-foldablekb`、`SW_VERSION=eh-sw-v283-20260813-foldablekb`、`ver.txt=20260813-foldablekb`，`keyboard.js?v=20260813-foldablekb`。
- **提交**：`b74c2e0`，已推送 `main`。
- **远端 CI**：GitHub Actions `CI Gate`（run `31718664718`）success。
- **Pages 部署**：`Deploy to GitHub Pages`（run `31718664620`）success；`pages build and deployment`（run `31718664095`）success。
- **线上真实文件核验**：`https://slzcn.github.io/echo-hall/` 的 `index.html`、`ver.txt`、`js/keyboard.js` 均 HTTP 200；线上版本为 `20260813-foldablekb`；`BUILD_VER`、脚本缓存指纹、`layoutWidth`/`widthChanged` 折叠屏基线和 `innerHeight + vkH`、`innerHeight + estimatedKbH` 重建路径全部命中。
