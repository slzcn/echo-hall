# 德州每日锁其他游戏 + 神曲只念不唱

**日期**: 2026-09-21

## Bug1: 德州 5 次后不能玩其他两款
**根因**: `eh_daily_plays_v1` 全局一个 `n`, 三款游戏共用; `ehDailyPlayGate()` 不分游戏。
**方案**: 计数改 `{date, nlhe, doudizhu, guandan}`; 门禁/发牌 `reached(game)`/`bump(game)`; 文案「今日德州…其他游戏不受影响」。

## Bug2: 神曲在「读」不在「唱」
**根因**: 线上 `MINIMAX_API_KEY` 实为 64 位 hex 摘要(非 MiniMax JWT), music_generation 鉴权失败; Edge 退 `eh-sing-tts` → 听感=朗读。
**方案**:
- eh-sing-gen: 非清唱不再用 TTS 冒充唱歌; 歌词用 [Verse]/[Chorus]; 支持 hex/base64/异步 task。
- 前端失败时 **伴奏+人声**: 公网母版 + eh-sing-tts 叠播, 至少有旋律床。
- **主人需把 Supabase secret `MINIMAX_API_KEY` 换成真实 MiniMax JWT** 后, AI 翻唱才会真正「唱」。

**验证**: journey-chip-authenticity / journey-song-public + ci-check
