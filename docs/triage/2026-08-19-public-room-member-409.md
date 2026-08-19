# 诊断单：公开房重复进房触发 eh_members 409

## §1 现象（Reproducibility）

- **设备**：健康探测用桌面 Chrome CDP
- **OS 版本**：macOS 26.6.1
- **运行环境**：Chrome，线上 GitHub Pages
- **触发步骤**：
  1. 打开线上首页，匿名会话恢复既有用户身份。
  2. 自动恢复／进入已加入过的官方房“闲聊广场”。
  3. `joinAsMember` 再次向 `eh_members` 写入同一 `(room_id,user_id)`。
- **预期结果**：重复进房幂等成功，不产生失败请求。
- **实际结果**：`POST /rest/v1/eh_members` 返回 HTTP 409；探测器无用户 JWT 重试该 URL 后又得到 401。
- **修前证据**：2026-08-19 08:42 运行 `python3 scripts/health-probe.py`，稳定记录 `HTTP 409 .../eh_members`，退出码 1。

## §2 稳定复现

- ✅ 连续健康探测均出现相同 `eh_members` 409。
- ✅ 线上 CDP 网络事件和本地源码路径相互印证。
- — 非视觉问题，不需要录屏；以可机器复现的 HTTP 状态和旅程测试代替。

## §3 单一根因假设

- **根因**：公开／官方房的 `joinAsMember` 使用裸 `insert`；`eh_members` 的唯一约束为 `(room_id,user_id)`，重复进房必然冲突。
- **证据链**：
  1. 线上失败 URL 精确指向 `/rest/v1/eh_members`，状态 409。
  2. `js/app.js` 的公开房路径确实使用 `sb.from('eh_members').insert(...)`。
  3. 数据库 RPC `eh_join_by_code` 已明确采用 `on conflict (room_id,user_id) do nothing`，证明该复合键就是预期幂等边界。
- **证伪实验**：用假 Supabase builder 连跑两次进房，断言生产代码必须调用带 `onConflict:'room_id,user_id'`、`ignoreDuplicates:true` 的 upsert；把代码突变回 insert 后测试必须变红。
- **证伪结果**：未被证伪，继续修复。

## §4 修复方案

- **文件**：`js/app.js`、`scripts/journey-member-upsert.js`、`scripts/ci-check.sh`、版本三处。
- **模块**：`joinAsMember`；建房后房主成员落库同步改为同一幂等策略。
- **平台影响**：网络写入语义统一，各平台一致；不涉及布局、键盘、PWA 行为。
- **历史回归检查**：已检查 `git log -- js/app.js`，没有既有同类修复。
- **回滚方案**：回退该原子提交并重新发布。

## §5 回归矩阵

| 场景 | Chrome CDP | 代码旅程 |
|---|:-:|:-:|
| 首次进公开房 | ⏳线上部署后 | ✅ |
| 重复进公开房 | ⏳线上部署后 | ✅ |
| 私密房资格校验保持只读 | ⏳线上部署后 | ✅ |
| 建房后房主落成员表 | ⏳线上部署后 | ✅ |

## §6 提交约束

- ✅ 单一问题：成员写入幂等。
- ✅ 无数据库字段变化。
- ✅ 版本号三处同步。
- ✅ `scripts/ci-check.sh` 全绿。

## §7 修后确认

- **CI 结果**：本地完整 `scripts/ci-check.sh` 全部通过；新增旅程证明当前 upsert 实现绿、旧版裸 insert 必红。
- **线上回归**：待部署后重新运行健康探测，必须无 `eh_members` 409。
- **合入 main 时间**：2026-08-19 08:49（待推送）。
