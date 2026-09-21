# MiniMax 音乐 API 升级对齐 + 午夜神曲实测

**日期**: 2026-09-21  
**文档**: https://platform.minimax.cn/docs/api-reference/music-generation

## 官方变更(2026-08-20)
- 免费档 `music-3.0-free` / `music-2.6-free` / `music-cover-free` **停止服务**。
- 付费档仅限 Token Plan / 历史付费用户; 新用户不可用。
- 正式域名: `https://api.minimax.cn`; 推荐模型 `music-3.0`; 翻唱两步 `music_cover_preprocess` → `music-cover`。
- 响应: `data.audio` 默认 **hex**; `extra_info.music_duration` 为毫秒。

## 本项目实测(eh-sing-gen)
- `api.minimax.cn` preprocess/music-3.0/cover → **2153** `This Music API is no longer available to new users...`
- `api.minimaxi.chat` → **2049** `invalid api key`
- 结论: **当前账号无法再走 MiniMax 音乐生成**, 与参数无关。

## 现状与兜底
- 生成: `eh-sing-tts` 人声成功(mode=voice), 存桶可播。
- 播放: 无副歌结构时前端「母版伴奏+人声」叠播(journey-exempt)。
- 真 AI 唱歌需: ①恢复 MiniMax 付费 Music 权限/换有效付费 Key ②或改用 MiniMax Audio / 开源 Music3 自建服务。

**验证**: 线上 probe 12s → ok voice + songUrl; 午夜 10867/10868 已补生成。
