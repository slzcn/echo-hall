# 键盘协同：小米浏览器（MiuiBrowser）键盘不跟随

- **报告人**：主人（真机截图 + 现象确认）
- **平台**：安卓小米浏览器 MiuiBrowser/20.24.101（Chrome 135 内核），`display-mode=browser`（不是 PWA，之前误判为 PWA）
- **现象**：点输入框弹键盘后，输入框**被键盘盖住、没跟上来、停在原来底部位置**
- **现有版本**：`20260730-kbdebugAndroidV28`

## 真机诊断数据（V28 浮层截图）
未聚焦：`innerH=805 vv.height=805 100svh/dvh/lvh=805 hallH=805 composer底=805 遮挡量=0`
聚焦后 6 帧采样（t0/t100/t250/t450/t700/t1000）**全部相同**：
```
vv=805 stageH=805 框底=790 键盘顶=805 距键盘=15
```
API 信号：
```
VirtualKeyboard API = ✓ 已挂载
VK.overlaysContent = true
VK.geometrychange 次数 = 0   ← 键盘弹起但事件从不触发
vv.resize 次数 = 0            ← visualViewport 从不 resize
window.resize 次数 = 0        ← window 也不 resize
```

## 根因
**MiuiBrowser 用 overlay 方式把软键盘盖在页面上，且不派发任何标准键盘信号**：
- `visualViewport.height` 键盘弹起后仍是 805（不缩小）
- `visualViewport.resize` 不触发
- `VirtualKeyboard.geometrychange` 不触发（即便 API 挂载 + overlaysContent=true）
- `window.resize` 不触发

页面因此完全不知道键盘弹起，`#hall` 保持 805 满屏，composer 贴 805 底 → 被键盘盖住。

iOS / 安卓 Chrome 都遵守标准信号（V23/V24 已修好）；MiuiBrowser 是不标准 WebView，三条信号链全哑。

## 修法：无信号兜底——focusin 后主动探测可视高
既然三条被动事件全哑，只能在 focusin 后**主动多帧轮询**，比对某个"键盘弹起会变"的量。但截图里 innerH/clientH/svh/dvh/lvh **全是 805 不变**——意味着 MiuiBrowser 连这些都不改。

若连 clientHeight 都不变，唯一能感知键盘的量只剩：
- `document.documentElement.clientHeight` vs `window.screen.height` 差值（估算）——不可靠
- **兜底策略：focusin 后按经验值把 composer 上抬一个"估算键盘高度"**，失焦复位。估算键盘高 = 屏高的百分比（安卓中文输入法约 屏高的 35%~42%）。

⚠️ 这是**下策**（估算高度，不同输入法/机型有误差），但对完全不给信号的 WebView 是唯一可行路。优先尝试：先在 focusin 后延迟读一次 `visualViewport` / `clientHeight`，万一 MiuiBrowser 是"延迟才更新"，能拿到真值就用真值；拿不到才落到估算。

## 待验证的关键疑点
截图是**键盘已弹起后**的稳定态采样，6 帧全 805。需要确认：**是不是 MiuiBrowser 压根不 resize（那 innerH 永远 805）**，还是**采样时机没抓到变化帧**。→ 兜底方案里加 innerH 时序日志，focusin 后连续记录 innerH，看它到底变不变。

## 决策
- 不改 iOS / 安卓 Chrome 已好的路径（vv.height 主链保留）
- 只对"三信号全哑"的 WebView 追加 focusin 主动探测兜底
- 一 commit 一事
- 版本三处同步 bump
