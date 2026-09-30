# Echo Bug 诊断单：键盘跨平台行为分化

## §1 现象（Reproducibility）

- **设备**：主人反馈，具体机型待补
- **OS 版本**：iOS／Android，具体版本待补
- **运行环境**：
  - iOS 浏览器：可复现
  - iOS PWA：可复现
  - Android 浏览器：V21 仍被键盘遮挡
  - Android PWA：始终不跟随输入法
- **主题/时段**：未提供，暂不作为变量
- **触发步骤**：
  1. 打开 Echo Hall，进入任意房间
  2. 点击聊天输入框，等待输入法弹起
  3. 观察输入框位置；再收起输入法并重复点击
- **预期结果**：输入框外框距当前可视底边 15px；键盘弹起、收回、再次弹起均保持跟随，不漂移、不跑到顶部
- **实际结果**：
  - iOS 浏览器、iOS PWA：输入框飘走
  - Android 浏览器：V21 仍被输入法遮挡
  - Android PWA：输入框始终不跟随输入法
- **修前视频/GIF**：待补，当前有主人真机现象反馈；未以视频冒充证据

### 关键运行时数值

暂缺主人真机诊断浮层截图，不能伪填。最小页已增加 `vv.height`、`vv.offsetTop`、`scrollY`、standalone、`.stage` top/height 诊断字段。

## §2 稳定复现

- ⏳ 主人已报告稳定复现；具体连续次数待补
- ✅ 至少两种运行环境已明确复现：iOS 浏览器/PWA、Android PWA；Android 浏览器作为正常对照
- ⏳ 修前视频待补

## §3 单一根因假设

- **本次假设根因**：`.stage` 的高度与滚动位置没有由同一个键盘状态机统一控制：CSS 的 `dvh/svh`、主聊天键盘 IIFE 的 inline height、以及 iOS 聚焦自动滚动／Android PWA 的 VisualViewport 变化分别接管了不同阶段，导致 iOS 出现滚动漂移、Android PWA 出现高度不更新。
- **证据链**：
  1. Android 浏览器正常、Android PWA 异常，说明业务 composer 结构不是唯一问题，PWA 的 viewport 变化路径不同。
  2. iOS 浏览器和 PWA 同时异常，说明不能只把问题归因于 Android PWA 的 `visualViewport.resize`。
  3. 当前代码同时存在 `body.hall-on .stage` 的 `100dvh/100svh` CSS 回退和 `keyboard.js` 的 inline height 写入；聚焦和失焦阶段的控制权不同。
- **可以证伪它的实验**：
  - 在不改业务结构的前提下，冻结 CSS viewport 高度，仅让单一控制器写入 `.stage` 的高度与位置；若三类异常同时消失，假设成立。
  - 关闭主聊天键盘 IIFE 的 inline 写入，仅保留 CSS 方案；若只在某平台恢复，说明是控制权冲突而非输入框自身定位问题。
- **证伪结果**：⬜ 已证伪  ☑ 未被证伪，继续验证

## §4 修复方案（Fix Plan）

- **动到的文件**：`index.html`、`js/keyboard.js`
- **结构精简决定**：把 `#hall` 从通用 `.stage` 中移出，聊天页只保留一个固定视口容器；键盘控制器只写 `#hall`，删除 `.stage → #hall` 双层高度链
- **动到的模块/函数**：聊天 DOM 层级、移动端 `#hall` 布局、键盘控制器；不动弹窗输入框滚动逻辑
- **Android PWA 信号**：补接 VirtualKeyboard `geometrychange/boundingRect`；该 API 不存在时继续使用 VisualViewport
- **是否影响其他平台**：会影响 iOS 浏览器/PWA、Android 浏览器/PWA；必须用回归矩阵验证
- **是否重新暴露旧 bug**：需检查 `.stage/#hall/--vh` 四层写入关系；当前暂不恢复旧的 `dvh` 强制写入
- **回滚方案**：单 commit 回退本次键盘控制器变更，并恢复版本三处

## §5 回归矩阵（修后回填）

| 场景 | iOS Safari | iOS PWA | Android Chrome | Android PWA | MIUI 浏览器 |
|------|:-:|:-:|:-:|:-:|:-:|
| 大厅进入 | ⏳ | ⏳ | ✅ | ⏳ | ⏳ |
| 官方频道进房 | ⏳ | ⏳ | ✅ | ⏳ | ⏳ |
| 用户房间进房 | ⏳ | ⏳ | ✅ | ⏳ | ⏳ |
| 输入框弹起键盘 | ✅ V20 | ✅ V20 | ❌ V21仍遮挡 | ❌始终不跟随 | ⏳ |
| 输入框收键盘 | ⏳ | ⏳ | ✅ | ⏳ | ⏳ |
| 消息发送 | ⏳ | ⏳ | ✅ | ⏳ | ⏳ |
| 消息流不跳/不抖 | ⏳ | ⏳ | ✅ | ⏳ | ⏳ |
| 切后台再切回 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| 旋转（横竖屏切换） | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| 返回按钮收键盘 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| BGM 菜单打开/关闭 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| PWA 更新（触发 SW 换代） | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |

## §6 提交约束

- ⏳ 本 commit 只修一个键盘布局问题
- ⏳ commit message 描述现象、根因、方案，不使用禁用词
- ⏳ 版本号三处同步
- ⏳ `bash scripts/ci-check.sh` 全绿

## §7 修后确认

- **修后视频**：待真机验证
- **CI 结果**：待修复后回填
- **回归矩阵通过率**：待修复后回填；存在未测项目时不宣称全平台通过
- **合入 main 时间**：待定
- **合入后 24h 有无线上反馈**：待定
