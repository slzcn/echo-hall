# 体检 1-3 补齐：开桌页每日剩余常驻 · 神曲形态标注 · 关键路径日志

**日期**: 2026-09-28

## 1. 开桌页常驻「今日还可玩 N 次」
**现象**: 每日剩余只在剩 ≤2 时 toast，开桌前看不到还能开几局。
**方案**: `ehDailyLeftTip`/`ehDailyLeftBadge`/`ehDailyLeftInline` 常驻徽章；挂到斜杠菜单游戏命令、三桌招募态提示行、三款战绩卡「再来一局」旁。剩 0/≤2/正常 分色。

## 2. 神曲卡片更早标明形态
**现象**: 谱曲中/生成完只写「谱曲中」「播放」，易被当成坏了或以为是真歌。
**方案**: 卡片常驻 `song-kind` 徽章——生成中「AI 谱曲中」，好了「伴奏+人声/清唱 · 本地试听」；曲风条标签改「AI 谱曲 · 本地试听」；超时态写明可本地试听/重试。

## 3. 关键路径空 catch 接 `_ehCatch`
**现象**: 约 285 处 `catch(_){}`，加载/token/身份/每日/牌桌 RPC/神曲失败静默。
**方案**: 游戏加载/重开、songToken/resolveToken、saveIdentity/loadIdentity、每日门禁、gtReap/gtSeatClone、sendSong、神曲队列条等关键路径进 ring buffer（`ehDumpLog()` / `?debug=1` 可查）；修正 visibilitychange 误标 scope。

**验证**: `scripts/journey-eh-polish.js` 全绿 + `bash scripts/ci-check.sh`

## 附: 修好挡住 push 的既有 CI 红
1. **斗地主终局战报缺失**: `applyMove` 漏处理 `double` 加倍轮 → 同步驱动卡死; `sfx` 抛错会吃掉 `overSoon`。现 `applyMove` 认 `double`, 终局 beat 在 `overSoon` 先发(不跟亮牌定时器)。
2. **视觉回归假红**: 德州断言仍按旧 DOM(我已坐椭圆 `.pk-me-seat`, 底牌在 `.pk-my-hole`); 卡背断言仍要暗玻璃, 实际已是白边青花。断言对齐现设计。
3. **中央落牌 3px 溢出**: `layoutPlayed` `Math.round` 亚像素顶出; 改 `floor-1` + 溢出再收紧。
