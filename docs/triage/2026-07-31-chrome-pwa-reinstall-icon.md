# Chrome PWA 重装无弹窗且桌面无图标

## §1 现象（Reproducibility）

- **设备**：主人安卓手机（具体机型未补充）
- **OS 版本**：未补充
- **运行环境**：Chrome
- **触发步骤**：
  1. Chrome 打开 Echo Hall。
  2. 页面不自动弹安装提示；大厅有“安装到桌面”按钮，但点击无系统弹窗。
  3. 从 Chrome 菜单执行安装，系统流程结束后桌面仍无图标。
- **预期结果**：按钮或菜单能调起安装，安装完成后出现桌面图标。
- **实际结果**：按钮无弹窗，菜单安装后无桌面图标。
- **修前视频**：主人已真机稳定复现；本轮无录屏文件。

## §2 稳定复现

- ✅ 主人真机复现三联症状。
- ✅ 历史提交 `adb74c4` 记录过完全相同现象：删除桌面图标后，Chrome 保留旧 WebAPK 安装记录；同 manifest id 重装不再落图标。
- ⏳ 当前无 ADB 真机通道，无法读取 WebAPK/Launcher 日志。

## §3 单一根因假设

- **本次假设根因**：Chrome 仍保留旧 manifest id 对应的 WebAPK 已安装记录；V57 又把 id 改回历史用过的 `/echo-hall/`，导致同 id 安装被判为“已存在”，不重新触发安装弹窗或落桌面图标。
- **证据链**：
  1. 历史提交 `adb74c4` 的现象与本次三联症状一致，换新 id 后曾恢复。
  2. `/echo-hall/` 与 `/echo-hall/?pwa=20260724` 都已被历史安装使用，不再是全新 id。
  3. manifest、Service Worker、192/512 图标在线检查均正常；图标 URL 全部 HTTP 200。
- **证伪实验**：只把 manifest id 换成从未使用的新值，保持 start_url/scope/icons 及安装按钮逻辑不变；主人真机再装，若仍无图标则本假设被证伪。
- **证伪结果**：⏳ 待主人真机验证。

## §4 修复方案

- **动到文件**：`manifest.json`、三处版本文件。
- **单一变量**：manifest `id` 换成全新稳定值 `/echo-hall/?pwa=20260731-v58`。
- **保持不变**：`start_url`、`scope`、icons、`beforeinstallprompt` 与按钮逻辑。
- **影响范围**：Android Chrome/PWA 安装身份；已安装旧 PWA 不受影响。
- **回滚方案**：回滚本次原子提交。

## §5 回归矩阵

| 场景 | Android Chrome | Android PWA |
|------|:-:|:-:|
| 页面进入 | ⏳ | — |
| beforeinstallprompt 可捕获 | ⏳ | — |
| 按钮调起系统安装窗 | ⏳ | — |
| 菜单安装后桌面出现图标 | ⏳ | — |
| 图标启动进入 standalone | — | ⏳ |
| PWA 更新 | — | ⏳ |

## §6 提交约束

- ✅ 单一 bug、单一 manifest id 变量。
- ✅ 版本号三处同步。
- ⏳ 提交前运行 `bash scripts/ci-check.sh`。

## §7 修后确认

- **自动检查**：待执行。
- **决定性验证**：Android Chrome 真机安装链路；桌面 CDP 无法生成 Android WebAPK/桌面图标。
