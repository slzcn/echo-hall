# Echo Bug 诊断单：首次安装离线只剩页面壳

## 1．用户旅程
首次访问并安装 PWA → 首屏加载完成 → 断网 → 重新打开 → 应完整进入可交互应用，而不是只有 HTML 静态壳。

## 2．稳定复现
安装阶段 `SHELL_ASSETS` 仅含 `./` 与 `index.html`；业务脚本首次加载早于 SW 接管，断网重开时关键脚本可能未缓存。

## 3．单一根因假设
SW 安装阶段未从当前 `index.html` 解析并预缓存同源关键脚本／样式资源。

## 4．验证方法
新增首次安装离线旅程：构造安装缓存后断网，断言首页引用的同源关键资源全部可命中；旧实现必红。

## 5．回归矩阵
- ✅ 在线首次加载：安装时网络读取 `index.html`，不改变正常页面请求路径
- ✅ 安装后离线重开：同源 `script[src]` 与 `link[rel=stylesheet]` 可从对应缓存命中
- ✅ 单个可选资源失败不拖垮整批缓存：逐资源捕获失败并用 `Promise.allSettled()` 汇总
- ✅ 版本资源指纹更新：带 `?v=` 的本地 JS 写入持久 `JS_CACHE`，与运行时读取路径一致

## 6．修复结果
`installOfflineShell()` 从本次网络获取的 `index.html` 提取同源脚本与样式；HTML／CSS 写入版本 shell 缓存，带指纹 JS 写入持久 JS 缓存。跨域依赖不纳入 shell 预缓存，任一资源下载失败仅跳过该项，不阻断 SW 安装或其他成功项。

独立旅程 `scripts/journey-sw-offline-install.js` 执行真实 install 回调，并包含旧版仅缓存 `./` 与 `index.html` 时关键 JS 缺失的反证。

## 7．发布验证
- `node --check sw.js`：通过
- `node scripts/journey-sw-offline-install.js`：通过
- `node scripts/test-sw-versioned-js-cache.js`：通过
- 修复前同一旅程失败证据：`AssertionError: caches same-origin script`，退出码 1
- `bash scripts/ci-check.sh`：全部功能套件通过；仓库既有危险 API 密度门在 `addEventListener: 120`（上限 118）处失败。本次仅改 SW 已有 install/fetch 回调内部逻辑，未新增 `addEventListener`。
