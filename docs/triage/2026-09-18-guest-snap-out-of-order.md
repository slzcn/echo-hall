# Echo Bug 最小诊断单 — guest 快照缺 seq，重连乱序可回退 UI

> 来源：2026-09-18 游戏代码审查。`table-sync.HostController` 已设计 seq，游戏 UI/net 未用。

---

## §1 现象（Reproducibility）

- **设备**：联机 guest
- **OS 版本**：无关
- **运行环境**：任意
- **主题/时段**：无关
- **触发步骤**：
  1. host 广播 snap@seq=N，guest 渲染
  2. 网络抖动/重连：迟到旧包 snap@seq=N-2 或 hello 补帧与在途旧包乱序到达
  3. guest `applySnapshot`/`onSnapshot` 无条件套用
- **预期结果**：guest 丢弃 seq 更旧的快照
- **实际结果**：UI 可能短暂回退到旧公共态（轮到谁/桌面牌/张数）
- **修前视频/GIF**：无（竞态审查）

---

## §2 稳定复现

- ☑ 纯逻辑：`scripts/test-snap-seq.js` — 旧 seq 必拒、更大 seq 必收、无 seq 兼容收下
- ☑ 三游戏 applySnapshot 入口同构，probe 可注入 payload 验证

---

## §3 单一根因假设（Single Hypothesis）

- **本次假设根因**：`poker-net`/`guandan-net`/`ddz-net` 的 `snapshot()` 不带单调 seq；guest `applySnapshot` 无 `snap.seq < lastSeq` 丢弃逻辑。`table-sync` 的 seq 从未接到 UI 广播路径。
- **证据链**：
  1. `js/games/table-sync.js` ~105-108：HostController 带 seq 且注释写明用途
  2. `js/games/poker-net.js` / `guandan-net.js` / `ddz-net.js` snapshot 字段无 seq
  3. `poker-ui`/`guandan-ui`/`game-ui` applySnapshot 无 seq 比较
  4. host 广播点 `app.js` onSync 直接 `chan.send(payload)`
- **可以证伪它的实验**：guest 依序收到 seq=3 再 seq=2，观察状态是否被旧包覆盖
- **证伪结果**：☑ 未被证伪，继续修复

---

## §4 修复方案（Fix Plan）

- **动到的文件**：
  - `js/games/poker-net.js`、`guandan-net.js`、`ddz-net.js`（导出 `acceptSeq`）
  - 三 UI `applySnapshot`（丢弃旧 seq）
  - `js/app.js` host 发送前 `gtStampSnap`（按桌单调递增）
- **动到的函数**：snapshot 发送/接收路径
- **是否会影响其他平台**：否
- **是否会重新暴露以前修过的 bug**：无 seq 的旧客户端快照仍会被接受（兼容）
- **回滚方案**：去掉 stamp 与 accept 即回到无序行为

---

## §5 回归矩阵（Regression Matrix）

| 场景 | 结果 |
|------|:-:|
| 正常逐步快照 | ✅ 单调递增全收 |
| 旧 seq 到达 | ✅ 丢弃 |
| 无 seq 字段（兼容） | ✅ 接受 |
| hello 补帧（更高 seq） | ✅ 接受 |

---

## §6 提交约束（Commit Discipline）

- ☑ 与 resume/remoteSeats 分 commit
- ☑ 版本号同步 + CI

---

## §7 修后确认（Post-Fix Verification）

- **CI 结果**：scripts/ci-check.sh 全部检查通过 ✅（2026-09-18）
