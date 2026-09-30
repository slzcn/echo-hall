# Echo Bug 最小诊断单 — 联机「接管座位」只改本地、host 不回座

> 来源：2026-09-18 游戏代码审查。commit `9b4a518` 已自注：`onSeatResume` 当前 app 未接。

---

## §1 现象（Reproducibility）

- **设备**：任意联机客人端 + host 端
- **OS 版本**：无关
- **运行环境**：☑ 任意支持 Realtime 的浏览器
- **主题/时段**：无关
- **触发步骤**：
  1. 真人客人加入牌桌，连超时 `MAX_MISS=3` 次
  2. host 侧 UI `idleOut(seat)` 把该席从引擎 `remoteSeats` 移除 → 本机 AI 托管
  3. 客人本地 `idleOut(mySeat)` → 旁观态出现「🙋 我回来了 · 接管座位」
  4. 客人点击接管 → `resumeSeat()` 只清本地 `spectating` / 定时器
  5. app.js 未传 `onSeatResume`，也无 `resume` 通道事件
- **预期结果**：host 把该席放回 `remoteSeats`，停止 AI 代打，客人动作再次被接受
- **实际结果**：host 仍按 AI 打该席，或客人动作被拒；UI 与权威态脱节
- **修前视频/GIF**：无（审查 + commit 自注）

---

## §2 稳定复现

- ☑ `scripts/journey-gt-online-heal.js`：host `idleOut(remote)` 后 `isRemote` 行为为 AI 托管；`resumeRemote` 后恢复
- ☑ 旧实现反证：不接 `onSeatResume` / 无 `resume` 事件时 host 侧 remoteSeats 不恢复
- ☑ 单机路径已由既有 `probe-resume-seat.js` 覆盖（不回归）

---

## §3 单一根因假设（Single Hypothesis）

- **本次假设根因**：`9b4a518` 只实现了三游戏 UI 内的 `resumeSeat()` + 预留 `onSeatResume` 钩子，但 `js/app.js` 的 guest `open()` 未注入该回调，host 通道也未监听 `resume`；引擎侧亦无 `resumeRemote(seat)` 把超时移出的远程席放回。
- **证据链**：
  1. `js/games/poker-ui.js` ~573/615：钩子存在，guest open 未传
  2. `js/app.js` `gtEnterPoker/Guandan/Ddz`：仅 `onAction`，无 `onSeatResume`
  3. host `act`/channel 仅有 `act`/`hello`，无 `resume`
  4. 三游戏 `idleOut` 对远程席 `remoteSeats.splice`，无对称恢复 API
- **可以证伪它的实验**：guest `resumeSeat` 后观察 host `remoteSeats` 是否包含该席；不接线时必不含
- **证伪结果**：☑ 未被证伪，继续修复

---

## §4 修复方案（Fix Plan）

- **动到的文件**：
  - `js/games/poker-ui.js`、`js/games/guandan-ui.js`、`js/games/game-ui.js`（导出 `resumeRemote`）
  - `js/app.js`（guest 注入 `onSeatResume` 发 `resume` 广播；host 监听；`act` 路径对 DB 仍为真人席自动 `resumeRemote`）
- **动到的模块/函数**：三 UI 的 `idleOut`/`resumeSeat` 邻域；`gtEnter*`；`gtWireHostChannel`/`gtLaunch*`
- **是否会影响其他平台**：否
- **是否会重新暴露以前修过的 bug**：不改超时计数语义；单机 `resumeSeat` 行为保持
- **回滚方案**：revert；guest 不发 resume 时行为退回修前

---

## §5 回归矩阵（Regression Matrix）

| 场景 | iOS Safari | iOS PWA | Android Chrome | Android PWA | MIUI 浏览器 |
|------|:-:|:-:|:-:|:-:|:-:|
| 单机超时→接管 | ✅ 既有 probe | ✅ | ✅ | ✅ | — |
| 联机超时→接管→host 回座 | ✅ probe | ⏳ | ⏳ | ⏳ | ⏳ |
| 接管后 AI 不抢牌 | ✅ probe | ⏳ | ⏳ | ⏳ | ⏳ |
| 未超时席 resumeRemote 无害 | ✅ probe | — | — | — | — |

---

## §6 提交约束（Commit Discipline）

- ☑ 单一主题：联机 resume 回座接线
- ☑ message 不用「真修/终于」
- ☑ 无 SQL 变更（DB 座位本就保留真人行；idleOut 未落库离座）
- ☑ 版本号同步 + CI 全绿

---

## §7 修后确认（Post-Fix Verification）

- **CI 结果**：scripts/ci-check.sh 全部检查通过 ✅（2026-09-18）
- **合入 main 时间**：待提交/推送后填
- **合入后 24h 有无线上反馈**：待观察
