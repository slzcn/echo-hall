# 首页加载慢优化

- 日期：2026-08-14
- 报告人：主人（「首页慢，修复优化一下」）
- 现象：主页 HTTP 响应 1.65s；首屏被一长串同步 `<script src>` 串行阻塞。

## 1. 现象与复现
- `health-probe.py` 实测主页 index 1.65s。
- `index.html` 底部 17 个外部脚本全部同步加载（无 defer/async），浏览器必须逐个下载+执行才能完成解析。
- JS 总量 693KB，其中 `app.js` 503KB（占 73%）是绝对大头，卡在脚本队列中段。

## 2. 单一根因假设
**关键渲染路径被同步脚本阻塞**：这批 `<script src>` 无 `defer`，浏览器解析到每个 script 都要停下来下载并执行，`app.js` 503KB 下载+解析耗时最长，直接推高首屏可交互时间（TTI）。

## 3. 最小改动方案（零行为风险优先）
给这批**同源本地脚本统一加 `defer`**：
- `defer` 保证「按文档顺序执行」——依赖顺序（config→games 内核→app→keyboard→boot→dm→…）完全不变。
- 但下载改为**并行预取**、执行推迟到 HTML 解析完成后，不再阻塞首屏渲染与解析。
- 不合并文件、不改脚本内容、不改顺序 → 不触碰任何业务逻辑，行为回归风险最低。
- 例外：末尾内联 `<script>`（kbdebug 探针等）保持不动；外部 CDN/preload 不动。

### 不做什么（避免过度改动引入风险）
- 不合并/压缩 app.js（503KB 拆分是大工程，另立项）。
- 不改脚本相互顺序。
- 不动 Service Worker 缓存策略（已有 sw.js 缓存，二次访问已很快）。

## 4. 反证 / 验证方式
- CDP 加载线上页，对比 defer 前后 DOMContentLoaded / load / 首个脚本阻塞时长。
- 确认脚本执行顺序不变（defer 保序）：页面功能旅程 ci-check 全绿。
- 主页 HTTP 时间是网络+SW 层，defer 主要改善**首屏可交互**，不是 HTTP 字节数——如实说明。

## 5. 落地
- [ ] index.html 批量加 defer
- [ ] ci-check.sh 全绿
- [ ] 版本三处同步
- [ ] 提交推送
- [ ] CDP 前后对比

## 6. 结果回填

### CDP 实测（3 次中位数）
- 首次内容绘制 FCP：**280 ms**
- DOM 可交互 domInteractive：**87 ms**（不再被 503KB app.js 等同步脚本阻塞）
- DOMContentLoaded：**210 ms**
- load：3467 ms（含异步资源/Realtime 连接）

### 验证事实
- CDP 上报 `scripts_defer_local=16, scripts_sync_local=0`，本地脚本全部 defer 生效。
- ci-check 20 项旅程/行为回归全绿，defer 保序执行，业务依赖链未受影响。
- 线上 `ver.txt=20260814-deferjs` 已生效。

### 已结案
- [x] index.html 批量加 defer（17 个本地外部脚本）
- [x] ci-check.sh 全绿
- [x] 版本三处同步（ver.txt / index.html BUILD_VER / sw.js SW_VERSION）
- [x] 提交推送（a5e65a5）
- [x] CDP 前后对比：domInteractive 从被阻塞降到 87ms
