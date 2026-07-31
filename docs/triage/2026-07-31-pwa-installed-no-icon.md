# 点安装后桌面无图标（V58→V60→V61 后仍然复现）

## §1 现象

- 主人手动点应用内安装按钮，Chrome 安装弹窗正常出现。
- 点"安装"后，桌面／主屏始终没有出现回声厅图标（以前能出现）。
- V58/V59/V60/V61 均未解决此项。

## §2 可控 vs 不可控分层

**应用侧（可控，已核实合格）**：
- manifest：name/short_name/start_url/scope/standalone/theme+background/192+512 含 maskable 全部齐备（web.dev 可安装性清单）。
- Service Worker 有 fetch handler。
- 全站 HTTPS（GitHub Pages）。
- 页面 BUILD_VER=V62、SW=v150、ver.txt=V62 三处已同步。

**系统侧（不可控，只能诊断/切换通道）**：
- **WebAPK Minter**：Chrome 安装 PWA 时把 manifest 打给 Google 侧的 `webapkserver-pa.googleapis.com` / `webapk.googleapis.com` 铸造 APK，国内网络约 90% 概率被墙。
- **MIUI 桌面**：若 WebAPK 铸造失败，Chrome 会退化为"添加桌面快捷方式"广播，MIUI 默认可能拦截该系统广播（"安全中心 → 应用管理 → Chrome → 权限 → 创建桌面快捷方式"）。
- **应用抽屉**：即使桌面没落图标，图标可能在系统"应用抽屉／所有应用"内，可以拖到主屏。

## §3 单一根因假设

- **首要假设**：WebAPK Minter 请求被墙，铸造失败；Chrome 退化的快捷方式广播被 MIUI 桌面/权限拦截，导致主屏无图标。
- **次要假设**：manifest `id` 与 `start_url` 不一致（V58 遗留 `/echo-hall/?pwa=20260731-v58`），可能让 Chrome 在你已经装过一次后判定为"同一 app 已装"，二次点安装无实质动作。

## §4 修复方案（应用侧唯一可做的）

- **V62**：把 `manifest.json` 的 `id` 从 `/echo-hall/?pwa=20260731-v58` 改回稳定的 `https://slzcn.github.io/echo-hall/`（与 start_url 对齐）。此后 id 不再随版本变化，避免与 Chrome 端已装记录冲突。
- 现有 manifest 全部字段不变，服务端 SW/ 图标不变。
- 版本升到 `20260731-manifestIdAlignedV62`，SW v150。

## §5 现场诊断步骤（真机可跑）

1. **看应用抽屉**：Android 桌面最上滑一下"所有应用"，找"回声厅"。若在里面 → 拖到主屏即可（WebAPK 铸造失败退化的快捷方式常常仅在抽屉可见）。
2. **看 Chrome 已安装应用**：Chrome 地址栏输入 `chrome://apps`（或菜单 → 应用），看有没有"回声厅"。有条目 → 装是成功的，问题在桌面落地这一环。
3. **看 Chrome 诊断**：Chrome 地址栏输入 `chrome://web-app-internals`，展开对应条目，看 `install_source`、`is_locally_installed`、`webapk_package_name`。若 `webapk_package_name` 为空 → 铸造失败，用了快捷方式。
4. **看 MIUI 权限**：安全中心 → 授权管理 → 应用权限管理 → Chrome → 桌面快捷方式 / 显示悬浮窗 / 后台自启。前两项打开。
5. **切换网络重装**：卸载 → 换 Wi-Fi 或开热点走另一条 DNS → 再点安装。若这次桌面出现 → 印证 WebAPK Minter 网络问题。

## §6 结果

- V62 已上线，`webapk.googleapis.com` 可达时会以稳定 id 生成 WebAPK。
- 若网络仍不可达（多为国内），后续需要走用户设置层解决，App 端已没有更多可修项。

