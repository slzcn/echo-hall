# 2026-08-20 折叠屏输入法/输入框协同回归

## 现象
用户在折叠屏上再次遇到输入框与软键盘协同错位。上一轮 V62 策略级重写（`e2baada`）+ 空 resize 保留估算（`bde1d55`）+ 折叠屏展开重建（`b74c2e0`）+ 键盘弹起中转屏双减修复（`3910511`）+ 覆盖式收起残留（`b71b6bf`）已经全部合入，且有本地反证测试守着。

## 已知回归门禁位置
- `scripts/journey-fold-keyboard-*.js`（折叠屏键盘系列旅程）
- `scripts/journey-vk-orientation-double-minus.js`
- `scripts/journey-kb-close-residual.js`
- `scripts/journey-kb-empty-resize-preserve.js`
- `scripts/journey-android-fold-ime-safe-gap.js`

## 定位计划
1. 用 `git log -p -- 'js/*keyboard*' 'js/*layout*' 'js/*chat*'` 复审过去 7 天键盘/布局相关改动。
2. 用现有回归脚本在本地跑一次，看是否有已经被沉默降级或断言绕过的场景。
3. 如所有既有旅程都绿，则本次现象大概率是折叠屏「展开→键盘弹起→折叠 / 键盘再收起」这类切换态没被覆盖，或最近刷新优化 `sw-register.js / index.html` 改动对布局初始化时序产生副作用。
4. 用 CDP 或 headless 手动构造折叠屏几何切换的时序，抓出坏轨迹。

## 修复原则
- 单变量假设：一次只改一条分支。
- 修复必须让旧实现被反证抓红，且现有反证不能被削弱。
- 不改探测房外数据，不动 SW 广播 / 版本号规则。
