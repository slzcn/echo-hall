# Echo — 全部收尾批次

> 主人: 不要再问，直接开干，全部干完

## 本批
1. **messages 扩展**: 语音 URL 白名单、消息类型文案、流式 kind、回声 bump
2. **voiceHtml** 接 `isTrustedVoiceSrc`
3. **空 catch**: 通道清理/BGM/去重/预取等关键路径 `_ehCatch`（约 270→257）
4. **auth/bgm** 前序已迁; **requireViaRpc** 已开
5. **journey-finish-all.js** 契约

## 验证
ci-check 全绿 · 版本 20260920-finish-all
