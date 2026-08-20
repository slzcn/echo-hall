# Echo Bug 诊断单：音频缓存无容量淘汰

## 1．用户旅程
长期播放不同 BGM／神曲 → 离线缓存应有上限并淘汰旧条目，不能无限增长直至浏览器驱逐整站数据。

## 2．稳定复现
`eh-audio-v1` 每个新 pathname 都直接 `cache.put`；原实现没有条目上限、淘汰函数或并发写入收敛机制。连续缓存 20 首时会留下 20 条并继续增长。

## 3．单一根因假设
音频缓存策略只有命中优化，没有生命周期与存储预算。

## 4．验证方法
新增 `scripts/journey-audio-cache-limit.js`：执行真实限额函数并发写入 20 条，断言只保留最近 12 条；同时构造旧 `put-only` 行为，确认会增长到 20 条（旧实现必红）。

## 5．回归矩阵
- ✅ 首次完整 200 音频写入缓存
- ✅ 并发写入串行化，不会共同突破上限
- ✅ 超限按 Cache.keys 顺序淘汰最旧条目
- ✅ 最近 12 条保留供离线播放
- ✅ 清理 Promise 失败由播放路径 catch，不影响本次响应

## 6．修复结果
- `AUDIO_CACHE_MAX_ENTRIES=12`，按单曲数 MB 控制持久缓存预算。
- `cacheAudioResponse` 将 `put → keys → delete` 串行，避免并发竞态。
- `trimAudioCache` 持续删除最旧条目直至回到上限。
- 旅程测试已接入 `scripts/ci-check.sh`。

## 7．发布验证
- ✅ `node scripts/journey-audio-cache-limit.js`
- ✅ `node --check sw.js`
- ✅ 未因本项修改版本号；最终版本一致性由全量 CI 校验。
