# 私密房翻历史触顶不自动续载

## §1 现象（Reproducibility）

- **设备/环境**：所有浏览器；移动端感知最明显。
- **触发步骤**：
  1. 进入历史消息超过一页的私密房。
  2. 从最新消息持续向上滑。
  3. 到达消息流顶部。
- **预期结果**：接近顶部时自动加载下一页，阅读连续；加载期间不重复请求；插入后当前可见消息保持原位。
- **实际结果**：只有点击 `#loadMoreBtn` 才会调用 `doLoadMore()`；`#stream` 的 scroll 监听只更新“回到最新”和滚动锚点。用户自然上滑会停住，必须寻找并点击一个 28px 高的小按钮。
- **稳定复现**：运行真实 `bindToLatest` 生产滚动绑定，派发 `scrollTop=24` 的 scroll；当前 `doLoadMore=0`。

## §2 稳定复现

- [x] 源码调用图确认：`loadHistory(false)` 仅由 `doLoadMore()` 调用；`doLoadMore()` 仅由按钮 onclick 触发。
- [x] 真实生产滚动绑定代码旅程可确定复现。
- [x] 不依赖网络、房间数据或设备时序。

## §3 证伪清单

| 命题 | 证伪实验 | 修前结果 |
|---|---|---|
| 向上滚动本身会加载 | 对真实 scroll listener 派发 `scrollTop=24` | `doLoadMore=0`，证伪 |
| MutationObserver 会补触发 | 仅改变 DOM，不点击按钮 | 只重判回最新按钮，不加载，证伪 |
| 用户可以自然发现入口 | 滚动条被隐藏，入口仅 11.5px 字号、28px 高 | 没有连续滚动 affordance，证伪 |
| 自动触发会并发翻页 | 连续派发 scroll；由现有 `_loadingMore` 守卫验证 | 修后必须保持单请求 |

**单一根因**：历史分页动作只绑定在按钮 click，没有进入消息流的 scroll 状态机。

## §4 修复方案

- 先新增 `scripts/journey-history-scroll.js`，运行真实 `bindToLatest` 生产代码。
- 复用现有 `#stream` scroll listener，不新增监听器；在节流后的 `kick` 中调用一个最小自动续载函数。
- 仅当 `scrollTop <= 80` 且 `#loadMoreBtn` 存在、未 disabled 时触发 `doLoadMore(btn)`。
- 防重复继续由现有 `_loadingMore` 守卫负责；按钮保留作为无障碍／失败重试入口。
- 不修改公开房接口，不修改分页查询，不修改锚点插入算法。
- 回滚：回退自动续载函数及其单一调用点。

## §5 回归矩阵

| 场景 | 代码级旅程 | iOS Safari/PWA | Android Chrome/PWA |
|---|:-:|:-:|:-:|
| 离顶部较远不加载 | 待测 | ⏳ | ⏳ |
| 接近顶部自动加载 | 修前 ❌ | ⏳ | ⏳ |
| 无加载按钮不请求 | 待测 | ⏳ | ⏳ |
| disabled/加载中不重复 | 待测 | ⏳ | ⏳ |
| 加载后锚点不跳 | 由既有 loadHistory 锚点路径覆盖，待联测 | ⏳ | ⏳ |
| 点击按钮仍可用 | 待测 | ⏳ | ⏳ |

## §6 提交约束

- [x] 本单只处理私密房触顶自动续载。
- [x] 版本号三处同步：`20260813-historyscroll`。
- [x] `bash scripts/ci-check.sh` 全绿。

## §7 修后确认

- **修前红灯**：真实滚动状态机在 `scrollTop=24` 时 `doLoadMore=0`。
- **修复实现**：复用现有 scroll listener 的 rAF 节流；`scrollTop<=80` 且存在可用 `#loadMoreBtn` 时调用既有 `doLoadMore()`。
- **旅程结果**：离顶部不加载／触顶加载一次／disabled 防并发／无按钮不请求／加载中不重复 5 步全绿。
- **反证**：移除 `maybeLoadOlderOnScroll(s)` 后触顶调用数回到 0，旧点击-only 实现必红。
- **完整 CI**：本地 `bash scripts/ci-check.sh` 全绿。
- **发布版本**：`20260813-historyscroll`。
