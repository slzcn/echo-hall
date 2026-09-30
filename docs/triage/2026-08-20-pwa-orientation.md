# Echo Bug 诊断单：安装态强制竖屏

## 1．用户旅程
安装 PWA → 手机／平板／折叠屏旋转横屏 → 应使用页面已有横屏和牌桌布局，而不是被安装态锁回竖屏。

## 2．稳定复现
`manifest.json` 固定 `"orientation": "portrait"`；浏览器页可旋转，而安装态按 manifest 拒绝横屏。

## 3．单一根因假设
早期竖屏锁定未随横屏／折叠屏适配能力更新。

## 4．验证方法
`journey-pwa-orientation.js` 解析真实 manifest，强制 `orientation === "any"`；构造旧 `portrait` manifest 反证必红。

## 5．回归矩阵
- ✅ 手机竖屏／横屏
- ✅ 平板旋转
- ✅ 折叠屏展开
- ✅ 浏览器态不受影响
- ✅ 安装态允许系统方向变化

## 6．修复结果
manifest 的 orientation 从 `portrait` 改为 `any`，不改版本号及其他 PWA 元数据。

## 7．发布验证
方向契约旅程已接入 `scripts/ci-check.sh` 并通过；安装包更新后需设备端旋转冒烟。
