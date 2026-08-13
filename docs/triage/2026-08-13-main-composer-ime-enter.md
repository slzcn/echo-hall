# 主聊天中文输入法候选期按 Enter 误发送

## §1 现象（Reproducibility）

- **范围**：主聊天输入框 `#cin`，私信输入框不受影响。
- **触发环境**：桌面和移动端中文拼音／五笔等使用 composition 事件的输入法。
- **触发步骤**：
  1. 进入任意房间并聚焦主聊天输入框；
  2. 用中文输入法输入拼音，让候选词处于合成态；
  3. 按 Enter 确认候选词。
- **预期结果**：Enter 只确认输入法候选词，不发送消息。
- **实际结果**：主聊天 `keydown` 直接调用 `send()`，可能发送尚未完成的文本。
- **对照证据**：`js/dm.js` 的私信输入框已经有 `compositionstart/end + isComposing + keyCode===229` 三重保护；`js/app.js` 主聊天没有。

## §2 稳定复现

- 静态路径对照：稳定，主聊天所有非 Shift 的 Enter 都进入 `send()`。
- 自动行为测试：`scripts/test-composer-ime.js` 直接加载生产 `js/app.js` 中的输入处理器，并派发 composition／keydown 序列；修复前应稳定红灯。
- 真机输入法最终确认：修复后仍需纳入输入法矩阵，但不把人工真机作为唯一测试手段。

## §3 单一根因假设

- **根因**：主聊天输入处理器没有维护 composition 状态，也没有读取 `KeyboardEvent.isComposing`／`keyCode===229`，把输入法候选确认键误当成消息发送键。
- **可以证伪它的实验**：只给主聊天补与私信同语义的 composition guard；若自动测试中候选期 Enter 不再发送、普通 Enter 仍发送，则假设成立。

## §4 修复方案

- 文件：`js/app.js`、行为回归测试、CI 门禁、版本三处。
- 在主聊天输入框维护 `_cinComposing`；`compositionstart` 置真，`compositionend` 置假并刷新发送按钮。
- `keydown` 最前面拦截 `_cinComposing || e.isComposing || e.keyCode===229`，确保输入法候选期的 Enter／Tab／方向键不被 @ 菜单、斜杠菜单或发送逻辑抢走。
- 不修改 `js/keyboard.js`、CSS 高度或 VisualViewport 逻辑，保持单变量。
- 回滚：回滚本次单 commit。

## §5 回归矩阵

| 场景 | 预期 |
|---|---|
| 普通 Enter | 发送一次并 preventDefault |
| Shift+Enter | 不发送，保留换行 |
| `isComposing=true` + Enter | 不发送，不抢输入法默认行为 |
| `keyCode=229` + Enter | 不发送 |
| compositionstart → Enter | 不发送 |
| compositionend → Enter | 恢复正常发送 |
| 合成态 + @／斜杠菜单 | 不选菜单、不发送 |

## §6 提交约束

- 单次变更只修主聊天 IME 合成态误发送。
- 版本号三处同步。
- `bash scripts/ci-check.sh` 和新增行为测试全绿。

## §7 修后确认

- `node scripts/test-composer-ime.js`：7／7 通过。
- `bash scripts/ci-check.sh`：全部通过，输入法行为测试已接入 CI。
- Chromium／WebKit 页面矩阵：手机 390×844、平板 820×1180、桌面 1440×900 共 6 组均 HTTP 200、无页面异常、无横向溢出、加载 `app.js?v=20260813-imeguard`。
- 修复前红灯：7 项中 5 项失败；修复后全部转绿。
- 未修改 `js/keyboard.js` 和布局 CSS，保持单变量。
- Firefox 与真实系统 IME 矩阵作为后续兼容回归继续执行，不冒充已完成。
