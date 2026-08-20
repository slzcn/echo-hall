# 核心弹窗与状态提示无障碍

## §1 现象
主弹窗没有 dialog 语义、焦点圈定、Esc 关闭及关闭后焦点恢复；关闭按钮为不可聚焦 div；toast 和消息流对读屏不可感知；全局 focus 规则仅覆盖 button。

## §2 稳定复现
键盘 Tab 可越过弹窗进入背景；Esc 无响应；关闭后焦点丢失；读屏不播报 toast 和新消息。

## §3 单一根因假设
弹窗和状态反馈没有统一的可访问交互契约。

## §4 不变量
打开弹窗保存触发源；Tab 留在可见控件内；Esc 关闭；关闭恢复焦点；toast/live log 有语义；减少动效时动态回看弹窗不动画。

## §5 修复
主弹窗和确认框增加 ARIA；关闭按钮改 button；增加 focus trap／Esc／焦点恢复；扩展 focus-visible；消息流 role=log，toast role=status；动态回看补 reduce-motion。

## §6 验证
新增 a11y 旅程和旧实现反证。

## §7 结果
待门禁回填。
