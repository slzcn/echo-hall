# Echo Bug 诊断单 — 2026-08-25 health-probe SSL 瞬时抖动导致整个探针崩溃

## §1 现象（Reproducibility）

- **设备/运行环境**：Cron 任务宿主机（macOS），跑 `python3 scripts/health-probe.py`
- **触发步骤**：
  1. 12:00 巡检 cron 拉起 `scripts/health-probe.py`
  2. 进入 `probe_business_readonly()` → 调用 `_sb_request("/rest/v1/rpc/eh_public_recent", …)`
  3. `urllib` 与 Supabase 建立 HTTPS 连接时 **SSL 握手超时**（`_ssl.c:1063: The handshake operation timed out`）
- **预期结果**：单个后端瞬时抖动应被识别为 transient，探针要么给出 JSON + 明确 issue，要么内部重试后恢复；不应崩溃
- **实际结果**：`urllib.error.URLError` 冒出到 `main()`，Python 解释器直接以栈回溯退出，`stdout` 为空、exit=1，cron 会把它当作真实故障告警

## §2 稳定复现

- 直接复现（不需真触发 SSL 超时）：
  ```python
  from unittest.mock import patch
  import urllib.error, socket, health_probe as hp  # sys.path 加 scripts/
  def boom(*a, **kw): raise urllib.error.URLError(TimeoutError("handshake timed out"))
  with patch("urllib.request.urlopen", side_effect=boom):
      st, raw, dt = hp._sb_request("/rest/v1/eh_rooms?select=id&limit=1", "fakekey")
  # 旧行为：抛 URLError 到调用方；新行为：返回 (0, b"", dt) 且不抛
  ```
- 观测证据：`/tmp/echo_probe.err` 中的完整栈（`_sb_request` → `urlopen` → `do_open` → `wrap_socket` → `TimeoutError`）
- 紧随其后的第二次探测（同一 cron 周期内，30s 后）全绿：Supabase 401 baseline 340ms，业务 RPC 1.1–1.3s，`ok:true / issues:[]` → 证明后端本身没事，是网络层瞬时抖动

## §3 单一根因假设

**`_sb_request` 只捕获 `urllib.error.HTTPError`，没捕获 `URLError` / `TimeoutError` / `socket.timeout`。** 因此任何 SSL 握手超时、DNS 失败、TCP RST 等网络层瞬时错误都会穿透到 `probe_business_readonly()`，再穿透到 `main()`，把整个探针带崩、丢失 JSON、误报为「有异常」。

对照证据：
- `probe_supabase()` 里同样的场景是显式 `try / except (URLError, TimeoutError, Exception)` 包住，行为正确（返回 issue、探针继续跑）
- `_sb_request` 只包了 `except urllib.error.HTTPError`，属于遗漏

**只有这一个假设。** 不换假设、不同时改其他探针。

## §4 修复方案

1. `_sb_request`：在既有 `HTTPError` 分支后追加 `except (URLError, TimeoutError, socket.timeout, OSError)`，返回 `(0, b"", elapsed)`（0=网络层失败哨兵，区别于任何真实 HTTP 状态码）。
2. `probe_business_readonly()` 里对 `st == 0` 的调用做一次**同参数即时重试**（间隔 1s）；两次都失败才把该项加进 `issues`，避免单点 SSL 抖动触发误报（对齐既有「连续样本」纪律）。
3. 加针对性单元测试 `scripts/test_health_probe_net_errors.py`：
   - 旧实现必红：直接 patch `urlopen` 抛 `URLError`，调用 `_sb_request` 预期不抛异常，且 `st==0`
   - 当前实现必绿：同上，返回 `(0, b"", <float>)`
   - 追加：patch 让第一次抛错、第二次成功，`probe_business_readonly` 走完不新增 issue（重试生效）
4. `import socket` 补齐（当前脚本没显式 import）。

**不改**：其他探针、CDP、trend、CI、业务代码。仅动 `scripts/health-probe.py` 和新增测试。

## §5 修后验证

- 单测通过（下方 §7 复盘会附具体命令与输出）
- `python3 scripts/health-probe.py` 连跑 2 次全绿
- `bash scripts/ci-check.sh` 全绿
- 版本号本轮无业务改动 → 不动（AGENTS.md：一个 commit 一件事；本次是探针基础设施，非业务发布，无需 bump BUILD_VER/SW_VERSION/ver.txt。CI Gate 只在业务改动时才要求三处同步；`journey-exempt: probe robustness only, no runtime code changed`）

## §6 回归矩阵

不适用（未动业务代码、未动键盘/布局/BGM/PWA）。

## §7 复盘

见 commit message。
