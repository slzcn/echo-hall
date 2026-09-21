# 文字神曲 → 公网 Supabase 部署

**日期**: 2026-09-20  
**诉求**: 梳理大模型能力, 文字神曲最佳实现, 摆脱内网依赖。

## 现有能力（线上已部署于 Supabase）
| 能力 | 入口 | 说明 |
|------|------|------|
| 神曲·清唱 | `functions/v1/eh-sing-tts` | 公网 Edge, 返回 PCM/WAV base64 |
| 神曲·翻唱 | `functions/v1/eh-sing-cover` | MiniMax music-cover + 母版 |
| 灵魂 BGM | `functions/v1/eh-bgm-gen` | 生成伴奏 |
| 歌曲 worker | `functions/v1/eh-song-worker` | 旁路补生成(非主路径) |
| 牌桌/灵魂 AI | 前端本地 | **不用大模型** |

Secrets 中已有 `MINIMAX_API_KEY` 等; 母版在 GitHub Pages `masters/`.

## 最佳实现（本批）
1. **清唱主路径**: 前端直调 `eh-sing-tts`(JWT) → PCM→WAV → 立即播放 + 上传 `eh-song` + 回写 `eh_messages`。
2. **翻唱主路径**: 维持 `eh-sing-cover` + `masters/manifest` + 母版 intro 预览。
3. 失败仍本地 Web Audio/TTS 兜底, 不再依赖内网 worker。

**验证**: `journey-song-public.js` + ci-check
