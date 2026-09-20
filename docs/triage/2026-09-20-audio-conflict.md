# BGM / 音效 / 语音 冲突修复 + 后台轮到弹窗

**日期**: 2026-09-20

## 音频冲突
**现象**: BGM、音效、语音互抢/不完整。
**根因**:
1. TTS `say()` 结束时无条件 `setSfxSoft(false)`, 神曲仍 hold 时音效被提前放开。
2. TTS 在神曲/聊天语音播放时 `speechSynthesis.cancel()`, 砍断歌词 → 总线泄漏, BGM 永久压死。
3. TTS 不 hold 总线 → 报牌与 BGM 同时响。
4. 关 BGM 只 `releaseAll('tts')`, song/voice 占用残留。
5. 大厅静音后牌桌 🎵 图标不刷新。

**方案** (`sfx-engine.js` / `app.js` / 三游戏 UI):
- TTS `hold('tts')`/`release('tts')`; 神曲/语音 `busyExcept('tts')` 时直接 return。
- softOff 走 `_sfxSoftByBus()`。
- `EhAudioBus.has/busyExcept/counts`; setBgm(false) `releaseAll()` 全清。
- `eh:audio-prefs` 事件同步牌桌音频图标。

## 后台轮到自己弹窗
**方案**: `_notifyMyTurnPopup` — Notification `requireInteraction` + body + tag 去重 + click focus; 开桌 `requestPermission`; 后台 **或** PiP 折叠且轮到我时提醒; 1.8s 轮询。

**验证**: `journey-audio-mixer.js` / `journey-audio-exclusive.js` / `journey-turn-notify.js` + ci-check
