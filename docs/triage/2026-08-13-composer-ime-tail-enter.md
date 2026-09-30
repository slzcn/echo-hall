# 主聊天输入法候选确认 Enter 被误发送

## §1 现象（Reproducibility）

- **目标环境**：iOS Safari／iOS PWA／部分 Android WebView；桌面中文输入法也可能产生同类事件顺序。
- **触发步骤**：
  1. 进入任意房间并聚焦主聊天输入框 `#cin`。
  2. 使用拼音输入中文，候选词尚未提交。
  3. 按 Enter 确认候选；浏览器按 `compositionend → keydown(Enter,isComposing=false,keyCode=13)` 派发事件。
- **预期结果**：Enter 只确认候选词，不发送消息；用户随后再次明确按 Enter 才发送。
- **实际结果**：`compositionend` 立即把 `_cinComposing` 清为 false；紧随其后的 Enter 穿过三重守卫并调用 `send()`，候选词被直接发送。
- **稳定复现方式**：从真实生产输入处理器抽取代码，在独立 VM 中连续派发上述事件序列；修前每次 `send=1`，确定性复现。
- **修前视频**：原生系统 IME 无法由无头浏览器可靠操纵；以真实生产处理器事件旅程＋变异反证代替，不虚报真机录屏。

## §2 稳定复现

- [x] 生产处理器事件旅程连续执行结果确定一致。
- [x] 覆盖两种浏览器事件序列：`keydown(isComposing=true) → compositionend` 与 `compositionend → keydown(isComposing=false)`。
- [ ] 真机录屏：本轮不具备系统 IME 自动化通道，明确保留为发布后人工体验核验项。

## §3 证伪清单（动代码前）

| 假设 | 证伪实验 | 修前结果 |
|---|---|---|
| `e.isComposing` 足以识别候选确认 | `compositionend` 后派发 `isComposing=false` 的 Enter | 被误发送，证伪 |
| `keyCode===229` 足以兜底 | 同序列使用 Safari 常见 `keyCode=13` | 被误发送，证伪 |
| 自维护 `_cinComposing` 足以兜底 | `compositionend` 已先清 false，再派发 Enter | 被误发送，证伪 |
| 延迟窗会吞掉用户正常发送 | 候选结束后超过保护窗再按 Enter | 必须正常发送，否则方案不合格 |

**单一根因**：保护状态只覆盖“合成进行中”这一时刻，没有覆盖 `compositionend` 后同一按键产生的尾随 Enter；缺少跨事件边界的短暂抑制窗。

## §4 修复方案

- **先测后改**：新增 `scripts/journey-composer-ime.js`，运行真实生产处理器，覆盖合成前／合成中／结束尾随 Enter／明确第二次 Enter／菜单协同／多行高度恢复。
- **生产改动**：仅改 `js/app.js` 主聊天输入处理器。记录 `compositionend` 时间；仅对紧随其后的 Enter／NumpadEnter 启用短保护窗，不影响其他键和稍后的明确发送。
- **边界**：保护窗使用事件 `timeStamp`，避免异步计时器；窗口取足以覆盖同一物理按键尾随事件但不吞明显第二次按键的短值。
- **影响平台**：修复 iOS Safari／PWA 和部分 WebView；Android 既有 `229` 守卫保留；桌面普通 Enter 不受影响。
- **回滚**：单提交回滚 `js/app.js` 对应几行和新增旅程测试／门禁项。

## §5 回归矩阵

| 场景 | 代码级旅程 | Chromium 事件序列 | WebKit 事件序列 |
|---|:-:|:-:|:-:|
| 普通 Enter 发送 | 待测 | 待测 | 待测 |
| Shift+Enter 换行 | 待测 | 待测 | 待测 |
| 合成中 Enter 不发送 | 待测 | 待测 | 待测 |
| compositionend 尾随 Enter 不发送 | 修前 ❌ | 修前 ❌ | 修前 ❌ |
| 稍后明确 Enter 发送 | 待测 | 待测 | 待测 |
| @／斜杠菜单不抢候选键 | 待测 | 待测 | 待测 |
| 发送后输入框高度恢复 | 待测 | 待测 | 待测 |

## §6 提交约束

- [x] 单一根因、单变量修复。
- [x] 版本号三处同步：`20260813-imetrail`。
- [x] `bash scripts/ci-check.sh` 全绿。
- [ ] 线上文件版本＋关键代码核验（提交部署后执行）。

## §7 修后确认

- **修复实现**：`compositionend` 记录事件时间；80ms 内的尾随按键不进入页面菜单／发送逻辑，窗口外明确 Enter 正常发送。
- **函数级回归**：`scripts/test-composer-ime.js` 7 项全绿。
- **完整旅程**：`scripts/journey-composer-ime.js` 8 步全绿。
- **反证**：变异版移除尾随保护后，`compositionend → Enter` 确定触发 `send=1`，测试必红。
- **完整 CI**：2026-08-13 19:14（GMT+8）本地 `bash scripts/ci-check.sh` 全绿。
- **发布版本**：`20260813-imetrail`。
- **线上核验**：提交部署后回填。
