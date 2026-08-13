# 公开房预取命中后历史停在 48 条

## §1 现象
- 进入公开／官方房；房卡 pointerenter/touchstart 已命中预取缓存。
- 预取只请求 `PREFETCH_N()`，默认 48 条。
- 首屏显示正常，但持续上翻永远只有这 48 条；不会自动补齐允许的最近 500 条。
- 未命中预取时会一次请求最多 500 条，因此行为取决于进入房间前是否触发预取。

## §2 稳定复现
- `prefetchRoom()` 对公开房固定 `lim:PREFETCH_N()`（默认 48）。
- `loadHistory(first)` 命中缓存后把 48 条作为完整 rows 渲染。
- 后续 `refreshSnapshotTail()` 虽请求 500 条，但明确只 append `m.id>domMaxMid` 的更新消息；更早 452 条被跳过。
- 代码级旅程构造完整 500 条＋DOM 已有最新 48 条，修前无法补入更早 452 条。

## §3 单一根因
公开房预取快路径与完整历史上限路径不一致：缓存命中后缺少“把已拉到的 500 条中缺失的更早消息分批 prepend”的状态转换。

## §4 修复方案
- 保留 48 条预取带来的秒开，不改 RPC，不突破 500 条上限。
- 复用 `refreshSnapshotTail()` 已有的 500 条请求；仅在“首屏使用预取缓存”时传入 `fillOlder=true`。
- 新增生产函数 `prependMissingPublicHistory(room, rows)`：
  - rid 校验防串房；
  - 只补 `id < 当前 DOM 最早 id` 且 DOM 不存在的消息；
  - 每批 30 条 idle prepend；
  - 每批以锚元素回位，滚动位置不跳；
  - 公开房后续普通 tail refresh 不重复扫描补历史。
- 不改私密房分页，不新增后端接口，不加载超过 `publicRecentLimit=500`。

## §5 回归矩阵
| 场景 | 旅程 |
|---|---|
| DOM 最新 48＋完整 500 → 补齐 500 | ✅ |
| 重复执行不重复 | ✅ |
| 切房后停止插入 | ✅ |
| 补入过程锚点不跳 | ✅ |
| 普通 tail refresh 不触发补旧 | ✅ |

## §6 提交约束
- [x] 仅处理公开房预取快路径补齐到最多 500 条。
- [x] 版本号三处同步：`20260813-public500`。
- [x] 完整 CI 全绿。

## §7 修后确认
- 修前红灯：生产代码缺少公开房预取历史补齐状态转换，旅程在入口定位阶段稳定失败。
- 修后旅程：预取 48 条后补齐到 500／不重复／锚点不跳／重复执行幂等／切房停止／仅快路径补旧，6 步全绿。
- 旧实现反证：移除 `refreshSnapshotTail(_r, true)` 后，旧 tail-only 路径不会进入补旧状态，旅程必红。
- 最大历史仍由 `publicRecentLimit=500` 控制；未改 RPC、未突破 500 条。
- 本地 `bash scripts/ci-check.sh` 全绿；旅程覆盖门识别并接受 `scripts/journey-public-history-cap.js`。
