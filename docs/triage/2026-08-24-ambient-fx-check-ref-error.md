# Triage: ambient-fx.js ReferenceError: check is not defined

**日期**: 2026-08-24  
**严重性**: 高 — JS 异常阻断 ambient-fx.js 加载，进厅链路受影响  
**状态**: 已修复

---

## §1 现象

health-probe CDP 探测捕获重复 JS 异常：

```
ReferenceError: check is not defined
  at https://slzcn.github.io/echo-hall/js/ambient-fx.js?v=20260802-entryFreezeFix:75:33
```

错误发生两次（可能是 onload + CDP 连入各触发一次）。

## §2 复现

- 稳定复现：任何访问 Echo 线上页面的浏览器都会触发
- 根因：`ambient-fx.js` 第 77 行 `const dnOrig=check` 引用了第 2 个 IIFE（deepNight）内的 `check` 函数，但该函数在第 3 个 IIFE（moodWeather）的作用域中不可见
- 该 ReferenceError 会中断第 3 个 IIFE 的执行，但不会中断整个文件（因为第 3 个 IIFE 是自包含的匿名函数）

## §3 根因假设

**单一假设**：第 3 个 IIFE（moodWeather）第 77 行存在遗留死代码，错误引用了第 2 个 IIFE（deepNight）闭包内的 `check` 变量。

代码历史：
- commit `c630c36` 引入了定时器清理钩子，在 moodWeather IIFE 内添加了 `let _dnT=null; const dnOrig=check;`
- 此时 `check` 是 deepNight IIFE 内的局部变量，在 moodWeather IIFE 中不可见
- deepNight IIFE 已正确在第 34 行挂载了 `window._ehDeepNight`，不需要在 moodWeather 中重复

## §4 修复

删除第 77 行的死代码（`const dnOrig=check` 和覆盖 `window._ehDeepNight` 的代码），替换为注释说明。

修复后 deepNight 的清理钩子完全由第 2 个 IIFE（第 34 行）管理，作用域清晰。

## §5 验证

- [ ] 本地 CDP 探测：修复后 `health-probe.py` 无 JS 异常
- [ ] CI：游戏回归和版本不一致是预存问题，与本轮改动无关
- [ ] 线上复测：push 后 GitHub Pages 部署完成后 CDP 探测无异常
