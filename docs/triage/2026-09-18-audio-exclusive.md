# Echo Bug 最小诊断单 — BGM / 音效 / 语音冲突叠播

> 来源：主人反馈 2026-09-18。「背景音乐和音效和语音好像有冲突…音乐和语音不能一直、同时播放」。

## §1 现象
- 牌桌/聊天中 BGM + 出牌音效 + 报牌 TTS / 语音消息同时响
- 人声被埋；音乐与语音长时间并行

## §2 稳定复现
- ☑ 旧 duck 仅把 BGM 降到 0.12，仍与人声同时播
- ☑ SFX 不感知人声，发牌/出牌音与 TTS 叠
- ☑ 语音消息与 TTS 可叠
- ☑ `scripts/probe-audio-exclusive.js` + 既有 `probe-sfx-duck.js`

## §3 单一根因假设
缺少全局「人声互斥总线」：BGM 只 duck 不 pause；音效无人声态；多路人声可并行。

## §4 修复方案
- `sfx-engine.js`：`EhAudioBus` hold/release 引用计数；人声期间 BGM 淡 0 并 pause、SFX 变软且跳过非关键音；BGM start 时 cancel TTS
- `app.js`：语音消息/神曲 hold/release；`window.stopVoice` 供引擎打断
- 开关：关语音 releaseAll tts

## §5 回归
| 场景 | 结果 |
|------|:-:|
| TTS 中 BGM 不响 | probe |
| 语音结束 BGM 恢复 | probe |
| 人声中发牌音被跳过 | probe |
| BGM 起播打断 TTS | probe |

## §6–§7
随 release CI 合入。
