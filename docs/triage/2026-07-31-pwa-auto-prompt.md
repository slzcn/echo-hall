# Chrome PWA 默认安装提示被页面抑制

## §1 现象（Reproducibility）

- **环境**：Android Chrome。
- **步骤**：打开 Echo Hall，达到浏览器可安装条件后等待。
- **预期**：Chrome 可按自身参与度规则主动显示安装提示。
- **实际**：从不自动显示；页面按钮或浏览器菜单仍可手动进入安装流程。

## §2 稳定复现

- 主人真机连续复现。
- 静态代码可稳定确认：`beforeinstallprompt` 监听器无条件调用 `event.preventDefault()`。

## §3 单一根因假设

- **根因**：页面为了自定义安装按钮调用 `preventDefault()`，主动取消了 Chrome 默认安装推广。
- **证据**：Chrome 官方《How to provide your own in-app install experience》明确说明，`preventDefault()` 会阻止移动端默认 mini-infobar／安装对话框。
- **证伪实验**：只移除该调用，保留事件缓存、自定义按钮、manifest 与 Service Worker；达到 Chrome 参与度条件后观察默认提示能否恢复。

## §4 修复方案

- 不再取消 `beforeinstallprompt` 默认行为，把默认提示时机交还 Chrome。
- 仍缓存事件，保留大厅“安装到桌面”按钮作为手动入口。
- 不再改 manifest `id`；V58 的新 ID 从此保持稳定，避免反复制造新的应用身份。

## §5 回归矩阵

| 场景 | 结果 |
|---|---|
| manifest、192/512 图标在线 | ✅ |
| Service Worker 含 fetch 处理器 | ✅ |
| 默认提示不再被页面取消 | ✅ 静态确认 |
| 自定义安装按钮仍保留 | ✅ 静态确认 |
| Android 真机默认提示 | ⏳ 由 Chrome 参与度与系统策略决定 |
| Android 安装后 Launcher 图标 | ⏳ 由 WebAPK／Launcher 权限决定 |

## §6 提交约束

- 单一安装提示问题；版本三处同步；提交前跑 `bash scripts/ci-check.sh`。

## §7 修后确认

- 桌面浏览器无法生成 Android WebAPK，也无法验证 MIUI Launcher 落图标；不把静态检查冒充真机安装成功。
