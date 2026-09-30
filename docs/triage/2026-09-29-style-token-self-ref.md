# 主题变量自引用 + 同构控件尺度对齐

**日期**: 2026-09-29

## 1. token 化把主题色改成自引用
**现象**: 换肤后强调色不跟皮肤走；`:root` 默认主题与 lagoon / 日间 cyber 文字、强调色解析成空。
**根因**: 硬编码色批量替换时，属性名与 `var()` 参数同名的声明被写成 `--accent:var(--accent)`、`--ink:var(--ink)` 等。CSS 变量自引用按无效值处理，整条色板塌掉；`--hover:var(--hover)` 在更早提交就已存在。
**方案**: 按 `js/config.js` 的 `themePalettes` 与远端基线回填真值（cyber `#00E5D4` / lagoon `#12B0E0` / 日间 cyber `#007f76`）；派生色（`--line`/`--grid`/`--glow-*`）保留 `color-mix(var(--accent))`；夜间 `--hover` 改为 `color-mix(in srgb, var(--ink) 6%, transparent)`。

## 2. `var(--x,var(--x))` 循环 fallback
**现象**: 同名 fallback 无兜底作用，声明膨胀一倍。
**方案**: 全量收成 `var(--x)`。

## 3. 同构控件圆角/字号不成套
**现象**: 确认按钮 11px、主按钮 12px；登录框 11px、聊天输入 12px；角标 5/6/7px 混用；13.5/15.5/11.5 半档字号散落。
**方案**: `--eh-radius-*` 收到 6/12/16/999，同构控件挂 token；半档字号归到 12/14/15。牌面红黑、筹码金、名次金银铜等身份色不动。

## 4. bottle 模式漏写死湖水青
**现象**: 换肤后漂流瓶按钮/原文条底色仍是 `#12B0E0`。
**方案**: 改 `var(--accent)`。

## 5. `element.style=` 密度超门禁
**现象**: CI 危险 API 监控 149 > 上限 146（长期稳定值，非本次暴涨）。
**方案**: `pwa-install.js` 四处 `style.display='none'` 收成 `hidden` 属性，计数 145 过线。

**验证**: `bash scripts/ci-check.sh` + 夜间/日间 token 解析探针（accent/hover/eh-radius）
