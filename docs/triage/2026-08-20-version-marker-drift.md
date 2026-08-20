# Echo Bug 最小诊断单：线上版本标记漂移

## §1 现象（Reproducibility）

- **设备/环境**：线上探测器（HTTP + Chromium/CDP），2026-08-20 20:30 CST
- **触发步骤**：
  1. 请求线上 `index.html`、`ver.txt`、`sw.js`，提取 `BUILD_VER`、`ver.txt`、`SW_VERSION`。
  2. 连续运行 `python3 scripts/health-probe.py` 样本。
  3. 比较三处版本标记。
- **预期结果**：`index.html BUILD_VER` 与 `ver.txt` 相等，且 `sw.js SW_VERSION` 包含同一业务版本。
- **实际结果**：连续样本均为 `BUILD_VER=20260820-fold-ime-fallback`，`ver.txt=20260820-dup-scavenger`，`SW_VERSION=eh-sw-v363-20260820-dup-scavenger`；探测退出码 1。
- **修前视频/GIF**：不适用（线上版本元数据一致性问题，无视觉交互现象）。

## §2 稳定复现

- ✅ 同一线上状态连续 2 个完整样本复现；第三个样本被探测执行时限终止，但前两次结果一致。
- ✅ HTTP 200、Supabase、业务只读链路、CDP JS 错误/资源失败/白屏/Realtime 均正常，异常收敛为版本标记漂移。
- ⏳ 真机视频：不适用。

## §3 单一根因假设

- **本次假设根因**：最近提交将 `index.html` 的脚本缓存指纹更新为 `fold-ime-fallback` 的既有并发改动，但没有同步把内嵌 `BUILD_VER` 更新为提交同时写入 `ver.txt` 的 `dup-scavenger`；因此同一部署产物的三处版本元数据不一致。
- **证据链**：
  1. 线上 `index.html` 与本地 `HEAD:index.html` 都是 `20260820-fold-ime-fallback`。
  2. 本地 `HEAD:ver.txt` 与 `HEAD:sw.js` 都是 `20260820-dup-scavenger`。
  3. `health-probe.py` 明确以三处标记相等作为门禁，且连续线上样本仅此一项异常。
- **可以证伪它的实验**：在不改业务代码的情况下，将 `index.html` 的 `BUILD_VER` 修正为 `ver.txt` 的值，运行 CI 版本一致性检查；若门禁通过且部署后探测清零，则支持该根因。
- **证伪结果**：⬜ 未被证伪，继续修复。

## §4 修复方案

- **动到的文件**：`index.html`、本诊断单。
- **模块/行号**：`index.html` 版本自愈 IIFE 内 `BUILD_VER`。
- **平台影响**：无业务逻辑变化；只修复 PWA 版本自愈比较使用的元数据。
- **旧实现回归核对**：`scripts/ci-check.sh` 已包含 BUILD_VER/ver.txt 与 SW_VERSION 一致性检查；保留并执行该门禁，不修改探测器绕过错误。
- **回滚方案**：回滚本次原子提交即可恢复原版本标记。

## §5 回归矩阵

- 版本一致性门禁：⏳ 修复后填写。
- HTTP/CDP/业务探测：⏳ 部署后填写。

## §6 提交约束

- ⏳ 单一根因、仅相关文件、版本三处同步、CI 全绿后提交。

## §7 修后确认

- ⏳ 待修复、部署和线上复测后填写。
