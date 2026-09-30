# 空位入座 / 预选回归 / 筹码避牌 / 无真人散桌

**日期**: 2026-09-30

## 1. 空位「点击入座」没反应
空位 click 原先 `spectating` 才入座，否则弹邀请菜单 —— 与文案不符。改为**点击=入座**，邀请改长按；`_gtGrabSeat` 先拉最新桌行、已在座直接进桌、失败分因提示（下一手再试/座位刚被占）。

## 2. 「牌局已开始，进不去了」
`eh_gt_join` 对 nlhe playing 本可进；提示过硬且本地脏行导致误判。文案改「这局暂时入不了座，下一手或点空位再试」；入座前 `gtEnsureRow` 拉新。

## 3. 预选功能回归 + 去粘性选中
恢复「跟任意注/过牌/过牌或弃牌」预选；`.on` 高亮改 `.queued` 小圆点，手动出牌/新一手即清。

## 4. 无真人自动散桌
`gtCheckNoHumansThenClose`：无「在座」真人（away 不算）1.5s 后自动 `gtClose`；每手结算 + realtime 座位变化都查。

## 5. 下注筹码压公共牌
commit 落点按 `els.board`/`pot` 真实矩形避让，不再压牌/底池。

**验证**: `probe-poker-two-player` 17/17 · `journey-poker-play` · `journey-ui-consistency` · `ci-check`
