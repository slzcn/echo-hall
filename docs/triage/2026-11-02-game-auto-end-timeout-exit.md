# 诊断单：游戏自动结束 / 超时退出连锁

**日期**: 2026-11-02  
**状态**: 根因假设唯一（H1）— 待复现与单变量验证  
**关联**: v145/v146 超时离座规则；用户反馈「仍旧存在游戏自动结束」

---

## §1 现象

- 打牌中（尤其单人 host 对 AI/灵魂，或桌上只剩自己一个真人）游戏**整桌自动结束/解散**。
- 用户感知：没主动退出，牌局突然没了，回聊天室或弹「牌桌已自动解散 / 桌上没有真人了」。
- 与「超时」高度相关：思考稍久、切后台、弱网下尤其容易触发。

## §2 稳定复现目标

1. **场景 A（设计行为被放大成 bug）**：host 独自对 AI，`actMs` 压到 30ms，连续两次回合超时 → 应观察到 `idleOut→doEnterSpectator→onSeatIdle(vacate)`，随后 `gtCheckNoHumansThenClose` 判 0 真人 → 整桌解散。  
2. **场景 B（误计超时）**：`awaitingHost` 期间误触发 `onHumanTimeout` → `humanAct` 早退但仍 `bumpMiss` → 两次假超时即可离座。  
3. **反证**：修复后场景 A 不应整桌销毁（至少应保留桌面/可再坐，或仅托管不散桌）；场景 B 不应累计 miss。

已有脚本：`scripts/repro-auto-fold.js`（只验证「挂机两次→离座」，**不验证「离座后是否误散整桌」**，故用户仍能撞上自动结束）。

## §3 根因假设（只允许一条）

**H1（主根因）**：v145/v146 把「回合超时×2」与「离座腾 DB 座」绑死，再与 `gtCheckNoHumansThenClose`（0 个非 away 真人 → 5s 后解散）串成链：

```
onHumanTimeout ×2 → bumpMiss≥MAX_MISS(2) → idleOut → doEnterSpectator
  → onSeatIdle({vacate,mine}) → gtLeave + gtCheckNoHumansThenClose
  → seats 无非 away 真人 → gtClose → 「牌桌自动解散」
```

对**桌上只剩自己一个真人**（单机/联机 host 对 AI、或他人都已离座）时，这条链必然把**整局游戏销毁**，而不仅是自己改旁观。用户仍坐在桌前、仍在看牌，却被判「无人」。

**加重因子（同一假设下的实现缝，不另开单）**：
- `poker-ui.js` `onHumanTimeout` 在 `humanAct` 因 `awaitingHost` 早退时**仍** `bumpMiss` → 可产生假超时计数。
- 回合思考窗偏短（德州 15s / 斗地主 10s）×2 即离座；切后台/弱网时计时与补发更易凑满 2 次。
- `gtCheckNoHumansThenClose` 只看 seats 的 human/away，**不看「是否仍有人在桌前观战/本机 session 还在」**。

**不采用的假设（已排除或另单）**：
- H2 `GT_STUCK_MS` 未定义导致 stuck 误杀 — 该引用会 ReferenceError 被空 catch，**不会**触发解散（死代码，另记清理）。
- H3 idleClose 2min 误杀 — v87 已有 `_inGame` 保活，活跃 session 不走该路径。

## §4 状态转换（当前错误链）

| 状态 | 事件 | 下一态 | 用户可见 |
|------|------|--------|----------|
| playing(host, 仅我 1 真人) | 回合超时 #1 | auto-act + miss=1 | toast「超时 · 自动弃牌」 |
| playing, miss=1 | 回合超时 #2 | idleOut → spectating + vacate | toast / 「起身让座」 |
| spectating, seats 无真人 | 5s 后 | closed / cleanup | toast「桌上没有真人了，牌桌自动解散」 |
| playing 且 awaitingHost | 误 timeout | miss++（**bug**） | 无动作却计挂机 |

**期望不变量**：
1. 回合超时只应「代打本回合」，**不得**在「本机仍有活跃观战/唯一真人仍连接」时销毁整桌。  
2. `bumpMiss` 仅在**真实未响应且未成功出牌**时 +1。  
3. 散桌仅当：无人在座 **且** 无活跃观战 **且**（或）超过更长的 reap 窗。

## §5 修复方向（待复现后单变量）

1. **拆链**：`onSeatIdle(vacate)` 后若 `gtCheckNoHumansThenClose` 发现 0 真人，但本机 `_gtPokerSession` 仍为 host/spectator 且 table 未关 → **不 gtClose**，改为保留空桌/旁观，交给 `eh_gt_reap`（5min）回收。  
2. **假超时**：`onHumanTimeout` 仅在 `humanAct` 真正推进后 `bumpMiss`。  
3. **（可选）** 提高 MAX_MISS 或「页面 hidden 不计 miss」——须单独变量验证，避免与 1/2 混改。

## §6 回归矩阵（修完必过）

| 场景 | 期望 |
|------|------|
| host 独自对 AI，两次超时 | 自动代打，**整桌仍在**，可继续/再来一局 |
| host+guest，guest 两次超时 | guest 离座，host 继续；全无真人后才散 |
| awaitingHost 期间不点 | 不累计 miss |
| 主动点「返回/收工」 | 正常离场，可散桌 |
| 5min 无人 reap | 空桌仍可被服务端回收 |

## §7 旅程测试要求

- 新增 `scripts/journey-timeout-no-autodissolve.js`（或扩展 `repro-auto-fold.js`）：  
  - 旧实现（离座后立即 gtClose）必红；  
  - 新实现必绿；  
  - 覆盖：单真人两次超时、假超时不计数、主动离场仍可散桌。
- 本地 `bash scripts/ci-check.sh` 全绿。

## §8 验证记录

- 复现：`node scripts/repro-auto-fold.js` / `journey-timeout-no-autodissolve.js`  
  - 修复前契约（v145）：`spec=true vacate=true` → 连锁 `gtCheckNoHumansThenClose` 整桌销毁。  
  - 修复后：`spec=false vacate=false`，本席仍在座。  
- 单变量 1（三款 `idleOut(mySeat)`）：不再 `doEnterSpectator`，只 toast 代打保座位。  
- 单变量 2（poker/guandan `onHumanTimeout`）：仅真正推进后 `bumpMiss`；未推进重置 `turnSeatActive`，防 remain=0 假两连。  
- 保留：显式旁观仍 `onSeatIdle(vacate)`；远程席超时仍交 AI。  
- `scripts/journey-idle-trustee.js` / `journey-spectator-regression.js` / `journey-timeout-no-autodissolve.js` 全绿（含旧实现反证）。  
- `bash scripts/ci-check.sh` 全绿。

**结论**：H1 成立并已按「拆链 + 防假超时」收敛。空桌回收改依赖显式离场后的 `gtCheckNoHumansThenClose` 与 `eh_gt_reap`。
