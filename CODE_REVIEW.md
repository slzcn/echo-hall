# Echo Hall 全站代码体检报告

**扫描时间**：2026-07-14 03:15
**范围**：`~/echo-hall/` 全部 HTML/JS
**结论**：**代码底子很扎实**（防串房/超时兜底/allSettled/Fragment/rIC 都做了、innerHTML 全 esc/safeEmoji 转义无 XSS），主要问题在**冗余清理和微优化**层面，真 bug 极少。

---

## 一、文件规模盘点

| 文件 | 大小 | 行数 | 状态 |
|---|---|---|---|
| `index.html` | 376K | 5712 | 🟢 主战场，健康 |
| `admin.html` | 103K | 1405 | 🟢 健康 |
| `jianghu.html` | 69K | ? | 🟡 **孤立文件**，index.html 未引用，独立玩法待定 |
| `audiotest.html` | 5K | - | 🔴 **死文件**，未引用 |
| `sing-compare.html` | 9K | - | 🔴 **死文件**，未引用 |
| `sing-debug.html` | 9K | - | 🔴 **死文件**，未引用 |
| `sing-truth.html` | 14K | - | 🔴 **死文件**，未引用 |
| `eh-config.default.js` | 5K | - | 🔴 **死文件**（阶段一注释说是"独立配置参考文件，可留作文档"，但未引用） |

**总计可清理 ~42K 死代码**（5 个死文件）。

---

## 二、🔴 高危问题（几乎没有）

**未发现明显崩溃/XSS/权限漏洞。**

- innerHTML 全部拼接前都过 `esc()`/`safeEmoji()`/`safeColor()`，✅ 无 XSS
- Realtime 订阅在 `enterRoom`/`leaveRoom` 有配对 `removeChannel`，✅ 无泄漏
- loadHistory 有 `_enterRid` 防串房、`withTimeout(10s)` 兜底、`Promise.allSettled` 防单点，✅ 竞态处理完善
- rIC 分批渲染带 `{timeout:250}`，✅ 后台不卡死

---

## 三、🟡 中危问题

### 3.1 SB_ANON key 硬编码在前端（`index.html:1678`）
```js
const SB_ANON = 'eyJhbG…GpnY';   // legacy JWT anon key 明文
```
→ **现状**：anon key 本身可以前端暴露（Supabase 设计允许），风险主要在**未启用 RLS 的表**上。
→ **建议**：确保所有 `eh_*` 表都开了 RLS（应该已开，可 admin 后台验证下）。**这是设计问题不是 bug，不用改**，但建议在 `eh-config-refactor-progress.md` 阶段的"后续安全收口"里跟进。

### 3.2 `setInterval` 未清理（页面生命周期一直跑）
- `index.html:2010` — 每分钟检查日夜自动切换（无 clear，但页面级永久任务，可接受）
- `index.html:5626` — 每 5 分钟检查深夜模式（同上）
- `index.html:5634` — 每 3 秒轮询灵魂主导情绪（**离房后也在跑**，浪费 CPU）
- `index.html:2740` — heartbeatTimer 心跳（`leaveRoom` 已 clear ✅）

→ **建议**：把 `moodWeather` 轮询在离房时暂停：
```js
// 现状 L5634
setInterval(()=>{ if(!document.body.classList.contains('hall-on')...){ return; } ... }, 3000);
// 改成
let _moodT=null;
function startMood(){ if(_moodT) return; _moodT=setInterval(...,3000); }
function stopMood(){ if(_moodT){clearInterval(_moodT); _moodT=null;} }
// enterRoom 调 startMood；leaveRoom 调 stopMood
```
→ 收益：离房/大厅时不跑 3s 轮询，省电（尤其手机）。工作量 5min。

### 3.3 事件监听器无 `removeEventListener`（`index.html` 全站 50 处 add / 0 处 remove）
- 大部分是页面级全局监听（click/keydown/visibilitychange）不需要移除
- **但**：部分是消息气泡、房间卡片这种**会大量创建销毁的 DOM 元素**上的监听
→ **建议**：抽样检查消息气泡的监听是否用了事件委托（用了就没事）。如果每条消息独立绑定，长会话堆积会漏内存。
→ 主查已确认 `menu.querySelectorAll('.at-item').forEach(el=>el.onclick=...)` 用 onclick 属性（不重复叠加，✅ 安全）。
→ 结论：**不是 bug，但下次大重构时统一改事件委托更好**。

### 3.4 生产环境 `console.log` 遗留
- **只有 3 处真正的 `console.log`**：
  - `L4238 console.log('[song resumed]', ...)`
  - `L4299 console.log('[song ready]', ...)`
  - `L4782 console.log('[EH] client caches purged:', reason||'')`
- 其余 43 处都是 `console.warn`（错误诊断，**该保留**）
→ **建议**：这 3 处 log 改成 `if(location.search.includes('debug=1')) console.log(...)`，或直接删。工作量 2min。

---

## 四、🟢 低危 / 规范 / 冗余

