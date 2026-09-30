# Echo 测试能力合并约定（自动化测试 × 错误监控）

## 职责边界
| 能力 | 负责 | 入口 |
|---|---|---|
| 功能自动化测试（单测/契约/联机协议/旅程） | 本仓库 `scripts/run-suite.sh` | `bash scripts/run-suite.sh [quick\|full\|games\|multiplayer\|monitor\|…]` |
| 线上错误采集 | `js/app.js` 内 `window.ehReportError` → `POST /rest/v1/eh_errors` | 浏览器端自动接 `error` / `unhandledrejection` |
| 测试×监控桥接 | `scripts/error-monitor.js` | `node scripts/error-monitor.js [collect\|report]` |

## 已落地的桥接接口（`scripts/error-monitor.js`）

```js
module.exports = {
  // 跑测结束上报(落盘 scripts/.error-monitor-runs.jsonl + 写 eh_errors kind=suite_run)
  reportRun: async ({ mode, pass, fail, skip, failed, durationMs }) => {},
  // 拉线上错误指纹(默认 24h, 50 条)
  collect: async ({ limit, hours }) => ({ errors: [], source: 'eh_errors' }),
  // 判断某条错误是否已在测试里覆盖(manual 埋点指纹 → 对应用例文件)
  isCovered: (error) => boolean,
};
```

`run-suite.sh` 结尾自动调用 `reportRun`（缺文件不挡测试）。
`bash scripts/run-suite.sh monitor` 拉线上错误并标出**未覆盖**条目 → 指导补用例。

## 手动埋点指纹 ↔ 用例
| 指纹 (kind) | 触发点 | 覆盖用例 |
|---|---|---|
| `guest_action_failed` | guest 出牌回传失败 | `journey-gt-act-rpc.js` |
| `snapshot_apply_failed` | 快照应用抛错 | `journey-poker-online.js` |
| `grab_seat_failed` | 抢位失败 | `test-gt-join-matrix.js` |
| `js_error` / `promise` | 全局异常 | 按 message 关键字匹配用例 |

## 合并后的统一能力
1. **跑测**：`run-suite.sh` 全量/快测 —— 改代码后回归。
2. **看错**：`run-suite.sh monitor` / `node scripts/error-monitor.js collect` —— 真实用户路径缺口。
3. **闭环**：线上错误 → `isCovered` 为假 → 在 `scripts/test-suite.md` 对应功能域补用例 → 跑测防再犯。

## 用例补充约定
- 新功能落地：在 `scripts/test-suite.md` 对应域加一行 + 实现 `test-*.js` / `journey-*.js`。
- 线上 bug 修复：修完追加回归条目（源码契约或行为探针）。
- 每次提交前：`bash scripts/run-suite.sh quick`；定期：`full`；线上巡检：`monitor`。

