# PWA 斗地主牌桌偏小

**日期**: 2026-09-20  
**现象**: 主人截图 — PWA 竖屏下斗地主牌面/绒面桌心偏小, 竖向留白多、观感空。

**根因**: 手机宽度 <600px 走最小档 `--cw:44px`; 竖屏中央 `min-height:96px` + 椭圆 inset 5%~8%, 桌心被压成小盘; PWA 无地址栏本可更大却无加成。

**方案**:
- `game-ui.js`: 手机竖屏斗地主牌 50×70、中央 min-height 150、椭圆吃满; `html.pwa-standalone` 再放一档 54×76 / min-height 180。
- `table-shared.css`: 掼蛋/德州 PWA 竖屏牌面与桌心同步放大。

**验证**: `node scripts/journey-ddz-pwa-size.js` + ci-check