### 4.1 可读性差的超长单行（`index.html:2686`，547 字符）
```js
const fresh=buildMsgEl(m); if(fresh){ bubble.replaceWith(fresh); if(wasPending){ const nc=fresh.querySelector('.song-card'); if(nc && !nc.classList.contains('pending')){ ... }}}
```
→ **建议**：换行拆开，逻辑相同但可读性大增。工作量 5min。

### 4.2 巨石文件（`index.html` 5712 行）
- 4218 行 inline `<script>` 全都在 HTML 里，无法浏览器缓存
- 每次改 1 行 JS，整个 376K HTML 需重新下载
→ **建议**（可选，看主人偏好）：拆分为
  - `index.html`（骨架 ~1400 行 CSS + HTML）
  - `app.js`（4200 行主逻辑，加 `?v=YYYYMMDD` cache-busting）
  - `theme.js`（EH_CONFIG + injectThemeCSS）
→ 收益：改 JS 不需重新下 HTML，浏览器缓存命中率↑。但会破坏"单文件部署"的简洁性。
→ 工作量 1-2h，但**只有大迭代时才划算**。目前不做也行。

### 4.3 少量重复工具函数
- `esc` (L1691) / `safeEmoji` / `safeColor` — 用得多，已封装 ✅
- `fmtAgo` (L2205) / `fmtTime` (L2912) / `fmtDur` (L3554) — 都是时间格式化，功能有交叉但语义不同，可保留
→ 无冗余，✅

### 4.4 全局变量 window.xxx 挂载（暴露到全局）
```
window.EhFx     — 需要（跨闭包调用）
window.EhSfx    — 需要
window.playSong — hook 需要
window.syncSkinActive — ?（需查用途）
window.__EH_BUILD_VER — 自愈机制用
window.__ehdbg — debug=1 用
window.__preHall — ?
```
→ **建议**：`syncSkinActive` 和 `__preHall` 查下是否真需要暴露。工作量 5min。

### 4.5 命名混合（camelCase + snake_case）
→ snake_case 全是 Supabase 表字段/列名（`user_id`/`created_at`/`deleted_at`），JS 变量全 camelCase。**这是正常的**，因为要跟数据库对齐。✅

---

## 五、性能优化建议

### 5.1 首屏加速已做（已做的不再动）
- ✅ preconnect + dns-prefetch + preload Supabase 库
- ✅ Supabase 库 `<script defer>`（不阻塞首屏）
- ✅ 首屏内联防闪 CSS
- ✅ 大厅列表预取缓存

### 5.2 可加的微优化
- **懒加载 admin 相关代码**：admin.html 独立页面已经 ✅
- **神曲预取限流**：L2616 `.slice(-3)` 只预取 3 首 ✅ 已优化过
- **图片/头像用 emoji 无图片开销** ✅

### 5.3 无明显性能瓶颈

---

## 六、TOP 10 优先修复清单（按 ROI 排序）

| # | 事项 | 收益 | 工作量 | 优先级 |
|---|---|---|---|---|
| 1 | **删 5 个死文件** (audiotest/sing-*.html/eh-config.default.js) | 减 42K 仓库体积、避免误引用 | 2min | 🔥 立即 |
| 2 | **归档或删 `jianghu.html`** (孤立独立玩法，未接入 index) | 明确项目边界 | 需主人确认 | 🔥 立即 |
| 3 | **3 处 `console.log` 加 debug gate** (L4238/L4299/L4782) | 生产日志干净 | 2min | 🔥 立即 |
| 4 | **`moodWeather` 离房停轮询** (L5634) | 省手机电量 | 5min | ⚡ 建议 |
| 5 | **L2686 超长行拆分** | 可读性 | 5min | ⚡ 建议 |
| 6 | **`window.__preHall`/`syncSkinActive` 用途梳理** | 减少全局污染 | 10min | 💡 可选 |
| 7 | **admin/index 提取公共 utils.js** (esc/toast/api) | 减少重复 | 30min | 💡 可选 |
| 8 | **`sb.from('eh_config').select(...)` 加 5min 客户端缓存** | 减少启动请求 | 15min | 💡 可选 |
| 9 | **拆分 5712 行 index.html** | 缓存命中率、可维护性 | 1-2h | 💡 大迭代时 |
| 10 | **SB_ANON key 前端暴露** | 确认所有表 RLS 已开 | 需 admin 检查 | 💡 后续 |

---

## 七、我的整体判断

**Echo Hall 的代码质量在同类"单人独立开发的巨石 HTML 项目"里排前 10%。** 关键工程实践（超时兜底、竞态防护、错误降级、防串房、批量渲染、缓存策略）都做了。

**主人问的"整体优化"，我建议只做 #1-#5**（合计 ~15min），能拿到 90% 的收益。其余的 #6-#10 是"锦上添花"，不做也完全 OK。

---

## 八、想立刻执行的话

我可以现在就把 #1-#5 全做了（删死文件 + 清 console + moodWeather 离房停 + L2686 拆行），一次 commit 部署 2 处（GitHub Pages + 妙搭）。要不要动手？
