# 键盘协同：首次进聊天室输入框距底部大

- **报告人**：主人（V23 真机验证后追加发现）
- **平台**：安卓真机（浏览器/PWA 未细分）
- **触发条件**：首次进 hall 场景（未点击输入框、键盘未弹起过）
- **现有版本**：`20260730-kbNoJitterV23`（commit 22b762e）

## 现象
- 首次进入聊天室：输入框离底部有明显额外空白（大于 15px 规格）
- 弹一次键盘后收回：距离变正常（15px）
- 也就是说，`visualViewport.resize` 触发过一次后 `#hall` 高度就对了

## 结构假设定位
`#hall` 用 `height:100svh` 作为默认高度（回退 `-webkit-fill-available`）。安卓/iOS 移动浏览器上：
- `100svh` = **地址栏折叠前的最小安全高度**（工具栏展开态高度）
- `visualViewport.height` = **当前真实可视高度**（工具栏折叠后更大或键盘弹起时更小）

首次进 hall 时 `chatFocused=false`，`applyLayout` 走清空分支 `el.style.height=''`，`#hall` 用 `100svh`。安卓 Chrome 地址栏折叠后，真实可视区其实比 `100svh` 大 → `#hall` 底部没铺满 → composer 落在 `100svh` 底端而不是真实可视底端 → 视觉上"离底远"。

弹一次键盘：`chatFocused=true` 触发 focusin → 键盘弹起触发 `vv.resize` → `applyLayout` 按 `vv.height` 写 `#hall.style.height` → 键盘收回 → `focusout` → `applyLayout` 走清空分支 `el.style.height=''` → **理论上应回到 `100svh` 的问题态**，但主人报"收回后距离正常"，说明地址栏在键盘弹起过程中已经折叠，此时 `100svh` 与真实可视高度接近 → 表现正常。

## 修法方向
**未聚焦态也需要 `#hall` 高度贴合真实可视区，不能只靠 CSS `100svh`**。改法：
- `applyLayout` 未聚焦分支不再清空 `#hall.style.height`，改为写 `visualViewport.height`（跟聚焦态一致，都用 vv 作为唯一高度源）
- 页面加载时和 `hall.classList.add('on')` 时主动调 `settleChatLayout()` 同步一次
- `visualViewport.resize` 监听在非聚焦态也生效（地址栏折叠时也能跟）

## 权衡
- 之前 V19 引入 `chatFocused` 分离两种意图：聚焦时按 vv 写、失焦清空退回 CSS。这个设计假设"未聚焦时 CSS 满高就够用"，事实证明**移动端 CSS `100svh` 与 `vv.height` 会有 20-100px 差距**（地址栏、系统栏），假设不成立。
- 简化到只用 vv.height 一个高度源，不再有"清空退回 CSS"分支，反而更简单。
- 唯一风险：桌面浏览器缩放窗口时也会持续写 `#hall.style.height`，需确认 `vv.height=innerHeight` 时不产生多余 reflow（`applyLayout` 已有 `if (el.style.height !== next)` 门槛，值相同不写）。

## 待验
- 桌面 CDP：首次进 hall 时 `#hall.height` 应等于 `vv.height`
- 真机跨平台验证：首次进 hall 输入框距底 15px

## 决策
- 一 commit 一事：只改 applyLayout 未聚焦分支
- 版本三处同步 bump 到 V24
- 禁词铁律
