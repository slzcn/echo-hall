# estimatedKbH 键盘收起残留

## §1 现象
`js/keyboard.js` `startKbCollapseWatch()` 只在两个分支清 `estimatedKbH=0`：
1. `activeElement !== chatInput()`（用户点了别处）
2. `window.innerHeight > collapseBaseInnerH + 50`（innerH 回升）
在小米 WebView / 部分 Android 覆盖式键盘设备上，`resizes-content=false` + 系统级"关闭键盘"按钮触发收起时：
- 键盘物理收起
- 输入框仍处于 focus（`activeElement === #cin`）
- innerH 变化 <50px（覆盖式，本就不缩）
两条件都不满足 → `estimatedKbH` 停留在弹起时的估算值 → `visibleHeight()` 一直扣键盘高 → 输入区/hall 下方留白 → 只能重新点输入框再收才复原。

## §2 稳定复现（能在 JSDOM 内造出行为）
- 模拟 focusin → 无信号窗口 → estimatedKbH 被设为 0.38 * innerH
- 触发一次"键盘物理收起"信号：`geometrychange` 上 rect.height=0（V57 后 VK.boundingRect 是主用真值信号）
  - 此时 `visualViewport.resize` 也可能不发（覆盖式）
- 期望：`estimatedKbH` 被清零，`applyLayout` 重跑
- 实际：只有 `geometrychange` 的处理器把它清零；如果设备不发 geometrychange、只发 `visualViewport.scroll` 或纯 `window.resize`（很多小米 WebView 就是这样），估算残留

真正的漏洞是 `startKbCollapseWatch()` 里**没有信号 3**：VK.boundingRect.height 现值等于 0（键盘已收）+ 之前曾非 0（vkGeomHits > baseline）→ 就该清零。代码里注释写着"信号 3"要做，但实际什么都没做（走进 catch 就 return）。

## §3 单一根因
`startKbCollapseWatch()` 信号 3 分支为空实现——真值路径回到 0 时不清 estimatedKbH。

## §4 修法
补齐信号 3：`VK.boundingRect.height === 0` 且 `vkGeomHits > (signalBaseline?.vkHits || 0)` → 视为键盘收起，`estimatedKbH=0`、清定时器、重经布局。

## §5 红灯旅程
`scripts/journey-kb-collapse.js`：
1. 模拟 focusin，走 250ms 无信号窗口 → `estimatedKbH>0`（弹起）
2. 模拟 vkGeomHits 自增 + VK.boundingRect.height=0（键盘物理收起）
3. tick 一次 300ms 轮询
4. 断言 `estimatedKbH===0`
5. 反证：旧信号 3 空实现 → 断言必红

## §6 覆盖面
只改 keyboard.js 补空分支；不新增监听器；不放宽 CI 密度门。
