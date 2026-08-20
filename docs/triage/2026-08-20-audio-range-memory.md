# Echo Bug 诊断单：音频 Range 造成整文件内存峰值

## 1．用户旅程
播放已缓存音频 → 拖动进度 → 浏览器请求 Range → 应返回正确字节范围，且不能把完整音频反复复制进内存。

## 2．稳定复现
`serveAudio()` 对每个 Range 都执行完整 `arrayBuffer()` 再 `slice()`；后缀 Range 解析错误，非法范围退回整文件 206。

## 3．单一根因假设
SW 试图用 Cache API 中的完整 Response 手工切片，受限于 API 必须全量读取，且 Range 解析未完整实现规范。

## 4．验证方法
新增 Range 旅程覆盖普通、开放端、后缀、非法范围；修复后缓存命中 Range 不再走全量 arrayBuffer 切片路径。

## 5．回归矩阵
- ✅ 无 Range 完整播放：完整体仍为持久缓存优先，miss 时网络 200 后写缓存
- ✅ 普通 Range：`bytes=2-4` 返回 206、正确 `Content-Range` 与 3 字节正文
- ✅ 开放端 Range：`bytes=7-` 返回 `bytes 7-9/10`
- ✅ 后缀 Range：`bytes=-3` 返回 `bytes 7-9/10`
- ✅ 416 非法范围：越界、倒序、错误单位、非法文本与多段 Range 返回 `Content-Range: bytes */10`
- ✅ 断网完整缓存播放：Range 网络失败后才读取完整缓存，以 `Blob.slice()` 构造规范 206；无缓存返回 504

## 6．修复结果
带 Range 的请求改为优先原样 `fetch(req)`，由源站流式返回 206，不再为了每次 Range 主动下载完整 MP3。仅网络失败且存在完整缓存时进入离线降级；解析单段 Range 后用 Blob 切片，删除旧实现的完整 `arrayBuffer()` 加二次 `slice()` 内存路径。

`parseAudioRange()` 明确覆盖普通、开放端、后缀范围，并对越界、倒序、错误单位、空值及多段请求返回 416。独立旅程包含旧解析器将 `bytes=-3` 错当从 0 开始的反证。

## 7．发布验证
- `node --check sw.js`：通过
- `node scripts/journey-sw-audio-range.js`：通过（含无 Range 完整体、在线透传、离线缓存降级、无缓存 504）
- 修复前同一旅程失败证据：首个网络请求 `Range` 为 null（旧实现先请求完整体），退出码 1
- `bash scripts/ci-check.sh`：全部功能套件通过；仓库既有危险 API 密度门在 `addEventListener: 120`（上限 118）处失败。本次仅改 SW 已有 install/fetch 回调内部逻辑，未新增 `addEventListener`。
