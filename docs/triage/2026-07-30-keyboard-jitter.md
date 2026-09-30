# 键盘协同：点击后上下抖动

- **报告人**：主人（真机验证 V22 后）
- **平台**：真机（安卓/iOS 未细分，主人未指明；假设跨平台）
- **触发条件**：`#hall` 加载完后点击 `#cin` 输入框，键盘弹起过程中输入框位置上下抖动几次才稳定
- **现有版本**：`20260730-kbHallSimpleV22`（commit f74f5bf）

## 现象
- 点击输入框，输入框先跳一次、再跳一次，最后才稳定在键盘上方 15px
- 视觉上"多次跳变"而不是"一次平滑到位"

## 结构假设定位
`js/keyboard.js` `focusin` 分支目前调用 `settleChatLayout()` 后又追加 5 个定时任务：`[100,250,450,700,1000].forEach(ms => setTimeout(settleChatLayout, ms))`。
- 键盘弹起真实过程约 200-400ms 分几阶段：`focusin` → `resize`（vv 缩） → geometry 稳定
- 每次 `settleChatLayout` 都会读取当前 `visualViewport.height` 或 `keyboardRect` 立即写 `#hall.height`
- **问题**：在键盘弹起过渡帧上采样的高度就是错的（还没到最终值），写进去再校正 → 视觉抖动
- V19-V22 一路加"多次采样兜底"是为了确保安卓 PWA 慢响应时最终跟上，但 V22 已经改用 VirtualKeyboard `geometrychange`（安卓 PWA 有原生几何信号）+ VisualViewport `resize`（其他平台有原生信号），**这两个信号本身就是"稳定态触发"**——多次延迟采样纯属冗余

## 修复方向
- 删除 `focusin` 后所有 setTimeout 补采样
- 只保留三个稳定态信号触发：VisualViewport `resize`、VisualViewport `scroll`、VirtualKeyboard `geometrychange`
- `focusout` 同理删除 100/300/600 三个 setTimeout
- 若真机验证发现某平台没有稳定信号，回补该平台单个延迟（而不是五个）

## 待验
- 桌面 CDP 三态回归：`focus/blur` 后间距恒 15、`#hall` 高度只写一次（不是多次）
- 真机跨平台验证：抖动消失

## 决策
- 一 commit 一事：只删定时器不动其他
- 版本三处同步 bump 到 V23
- 禁词铁律：不用"真修/终于/真凶/彻底解决"
