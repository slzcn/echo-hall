# Echo Bug 诊断单：弹窗可访问名称与焦点闭环不完整

## 1．用户旅程
打开创建／创建完成／加入／注册／找回／编辑资料面板 → 读屏播报当前面板标题；打开确认框 → Tab／Shift+Tab 不逃出 → Esc 取消 → 焦点回到触发控件。

## 2．稳定复现
通用 `modalMask` 固定 `aria-labelledby="activeModalTitle"`，切到其他面板仍引用隐藏的“创建房间”；confirm 虽为 dialog，却不进入 Esc、Tab trap 与焦点恢复链路。

## 3．单一根因假设
弹窗管理只完整覆盖主 modal，且没有按 active panel 更新名称，也没有把 confirm 纳入统一焦点生命周期。

## 4．验证方法
扩展 `journey-dialog-a11y.js`：检查六个面板各有唯一标题映射；行为执行 confirm trap，验证正向／反向 Tab 绕回和 Esc 取消；检查打开保存、关闭恢复焦点。内置固定标题／无 trap 旧实现反证必红。

## 5．回归矩阵
- ✅ 六类业务面板动态 `aria-labelledby`
- ✅ confirm Tab／Shift+Tab 圈定
- ✅ confirm Esc 与遮罩取消
- ✅ confirm 确定／取消按钮
- ✅ 主 modal 与 confirm 关闭后焦点恢复
- ✅ 鼠标／触屏关闭路径保留

## 6．修复结果
为每个面板标题增加稳定 id；`openModal` 按面板设置 `aria-labelledby`。confirm 保存触发焦点，新增独立 trap 与 Esc 关闭，结束时清理处理器并恢复焦点；全局键盘入口优先处理最上层 confirm。

## 7．发布验证
扩展旅程已接入既有 CI 的 dialog 检查并通过。整套 CI 结果见交付说明。
