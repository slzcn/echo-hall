# 声音三开关互不干扰 + 本房 BGM 随机循环

**日期**: 2026-09-29

## 诉求
🎵 菜单下的背景音乐 / 音效 / 语音好像互相冲突；背景音乐应随机循环播放本房曲目。

## 根因
1. **`setBgm(false)` 越权**：关背景乐时顺手 `speechSynthesis.cancel()` + `releaseAll()` + `stopVoice()` → 把语音一起杀了，三开关不独立。
2. **本房 BGM 只单曲 loop**：`AudioEngine.start(cfg)` 模式是 `loop`，进房随机选一首后一直重复，不是曲库随机连播。

## 方案
1. `setBgm` 只停/启背景乐（含 override/预览），**不再碰语音/音效**；`setVoice(false)` 只停 TTS+语音消息并放掉对应 hold。
2. 新增 `roomBgmPool(room)`（本房 base+variants）；`startRoomBGM` 改 `AudioEngine.chain(pool)` —— 随机接下一首（避开刚放过）、循环播放。大厅本就走 `chain(bgmPool())`。
3. 菜单脚注「背景音乐 · 随机循环本房曲目」。

## 验证
`journey-audio-mixer` / `journey-audio-exclusive`（契约改为「关 BGM 不误杀语音」）/ `probe-audio-menu` / `journey-game-audio` / `bash scripts/ci-check.sh`
