# Service Worker 换版后脚本缓存失效

## §1 现象

每次 Echo 发版并激活新 Service Worker 后，下一次打开会重新下载全部带版本指纹的本地脚本。当前本地脚本约 1.2 MB，弱网下会放大刷新等待。

## §2 稳定复现

1. 在旧 Service Worker 的 `eh-js-v1` 中放入带 `?v=` 的脚本缓存项。
2. 激活当前 Service Worker。
3. 旧 `activate` 逻辑无条件删除 `k === JS_CACHE`，整个 `eh-js-v1` 消失。
4. 新页面即使大部分脚本指纹未变，也只能全部重新下载。

## §3 单一根因假设

`activate` 把持久 `JS_CACHE` 当成旧 shell 缓存删除。脚本 URL 已带内容指纹，且 `serveVersionedJs()` 会在单个路径下载成功后清理该路径旧指纹，不需要整库清空。

反证：旧实现必须包含 `k === JS_CACHE` 的激活期删除条件；移除后，激活只清旧 shell/CDN 缓存，`eh-js-v1` 保留，单路径旧指纹仍会收敛。

## §4 修复方案

- `activate` 不再删除 `JS_CACHE`。
- 保留 `serveVersionedJs()` 的同 pathname 旧指纹清理。
- 新增静态行为测试，验证持久缓存契约并反证旧实现。

## §5 回归矩阵

- [x] JavaScript / Service Worker 语法检查
- [x] 版本三处一致
- [x] PWA 缓存行为测试
- [x] 完整 `scripts/ci-check.sh`：全部检查通过

## §6 提交约束

本提交只修改 Service Worker 缓存生命周期、对应测试、诊断单和版本标记。

## §7 修后确认

`node scripts/test-sw-versioned-js-cache.js` 当前实现三组断言通过；测试内把 activate 模拟为旧实现 `|| k === JS_CACHE` 时稳定失败。全量 `bash scripts/ci-check.sh` 已通过。
