# Echo Bug 最小诊断单 — TTS 不影响 BGM + 德州结算数字

> 来源：主人 2026-09-18。「TTS报牌的声音不要影响背景音乐；德州每局结束的结算tips数字不准确」。

## §1 现象
1) 报牌 TTS 会压低/暂停 BGM  
2) 结算 tips 把「底池总额」当成「赢到手」；生涯分可能双计

## §2 根因
1) EhSfx.say 曾 hold EhAudioBus → duck/pause BGM  
2) champLine 用 potTotal（含自己投入）；bumpGameStats + _bankFromPokerResult 双计

## §3 修复
- TTS：不 hold 总线、不 duck BGM；仅 setSfxSoft
- 结算：delta 取 `result.delta[mySeat]`；区分 收池 potWon vs 底池 potTotalAll；文案「净赢/收池」
- 生涯：仅 bumpGameStats 内 bankBump 一次

## §4 验证
`probe-sfx-duck.js`、`journey-audio-exclusive.js`、`test-pk-settle-nums.js`
