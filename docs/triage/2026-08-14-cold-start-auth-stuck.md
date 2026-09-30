# 进程死后刷新卡登录页/点击无响应

- 日期：2026-08-14
- 报告人：主人
- 现象：**进程死掉后**，刷新页面经常卡在登录页/预绘骨架，要**半天才能进来**，**这时点哪里都没反应**。

## 1. 现象拆解与复现
三个可以独立观测的症状：
- 症状 A：卡在登录页/骨架
- 症状 B：点击无响应（不是"点了没进"而是"事件像被卡住了"）
- 症状 C：等很久（"半天"）才恢复

触发前置：**进程死掉后**（浏览器/Webview 冷启）。热刷新一般不复现——因为进程已在，SW 已 activate，Supabase 库和 GoTrue 状态在内存里。

## 2. 单一根因假设
**GoTrue `getSession()` 内部 autoRefreshToken 网络卡住 → boot 阻塞在 `resolveSession` 的"兜底重读"**（该重读故意不带超时，见 `js/app.js:199`），导致：
- authHandled 永远为 false（症状 B 点击无响应的直接原因：全站需 auth 的动作都在等）
- 4s 兜底 `goScene('enter')` 触发后卡登录页，但登录页本身也依赖 sb（症状 A）
- 直到 GoTrue 内部超时/网络恢复才继续（症状 C 半天）

进程死掉时容易撞上：SW 首次就绪 + supabase 库 defer 首次执行 + GoTrue 首次 getSession + autoRefresh 网络请求，任一环慢就叠加。

## 3. 反证 / 佐证
- 代码原注释（`app.js:189-192`）自己就写着"getSession 偶发 hang 是内部顺带 autoRefresh 的网络卡了"——问题已被识别，但兜底路径故意没加超时，与热路径不对称。
- 首次读带 3.5s 超时，说明作者知道会卡；兜底不带超时，是当时权衡"网络抖动不误判"的取舍——但**结果是让"网络真慢"场景全部变成"点哪都没反应"**。

## 4. 最小改动方案
四处协同、都是"补漏"而非"改行为"：

1. **`resolveSession` 兜底重读也套超时**（放宽为 5s，比首次 3.5s 宽松）——超时后走原有失效路径（正式账号提示重登、匿名走匿名登录），不再无限等。
2. **`bootSupabase` 兜底回落窗口 4s → 3s 并接受"提前打断"**：预绘 hall 期间**用户任意点击/键盘输入即立即触发回落到 enter**（把 UI 从"点哪没反应的骨架"解放出来）。同时保留 3s 无操作自动回落。
3. **回落 enter 后仍保留后台 authHandled 追认**：session 慢返回时不再"卡住"，但如果它后来真的返回了、且用户还在 enter 页，进一次 `resumeAfterAuth` 无缝进房——不需要用户手动再点一次。
4. **进程冷启动检测**：`performance.getEntriesByType('navigation')[0].type === 'reload'` 且 `navigationStart` 距上次 unload > 60s 视为冷启动，把 3s 兜底进一步降到 1.5s（不用等，直接给用户操作机会）。

**不做**：不动 SW 缓存策略（无关）、不改 auth 主逻辑（`ensureAuth`/`signInAnonymously` 不动）、不动预绘 hall 骨架（那是好东西，只是需要"可打断"）。

## 5. 验证方式
- CDP 模拟网络 offline 3-8s 后 online，观察启动是否卡死。
- CDP 手动 `sb.auth.getSession()` mock 为永不 resolve 的 Promise，验证兜底超时能否救回。
- 真机进程杀掉重启（这是主人真实场景）——无法自动化，主人复测。
- ci-check.sh 20 项旅程全绿。

## 6. 结果回填
（待填）
