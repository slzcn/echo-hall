# Echo Bug 诊断单：核心控件无法键盘操作

## 1．用户旅程
键盘／读屏用户进入大厅与房间 → Tab 可聚焦返回、个人空间、回到最新、提醒、更多、表情、反击／格挡等核心控件 → Enter／Space 可触发与点击相同的动作。

## 2．稳定复现
上述控件由 `div`／`span` 实现，仅绑定 click；检查 DOM 可见它们缺少 `role="button"`、`tabindex="0"` 或可访问名称。Tab 跳过，聚焦后也无统一 Enter／Space 行为。

## 3．单一根因假设
核心交互控件没有统一的非原生按钮语义与键盘激活层。

## 4．验证方法
`journey-core-controls-a11y.js` 遍历核心静态控件，断言可聚焦、有按钮语义和可访问名称，并行为执行统一激活函数，确认 Enter／Space 各合成一次 click，其他按键与原生按钮不被接管。内置旧 click-only div 反证必红。

## 5．回归矩阵
- ✅ 鼠标／触屏：保留原 click、pointer、touch 绑定
- ✅ Tab：核心非原生控件进入顺序
- ✅ Enter／Space：统一转发到既有 click 业务
- ✅ 读屏：`role=button` + `aria-label`
- ✅ focus-visible：沿用全局 `[role="button"]:focus-visible`

## 6．修复结果
静态核心控件及动态房间图标、头像、颜色、表情控件补齐语义；新增 `_activateRoleButtonOnKey`，只处理聚焦的 `[role=button]`，不改变原生 button 和鼠标触控路径。

## 7．发布验证
已接入 `scripts/ci-check.sh`；定向旅程通过。整套 CI 结果见交付说明。
