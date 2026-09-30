# 混合设备硬件键盘误缩

## §1 现象
平板／折叠屏连接硬件键盘时，输入框 focus 但视口无变化，旧无信号 fallback 仍按可视高 39% 估算软键盘，聊天区域被错误压缩；部分触屏设备上报 pointer:fine 又会完全跳过真实软键盘几何。

## §2 稳定复现
模拟 maxTouchPoints>0、pointer:fine、focus 输入框且 VV/VK/innerHeight 均无变化。旧媒体判断要么完全不管理，要么 coarse 场景直接估算 39%。

## §3 单一根因假设
把“设备是否可能有软键盘”和“无信号时是否允许百分比估算”合并成一个 coarse 媒体判断。

## §4 不变量
触屏混合设备仍接收真实几何；无真实几何时，fine pointer 不做百分比估算；coarse 触屏保留现有 WebView fallback。

## §5 修复
拆分 `hasTouch()` 与 `allowNoSignalEstimate()`：布局控制看触屏能力，39% fallback 仅 coarse+hover none。

## §6 验证
新增 mixed-input 旅程和旧实现反证。

## §7 结果
待门禁回填。
