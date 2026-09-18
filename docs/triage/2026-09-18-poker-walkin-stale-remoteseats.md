# Echo Bug 最小诊断单 — 德州中途入座 act 被 stale remoteSeats 拒

> 来源：2026-09-18 游戏代码审查（非真机报障）。§2 用自动化 probe 作稳定复现路径。

---

## §1 现象（Reproducibility）

- **设备**：桌面 Chrome（probe）/ 联机任意客户端
- **OS 版本**：macOS（probe）；联机路径与 OS 无关
- **运行环境**：⬜ Safari  ⬜ Safari-standalone-PWA  ☑ Chrome  ⬜ Chrome-PWA  ⬜ MIUI 浏览器  ⬜ 德信内嵌  ⬜ 其他：______
- **主题/时段**：无关
- **触发步骤**（联机德州 · host 以 playing 态进桌后）：
  1. host 通过牌桌卡「进入牌桌」走 `gtLaunchPoker`（非 lobby 路径），此时 `const A=gtSeatArrays(row)` 固化
  2. 真人 B 中途点空位/AI 席「顶替」入座 → realtime 更新 `eh_game_tables.seats`
  3. host 引擎 `updateRoster(gtSeatArrays(row))` 已把 B 标成真人（下一手生效）
  4. B 出牌 → host `act` 处理器仍用启动时冻结的 `A.remoteSeats`，B 的 seat 不在其中
- **预期结果**：B 的动作被 host 引擎校验后应用
- **实际结果**：动作被静默 return；B 席卡住直至超时被 idleOut 转 AI
- **修前视频/GIF**：无（代码审查发现；probe 覆盖行为反证）

### 关键运行时数值

不适用（非键盘/布局类）。

---

## §2 稳定复现

- ☑ 自动化 probe 连续多次可复现（`scripts/journey-gt-online-heal.js` 旧实现反证：冻结 A 拒新席 / 现算 A 放行）
- ☑ 单环境即可判定逻辑缺陷（act 过滤与 DB 座位源不一致）
- ☑ 修前行为由测试断言（旧写法必红）

**说明**：本单为审查发现的联机逻辑缺陷，复现载体是内存总线 + 引擎 UI probe，不依赖特定机型传感器。

---

## §3 单一根因假设（Single Hypothesis）

- **本次假设根因**：`gtLaunchPoker` / `gtLaunchDdz` / `gtLaunchGuandan` 的 host `act` 处理器在开桌时固化 `const A=gtSeatArrays(row)`，此后 `A.remoteSeats` 不再随 `_gtTables` 更新；而招募态 `gtWireHostChannel` 每次 act 都现算，行为不一致。
- **证据链**：
  1. `js/app.js` `gtLaunchPoker` ~2653：`const A=gtSeatArrays(row)` 一次求值
  2. 同文件 act 分支 ~2664：`A.remoteSeats.indexOf(payload.seat)<0 → return`
  3. realtime ~2172：仅调用 `_ehGame.updateRoster(...)`，不回写闭包里的 `A`
  4. 招募态 `gtWireHostChannel` ~2498 每次从 `_gtTables.get` 现算 — 对照路径正确
- **可以证伪它的实验**：构造 `row.seats` 变更后，对比「冻结 A」与「现算 A」对同一 payload.seat 的放行结果
- **证伪结果**：⬜ 已证伪，本假设排除  ☑ 未被证伪，继续修复

---

## §4 修复方案（Fix Plan）

- **动到的文件**：
  - `js/app.js`（host act 过滤改为现算；抽 `gtLiveSeatArrays` / `gtAcceptRemoteAct`）
- **动到的模块/函数/行号区间**：
  - `gtWireHostChannel`、`gtLaunchPoker`、`gtLaunchDdz`、`gtLaunchGuandan` 的 `act` 分支
- **是否会影响其他平台**：否（联机 host 逻辑，与渲染层无关）
- **是否会重新暴露以前修过的 bug**：不改 idleOut/超时语义；与 #61 座位越权加固同向（更信 DB 座位）
- **回滚方案**：git revert 本次 app.js 中 act 过滤改动

---

## §5 回归矩阵（Regression Matrix）

| 场景 | iOS Safari | iOS PWA | Android Chrome | Android PWA | MIUI 浏览器 |
|------|:-:|:-:|:-:|:-:|:-:|
| 大厅进入 | — | — | — | — | — |
| 牌桌卡进桌（host） | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| 德州中途顶替入座 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| 远程真人出牌 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| 旧席/非法 seat 仍被拒 | ✅ probe | ✅ probe | — | — | — |

逻辑层 probe 全绿；真机联机矩阵待线上验证。

---

## §6 提交约束（Commit Discipline）

- ☑ 本 commit 只修一个 bug（stale remoteSeats）
- ☑ commit message 描述现象+根因+方案，不用「真修/终于/真凶」
- ☑ 无数据库字段变更
- ☑ 版本号三处同步
- ☑ 本地 `scripts/ci-check.sh` 全绿（已达成）

---

## §7 修后确认（Post-Fix Verification）

- **修后视频**：无（probe 断言代替）
- **CI 结果**：scripts/ci-check.sh 全部检查通过 ✅（2026-09-18）
- **回归矩阵通过率**：probe 覆盖逻辑路径
- **合入 main 时间**：待提交/推送后填
- **合入后 24h 有无线上反馈**：待观察
