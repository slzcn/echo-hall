# 诊断单：个人空间抽屉显示原生滚动条

## §1 现象

- **设备**：桌面浏览器及支持 WebKit 滚动条的移动端
- **运行环境**：Chrome / Safari / PWA / WebView
- **触发步骤**：
  1. 打开「个人空间」。
  2. 内容高度超过可视区。
  3. 观察抽屉右侧。
- **预期结果**：抽屉内容仍可触摸、滚轮滚动，但不显示原生滚动条；与大厅、消息流、输入框的无轨滚动视觉一致。
- **实际结果**：`.drawer-body` 只有 `overflow-y:auto`，右侧显示浏览器原生滚动条，破坏沉浸感。

## §2 稳定复现

- CSS 静态契约可稳定复现：`index.html` 中 `.drawer-body{flex:1;overflow-y:auto}` 未声明 Firefox、旧 Edge 和 WebKit 的滚动条隐藏规则。
- `.drawer-body` 同时用于 `#meBody`、`#gearBody`、`#dmInboxBody`；三个右侧抽屉均有同一问题。

## §3 单一根因假设

- **根因**：通用抽屉滚动容器 `.drawer-body` 漏了全站其他滚动容器已采用的无轨滚动样式。
- **证据链**：
  1. `.drawer-body` 是实际滚动容器，具备 `overflow-y:auto`。
  2. 它没有 `scrollbar-width:none`、`-ms-overflow-style:none` 或 `::-webkit-scrollbar` 规则。
  3. `#lobby`、`.stream`、`.cin` 已采用这三套兼容规则且仍可滚动。
- **证伪实验**：只给 `.drawer-body` 加上述隐藏规则，不改变 `overflow-y:auto`；若滚动能力保留且轨道消失，则假设成立。
- **证伪结果**：未被证伪，继续修复。

## §4 修复方案

- **文件**：`index.html`、`scripts/journey-drawer-scrollbar.js`、`scripts/ci-check.sh`
- **方案**：在通用 `.drawer-body` 上补 `scrollbar-width:none`、`-ms-overflow-style:none`；新增 `.drawer-body::-webkit-scrollbar{width:0;height:0;display:none}`。
- **范围选择**：不只给 `#meBody` 打补丁。个人空间、房主设置、私信收件箱是同一种右侧抽屉、共用同一滚动容器，统一修复才不会留下同类视觉断层。
- **行为不变量**：必须继续保留 `overflow-y:auto`，只隐藏轨道，不禁滚动。
- **回滚**：回退本提交即可。

## §5 回归矩阵

| 场景 | Chrome | Safari | Firefox | PWA / WebView |
|---|:-:|:-:|:-:|:-:|
| 个人空间仍可滚动 | 自动契约 ✅ | 自动契约 ✅ | 自动契约 ✅ | 自动契约 ✅ |
| 个人空间无滚动条 | 自动契约 ✅ | 自动契约 ✅ | 自动契约 ✅ | 自动契约 ✅ |
| 房主设置 / 私信收件箱一致 | 自动契约 ✅ | 自动契约 ✅ | 自动契约 ✅ | 自动契约 ✅ |

## §6 提交约束

- 本提交只处理右侧抽屉滚动条视觉一致性，不混入现有未提交的离场用户改名改动。
- 版本号三件套另拆发布提交。
- 提交前跑全量 `bash scripts/ci-check.sh`。

## §7 修后确认

- 待填写：本地旅程、全量 CI、远端 CI、Pages 部署、线上 CSS 核验。
