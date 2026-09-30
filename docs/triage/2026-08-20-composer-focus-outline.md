# 主聊天输入框聚焦双边框

## 现象
安卓截图中主聊天输入框聚焦时，输入框内部 textarea 出现独立的青色焦点轮廓，与外层 `.cin-wrap` 的 `:focus-within` 边框叠加，右侧形成异常竖线和双层边框视觉。

## 根因假设（单一）
全局 `textarea:focus-visible` 规则给 `.cin` 施加了 `outline:2px solid`，而主聊天输入框同时由 `.cin-wrap:focus-within` 提供焦点态边框；两个焦点指示器叠加，导致截图中的异常线条。

## 修复方案
仅移除主聊天 `.cin` 的自身 focus-visible outline，保留 `.cin-wrap:focus-within` 的外层焦点指示器；其它 textarea、键盘焦点和语义不变。

## 验证
- 新增静态旅程：主聊天输入框仅由 `.cin-wrap` 提供焦点指示器，`.cin` 不覆盖 outline。
- 运行完整 `bash scripts/ci-check.sh`。
- 发布后检查线上资源版本与输入框样式。
