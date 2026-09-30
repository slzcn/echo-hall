# 播报没声/声音冲突续修 + 牌桌顶栏换肤

**日期**: 2026-09-29

## 播报没有声音
`EhSfx.say` 先 `speechSynthesis.cancel()` 再 `setTimeout(0)` 里 `speak`：
- 丢掉用户手势链(iOS/严格自动播放下无声)
- cancel 异步会吞掉紧接着的 speak

改为：仅在确有队列时 cancel，随后**同步 `speak`**；手势解锁每次 `resume()`（非仅 paused）。

## 声音仍冲突（续）
`playCfg` 起播/换曲时 `stopVoice()` 掐断语音条；手势唤醒还可能在人声中拉起 BGM。
- `playCfg` 不再 stopVoice，人声中保持静音待其说完
- `kickBgmOnGesture` 在 `EhAudioBus.busy()` 时不拉 BGM

## 牌桌顶栏 🎨 换肤
三款牌桌 🎵 旁加 🎨，点开 `EhThemeMenu`（日夜 + 10 主题），与大厅/聊天页同一套 `pickTheme`/`pickMode`。样式走 `table-shared.css` class，避免 element.style 超密度门禁。

## 验证
`probe-game-theme-btn` 19/19 · `probe-audio-switch-matrix` 25/25 · `journey-audio-mixer` · `journey-table-visual` · `ci-check`
