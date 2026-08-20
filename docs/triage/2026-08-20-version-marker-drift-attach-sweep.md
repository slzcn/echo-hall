# Echo Bug 最小诊断单：线上版本标记漂移（attach-sweep）

## §1 现象（Reproducibility）

- **设备/环境**：线上探测器（HTTP），2026-08-20 21:31 CST
- **触发步骤**：
  1. 请求线上 `index.html`、`ver.txt`、`sw.js`，提取版本标记。
  2. 运行 `python3 scripts/health-probe.py`。
  3. 比较 `BUILD_VER` 与 `ver.txt`。
- **预期结果**：`index.html BUILD_VER`、`ver.txt` 与 `sw.js SW_VERSION` 使用同一业务版本。
- **实际结果**：线上 `BUILD_VER=20260820-dup-scavenger`，`ver.txt=20260820-attach-sweep`，`SW_VERSION=eh-sw-v365-20260820-attach-sweep`；探测退出码 1，唯一 issue 为版本不一致。
- **修前视频/GIF**：不适用（线上元数据一致性问题）。

## §2 稳定复现

- ✅ 当前线上探测样本稳定复现；HTTP、Supabase、业务只读链路均正常，异常收敛为版本标记漂移。
- ✅ 本地 `HEAD` 同样存在相同不一致：`index.html` 为 `dup-scavenger`，`ver.txt/sw.js` 为 `attach-sweep`。
- — 真机视频：不适用。

## §3 单一根因假设

- **本次假设根因**：版本发布时 `ver.txt` 与 `sw.js` 已推进到 `20260820-attach-sweep`，但内嵌版本自愈 IIFE 的 `BUILD_VER` 遗留为上一版本 `20260820-dup-scavenger`，导致探测和客户端版本自愈比较看到漂移。
- **证据链**：
  1. 三处标记只有 `index.html` 不同，且 `ver.txt` 与 `sw.js` 同为 `attach-sweep`。
  2. `git diff` 仅有并行改动 `js/modules/lobby.js`，不涉及本修复文件。
  3. `health-probe.py` 唯一异常正是三处版本标记比较失败，其他链路通过。
- **可以证伪它的实验**：仅将 `BUILD_VER` 改为 `ver.txt` 当前值，运行版本门禁；若本地门禁通过、部署后线上三处一致且 probe 清零，则支持该假设。
- **证伪结果**：未被证伪，继续修复。

## §4 修复方案

- **动到的文件**：`index.html`、本诊断单。
- **模块/行号**：版本自愈 IIFE 的 `BUILD_VER`。
- **平台影响**：不改变业务逻辑；修复版本自愈和健康门禁的元数据一致性。
- **回归核对**：不触碰并行修改的 `js/modules/lobby.js`；运行 CI 版本一致性和健康探测。
- **回滚方案**：回滚本原子提交。

## §5 回归矩阵

- 版本一致性门禁：⏳ 修复后填写。
- HTTP/业务探测：⏳ 部署后填写。

## §6 提交约束

- ⏳ 仅本根因相关文件；版本三处统一为 `20260820-attach-sweep`；CI 全绿后原子提交。

## §7 修后确认

- ⏳ 待修复、部署和线上复测后填写。
